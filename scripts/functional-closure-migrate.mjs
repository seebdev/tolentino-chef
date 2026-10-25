import fs from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {targetEnvironment} from './migration-target-inspect.mjs';
import {connectTargetPg} from './migration-target-runtime.mjs';
import {inspect} from './inspect-render-migration.mjs';
const PROJECT='hgntppemxwcxaxritnfq',SERVICE='srv-dba32beq1p3s73a4g6v0',OWNER='tea-dba1s4m1egvs7391ve50';
const URL='https://tolentino-restaurantes-admin.onrender.com',REPO='https://github.com/seebdev/tolentino-chef';
const files=['20261018053627_owner_access.sql','20261018053802_import_attempts_and_qr_versions.sql','20261018053943_appearance_publication.sql','20261018054420_translation_jobs.sql','20261018061842_closure_queue_indexes.sql','20261018062727_terminal_business_conflicts.sql','20261018063724_translation_manual_fields.sql'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const normalized=x=>String(x).replace(/\r\n/g,'\n');
const assert=(condition,code)=>{if(!condition)throw new Error(code)};
const option=name=>process.argv[process.argv.indexOf(name)+1];
const apply=process.argv.includes('--apply');
const report={at:new Date().toISOString(),projectRef:PROJECT,serviceId:SERVICE,operation:apply?'incremental-schema-apply':'incremental-schema-plan',migrations:[],remoteMutations:0};
let db;
try{
 const env=targetEnvironment();assert(env.TARGET_SUPABASE_URL===`https://${PROJECT}.supabase.co`,'PROJECT_MISMATCH');
 const origin=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim().replace(/\.git$/,'');assert(origin===REPO,'REPOSITORY_MISMATCH');
 const remote=execFileSync('.runtime/gh/bin/gh.exe',['api','repos/seebdev/tolentino-chef/git/ref/heads/main','--jq','.object.sha'],{encoding:'utf8',windowsHide:true}).trim();
 const inventory=await inspect(env);assert(inventory.render.status==='read_only_inventory_complete','INVENTORY_FAILED');
 const services=inventory.render.services.filter(s=>s.ownerId===OWNER);assert(services.length===1&&services[0].id===SERVICE,'SERVICE_INVENTORY_MISMATCH');
 assert(inventory.publicAuth.signupDisabled&&!inventory.publicAuth.anonymousEnabled,'PUBLIC_SIGNUP_NOT_CLOSED');
 const render=async path=>{const r=await fetch('https://api.render.com/v1/services/'+SERVICE+path,{headers:{Authorization:'Bearer '+env.TARGET_RENDER_API_KEY},redirect:'error',signal:AbortSignal.timeout(30000)});assert(r.ok,'RENDER_READ_FAILED');return r.json()};
 const service=await render('');assert(service.ownerId===OWNER&&service.repo.replace(/\.git$/,'')===REPO&&service.branch==='main'&&service.serviceDetails.plan==='free'&&service.serviceDetails.url.replace(/\/$/,'')===URL,'RENDER_TARGET_MISMATCH');
 const deploys=(await render('/deploys?limit=20')).map(x=>x.deploy);const live=deploys.find(x=>x.status==='live');assert(live?.commit?.id===remote,'LIVE_MAIN_MISMATCH');
 assert(!deploys.some(x=>['created','queued','build_in_progress','pre_deploy_in_progress','update_in_progress'].includes(x.status)),'DEPLOYMENT_IN_PROGRESS');
 const health=await fetch(URL+'/api/health',{redirect:'error',signal:AbortSignal.timeout(60000)});const healthValue=await health.json();assert(health.ok&&healthValue.supabaseProjectRef===PROJECT&&healthValue.configured,'PUBLIC_DATABASE_MISMATCH');
 report.destination={repository:origin,branch:'main',commit:remote,url:URL,workspace:OWNER,signupDisabled:true};
 db=await connectTargetPg(env);
 const history=(await db.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
 const all=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
 assert(history.length>=2&&history.length<=all.length,'HISTORY_UNEXPECTED');
 for(let i=0;i<history.length;i++){
  const expected=all[i];assert(expected?.startsWith(history[i].version+'_')&&history[i].statements?.length===1,'HISTORY_PREFIX_MISMATCH');
  assert(hash(normalized(fs.readFileSync('supabase/migrations/'+expected,'utf8')))===hash(normalized(history[i].statements[0])),'HISTORY_CONTENT_MISMATCH');
 }
 const pending=all.slice(history.length);assert(pending.every(f=>files.includes(f)),'UNREVIEWED_MIGRATION');
 report.migrations=pending.map(file=>({file,sha256:hash(fs.readFileSync('supabase/migrations/'+file))}));
 if(apply){
  assert(option('--confirm-target')===PROJECT,'TARGET_CONFIRMATION_REQUIRED');
  const backupPath=resolve(option('--backup')||'');assert(backupPath.startsWith(resolve('.runtime/backups')+'\\'),'BACKUP_PATH_INVALID');
  const backupHash=hash(fs.readFileSync(backupPath));assert(backupHash===option('--backup-sha256'),'BACKUP_HASH_MISMATCH');
  const restore=JSON.parse(fs.readFileSync(option('--restore-evidence'),'utf8'));
  assert(restore.result==='PASS'&&JSON.stringify(restore).includes(backupHash),'RESTORE_EVIDENCE_REQUIRED');
  assert(Date.now()-fs.statSync(backupPath).mtimeMs<2*3600000,'BACKUP_TOO_OLD');
  report.backup={archive:option('--backup'),sha256:backupHash,restoreEvidence:option('--restore-evidence')};
  await db.query('begin read write');
  await db.query("select pg_advisory_xact_lock(hashtext('tolentino-functional-closure'))");
  const tables=(await db.query("select table_name,column_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows;
  const columns=new Map();for(const row of tables){assert(/^[a-z_]+$/.test(row.table_name)&&/^[a-z_]+$/.test(row.column_name),'CATALOG_IDENTIFIER_INVALID');columns.set(row.table_name,[...(columns.get(row.table_name)||[]),row.column_name])}
  await db.query('lock table '+[...columns.keys()].map(t=>'public."'+t+'"').join(',')+' in share row exclusive mode');
  const snapshot=async()=>{
   const values={};for(const [table,names]of columns){const rows=(await db.query('select '+names.map(n=>'"'+n+'"').join(',')+' from public."'+table+'"')).rows;values[table]={count:rows.length,sha256:hash(JSON.stringify(rows.map(r=>hash(JSON.stringify(r))).sort()))}}
   return values;
  };
  const manualMigration=report.migrations.length===1&&report.migrations[0].file==='20261018063724_translation_manual_fields.sql';
  const preservedRows=async()=>{const result={};for(const table of ['restaurants','translations','translation_jobs'])result[table]=(await db.query('select * from public.'+table+' order by id')).rows;return result};
  const manualBefore=manualMigration?await preservedRows():null;
  if(manualMigration)assert(manualBefore.translations.every(t=>t.is_manual&&t.source_hash===null)&&manualBefore.translation_jobs.every(j=>j.status!=='processing'),'MANUAL_BACKFILL_PRECONDITIONS');
  const before=await snapshot();
  for(const migration of report.migrations){const sql=fs.readFileSync('supabase/migrations/'+migration.file,'utf8');assert(hash(sql)===migration.sha256,'MIGRATION_CHANGED_AFTER_REVIEW');await db.query(sql);await db.query('insert into supabase_migrations.schema_migrations(version,statements,name)values($1,$2,$3)',[migration.file.split('_')[0],[sql],migration.file.replace(/^\d+_/,'').replace(/\.sql$/,'')]);}
  const after=await snapshot();
  if(manualMigration){
   const manualAfter=await preservedRows();
   const omit=(r,keys)=>Object.fromEntries(Object.entries(r).filter(([k])=>!keys.includes(k)).sort(([a],[b])=>a.localeCompare(b)));
   const stable=(rows,keys)=>JSON.stringify(rows.map(r=>omit(r,keys)));
   for(const table of Object.keys(before))if(!['restaurants','translations','translation_jobs'].includes(table))assert(JSON.stringify(before[table])===JSON.stringify(after[table]),'UNRELATED_DATA_CHANGED');
   assert(stable(manualBefore.translations,['updated_at'])===stable(manualAfter.translations,['updated_at','manual_fields']),'MANUAL_TEXT_OR_ID_CHANGED');
   assert(stable(manualBefore.restaurants,['updated_at','menu_version','menu_version_transaction'])===stable(manualAfter.restaurants,['updated_at','menu_version','menu_version_transaction']),'RESTAURANT_BUSINESS_DATA_CHANGED');
   const affected=new Set(manualBefore.translations.map(t=>t.restaurant_id));
   for(const old of manualBefore.restaurants){const next=manualAfter.restaurants.find(r=>r.id===old.id);assert(Number(next.menu_version)===Number(old.menu_version)+(affected.has(old.id)?1:0),'UNEXPECTED_MENU_VERSION');}
   const mutableJob=['status','attempts','lease_id','lease_until','next_attempt_at','updated_at'];
   const oldIds=new Set(manualBefore.translation_jobs.map(j=>j.id));
   assert(stable(manualBefore.translation_jobs,mutableJob)===stable(manualAfter.translation_jobs.filter(j=>oldIds.has(j.id)),mutableJob),'JOB_CONTENT_CHANGED');
   for(const old of manualBefore.translation_jobs){const next=manualAfter.translation_jobs.find(j=>j.id===old.id);assert(next&&['pending','manual','completed','superseded','failed'].includes(next.status)&&next.attempts<=old.attempts,'UNEXPECTED_JOB_STATE');}
   const masks=(await db.query("select count(*)::int n from public.translations t where t.manual_fields is distinct from coalesce((select array_agg(key order by key) from jsonb_each(t.fields) where private.translation_has_text(value)),'{}'::text[])")).rows[0].n;
   assert(masks===0,'MANUAL_PROVENANCE_MISMATCH');
   for(const job of manualAfter.translation_jobs.filter(j=>!oldIds.has(j.id))){const valid=(await db.query("select $2::jsonb=private.translation_source($1,$3,$4) as valid",[job.restaurant_id,JSON.stringify(job.source_fields),job.entity_type,job.entity_id])).rows[0].valid;assert(valid,'NEW_JOB_SOURCE_MISMATCH');}
   report.expectedMetadataChanges={manualFieldMasks:manualAfter.translations.length,menuVersionIncrements:affected.size,newJobs:manualAfter.translation_jobs.length-manualBefore.translation_jobs.length,manualTextPreserved:true};
  }else assert(JSON.stringify(before)===JSON.stringify(after),'EXISTING_DATA_CHANGED');
  const security=(await db.query("select count(*)::int as tables,count(*)filter(where relrowsecurity)::int as secured from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows[0];assert(security.tables===security.secured,'RLS_NOT_ENABLED');
  await db.query("notify pgrst,'reload schema'");
  await db.query('commit');report.remoteMutations=report.migrations.length;report.dataPreservation={tables:columns.size,rows:Object.values(before).reduce((sum,t)=>sum+t.count,0),originalColumnsAndRowsUnchanged:!manualMigration,originalBusinessDataPreserved:true};report.security=security;
 }
 report.result='PASS';
}catch(error){if(db)await db.query('rollback').catch(()=>{});report.result='FAIL';report.error=/^[A-Z_0-9]+$/.test(error.message)?error.message:'MIGRATION_FAILED';report.sqlState=typeof error.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:undefined;process.exitCode=1;
}finally{if(db)await db.end().catch(()=>{})}
const directory='docs/evidence/functional-closure-20261018';fs.mkdirSync(directory,{recursive:true});const evidence=directory+'/schema-'+(apply?'apply':'plan')+'-'+report.at.replace(/[^0-9TZ]/g,'')+'.json';fs.writeFileSync(evidence,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,evidence}));