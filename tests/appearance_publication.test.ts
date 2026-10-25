import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
let db:PGlite;
const id="11111111-1111-4111-8111-111111111111",user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeAll(async()=>{
 db=new PGlite();
 await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;");
 for(const file of ["20261017021301_initial_tenant_security.sql",...(process.env.APPEARANCE_BASELINE?[]:["20261018053943_appearance_publication.sql","20261018062727_terminal_business_conflicts.sql"])]) await db.exec(readFileSync("supabase/migrations/"+file,"utf8").replace(/^\uFEFF/,""));
 await db.query("insert into auth.users(id) values($1)",[user]);
 await db.exec("set role service_role");
 await db.query("select public.provision_restaurant($1,$2,'Original','fixture-menu','Owner','owner@example.test')",[id,user]);
 await db.exec("reset role");
},60000);
afterAll(async()=>{await db?.close()});
async function isolated(run:()=>Promise<void>,owner=true){await db.exec("begin");try{await db.exec("set local role "+(owner?"authenticated":"service_role"));await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await run()}finally{await db.exec("rollback")}}
async function save(patch:unknown,rev:number,publish=false,name:string|null=null,description:string|null=null){return db.query<{result:Record<string,unknown>}>("select public.save_restaurant_appearance($1,$2,$3,$4,$5,$6) as result",[id,JSON.stringify(patch),name,description,rev,publish])}
describe("atomic appearance publication on PostgreSQL",()=>{
 it("saving a draft preserves public name, description and colors",()=>isolated(async()=>{await save({primary:"#FF8800"},0,false,"Draft title","Draft description");const r=await db.query<{name:string;description:string;appearance:{primary:string};draft_name:string}>("select r.name,r.description,s.appearance,s.draft_name from restaurants r join restaurant_settings s on s.restaurant_id=r.id where r.id=$1",[id]);expect(r.rows[0].name).toBe("Original");expect(r.rows[0].description).not.toBe("Draft description");expect(r.rows[0].appearance.primary).not.toBe("#FF8800");expect(r.rows[0].draft_name).toBe("Draft title")}));
 it("publishes current unsaved settings and details with one version increment",()=>isolated(async()=>{const before=await db.query<{menu_version:number}>("select menu_version from restaurants where id=$1",[id]);await save({primary:"#FF8800",columns_mobile:2,columns_desktop:1},0,true,"New name","New description");const r=await db.query<{name:string;menu_version:number;appearance_revision:number;appearance:{columns_mobile:number;columns_desktop:number}}>("select r.name,r.menu_version,s.appearance,s.appearance_revision from restaurants r join restaurant_settings s on s.restaurant_id=r.id where r.id=$1",[id]);expect(r.rows[0].name).toBe("New name");expect(Number(r.rows[0].menu_version)).toBe(Number(before.rows[0].menu_version)+1);expect(Number(r.rows[0].appearance_revision)).toBe(1);expect(r.rows[0].appearance.columns_mobile).toBe(2);expect(r.rows[0].appearance.columns_desktop).toBe(1)}));
 it("partial saves preserve previous theme settings and draft metadata",()=>isolated(async()=>{await save({primary:"#FF8800",columns_mobile:2},0,false,"Draft title");const r=await save({secondary:"#001122"},1);expect(r.rows[0].result.draft_appearance).toMatchObject({primary:"#FF8800",secondary:"#001122",columns_mobile:2});expect(r.rows[0].result.draft_name).toBe("Draft title")}));
 it("rejects stale editor revisions instead of overwriting",()=>isolated(async()=>{await save({primary:"#FF8800"},0);await expect(save({primary:"#000000"},0)).rejects.toMatchObject({code:"PT409"})}));
 it("rejects invalid fields before either table changes",()=>isolated(async()=>{await expect(save({columns_mobile:3},0,true,"Changed")).rejects.toMatchObject({code:"22023"})}));
 it("denies a different restaurant owner",()=>isolated(async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,true)",["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);await expect(save({primary:"#FF8800"},0)).rejects.toMatchObject({code:"42501"})}));
 it("supports authorized service administrator without a user JWT",()=>isolated(async()=>{const result=await save({background:"#FFFFFF"},0,true);expect(result.rows[0].result.published).toBe(true)},false));
});
