import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {preflight,requireState as ok,evidence} from './closure-owner-integration.mjs';
import {protectBackupDirectory,loadBackupKey,encryptArchive,decryptArchive,digest,sha256} from './backup-common.mjs';
const SERVICE='srv-dba32beq1p3s73a4g6v0',ORIGIN='https://tolentino-restaurantes-admin.onrender.com';
const report={at:new Date().toISOString(),operation:process.argv.includes('--apply')?'merge-existing-render-environment':'plan-render-environment',serviceId:SERVICE,secretsPrinted:false,operations:[]};
try{
 const {env,destination}=await preflight();report.destination=destination;
 const translation=parseEnv(fs.readFileSync('.env.translation.local','utf8').replace(/^\uFEFF/,''));
 const enabled=!process.argv.includes('--disabled');
 if(enabled){const probe=JSON.parse(fs.readFileSync('docs/evidence/functional-closure-20261018/translation-real-small-batch.json','utf8'));ok(probe.result==='PASS'&&probe.samples.length===3,'SMALL_REAL_BATCH_REQUIRED');ok(translation.OPENAI_API_KEY?.length>15,'KEY_REQUIRED')}
 ok(Number(translation.TRANSLATION_BUDGET_USD)===(enabled?2:0),'BUDGET_EXACT_AUTHORIZATION');
 const patch={OPENAI_TRANSLATION_MODEL:'gpt-4.1-mini-2025-04-14',TRANSLATION_ENABLED:String(enabled),TRANSLATION_BUDGET_USD:enabled?'2':'0',TRANSLATION_MAX_OUTPUT_TOKENS:'2048',...(enabled?{OPENAI_API_KEY:translation.OPENAI_API_KEY}:{})};
 const api=async(path,method='GET',value)=>{ok(path.startsWith('/services/'+SERVICE),'RENDER_PATH');const r=await fetch('https://api.render.com/v1'+path,{method,headers:{Authorization:'Bearer '+env.TARGET_RENDER_API_KEY,...(value?{'Content-Type':'application/json'}:{})},body:value?JSON.stringify(value):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});report.operations.push({path,method,status:r.status});ok(r.ok,'RENDER_HTTP_'+r.status);return r.json()};
 const variables=async()=>{const values=[];let cursor='';const seen=new Set();for(let page=0;page<20;page++){const batch=await api('/services/'+SERVICE+'/env-vars?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));ok(Array.isArray(batch),'ENV_SHAPE');if(!batch.length)return values;values.push(...batch.map(x=>x.envVar));cursor=batch.at(-1).cursor;ok(cursor&&!seen.has(cursor),'ENV_PAGINATION');seen.add(cursor)}throw Error('CLOSURE_ENV_PAGE_LIMIT')};
 const before=await variables(),map=Object.fromEntries(before.map(x=>[x.key,x.value]));ok(before.length===Object.keys(map).length,'ENV_DUPLICATES');
 ok(map.APP_URL===ORIGIN&&map.NEXT_PUBLIC_SUPABASE_URL===env.TARGET_SUPABASE_URL&&map.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY===env.TARGET_SUPABASE_PUBLISHABLE_KEY&&map.SUPABASE_SERVICE_ROLE_KEY===env.TARGET_SUPABASE_SERVICE_ROLE_KEY,'CURRENT_RENDER_TARGET_CONFIGURATION');
 const expected={...map,...patch};report.preservedKeys=Object.keys(map).filter(k=>!(k in patch));report.configuredKeys=Object.keys(patch);report.translationEnabled=enabled;report.budgetUsd=enabled?2:0;
 if(process.argv.includes('--apply')){
  protectBackupDirectory();const {key,mode}=loadBackupKey();try{const payload={serviceId:SERVICE,at:report.at,environment:before};const encrypted=encryptArchive(payload,key,mode);ok(digest(decryptArchive(encrypted,key))===digest(payload),'ENV_BACKUP_ROUNDTRIP');const file='.runtime/backups/render-environment-'+report.at.replace(/[^0-9TZ]/g,'')+'.json.enc';fs.writeFileSync(file,encrypted,{flag:'wx',mode:0o600});report.backup={file,sha256:sha256(encrypted)}}finally{key.fill(0)}
  const fresh=await variables();ok(digest(fresh.slice().sort((a,b)=>a.key.localeCompare(b.key)))===digest(before.slice().sort((a,b)=>a.key.localeCompare(b.key))),'ENV_CHANGED_BEFORE_APPLY');
  await api('/services/'+SERVICE+'/env-vars','PUT',Object.entries(expected).map(([key,value])=>({key,value})));
  const after=await variables();ok(after.length===Object.keys(expected).length&&after.every(x=>x.value===expected[x.key]),'ENV_READBACK');report.verifiedKeys=after.map(x=>x.key);report.applied=true;
 }
 report.result='PASS';
}catch(error){report.result='FAIL';report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:'CLOSURE_RENDER_ENVIRONMENT_FAILED';process.exitCode=1}
const file=evidence('render-translation-environment-'+report.at.replace(/[^0-9TZ]/g,'')+'.json',report);console.log(JSON.stringify({result:report.result,code:report.code,applied:report.applied,translationEnabled:report.translationEnabled,configuredKeys:report.configuredKeys,evidence:file}));