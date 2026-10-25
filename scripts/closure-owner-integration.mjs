import fs from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {randomUUID,randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {targetEnvironment} from "./migration-target-inspect.mjs";
import {protectMigrationDirectory,PRIVATE_DIR,connectTargetPg} from "./migration-target-runtime.mjs";
import {digest,ROOT} from "./backup-common.mjs";
export const PROJECT="hgntppemxwcxaxritnfq",BASE="http://localhost:3002";
export const STATE=resolve(PRIVATE_DIR,"closure-test-accounts.json"),MANIFEST=resolve(PRIVATE_DIR,"closure-test-manifest.json");
const REPO="https://github.com/seebdev/tolentino-chef",SERVICE="srv-dba32beq1p3s73a4g6v0",WORKSPACE="tea-dba1s4m1egvs7391ve50";
export const requireState=(condition,code)=>{if(!condition)throw Error("CLOSURE_"+code)};
export const secret=()=>randomBytes(24).toString("base64url");
export function readState(){const value=JSON.parse(fs.readFileSync(STATE,"utf8"));requireState(value.format==="tolentino-closure-owned-v1"&&value.projectRef===PROJECT&&value.base===BASE,"STATE_INVALID");return value}
export function saveState(value){
 requireState(value.projectRef===PROJECT&&value.base===BASE,"STATE_TARGET");
 requireState(!fs.existsSync(STATE)||!fs.lstatSync(STATE).isSymbolicLink(),"STATE_LINK");
 const next=STATE+".next";requireState(!fs.existsSync(next),"STATE_TEMP_EXISTS");
 const fd=fs.openSync(next,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+"\n");fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 fs.renameSync(next,STATE);requireState(digest(readState())===digest(value),"STATE_ROUNDTRIP");
}
export async function assertHealth(){
 const r=await fetch(BASE+"/api/health",{redirect:"error",signal:AbortSignal.timeout(30000)});
 const value=await r.json();requireState(r.status===200&&value.configured&&value.supabaseProjectRef===PROJECT,"APP_TARGET");
}
export class ClosureSession{
 constructor(){this.jar=new Map()}
 async request(path,{method="GET",data,form}={}){
  requireState(path.startsWith("/api/")||path.startsWith("/q/"),"APP_PATH");
  if(method!=="GET")await assertHealth();
  const headers={origin:BASE,cookie:[...this.jar].map(([k,v])=>k+"="+v).join("; ")};
  if(data)headers["content-type"]="application/json";
  const response=await fetch(BASE+path,{method,headers,body:form||(data?JSON.stringify(data):undefined),redirect:"manual",signal:AbortSignal.timeout(90000)});
  for(const raw of response.headers.getSetCookie()){const pair=raw.split(";")[0],i=pair.indexOf("=");this.jar.set(pair.slice(0,i),pair.slice(i+1))}
  const type=response.headers.get("content-type")||"";
  const value=type.includes("json")?await response.json():Buffer.from(await response.arrayBuffer());
  return{status:response.status,data:value,headers:response.headers};
 }
 async login(identifier,password){return this.request("/api/auth",{method:"POST",data:{action:"login",identifier,password}})}
 async logout(){return this.request("/api/auth",{method:"POST",data:{action:"logout"}})}
}
export function serviceRead(env){
 const delegate=fetch;
 return createClient(env.TARGET_SUPABASE_URL,env.TARGET_SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:async(input,options={})=>{
   const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),method=(options.method||"GET").toUpperCase();
   requireState(url.origin==="https://"+PROJECT+".supabase.co"&&(method==="GET"||method==="HEAD"||(method==="POST"&&url.pathname==="/storage/v1/object/list/restaurant-media")),"SERVICE_WRITE_BLOCKED");
   return delegate(input,{...options,redirect:"error",signal:options.signal||AbortSignal.timeout(60000)});
  }}
 });
}
const checked=(result,code)=>{requireState(!result.error,code);return result.data};
export async function readAll(db,table,filter){
 const rows=[];for(let start=0;;start+=200){
  let query=db.from(table).select("*");if(filter)query=query.in(filter.field,filter.ids);
  const page=checked(await query.range(start,start+199),"READ_"+table.toUpperCase());
  requireState(Array.isArray(page),"READ_SHAPE");rows.push(...page);requireState(rows.length<=100000,"ROW_LIMIT");if(page.length<200)return rows;
 }
}
export async function originalsFingerprint(db,ids){
 const specs={restaurants:"id",restaurant_memberships:"restaurant_id",restaurant_settings:"restaurant_id",categories:"restaurant_id",products:"restaurant_id",promotions:"restaurant_id",restaurant_hours:"restaurant_id",translations:"restaurant_id",restaurant_qr_configs:"restaurant_id",restaurant_domains:"restaurant_id",commercial_sales:"restaurant_id"};
 const result={};
 for(const [table,field]of Object.entries(specs)){const rows=await readAll(db,table,{field,ids});result[table]={count:rows.length,hash:digest(rows.map(digest).sort())}}
 for(const table of ["platform_admins","platform_settings"]){const rows=await readAll(db,table);result[table]={count:rows.length,hash:digest(rows.map(digest).sort())}}
 return result;
}
export async function assertOwned(db,state,account){
 requireState(account.restaurantId&&!state.baseline.restaurantIds.includes(account.restaurantId),"ORIGINAL_WRITE_BLOCKED");
 const restaurant=checked(await db.from("restaurants").select("*").eq("id",account.restaurantId).single(),"OWNED_RESTAURANT");
 const members=checked(await db.from("restaurant_memberships").select("*").eq("restaurant_id",account.restaurantId),"OWNED_MEMBERSHIP");
 requireState(restaurant.is_demo===true&&restaurant.slug===account.slug&&restaurant.owner_email===account.email&&members.length===1,"OWNERSHIP");
 const user=checked(await db.auth.admin.getUserById(members[0].user_id),"OWNED_AUTH").user;
 requireState(user.email===account.email&&user.app_metadata.creation_request_id===account.requestId&&user.app_metadata.creation_actor_id===state.meta.adminId&&user.app_metadata.demo===true,"AUTH_OWNERSHIP");
 requireState(!state.baseline.userIds.includes(user.id),"ORIGINAL_AUTH_BLOCKED");
 if(account.userId)requireState(account.userId===user.id,"OWNER_UUID_CHANGED");
 return{restaurant,user};
}
export async function preflight(){
 const env=targetEnvironment();requireState(env.TARGET_SUPABASE_URL==="https://"+PROJECT+".supabase.co","CONFIG_TARGET");
 requireState(execFileSync("git",["remote","get-url","origin"],{cwd:ROOT,encoding:"utf8"}).trim().replace(/\.git$/,"")===REPO,"REPOSITORY");
 const remote=execFileSync(resolve(ROOT,".runtime/gh/bin/gh.exe"),["api","repos/seebdev/tolentino-chef/git/ref/heads/main","--jq",".object.sha"],{cwd:ROOT,encoding:"utf8",windowsHide:true}).trim();
 const render=async suffix=>{const r=await fetch("https://api.render.com/v1/services/"+SERVICE+suffix,{headers:{Authorization:"Bearer "+env.TARGET_RENDER_API_KEY},redirect:"error",signal:AbortSignal.timeout(30000)});requireState(r.ok,"RENDER_READ");return r.json()};
 const service=await render("");requireState(service.ownerId===WORKSPACE&&service.branch==="main"&&service.repo.replace(/\.git$/,"")===REPO&&service.serviceDetails.plan==="free","RENDER_TARGET");
 const deploys=(await render("/deploys?limit=20")).map(r=>r.deploy);
 requireState(deploys.find(d=>d.status==="live")?.commit?.id===remote,"MAIN_LIVE_MISMATCH");
 const settings=await fetch(env.TARGET_SUPABASE_URL+"/auth/v1/settings",{headers:{apikey:env.TARGET_SUPABASE_PUBLISHABLE_KEY},redirect:"error"});const auth=await settings.json();requireState(settings.ok&&auth.disable_signup===true,"SIGNUP_OPEN");
 await assertHealth();let pg;
 try{pg=await connectTargetPg(env);const versions=(await pg.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(r=>r.version);requireState(["20261018053627","20261018053802","20261018053943","20261018054420"].every(v=>versions.includes(v)),"SCHEMA_NOT_READY")}finally{await pg?.end()}
 const acl=protectMigrationDirectory();
 requireState(execFileSync("git",["check-ignore",STATE],{cwd:ROOT,encoding:"utf8"}).trim(),"PRIVATE_NOT_IGNORED");
 return{env,db:serviceRead(env),acl,destination:{projectRef:PROJECT,serviceId:SERVICE,branch:"main",liveCommit:remote,localOrigin:BASE}};
}
export function writeManifest(state){
 const manifest={format:state.format,projectRef:PROJECT,base:BASE,runId:state.runId,meta:state.meta,restaurants:Object.entries(state.accounts).map(([key,a])=>({key,id:a.restaurantId,userId:a.userId,slug:a.slug,alias:a.alias,isDemo:true,status:"active",publicToken:a.publicToken,stage:a.stage,creationRequestId:a.requestId}))};
 fs.writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
}
export function evidence(name,report){
 const directory=resolve(ROOT,"docs/evidence/functional-closure-20261018");fs.mkdirSync(directory,{recursive:true});const file=resolve(directory,name);
 fs.writeFileSync(file,JSON.stringify(report,null,2)+"\n");return file.slice(ROOT.length+1).replaceAll("\\","/");
}
export async function provision(){
 requireState(process.argv.includes("--apply")&&process.argv[process.argv.indexOf("--confirm-target")+1]===PROJECT,"APPLY_CONFIRMATION");
 const {db,acl,destination}=await preflight();
 const admin=JSON.parse(fs.readFileSync(resolve(PRIVATE_DIR,"admin-account.json"),"utf8"));
 const session=new ClosureSession(),sessions=[];
 let state;
 try{
  const login=await session.login(admin.email,admin.password);requireState(login.status===200&&login.data.role==="superadmin","ADMIN_LOGIN");
  if(fs.existsSync(STATE))state=readState();
  else{
   const restaurants=await readAll(db,"restaurants");
   const users=[];for(let page=1;;page++){const data=checked(await db.auth.admin.listUsers({page,perPage:200}),"AUTH_LIST");users.push(...data.users);if(data.users.length<200)break;requireState(page<500,"AUTH_LIMIT")}
   const nonce=randomUUID().slice(0,8),runId=new Date().toISOString().replace(/[^0-9TZ]/g,"")+"-"+nonce;
   state={format:"tolentino-closure-owned-v1",projectRef:PROJECT,base:BASE,runId,meta:{adminId:admin.userId,creationRunId:runId},baseline:{restaurantIds:restaurants.map(r=>r.id),userIds:users.map(u=>u.id),fingerprint:await originalsFingerprint(db,restaurants.map(r=>r.id))},accounts:{}};
   for(const key of ["alpha","beta","gamma"])state.accounts[key]={email:"closure-"+key+"-"+nonce+"@tolentino-demo.test",password:secret(),temporaryPassword:secret(),requestId:randomUUID(),accessRequestId:randomUUID(),slug:"closure-"+key+"-"+nonce,alias:"closure."+key+"."+nonce,stage:"prepared"};
   saveState(state);
  }
  requireState(state.meta.adminId===admin.userId,"ADMIN_ID_CHANGED");
  for(const [key,account]of Object.entries(state.accounts)){
   if(!account.restaurantId){
    const created=await session.request("/api/admin/restaurants",{method:"POST",data:{action:"create",requestId:account.requestId,data:{name:"QA Closure "+key.toUpperCase(),slug:account.slug,owner_name:"Propietario QA "+key,owner_email:account.email,description:"Restaurante temporal exclusivo de pruebas de cierre funcional.",demo:true,currency:"COP",default_language:"es"}}});
    requireState(created.status===201&&created.data.demo===true&&created.data.invitationSent===false,"CREATE_"+key.toUpperCase());
    account.restaurantId=created.data.restaurantId;account.stage="created";saveState(state);
   }
   const owned=await assertOwned(db,state,account);account.userId=owned.user.id;account.publicToken=owned.restaurant.public_token;saveState(state);
   if(account.stage==="created"){
    const access=await session.request("/api/admin/owner-access",{method:"POST",data:{restaurantId:account.restaurantId,requestId:account.accessRequestId,action:"set_password",alias:account.alias,password:account.temporaryPassword}});
    requireState(access.status===200&&access.data.requiresPasswordChange===true||access.status===200&&access.data.replayed===true,"ACCESS_"+key.toUpperCase());
    account.stage="temporary-set";saveState(state);
   }
   if(account.stage==="temporary-set"){
    const owner=new ClosureSession();sessions.push(owner);
    const entered=await owner.login(account.alias,account.temporaryPassword);requireState(entered.status===200&&entered.data.requiresPasswordChange===true&&entered.data.redirect==="/login?mode=password","FIRST_LOGIN_"+key.toUpperCase());
    const blocked=await owner.request("/api/workspace/"+account.restaurantId);requireState(blocked.status===403&&blocked.data.code==="PASSWORD_CHANGE_REQUIRED","GATE_"+key.toUpperCase());
    const changed=await owner.request("/api/auth",{method:"POST",data:{action:"password",password:account.password}});requireState(changed.status===200,"PASSWORD_"+key.toUpperCase());
    const workspace=await owner.request("/api/workspace/"+account.restaurantId);requireState(workspace.status===200&&workspace.data.role==="owner","OWNER_READY_"+key.toUpperCase());
    account.stage="ready";delete account.temporaryPassword;saveState(state);await owner.logout();sessions.splice(sessions.indexOf(owner),1);
   }
   requireState(account.stage==="ready","READY_STAGE");writeManifest(state);
   console.log(JSON.stringify({stage:"ready",key,restaurantId:account.restaurantId,slug:account.slug}));
  }
  requireState(digest(await originalsFingerprint(db,state.baseline.restaurantIds))===digest(state.baseline.fingerprint),"ORIGINAL_CONTENT_CHANGED");
  const report={at:new Date().toISOString(),result:"PASS",operation:"provision-isolated-owner-fixtures",destination,acl,accounts:3,initialAliasAndPasswordChange:3,firstChangeApiDenied:3,existingContentUnchanged:true,noEmails:true,cleanupPerformed:false,credentials:"private ignored ACL-protected file",restaurants:Object.entries(state.accounts).map(([key,a])=>({key,id:a.restaurantId,slug:a.slug,stage:a.stage}))};
  const file=evidence("closure-owner-provision.json",report);console.log(JSON.stringify({result:"PASS",evidence:file,accounts:3,existingContentUnchanged:true}));
 }finally{for(const s of sessions)await s.logout().catch(()=>{});await session.logout().catch(()=>{})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{requireState(process.argv.includes("--provision"),"MODE_REQUIRED");await provision()}catch(error){console.error(JSON.stringify({result:"FAIL",code:/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:"CLOSURE_OPERATION_FAILED"}));process.exitCode=1}
}
