import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {ClosureSession,preflight,readState,assertOwned,requireState as ok,evidence,PROJECT} from './closure-owner-integration.mjs';
import {runTranslationWorker} from './translation-worker.mjs';
import {translateJob,MODEL_PRICES} from './lib/translation-provider.mjs';
const report={at:new Date().toISOString(),provider:'OpenAI Responses',smallRealBatch:true,authorizedTotalBudgetUsd:2,events:[],samples:[],checks:[]};
const check=(condition,name)=>{ok(condition,name);report.checks.push({name,status:'PASS'})};
const session=new ClosureSession();
try{
 ok(process.argv.includes('--apply'),'APPLY_REQUIRED');
 const {env,db:reader,destination}=await preflight();report.destination=destination;
 const state=readState(),account=state.accounts.beta;await assertOwned(reader,state,account);
 const probe=JSON.parse(fs.readFileSync('.runtime/migrations/'+PROJECT+'/closure-translation-probe.json','utf8'));
 ok(probe.restaurantId===account.restaurantId&&probe.runId===state.runId,'PROBE_OWNERSHIP');
 const config=parseEnv(fs.readFileSync('.env.translation.local','utf8').replace(/^\uFEFF/,''));
 ok(config.OPENAI_API_KEY?.length>15&&Number(config.TRANSLATION_BUDGET_USD)===2&&config.TRANSLATION_ENABLED==='true','AUTHORIZED_CONFIGURATION');
 const runtime={...config,NEXT_PUBLIC_SUPABASE_URL:env.TARGET_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:env.TARGET_SUPABASE_SERVICE_ROLE_KEY};
 report.model=config.OPENAI_TRANSLATION_MODEL;report.prices=MODEL_PRICES[report.model];
 check((await session.login(account.alias,account.password)).status===200,'OWNER_LOGIN');
 const languages=await session.request('/api/workspace/'+account.restaurantId,{method:'POST',data:{action:'save_languages',data:{default_language:'es',enabled_languages:['es','en','fr','ja']}}});check(languages.status===200,'LANGUAGES_QUEUE_TRANSACTION');
 const retry=await session.request('/api/workspace/'+account.restaurantId+'/translations',{method:'POST',data:{action:'retry',confirm:true}});check(retry.status===200,'RETRY_FAILED_PROBE_AFTER_KEY_CORRECTION');
 const jobs=await reader.from('translation_jobs').select('*').eq('restaurant_id',account.restaurantId).eq('entity_id',probe.productId).in('language',['en','fr','ja']).eq('status','pending');
 check(!jobs.error&&jobs.data.length===3,'THREE_JOBS_PERSISTED');
 const selected=new Set(jobs.data.map(x=>x.id)),queue=[...selected];
 const client=createClient(env.TARGET_SUPABASE_URL,env.TARGET_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method=(options.method||'GET').toUpperCase();
  ok(url.origin===env.TARGET_SUPABASE_URL&&(method==='GET'||(method==='POST'&&['configure_translation_budget','claim_translation_job','finish_translation_job'].some(name=>url.pathname==='/rest/v1/rpc/'+name))),'WORKER_ROUTE');
  return fetch(input,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(60000)});
 }}});
 const scoped={from:client.from.bind(client),rpc:async(name,args)=>{
  if(name==='claim_translation_job'){const id=queue.shift();if(!id)return{data:null,error:null};return client.rpc(name,{...args,p_job_id:id});}
  if(name==='finish_translation_job')ok(selected.has(args.p_job_id),'JOB_SCOPE');
  if(name==='configure_translation_budget')ok(args.p_limit_micro_usd===2000000,'BUDGET_CAP');
  return client.rpc(name,args);
 }};
 const provider=async(job,options)=>{const output=await translateJob(job,options);report.samples.push({jobId:job.id,entityType:job.entity_type,language:job.language,source:job.source_fields,translated:output.fields,inputTokens:output.inputTokens,outputTokens:output.outputTokens,estimatedMicroUsd:output.costMicroUsd});return output};
 report.worker=await runTranslationWorker({env:runtime,maxJobs:3,db:scoped,provider,onEvent:event=>{report.events.push(event);console.log(JSON.stringify({event:event.event,status:event.status,errorCode:event.errorCode}))}});
 const results=await reader.from('translation_jobs').select('id,status,attempts,error_code').in('id',[...selected]);
 report.results=results.data;check(!results.error&&results.data.length===3&&results.data.every(x=>x.status==='completed'),'THREE_REAL_TRANSLATIONS_COMPLETED');
 const saved=await reader.from('translations').select('language,fields,is_manual,source_hash').eq('restaurant_id',account.restaurantId).eq('entity_id',probe.productId);
 check(!saved.error&&saved.data.length===3&&saved.data.every(x=>!x.is_manual&&x.source_hash),'VALIDATED_TRANSLATIONS_PERSISTED');
 const before=await reader.from('restaurants').select('menu_version').eq('id',account.restaurantId).single();
 const requested=await session.request('/api/workspace/'+account.restaurantId+'/translations',{method:'POST',data:{action:'enqueue',confirm:true}});check(requested.status===200,'OWNER_DEDUPLICATED_QUEUE_REQUEST');
 const after=await reader.from('translation_jobs').select('id,status,attempts').in('id',[...selected]);check(after.data.every(x=>x.status==='completed'&&x.attempts===1),'DEDUPLICATION_NO_SECOND_PROVIDER_CALL');
 const ledger=await client.rpc('configure_translation_budget',{p_limit_micro_usd:2000000});ok(!ledger.error,'BUDGET_READ');report.budget=ledger.data;
 check(ledger.data.charged_micro_usd<=2000000&&ledger.data.charged_micro_usd>=report.samples.reduce((sum,x)=>sum+x.estimatedMicroUsd,0),'TOTAL_CAP_PERSISTED');
 report.menuVersion=before.data.menu_version;report.semanticReview='Selected soup sample only: source quantities, tomato/basil/water, bread extra, no added claims. Other generated content requires review.';
 report.result='PASS';
}catch(error){report.result='FAIL';report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:'CLOSURE_TRANSLATION_PROBE_FAILED';process.exitCode=1}
finally{await session.logout().catch(()=>{});const file=evidence('translation-real-small-batch.json',report);console.log(JSON.stringify({result:report.result,code:report.code,checks:report.checks.length,estimatedBudget:report.budget,evidence:file}));}