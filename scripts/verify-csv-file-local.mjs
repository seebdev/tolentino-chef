import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {parseProductsCsv} from '../src/lib/csv.ts';
const argument=name=>process.argv[process.argv.indexOf(name)+1];
const ensure=(ok,code)=>{if(!ok)throw new Error(code);};
async function main(){
 const file=argument('--file');ensure(process.argv.includes('--file')&&file,'FILE_REQUIRED');
 const bytes=readFileSync(resolve(file));ensure(bytes.length<=5*1024*1024,'FILE_TOO_LARGE');
 const parsed=parseProductsCsv(bytes.toString('utf8'));
 ensure(parsed.errors.length===0&&parsed.rows.length===123,'EXPECTED_123_VALID_ROWS');
 ensure(parsed.rows.every(r=>r.sku)&&new Set(parsed.rows.map(r=>r.sku)).size===123,'EXPECTED_UNIQUE_SKUS');
 globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
 const db=new PGlite();
 try{
  await db.exec("create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;");
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(resolve('supabase/migrations',file),'utf8').replace(/^\uFEFF/,''));
  const owner=randomUUID(),tenant=randomUUID(),attempt=randomUUID(),hash=createHash('sha256').update(bytes).digest('hex');
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.exec('set role service_role');await db.query("select public.provision_restaurant($1,$2,'Local CSV','local-csv','Local','local@test.invalid')",[tenant,owner]);await db.exec('reset role;begin;set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  const call=async id=>(await db.query('select public.import_products_attempt($1,$2,$3,$4::jsonb,$5,true,$6) result',[tenant,id,hash,JSON.stringify(parsed.rows),'skip',owner])).rows[0].result;
  const first=await call(attempt),replay=await call(attempt),skip=await call(randomUUID());
  const count=(await db.query('select count(*)::int count from public.products where restaurant_id=$1',[tenant])).rows[0].count;
  ensure(first.status==='completed'&&first.result.inserted===123,'CREATED_COUNT_MISMATCH');ensure(replay.replayed&&replay.result.inserted===123,'REPLAY_MISMATCH');ensure(skip.result.skipped===123&&skip.result.inserted===0&&count===123,'DUPLICATION');
  await db.exec('rollback');
  const evidence={at:new Date().toISOString(),result:'PASS',scope:'actual-user-CSV-parsed-and-imported-in-isolated-PGlite',sourceFileName:'tolentino_123_productos_prueba.csv',sourceSha256:hash,sourceBytes:bytes.length,parsed:123,uniqueSkus:123,first:{created:123,updated:0,skipped:0,rejected:0},replayed:true,repeatSkip:{created:0,skipped:123},persistedLocalRows:count,remoteMutations:false,network:false,physicalDatabase:'PGlite in memory; Auth and Storage schemas are stubs; no GoTrue or Storage HTTP',sourceContentPublished:false};
  writeFileSync('docs/evidence/closure-csv123-actual.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({result:evidence.result,parsed:123,created:123,repeatSkipped:123,remoteMutations:false}));
 }finally{await db.close();}
}
main().catch(()=>{console.error('CSV_LOCAL_ACCEPTANCE_FAILED; no source rows are logged');process.exitCode=1;});
