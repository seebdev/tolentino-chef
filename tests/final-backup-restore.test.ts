import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { applicationCatalog, capturedMigrations, databaseRows } from "../scripts/migration-target-final-backup.mjs";
import { restoreCapturedRows } from "../scripts/migration-target-final-restore-local.mjs";
const OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",ADMIN="cccccccc-cccc-4ccc-8ccc-cccccccccccc",REST="11111111-1111-4111-8111-111111111111",CAT="11111111-1111-4111-8111-111111111112",PROD="11111111-1111-4111-8111-111111111113";
const files=readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")).sort();
const history=files.map(file=>({version:file.split("_")[0],name:file.replace(/^\d+_/,"").replace(/\.sql$/,""),statements:[readFileSync("supabase/migrations/"+file,"utf8")]}));
let source:PGlite,target:PGlite,snapshot:Awaited<ReturnType<typeof databaseRows>>;
async function setup(){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;");
 for(const {sql}of capturedMigrations(history))await db.exec(sql);
 await db.query("insert into auth.users(id)values($1),($2)",[OWNER,ADMIN]);
 return db;
}
beforeAll(async()=>{
 source=await setup();target=await setup();
 await source.query("insert into platform_admins(user_id)values($1)",[ADMIN]);
 await source.query("select provision_restaurant($1,$2,'Fixture','fixture','Owner','owner@example.test')",[REST,OWNER]);
 await source.query("insert into categories(id,restaurant_id,name)values($1,$2,'Main')",[CAT,REST]);
 await source.query("insert into products(id,restaurant_id,category_id,name,price)values($1,$2,$3,'Dish',5)",[PROD,REST,CAT]);
 await source.exec("insert into private.rate_limits(key,hits,window_started_at) select 'fixture-'||n,1,now() from generate_series(1,1105) n");
 await source.query("update private.owner_access set login_alias='fixture.owner',requires_password_change=true where restaurant_id=$1",[REST]);
 snapshot=await databaseRows(source);
});
afterAll(async()=>{await source?.close();await target?.close();});
describe("catalog-based isolated backup restore",()=>{
 it("selects only captured versions even when newer local migrations exist",()=>{
  expect(capturedMigrations(history.slice(0,2))).toHaveLength(2);
  const changed=structuredClone(history.slice(0,2));changed[0]!.statements[0]+="-- changed";
  expect(()=>capturedMigrations(changed)).toThrow();
 });
 it("captures every catalog table including new private state and more than 1000 rows",async()=>{
  const catalog=await applicationCatalog(source);
  expect(snapshot.catalog).toEqual(catalog);
  expect(Object.keys(snapshot.privateTables)).toEqual(expect.arrayContaining(["owner_access","owner_access_requests","rate_limits","import_attempts","translation_budget"]));
  expect(snapshot.privateTables.rate_limits).toHaveLength(1105);
  expect(snapshot.tables.translation_jobs).toBeDefined();
  expect(snapshot.tables.restaurants).toHaveLength(1);
 });
 it("restores exact current public/private rows, generated columns and identities with FK checks enabled",async()=>{
  const restored=await restoreCapturedRows(target,snapshot);
  expect(restored.tables).toBe(snapshot.catalog.length);
  expect(await databaseRows(target)).toEqual(snapshot);
  const disabled=(await target.query<{n:number}>("select count(*)::int as n from pg_trigger where not tgisinternal and tgenabled='D'")).rows[0]!.n;
  expect(disabled).toBe(0);
 });
 it("rolls back every table if any captured row violates its FK",async()=>{
  const invalid=structuredClone(snapshot);
  invalid.tables.products[0]!.category_id="22222222-2222-4222-8222-222222222222";
  await expect(restoreCapturedRows(target,invalid)).rejects.toThrow();
  expect(await databaseRows(target)).toEqual(snapshot);
 });
 it("fails closed on omitted tables or a remote-like SQL adapter",async()=>{
  const missing=structuredClone(snapshot);delete missing.privateTables.owner_access;
  await expect(restoreCapturedRows(target,missing)).rejects.toThrow();
  const remote={query:vi.fn(),exec:vi.fn()};
  await expect(restoreCapturedRows(remote,snapshot)).rejects.toThrow();
  expect(remote.query).not.toHaveBeenCalled();expect(remote.exec).not.toHaveBeenCalled();
 });
});
