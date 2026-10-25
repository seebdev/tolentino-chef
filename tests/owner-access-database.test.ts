import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
const UA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",UB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",ADMIN="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OLD="11111111-3333-4333-8333-111111111111",NEW="22222222-3333-4333-8333-111111111111",OTHER="33333333-3333-4333-8333-111111111111";
const REQ="44444444-4444-4444-8444-444444444444";
let db:PGlite;
async function one(sql:string,args:unknown[]=[]){return Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0]!)[0];}
async function role(name:string,user:string|null,session?:string){await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user||"",JSON.stringify({sub:user,session_id:session})]);await db.exec("set role "+name);}
async function tx(fn:()=>Promise<void>){await db.exec("begin");try{await fn();}finally{await db.exec("rollback");await role("postgres",null);}}
async function denied(sql:string,args:unknown[]=[]){await db.exec("savepoint deny");let error;try{await db.query(sql,args);}catch(e){error=e;}await db.exec("rollback to savepoint deny");expect(error).toBeTruthy();}
async function claim(id=REQ,restaurant=A,alias:string|null="aurora.owner"){return await one("select public.claim_owner_access($1,$2,$3,$4)",[ADMIN,id,restaurant,alias]) as Record<string,unknown>;}
async function complete(id=REQ,owner=UA){await role("postgres",null);await db.query("update auth.users set raw_app_meta_data=jsonb_build_object('owner_access_request_id',$1::text,'owner_access_actor_id',$2::text) where id=$3",[id,ADMIN,owner]);await role("service_role",null);return one("select public.complete_owner_access($1,$2)",[ADMIN,id]);}
beforeAll(async()=>{db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp());create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;");
for(const file of readdirSync("supabase/migrations").filter(f=>/initial_tenant_security|restaurant_creation_requests|owner_access/.test(f)).sort())await db.exec(readFileSync("supabase/migrations/"+file,"utf8"));
await db.query("insert into auth.users(id)values($1),($2),($3)",[UA,UB,ADMIN]);
await db.query("insert into platform_admins(user_id)values($1)",[ADMIN]);
for(const [id,user,name]of[[A,UA,"Aurora"],[B,UB,"Bruma"]])await db.query("select provision_restaurant($1,$2,$3,$4,'Owner','owner@example.test')",[id,user,name,name!.toLowerCase()]);
await db.query("insert into auth.sessions(id,user_id,created_at)values($1,$2,clock_timestamp()-interval '1 hour')",[OLD,UA]);
await db.query("insert into storage.objects(bucket_id,name)values('restaurant-media',$1)",[A+"/"+REQ+".png"]);
});
afterAll(async()=>{await db?.close();});
describe("owner credential policy in PostgreSQL",()=>{
 it("preserves existing credentials and tenant data until an authorized reset",()=>tx(async()=>{
  await role("authenticated",UA,OLD);
  expect(await one("select count(*)::int from restaurants")).toBe(1);
  expect(await one("select owner_session_state()")).toMatchObject({valid:true,requiresPasswordChange:false});
 }));
 it.each(["anon","authenticated"])("does not expose alias lookup, journals, password completion or admin RPCs to %s",name=>tx(async()=>{
  await role(name,UA,OLD);
  await denied("select resolve_owner_login('aurora.owner')");
  await denied("select * from private.owner_access");
  await denied("select complete_owner_password_change($1,$2,$3)",[UA,REQ,OLD]);
  await denied("select claim_owner_access($1,$2,$3,null)",[ADMIN,REQ,A]);
 }));
 it("requires an active actual platform administrator even through the service RPC",()=>tx(async()=>{
  await role("service_role",null);
  await denied("select claim_owner_access($1,$2,$3,null)",[UA,REQ,A]);
 }));
 it("fences double submission and never authorizes repeating an uncertain Auth write",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();
  expect(first).toMatchObject({state:"reserved",ownerId:UA,newUser:false});
  expect(await claim()).toEqual({state:"pending"});
  expect(await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken])).toBe(true);
  expect(await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken])).toBe(false);
  expect(await claim()).toMatchObject({state:"auth_started"});
  await denied("select complete_owner_access($1,$2)",[ADMIN,REQ]);
  expect(await complete()).toBe(true);expect(await complete()).toBe(false);
  expect(await claim()).toEqual({state:"completed"});
 }));
 it("reclaims an expired reservation while fencing the previous lease",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();
  await db.query("update private.owner_access_requests set lease_until=clock_timestamp()-interval '1 second' where actor_id=$1 and request_id=$2",[ADMIN,REQ]);
  const renewed=await claim();expect(renewed.leaseToken).not.toBe(first.leaseToken);
  expect(await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken])).toBe(false);
  expect(await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,renewed.leaseToken])).toBe(true);
 }));
 it("keeps the reserved email immutable across a pending retry",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();
  await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);
  await db.query("update restaurants set owner_email='changed@example.test' where id=$1",[A]);
  expect(await claim()).toMatchObject({state:"auth_started",email:"owner@example.test",ownerId:UA});
 }));
 it("rejects a session created during the reset before Auth completion",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();
  await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);
  await role("postgres",null);await db.query("insert into auth.sessions(id,user_id)values($1,$2)",[NEW,UA]);
  await complete();
  await role("authenticated",UA,NEW);
  expect(await one("select owner_session_state()")).toMatchObject({valid:false,requiresPasswordChange:true});
  expect(await one("select count(*)::int from restaurants")).toBe(0);
 }));
 it("blocks old sessions, direct REST-equivalent table access and Storage until a valid first change",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);await complete();
  await role("authenticated",UA,OLD);
  expect(await one("select owner_session_state()")).toMatchObject({valid:false,requiresPasswordChange:true});
  expect(await one("select count(*)::int from restaurants")).toBe(0);
  expect(await one("select count(*)::int from storage.objects")).toBe(0);
  await role("postgres",null);
  await db.query("insert into auth.sessions(id,user_id)values($1,$2),($3,$2)",[NEW,UA,OTHER]);
  await role("authenticated",UA,NEW);
  expect(await one("select owner_session_state()")).toMatchObject({valid:true,requiresPasswordChange:true});
  expect(await one("select count(*)::int from restaurants")).toBe(0);
  await role("service_role",null);
  expect(await one("select complete_owner_password_change($1,$2,$3)",[UA,REQ,NEW])).toBe(true);
  await role("authenticated",UA,NEW);
  expect(await one("select count(*)::int from restaurants")).toBe(1);
  expect(await one("select count(*)::int from storage.objects")).toBe(1);
  expect(await one("select count(*)::int from restaurants where id=$1",[B])).toBe(0);
  await role("authenticated",UA,OTHER);
  expect(await one("select count(*)::int from restaurants")).toBe(0);
  await role("authenticated",UA,OLD);
  expect(await one("select count(*)::int from restaurants")).toBe(0);
 }));
 it("cannot clear a newer reset with an old password-change generation or foreign session",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);await complete();
  expect(await one("select complete_owner_password_change($1,$2,$3)",[UA,REQ,OLD])).toBe(false);
  expect(await one("select complete_owner_password_change($1,$2,$3)",[UB,REQ,OLD])).toBe(false);
 }));
 it.each(["restaurant","membership"])("suspension and reactivation of %s require fresh login",kind=>tx(async()=>{
  await role("service_role",null);
  if(kind==="restaurant"){await db.query("update restaurants set status='suspended' where id=$1",[A]);await db.query("update restaurants set status='active' where id=$1",[A]);}
  else {await db.query("update restaurant_memberships set is_active=false where restaurant_id=$1",[A]);await db.query("update restaurant_memberships set is_active=true where restaurant_id=$1",[A]);}
  await role("authenticated",UA,OLD);
  expect(await one("select owner_session_state()")).toMatchObject({valid:false});
  expect(await one("select count(*)::int from restaurants")).toBe(0);
  await role("postgres",null);await db.query("insert into auth.sessions(id,user_id)values($1,$2)",[NEW,UA]);
  await role("authenticated",UA,NEW);expect(await one("select count(*)::int from restaurants")).toBe(1);
 }));
 it("enforces unique normalized aliases and leaves a conflicting tenant untouched",()=>tx(async()=>{
  await role("service_role",null);await claim();
  await denied("select claim_owner_access($1,$2,$3,$4)",[ADMIN,OTHER,B,"aurora.owner"]);
  expect(await one("select reset_pending from private.owner_access where restaurant_id=$1",[B])).toBe(false);
  await denied("select claim_owner_access($1,$2,$3,$4)",[ADMIN,OTHER,B,"Aurora.Owner"]);
 }));
 it("creates only the reserved owner identity, atomically assigns it once and preserves one-owner constraints",()=>tx(async()=>{
  await role("postgres",null);await db.query("delete from restaurant_memberships where restaurant_id=$1",[B]);await db.query("delete from private.owner_access where restaurant_id=$1",[B]);
  await role("service_role",null);const first=await claim(REQ,B,"bruma.owner");
  expect(first.newUser).toBe(true);await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);
  await role("postgres",null);await db.query("insert into auth.users(id)values($1)",[first.ownerId]);
  await role("service_role",null);await complete(REQ,String(first.ownerId));
  expect(await one("select count(*)::int from restaurant_memberships where restaurant_id=$1",[B])).toBe(1);
  expect(await one("select user_id from restaurant_memberships where restaurant_id=$1",[B])).toBe(first.ownerId);
  expect(await claim(REQ,B,"bruma.owner")).toEqual({state:"completed"});
 }));
 it("rejects mismatched reuse and refuses failed-state changes after completion",()=>tx(async()=>{
  await role("service_role",null);const first=await claim();
  expect(await claim(REQ,B,null)).toEqual({state:"mismatch"});
  await one("select begin_owner_auth($1,$2,$3)",[ADMIN,REQ,first.leaseToken]);await complete();
  expect(await one("select fail_owner_access($1,$2,'PASSWORD_REJECTED')",[ADMIN,REQ])).toBe(false);
 }));
});
