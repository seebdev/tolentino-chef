import fs from 'node:fs';
import {targetEnvironment} from './migration-target-inspect.mjs';
import {connectTargetPg} from './migration-target-runtime.mjs';
const env=targetEnvironment(),project='hgntppemxwcxaxritnfq';
const report={at:new Date().toISOString(),projectRef:project,readOnly:true};
for(const type of ['security','performance']){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/advisors/${type}`,{headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(45000)});
 const value=r.ok?await r.json():null;
 const list=Array.isArray(value)?value:(value?.lints||value?.advisors||[]);
 report[type]={httpStatus:r.status,notices:list.map(x=>({name:x.name,title:x.title,level:x.level,detail:x.detail,remediation:x.remediation,metadata:x.metadata}))};
}
const db=await connectTargetPg(env);
try{
 report.tables=(await db.query("select n.nspname as schema,c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r' order by 1,2")).rows;
 report.functions=(await db.query("select n.nspname as schema,p.proname,p.prosecdef as definer,p.proconfig as config,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f' order by 1,2")).rows;
 report.changelogCompatibility=(await db.query("select version() as version,(select count(*)::int from pg_attribute a join pg_type t on t.oid=a.atttypid join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and t.typname in('ltree','_ltree')) as ltree_columns,(select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prosrc ~ 'cipher-algo=(bf|blowfish|cast5)') as legacy_cipher_functions")).rows[0];
}finally{await db.end()}
const file='docs/evidence/functional-closure-20261018/advisors-after-schema.json';fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file,security:report.security,performanceNoticeCount:report.performance.notices.length,publicRls:report.tables.filter(x=>x.schema==='public').every(x=>x.rls),changelogCompatibility:report.changelogCompatibility}));