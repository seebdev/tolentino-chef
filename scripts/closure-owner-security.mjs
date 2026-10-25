import fs from "node:fs";
import {resolve} from "node:path";
import {createClient} from "@supabase/supabase-js";
import sharp from "sharp";
import jsQR from "jsqr";
import {randomUUID} from "node:crypto";
import {ClosureSession,preflight,readState,saveState,assertOwned,requireState as ok,secret,evidence,PROJECT,BASE,originalsFingerprint,writeManifest} from "./closure-owner-integration.mjs";
import {PRIVATE_DIR} from "./migration-target-runtime.mjs";
import {digest} from "./backup-common.mjs";
const report={at:new Date().toISOString(),operation:"real-isolated-owner-security",checks:[],remoteEmails:0,existingOwnersChanged:0,cleanupPerformed:false};
const sessions=[],clients=[];
let stage="preflight",state;
const check=(name,pass,extra={})=>{report.checks.push({name,pass,...extra});ok(pass,name.toUpperCase().replace(/[^A-Z0-9]+/g,"_"))};
async function expectStatus(name,response,status){check(name,response.status===status,{status:response.status});return response}
async function loginApp(account,identifier=account.alias,password=account.password){
 const s=new ClosureSession();sessions.push(s);const result=await s.login(identifier,password);await expectStatus("Login temporary task-owned owner",result,200);return s;
}
function directClient(env){
 const delegate=fetch;
 const client=createClient(env.TARGET_SUPABASE_URL,env.TARGET_SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async(input,options={})=>{const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);ok(url.origin==="https://"+PROJECT+".supabase.co","DIRECT_TARGET");return delegate(input,{...options,redirect:"error",signal:options.signal||AbortSignal.timeout(60000)})}}
 });clients.push(client);return client;
}
async function loginDirect(env,account,password=account.password){
 const client=directClient(env);const result=await client.auth.signInWithPassword({email:account.email,password});check("Direct Auth login for task-owned identity",!result.error&&result.data.user?.id===account.userId);return client;
}
try{
 ok(process.argv.includes("--apply")&&process.argv[process.argv.indexOf("--confirm-target")+1]===PROJECT,"APPLY_CONFIRMATION");
 const {db,env,destination}=await preflight();report.destination=destination;
 state=readState();ok(Object.values(state.accounts).every(a=>a.stage==="ready"),"ACCOUNTS_NOT_READY");
 for(const a of Object.values(state.accounts))await assertOwned(db,state,a);
 const adminCredentials=JSON.parse(fs.readFileSync(resolve(PRIVATE_DIR,"admin-account.json"),"utf8"));
 const admin=new ClosureSession();sessions.push(admin);
 const signed=await admin.login(adminCredentials.email,adminCredentials.password);check("Administrator identity kept",signed.status===200&&signed.data.role==="superadmin");
 const gamma=state.accounts.gamma;
 stage="gamma-reset";
 const old=await loginApp(gamma),oldDirect=await loginDirect(env,gamma);
 await expectStatus("Owner access works before reset",await old.request("/api/workspace/"+gamma.restaurantId),200);
 if(!gamma.reset){gamma.reset={requestId:randomUUID(),temporaryPassword:secret(),password:secret(),phase:"prepared"};saveState(state)}
 ok(gamma.reset.phase==="prepared","RESET_ALREADY_STARTED_REVIEW_REQUIRED");
 gamma.reset.phase="sent";saveState(state);
 const changed=await admin.request("/api/admin/owner-access",{method:"POST",data:{action:"set_password",restaurantId:gamma.restaurantId,requestId:gamma.reset.requestId,alias:gamma.alias,password:gamma.reset.temporaryPassword}});
 check("Temporary password returned once",changed.status===200&&changed.data.secretAvailable===true&&changed.data.temporaryPassword===gamma.reset.temporaryPassword);
 const replay=await admin.request("/api/admin/owner-access",{method:"POST",data:{action:"set_password",restaurantId:gamma.restaurantId,requestId:gamma.reset.requestId,alias:gamma.alias,password:gamma.reset.temporaryPassword}});
 check("Completed access retry never returns credential",replay.status===200&&replay.data.replayed===true&&replay.data.secretAvailable===false&&!replay.data.temporaryPassword);
 await expectStatus("Old application session denied after reset",await old.request("/api/workspace/"+gamma.restaurantId),401);
 const staleRows=await oldDirect.from("restaurants").select("id").eq("id",gamma.restaurantId);
 check("Old direct REST JWT has no access after reset",(!staleRows.error&&staleRows.data.length===0)||staleRows.status===401,{status:staleRows.status});
 const temporary=await loginApp(gamma,gamma.alias,gamma.reset.temporaryPassword);
 const pending=await temporary.request("/api/workspace/"+gamma.restaurantId);
 check("Temporary login cannot enter business API",pending.status===403&&pending.data.code==="PASSWORD_CHANGE_REQUIRED");
 const temporaryDirect=await loginDirect(env,gamma,gamma.reset.temporaryPassword);
 const gated=await temporaryDirect.from("restaurants").select("id").eq("id",gamma.restaurantId);check("Temporary login cannot bypass through direct REST",!gated.error&&gated.data.length===0);
 const completed=await temporary.request("/api/auth",{method:"POST",data:{action:"password",password:gamma.reset.password}});
 await expectStatus("Owner completes first mandatory change",completed,200);
 gamma.password=gamma.reset.password;gamma.reset.phase="completed";delete gamma.reset.password;delete gamma.reset.temporaryPassword;saveState(state);
 await expectStatus("Changed password unlocks same owner session",await temporary.request("/api/workspace/"+gamma.restaurantId),200);
 const discarded=await temporaryDirect.from("restaurants").select("id").eq("id",gamma.restaurantId);check("Other temporary session cannot keep access",(!discarded.error&&discarded.data.length===0)||discarded.status===401);
 const aliasConflict=await admin.request("/api/admin/owner-access",{method:"POST",data:{action:"alias",restaurantId:gamma.restaurantId,alias:state.accounts.alpha.alias}});
 check("Duplicate normalized owner alias rejected",aliasConflict.status===409&&aliasConflict.data.code==="OWNER_ALIAS_TAKEN");
 await expectStatus("Owner denied administrative access action",await temporary.request("/api/admin/owner-access?restaurantId="+gamma.restaurantId),403);
 const privateLookup=await temporaryDirect.rpc("resolve_owner_login",{p_alias:state.accounts.alpha.alias});check("Direct alias directory not exposed",Boolean(privateLookup.error));
 stage="gamma-suspension";
 await expectStatus("Suspend only task-owned owner",await admin.request("/api/admin/owner-access",{method:"POST",data:{action:"status",restaurantId:gamma.restaurantId,alias:gamma.alias,isActive:false}}),200);
 await expectStatus("Suspended membership immediately blocks session",await temporary.request("/api/workspace/"+gamma.restaurantId),403);
 await expectStatus("Reactivate only task-owned owner",await admin.request("/api/admin/owner-access",{method:"POST",data:{action:"status",restaurantId:gamma.restaurantId,alias:gamma.alias,isActive:true}}),200);
 await expectStatus("Reactivation does not revive old session",await temporary.request("/api/workspace/"+gamma.restaurantId),401);
 const reactivated=await loginApp(gamma);await expectStatus("Fresh session after membership reactivation works",await reactivated.request("/api/workspace/"+gamma.restaurantId),200);
 await expectStatus("Suspend only task-owned restaurant",await admin.request("/api/admin/restaurants",{method:"POST",data:{action:"status",restaurantId:gamma.restaurantId,data:{status:"suspended"}}}),200);
 await expectStatus("Restaurant suspension immediately blocks prior session",await reactivated.request("/api/workspace/"+gamma.restaurantId),401);
 await expectStatus("Reactivate only task-owned restaurant",await admin.request("/api/admin/restaurants",{method:"POST",data:{action:"status",restaurantId:gamma.restaurantId,data:{status:"active"}}}),200);
 await expectStatus("Restaurant reactivation requires new session",await reactivated.request("/api/workspace/"+gamma.restaurantId),401);
 stage="support";
 const support=await admin.request("/api/workspace/"+gamma.restaurantId);check("Support workspace retains superadmin role",support.status===200&&support.data.role==="superadmin");
 const adminSession=await admin.request("/api/session");check("Support never impersonates owner",adminSession.status===200&&adminSession.data.role==="superadmin");
 stage="media-and-isolation";
 const active={};
 const image=await sharp({create:{width:12,height:12,channels:3,background:{r:40,g:80,b:60}}}).png().toBuffer();
 for(const [key,account]of Object.entries(state.accounts)){
  const app=await loginApp(account),direct=await loginDirect(env,account);active[key]={app,direct};
  if(!account.mediaPaths?.length){
   const form=new FormData();form.set("file",new File([image],"closure-isolation.png",{type:"image/png"}));
   const uploaded=await app.request("/api/workspace/"+account.restaurantId+"/media",{method:"POST",form});
   check("Own Storage upload "+key,uploaded.status===201&&uploaded.data.path.startsWith(account.restaurantId+"/"));
   account.mediaPaths=[uploaded.data.path];saveState(state);
  }
  const ownDownload=await direct.storage.from("restaurant-media").download(account.mediaPaths[0]);check("Own private Storage download "+key,!ownDownload.error&&ownDownload.data.size>0);
  const ownRows=await direct.from("restaurants").select("id").eq("id",account.restaurantId);check("Own direct RLS positive control "+key,!ownRows.error&&ownRows.data.length===1);
  const qr=await app.request("/api/workspace/"+account.restaurantId+"/qr?format=png&size=256");
  if(qr.status===200){const raw=await sharp(qr.data).ensureAlpha().raw().toBuffer({resolveWithObject:true});const decoded=jsQR(new Uint8ClampedArray(raw.data),raw.info.width,raw.info.height);check("Own QR decodes stable UUID "+key,decoded?.data===BASE+"/q/"+account.publicToken)}
  else check("Own QR export "+key,false,{status:qr.status});
  await expectStatus("Own translation job status "+key,await app.request("/api/workspace/"+account.restaurantId+"/translations"),200);
 }
 const tables=["restaurants","restaurant_settings","categories","products","promotions","restaurant_hours","translations","restaurant_qr_configs","restaurant_domains","translation_jobs"];
 for(const [from,a]of Object.entries(state.accounts))for(const [to,b]of Object.entries(state.accounts)){
  if(from===to)continue;const label=from+" to "+to,{app,direct}=active[from];
  await expectStatus("Cross-tenant API read denied "+label,await app.request("/api/workspace/"+b.restaurantId),403);
  await expectStatus("Cross-tenant API write denied "+label,await app.request("/api/workspace/"+b.restaurantId,{method:"POST",data:{action:"save_category",data:{name:"must-not-create"}}}),403);
  await expectStatus("Cross-tenant QR export denied "+label,await app.request("/api/workspace/"+b.restaurantId+"/qr?format=svg"),403);
  await expectStatus("Cross-tenant jobs read denied "+label,await app.request("/api/workspace/"+b.restaurantId+"/translations"),403);
  await expectStatus("Cross-tenant jobs enqueue denied "+label,await app.request("/api/workspace/"+b.restaurantId+"/translations",{method:"POST",data:{action:"enqueue",confirm:true}}),403);
  for(const table of tables){const result=await direct.from(table).select("*").eq(table==="restaurants"?"id":"restaurant_id",b.restaurantId);check("Cross-tenant RLS "+table+" "+label,!result.error&&result.data.length===0)}
  const deniedWrite=await direct.from("restaurants").update({name:"must-not-change"}).eq("id",b.restaurantId).select("id");check("Cross-tenant direct RLS update denied "+label,!deniedWrite.error&&deniedWrite.data.length===0);
  const listed=await direct.storage.from("restaurant-media").list(b.restaurantId);check("Cross-tenant Storage list hidden "+label,!listed.error&&listed.data.length===0);
  const deniedObject=await direct.storage.from("restaurant-media").download(b.mediaPaths[0]);check("Cross-tenant Storage object denied "+label,Boolean(deniedObject.error)&&!deniedObject.data);
 }
 stage="originals-preservation";
 check("Existing restaurant content unchanged",digest(await originalsFingerprint(db,state.baseline.restaurantIds))===digest(state.baseline.fingerprint));
 for(const account of Object.values(state.accounts))await assertOwned(db,state,account);
 writeManifest(state);
 report.result="PASS";report.tenantDirections=6;report.accountsRetained=3;report.credentialsUpdatedPrivately=true;
}catch(error){report.result="FAIL";report.stage=stage;report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:"CLOSURE_OWNER_SECURITY_FAILED";process.exitCode=1}
finally{
 for(const session of sessions)await session.logout().catch(()=>{});
 for(const client of clients)await client.auth.signOut({scope:"local"}).catch(()=>{});
 report.passed=report.checks.filter(c=>c.pass).length;report.failed=report.checks.filter(c=>!c.pass).length;
 const file=evidence("closure-owner-security.json",report);console.log(JSON.stringify({result:report.result,stage:report.stage,code:report.code,passed:report.passed,failed:report.failed,evidence:file}));
}
