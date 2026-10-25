import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync,readdirSync} from "node:fs";
let db:PGlite;
type Job={id:string;lease_id:string;attempts:number};
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222",C="33333333-3333-4333-8333-333333333333";
const UA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",UB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",UC="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ids=[A,B,C],users=[UA,UB,UC];
const product=(id:string)=>id.slice(0,-1)+"5",category=(id:string)=>id.slice(0,-1)+"4";
async function one<T=unknown>(sql:string,args:unknown[]=[]):Promise<T>{return Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0]||{})[0] as T;}
async function role(name:string,user=""){await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("set role "+name)}
async function isolated(fn:()=>Promise<void>){await db.exec("begin");try{await role("service_role");await fn()}finally{await db.exec("rollback");await role("postgres")}}
async function denied(sql:string,args:unknown[]=[]){await db.exec("savepoint deny");let error;try{await db.query(sql,args)}catch(e){error=e}await db.exec("rollback to savepoint deny");expect(error).toBeTruthy()}
async function jobId(id=A){return one<string>("select id from translation_jobs where restaurant_id=$1 and entity_type='product' and status='pending'",[id])}
async function claim(id?:string){return one<Job>("select claim_translation_job(30000,$1)",[id||await jobId()])}
async function budget(value=2000000){return one<{charged_micro_usd:number}>("select configure_translation_budget($1)",[value])}
async function finish(j:Job,fields:unknown={name:"Cheese pizza",description:"",ingredients:"",tags:[],extras:[],variants:[]},cost:number|null=100,error:string|null=null,retry=false){return one("select finish_translation_job($1,$2,$3,$4,$5,$6)",[j.id,j.lease_id,fields===null?null:JSON.stringify(fields),cost,error,retry])}
beforeAll(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default clock_timestamp());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;");
 for(const file of readdirSync("supabase/migrations").filter(f=>/initial_tenant_security|owner_access|translation_jobs/.test(f)).sort())await db.exec(readFileSync("supabase/migrations/"+file,"utf8"));
 for(let n=0;n<3;n++){
  await db.query("insert into auth.users(id)values($1)",[users[n]]);await role("service_role");
  await db.query("select provision_restaurant($1,$2,$3,$4,'Owner','owner@example.test')",[ids[n],users[n],"Restaurant "+n,"restaurant-"+n]);
  await db.query("select save_restaurant_languages($1,'es',array['es','en'])",[ids[n]]);
  await db.query("insert into categories(id,restaurant_id,name)values($1,$2,'Pizzas')",[category(ids[n]),ids[n]]);
  await db.query("insert into products(id,restaurant_id,category_id,name,price)values($1,$2,$3,'Pizza de queso',100)",[product(ids[n]),ids[n],category(ids[n])]);await role("postgres");
 }

 await role("service_role");
 await db.query("insert into translations(restaurant_id,entity_type,entity_id,language,fields)values($1,'product',$2,'en',$3)",[C,product(C),JSON.stringify({name:"Legacy manual title",description:""})]);
 await db.query("update products set description='Descripción en español',tags=array['Fresco','Casero'] where id=$1",[product(B)]);
 await db.query("insert into translations(restaurant_id,entity_type,entity_id,language,fields)values($1,'product',$2,'en',$3)",[B,product(B),JSON.stringify({name:"Legacy manual name",description:"",tags:["",""],extras:[],variants:[]})]);
 await role("postgres");
 for(const file of readdirSync("supabase/migrations").filter(f=>/translation_manual_fields/.test(f)).sort())await db.exec(readFileSync("supabase/migrations/"+file,"utf8"));
},60000);
afterAll(async()=>{await db?.close()});
describe("persistent translation jobs, RLS and budget in PostgreSQL",()=>{
 it("enqueues with the source transaction and deduplicates unchanged source",()=>isolated(async()=>{
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1",[A])).toBe(2);
  await db.query("update products set price=120 where id=$1",[product(A)]);
  await db.query("select request_menu_translations($1,'enqueue')",[A]);await db.query("select request_menu_translations($1,'enqueue')",[A]);
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product'",[A])).toBe(1);
  await db.exec("savepoint source_change");await db.query("update products set name='New draft' where id=$1",[product(A)]);await db.exec("rollback to savepoint source_change");
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product'",[A])).toBe(1);
 }));
 it("supersedes changed source and reactivates the deduplicated original after a revert",()=>isolated(async()=>{
  await db.query("update products set name='Nueva pizza' where id=$1",[product(A)]);
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product' and status='pending'",[A])).toBe(1);
  await db.query("update products set name='Pizza de queso' where id=$1",[product(A)]);
  expect(await one("select source_fields->>'name' from translation_jobs where restaurant_id=$1 and entity_type='product' and status='pending'",[A])).toBe("Pizza de queso");
 }));
 it("retains accumulated charges across worker restarts and refuses over-budget claims",()=>isolated(async()=>{
  await budget(50000);await claim();await budget(50000);expect(await claim(await jobId(B))).toEqual({blocked:"budget"});
  const result=await budget(50000);expect(result.charged_micro_usd).toBe(30000);
 }));
 it("publishes a finished translation once and settles actual spend",()=>isolated(async()=>{
  await budget();const before=await one("select menu_version from restaurants where id=$1",[A]);const j=await claim();
  expect(await finish(j)).toMatchObject({accepted:true,status:"completed"});expect(await finish(j)).toEqual({accepted:false});
  expect(await one("select fields->>'name' from translations where restaurant_id=$1",[A])).toBe("Cheese pizza");
  expect(Number(await one("select menu_version from restaurants where id=$1",[A]))).toBe(Number(before)+1);expect((await budget()).charged_micro_usd).toBe(100);
 }));
 it("rejects stale results after a source edit",()=>isolated(async()=>{await budget();const j=await claim();await db.query("update products set name='Changed source' where id=$1",[product(A)]);expect(await finish(j)).toMatchObject({status:"superseded"});expect(await one("select count(*)::int from translations where restaurant_id=$1",[A])).toBe(0)}));
 it("preserves manual changes even when a provider request is in flight",()=>isolated(async()=>{await budget();const j=await claim();await db.query("insert into translations(restaurant_id,entity_type,entity_id,language,fields)values($1,'product',$2,'en',$3)",[A,product(A),JSON.stringify({name:"Manual title"})]);expect(await finish(j)).toMatchObject({status:"manual"});expect(await one("select fields->>'name' from translations where restaurant_id=$1",[A])).toBe("Manual title")}));
 it("reclaims an expired lease and keeps its unknown cost reserved",()=>isolated(async()=>{
  await budget();const first=await claim();await db.query("update translation_jobs set lease_until=now()-interval '1 second' where id=$1",[first.id]);const second=await claim(first.id);
  expect(second.lease_id).not.toBe(first.lease_id);expect(second.attempts).toBe(2);expect(await finish(first)).toEqual({accepted:false});expect(await finish(second,null,null,"provider_timeout_or_network",true)).toMatchObject({status:"pending"});expect((await budget()).charged_micro_usd).toBe(60000);
 }));
 it.each([[0,1],[0,2],[1,0],[1,2],[2,0],[2,1]])("denies cross-tenant jobs and admin budget RPCs in direction %i to %i",(from,to)=>isolated(async()=>{
  await role("authenticated",users[from]);expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1",[ids[to]])).toBe(0);
  expect(await one("select translation_job_summary($1)",[ids[to]])).toEqual([]);
  await denied("select request_menu_translations($1,'retry')",[ids[to]]);await denied("select configure_translation_budget(2000000)");await denied("select claim_translation_job(30000,null)");await denied("select save_manual_translation($1,'product',$2,'en','{\"name\":\"Foreign edit\"}')",[ids[to],product(ids[to])]);
 }));
});

describe("partial manual translation regression",()=>{
 it("queues missing automatic fields around legacy manual name and description",()=>isolated(async()=>{
  await db.query("insert into translations(restaurant_id,entity_type,entity_id,language,fields) values($1,'product',$2,'en',$3)",[A,product(A),JSON.stringify({name:"Hand edited title",description:"Hand edited description"})]);
  await db.query("update products set ingredients='Tomate',tags=array['Fresco'],extras='[{\"name\":\"Salsa\",\"price\":2}]',variants='[{\"name\":\"Grande\",\"price\":120}]' where id=$1",[product(A)]);
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product' and status='pending'",[A])).toBe(1);
 }));
 it("completes missing fields while preserving a manual edit made during a request",()=>isolated(async()=>{
  await db.query("update products set ingredients='Tomate' where id=$1",[product(A)]);
  await budget();const j=await claim();
  await db.query("select save_manual_translation($1,'product',$2,'en',$3)",[A,product(A),JSON.stringify({name:"Hand edited title"})]);
  expect(await finish(j,{name:"Cheese pizza",description:"",ingredients:"Tomato",tags:[],extras:[],variants:[]})).toMatchObject({status:"completed"});
  expect(await one("select fields from translations where restaurant_id=$1",[A])).toEqual({name:"Hand edited title",description:"",ingredients:"Tomato",tags:[],extras:[],variants:[]});
 }));
});

describe("manual provenance, invalidation and provider races",()=>{
 const fields={name:"Cheese pizza",description:"",ingredients:"Tomato",tags:[],extras:[],variants:[]};
 const manual=async (value:unknown)=>db.query("select save_manual_translation($1,'product',$2,'en',$3)",[A,product(A),JSON.stringify(value)]);
 const saved=()=>one<{fields:Record<string,unknown>;manual_fields:string[];source_hash:string|null;is_manual:boolean}>("select to_jsonb(t) from translations t where restaurant_id=$1 and entity_type='product'",[A]);
 const ingredient=()=>db.query("update products set ingredients='Tomate' where id=$1",[product(A)]);
 it("backfills legacy keys including legitimate empty source descriptions without changing text",()=>isolated(async()=>{
  expect(await one("select fields from translations where restaurant_id=$1",[C])).toEqual({name:"Legacy manual title",description:""});
  expect(await one("select manual_fields from translations where restaurant_id=$1",[C])).toEqual(["name"]);
  expect(await one("select status from translation_jobs where restaurant_id=$1 and entity_type='product' and status<>'superseded'",[C])).toBe("manual");
 }));
 it("keeps blank form placeholders pending instead of freezing them as manual",()=>isolated(async()=>{
  await ingredient();await manual({name:"Hand edited",description:"",ingredients:"",tags:[],extras:[],variants:[]});
  expect((await saved()).manual_fields.sort()).toEqual(["name"]);
  expect(await jobId()).toBeTruthy();
  await budget();expect(await finish(await claim(),fields)).toMatchObject({status:"completed"});
  expect((await saved()).fields.ingredients).toBe("Tomato");expect((await saved()).fields.name).toBe("Hand edited");
 }));
 it("invalidates only automatic values after a source edit and never upgrades them to manual",()=>isolated(async()=>{
  await ingredient();await manual({name:"Hand edited"});await budget();await finish(await claim(),fields);
  expect((await saved()).manual_fields).toEqual(["name"]);
  await db.query("update products set ingredients='Tomate y sal' where id=$1",[product(A)]);
  expect((await saved()).fields).toEqual({name:"Hand edited"});expect((await saved()).source_hash).toBeNull();
  expect(await finish(await claim(),{...fields,ingredients:"Tomato and salt"})).toMatchObject({status:"completed"});
  expect((await saved()).fields.ingredients).toBe("Tomato and salt");expect((await saved()).manual_fields).toEqual(["name"]);
 }));
 it("deduplicates a mixed completed job and regenerates only its automatic portion",()=>isolated(async()=>{
  await ingredient();await manual({name:"Hand edited"});await budget();await finish(await claim(),fields);
  await db.query("select request_menu_translations($1,'enqueue')",[A]);
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product' and status='completed'",[A])).toBe(1);
  await db.query("select request_menu_translations($1,'regenerate')",[A]);const j=await claim();
  await finish(j,{...fields,name:"Provider must not replace manual",ingredients:"Fresh tomato"});
  expect((await saved()).fields.name).toBe("Hand edited");expect((await saved()).fields.ingredients).toBe("Fresh tomato");
 }));
 it("fences a previous lease when source is edited then reverted",()=>isolated(async()=>{
  await ingredient();await manual({name:"Hand edited"});await budget();const old=await claim();
  await db.query("update products set ingredients='Sal' where id=$1",[product(A)]);
  await db.query("update products set ingredients='Tomate' where id=$1",[product(A)]);
  expect(await finish(old,fields)).toEqual({accepted:false});
  const current=await claim();expect(current.lease_id).not.toBe(old.lease_id);expect(await finish(current,fields)).toMatchObject({status:"completed"});
  expect((await saved()).fields.name).toBe("Hand edited");
  expect(await one("select count(*)::int from translation_jobs where restaurant_id=$1 and entity_type='product'",[A])).toBe(3);
 }));
 it("preserves the latest manual text around a stale provider completion",()=>isolated(async()=>{
  await ingredient();await manual({name:"First manual"});await budget();const j=await claim();
  await manual({name:"Latest manual"});await db.query("update products set ingredients='Sal' where id=$1",[product(A)]);
  expect(await finish(j,fields)).toMatchObject({status:"superseded"});
  expect((await saved()).fields.name).toBe("Latest manual");expect((await saved()).fields.ingredients).toBeUndefined();
 }));
 it("settles a missing-field provider response as failed without publishing source fallback",()=>isolated(async()=>{
  await ingredient();await manual({name:"Hand edited"});await budget();const j=await claim();
  expect(await finish(j,{name:"Cheese pizza"})).toMatchObject({status:"failed"});
  expect((await saved()).fields).toEqual({name:"Hand edited"});expect((await budget()).charged_micro_usd).toBe(100);
  expect(await one("select error_code from translation_jobs where id=$1",[j.id])).toBe("invalid_translation");
  expect(await finish(j,fields)).toEqual({accepted:false});
 }));
 it("rejects partial manual lists and ignores completely blank list placeholders",()=>isolated(async()=>{
  await db.query("update products set tags=array['Fresco','Casero'],extras='[{\"name\":\"Salsa\",\"price\":2},{\"name\":\"Queso\",\"price\":3}]' where id=$1",[product(A)]);
  for(const partial of [{tags:["Fresh",""]},{extras:[{name:"Sauce"}]},{extras:[{name:"Sauce"},{name:""}]}]){
   await db.exec("savepoint partial");let code;try{await manual(partial)}catch(e){code=(e as Error).message}await db.exec("rollback to savepoint partial");expect(code).toBe("translation_array_incomplete");
  }
  await manual({name:"Manual title",tags:["",""],extras:[{name:""},{name:""}]});expect((await saved()).manual_fields).toEqual(["name"]);
 }));
 it("preserves a complete manual list across regeneration and flags a changed source shape",()=>isolated(async()=>{
  await ingredient();await db.query("update products set tags=array['Fresco'] where id=$1",[product(A)]);
  await manual({tags:["Hand chosen tag"]});await budget();await finish(await claim(),{...fields,tags:["Fresh"]});
  expect((await saved()).fields.tags).toEqual(["Hand chosen tag"]);
  await db.query("update products set tags=array['Fresco','Casero'] where id=$1",[product(A)]);
  const j=await claim();expect(await finish(j,{...fields,tags:["Fresh","Homemade"]})).toMatchObject({status:"failed"});
  expect((await saved()).fields.tags).toEqual(["Hand chosen tag"]);
  expect(await one("select error_code from translation_jobs where id=$1",[j.id])).toBe("manual_source_shape_changed");
 }));
 it("rejects illegal manual mask keys/types and owner attempts across tenant boundaries",()=>isolated(async()=>{
  await role("authenticated",UA);
  await denied("insert into translations(restaurant_id,entity_type,entity_id,language,fields,manual_fields)values($1,'product',$2,'en','{\"name\":\"Name\"}',array['price'])",[A,product(A)]);
  await denied("insert into translations(restaurant_id,entity_type,entity_id,language,fields,manual_fields)values($1,'product',$2,'en','{\"tags\":[3]}',array['tags'])",[A,product(A)]);
  await denied("insert into translations(restaurant_id,entity_type,entity_id,language,fields,manual_fields)values($1,'product',$2,'en','{\"name\":\"Name\"}',array['name','name'])",[A,product(A)]);
 }));
});

describe("legacy blank manual fields migrate without freezing missing content",()=>{
 it("retains historical JSON and completes its blank description and placeholder list",()=>isolated(async()=>{
  const before={name:"Legacy manual name",description:"",tags:["",""],extras:[],variants:[]};
  expect(await one("select fields from translations where restaurant_id=$1",[B])).toEqual(before);
  expect(await one("select manual_fields from translations where restaurant_id=$1",[B])).toEqual(["name"]);
  await budget();const j=await claim(await jobId(B));
  expect(await finish(j,{name:"Provider title",description:"English description",ingredients:"",tags:["Fresh","Homemade"],extras:[],variants:[]})).toMatchObject({status:"completed"});
  expect(await one("select fields from translations where restaurant_id=$1",[B])).toEqual({name:"Legacy manual name",description:"English description",ingredients:"",tags:["Fresh","Homemade"],extras:[],variants:[]});
 }));
});
