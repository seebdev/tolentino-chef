import fs from "node:fs";
import {createClient} from "@supabase/supabase-js";
import {ClosureSession,preflight,readState,saveState,assertOwned,requireState as ok,evidence,PROJECT,originalsFingerprint,readAll,writeManifest} from "./closure-owner-integration.mjs";
import {connectTargetPg} from "./migration-target-runtime.mjs";
import {digest} from "./backup-common.mjs";

const report={at:new Date().toISOString(),operation:"cleanup-only-task-owned-closure-fixtures",projectRef:PROJECT,remoteMutations:0,auditRetained:true,translationBudgetReset:false};
let pg,stage="preflight";
const authIdentity=(user,account,state)=>user?.id===account.userId&&user?.email===account.email&&user.app_metadata?.creation_request_id===account.requestId&&user.app_metadata?.creation_actor_id===state.meta.adminId&&user.app_metadata?.demo===true;
async function listObjects(client,id){
 const paths=[];
 for(let offset=0;;offset+=100){
  const r=await client.storage.from("restaurant-media").list(id,{limit:100,offset,sortBy:{column:"name",order:"asc"}});
  ok(!r.error&&Array.isArray(r.data),"STORAGE_INVENTORY");
  for(const item of r.data){ok(item.id&&/^[0-9a-f-]{36}[.](webp|png|jpg|jpeg)$/i.test(item.name),"STORAGE_SHAPE");paths.push(id+"/"+item.name)}
  ok(paths.length<=10000,"STORAGE_LIMIT");if(r.data.length<100)return paths;
 }
}
try{
 ok(process.argv.includes("--apply")&&process.argv.includes("--confirm-workers-stopped")&&process.argv[process.argv.indexOf("--confirm-target")+1]===PROJECT,"CLEANUP_CONFIRMATION");
 const {db,env,destination}=await preflight();report.destination=destination;
 const state=readState(),accounts=Object.values(state.accounts),ids=accounts.map(a=>a.restaurantId),users=accounts.map(a=>a.userId);
 ok(accounts.length===3&&new Set(ids).size===3&&new Set(users).size===3,"OWNED_SET");
 ok(ids.every(id=>!state.baseline.restaurantIds.includes(id))&&users.every(id=>!state.baseline.userIds.includes(id)),"ORIGINAL_ID_BLOCKED");
 ok(accounts.every(a=>a.email.endsWith(".test")),"RESERVED_EMAIL_ONLY");
 if(state.cleanup?.phase==="completed"){report.result="PASS";report.replayed=true;report.remoteMutations=0}
 else{
  const current=await readAll(db,"restaurants");
  const keptIds=current.filter(r=>!ids.includes(r.id)).map(r=>r.id);
  ok(state.baseline.restaurantIds.every(id=>keptIds.includes(id)),"ORIGINAL_RESTAURANT_MISSING");
  const originals=await originalsFingerprint(db,keptIds);
  pg=await connectTargetPg(env);
  if(!state.cleanup){
   for(const account of accounts)await assertOwned(db,state,account);
   state.cleanup={phase:"verified",startedAt:new Date().toISOString(),retainedRestaurantIds:keptIds,retainedContent:originals,objects:[],ownedIds:ids,ownedUsers:users};
   saveState(state);
  }
  ok(digest(state.cleanup.ownedIds)===digest(ids)&&digest(state.cleanup.ownedUsers)===digest(users),"CLEANUP_JOURNAL_MISMATCH");
  const budgetBefore=(await pg.query("select limit_micro_usd,charged_micro_usd,blocked_reason from private.translation_budget where id")).rows[0];
  const existing=accounts.filter(a=>current.some(r=>r.id===a.restaurantId));
  if(existing.length){
   ok(existing.length===3,"PARTIAL_RESTAURANT_STATE");
   for(const account of accounts)await assertOwned(db,state,account);
   stage="suspend-task-memberships";
   await pg.query("begin read write");
   try{
    await pg.query("select id from public.restaurants where id=any($1::uuid[]) order by id for update",[ids]);
    const running=(await pg.query("select count(*)::int as n from public.translation_jobs where restaurant_id=any($1::uuid[]) and status='processing'",[ids])).rows[0].n;
    ok(running===0,"WORKER_STILL_PROCESSING");
    const suspended=await pg.query("update public.restaurant_memberships set is_active=false where restaurant_id=any($1::uuid[]) and user_id=any($2::uuid[]) returning restaurant_id",[ids,users]);
    ok(suspended.rows.length===3,"MEMBERSHIP_SET_CHANGED");
    await pg.query("commit");report.remoteMutations+=3;state.cleanup.phase="suspended";saveState(state);
   }catch(error){await pg.query("rollback");throw error}
  }else ok(["database-delete-started","database-deleted","auth-delete-started"].includes(state.cleanup.phase),"MISSING_WITHOUT_JOURNAL");

  stage="inventory-task-storage";
  const paths=[];
  for(const id of ids)paths.push(...await listObjects(db,id));
  const allowedPaths=new Set(paths),allowedUsers=new Set(users),delegate=fetch;
  const destructive=createClient(env.TARGET_SUPABASE_URL,env.TARGET_SUPABASE_SERVICE_ROLE_KEY,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(input,options={})=>{
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url),method=(options.method||"GET").toUpperCase();
    ok(url.origin==="https://"+PROJECT+".supabase.co","DELETE_TARGET");
    let allowed=method==="GET"||method==="HEAD";
    if(method==="DELETE"&&url.pathname==="/storage/v1/object/restaurant-media"){
     const payload=JSON.parse(options.body);allowed=Array.isArray(payload.prefixes)&&payload.prefixes.length>0&&payload.prefixes.every(p=>allowedPaths.has(p));
    }
    if(method==="DELETE"&&url.pathname.startsWith("/auth/v1/admin/users/"))allowed=allowedUsers.has(url.pathname.split("/").at(-1));
    ok(allowed,"DELETE_SCOPE");return delegate(input,{...options,redirect:"error",signal:options.signal||AbortSignal.timeout(60000)});
   }}
  });
  state.cleanup.objects=[...new Set([...state.cleanup.objects,...paths])];state.cleanup.phase=existing.length?"storage-delete-started":state.cleanup.phase;saveState(state);
  for(let offset=0;offset<paths.length;offset+=50){const batch=paths.slice(offset,offset+50);const deleted=await destructive.storage.from("restaurant-media").remove(batch);ok(!deleted.error,"STORAGE_DELETE_FAILED");report.remoteMutations+=batch.length}
  for(const id of ids)ok((await listObjects(db,id)).length===0,"STORAGE_REMAINS");
  if(existing.length){
   stage="database-delete";
   state.cleanup.phase="database-delete-started";saveState(state);
   await pg.query("begin read write");
   try{
    const rows=(await pg.query("select id,is_demo,owner_email,slug from public.restaurants where id=any($1::uuid[]) order by id for update",[ids])).rows;
    ok(rows.length===3&&rows.every(r=>{const a=accounts.find(a=>a.restaurantId===r.id);return r.is_demo&&r.owner_email===a.email&&r.slug===a.slug}),"DATABASE_IDENTITY_CHANGED");
    const memberships=(await pg.query("select restaurant_id,user_id,is_active from public.restaurant_memberships where restaurant_id=any($1::uuid[])",[ids])).rows;
    ok(memberships.length===3&&memberships.every(m=>accounts.some(a=>a.restaurantId===m.restaurant_id&&a.userId===m.user_id)&&m.is_active===false),"DATABASE_MEMBERSHIP_CHANGED");
    ok((await pg.query("select count(*)::int as n from public.translation_jobs where restaurant_id=any($1::uuid[]) and status='processing'",[ids])).rows[0].n===0,"WORKER_RESTARTED");
    await pg.query("select id from private.translation_budget where id for update");
    for(const a of accounts){
     const request=(await pg.query("select state,restaurant_id,owner_id from private.restaurant_creation_requests where actor_id=$1 and request_id=$2 for update",[state.meta.adminId,a.requestId])).rows;
     ok(request.length===1&&request[0].state==="completed"&&request[0].restaurant_id===a.restaurantId&&request[0].owner_id===a.userId,"CREATION_REQUEST_CHANGED");
     await pg.query("delete from public.commercial_sales where restaurant_id=$1",[a.restaurantId]);
     const removed=await pg.query("delete from public.restaurants where id=$1 and is_demo=true returning id",[a.restaurantId]);ok(removed.rows.length===1,"RESTAURANT_DELETE_COUNT");
     const journal=await pg.query("delete from private.restaurant_creation_requests where actor_id=$1 and request_id=$2 and restaurant_id=$3 and owner_id=$4 returning request_id",[state.meta.adminId,a.requestId,a.restaurantId,a.userId]);ok(journal.rows.length===1,"REQUEST_DELETE_COUNT");
    }
    await pg.query("commit");report.remoteMutations+=9;state.cleanup.phase="database-deleted";saveState(state);
   }catch(error){await pg.query("rollback");throw error}
  }
  stage="delete-only-reserved-auth";
  ok((await pg.query("select count(*)::int as n from public.restaurant_memberships where user_id=any($1::uuid[])",[users])).rows[0].n===0,"AUTH_STILL_ASSIGNED");
  ok((await pg.query("select count(*)::int as n from public.platform_admins where user_id=any($1::uuid[])",[users])).rows[0].n===0,"ADMIN_DELETE_BLOCKED");
  state.cleanup.phase="auth-delete-started";saveState(state);
  for(const account of accounts){
   const found=await db.auth.admin.getUserById(account.userId);
   if(found.error?.code==="user_not_found"||found.error?.status===404)continue;
   ok(!found.error&&authIdentity(found.data.user,account,state),"AUTH_DELETE_IDENTITY_CHANGED");
   const removed=await destructive.auth.admin.deleteUser(account.userId);ok(!removed.error,"AUTH_DELETE_FAILED");report.remoteMutations++;
  }
  for(const account of accounts){const found=await db.auth.admin.getUserById(account.userId);ok(found.error?.code==="user_not_found"||found.error?.status===404,"AUTH_REMAINS")}
  stage="preservation";
  ok(digest(await originalsFingerprint(db,keptIds))===digest(originals),"RETAINED_CONTENT_CHANGED");
  const remaining=(await readAll(db,"restaurants")).map(r=>r.id).sort();ok(digest(remaining)===digest(keptIds.sort()),"UNEXPECTED_RESTAURANTS");
  const budgetAfter=(await pg.query("select limit_micro_usd,charged_micro_usd,blocked_reason from private.translation_budget where id")).rows[0];ok(digest(budgetBefore)===digest(budgetAfter),"BUDGET_CHANGED");
  for(const table of ["owner_access","owner_access_requests","import_attempts"]){const count=(await pg.query('select count(*)::int as n from private."'+table+'" where restaurant_id=any($1::uuid[])',[ids])).rows[0].n;ok(count===0,"PRIVATE_TASK_ROWS_REMAIN")}
  ok((await pg.query("select count(*)::int as n from private.restaurant_creation_requests where restaurant_id=any($1::uuid[]) or owner_id=any($2::uuid[])",[ids,users])).rows[0].n===0,"CREATION_TASK_ROWS_REMAIN");
  state.cleanup.phase="completed";state.cleanup.completedAt=new Date().toISOString();
  for(const a of accounts){delete a.password;delete a.temporaryPassword;if(a.reset){delete a.reset.password;delete a.reset.temporaryPassword}a.stage="cleaned"}
  saveState(state);writeManifest(state);
  report.result="PASS";report.restaurantsDeleted=3;report.authUsersDeleted=3;report.storageObjectsDeleted=state.cleanup.objects.length;report.creationRequestsDeleted=3;report.retainedContentUnchanged=true;report.retainedRestaurants=keptIds.length;report.translationBudgetPreserved=true;report.localCredentialsErased=true;
 }
}catch(error){report.result="FAIL";report.stage=stage;report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:"CLOSURE_CLEANUP_FAILED";process.exitCode=1}
finally{if(pg)await pg.end().catch(()=>{});const file=evidence("closure-temporary-cleanup.json",report);console.log(JSON.stringify({result:report.result,stage:report.stage,code:report.code,evidence:file,restaurantsDeleted:report.restaurantsDeleted,storageObjectsDeleted:report.storageObjectsDeleted}))}
