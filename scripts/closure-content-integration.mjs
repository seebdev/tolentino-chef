import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ClosureSession,preflight,readState,assertOwned,requireState as ok,evidence} from './closure-owner-integration.mjs';
const report={at:new Date().toISOString(),checks:[],realBusinessApis:true,interception:false,cleanup:'owned temporary restaurant reserved for final cleanup'};
const check=(value,name)=>{ok(value,name);report.checks.push({name,status:'PASS'});console.log(JSON.stringify({check:name,status:'PASS'}))};
const session=new ClosureSession();
try{
 ok(process.argv.includes('--apply'),'APPLY_REQUIRED');
 const {db,destination}=await preflight();report.destination=destination;
 const state=readState(),account=state.accounts.beta;ok(account.stage==='ready','BETA_NOT_READY');await assertOwned(db,state,account);
 check((await session.login(account.alias,account.password)).status===200,'OWNER_ALIAS_LOGIN');
 const path='/api/workspace/'+account.restaurantId;
 const action=async(action,data)=>{const r=await session.request(path,{method:'POST',data:{action,data}});ok(r.status===200,'ACTION_'+action.toUpperCase()+'_'+r.status);return r.data.data};
 await action('save_languages',{default_language:'es',enabled_languages:['es']});
 const category=await action('save_category',{name:'Cierre CSV y traducción',is_visible:true});
 const product=await action('save_product',{category_id:category.id,name:'Sopa de tomate',description:'Sopa de tomate con albahaca.',ingredients:'Tomate, albahaca y agua.',price:18000,extras:[{name:'Pan',price:2000}],is_published:true,is_featured:true,sku:'CLOSURE-PROBE-'+state.runId.slice(-8)});
 check(Array.isArray(product.variants)&&product.variants.length===0&&product.extras.length===1,'NEW_PRODUCT_WITHOUT_VARIANTS');
 const legacy=await action('save_product',{category_id:category.id,name:'Producto con variante histórica',price:19000,variants:[{name:'Grande',price:23000}],extras:[{name:'Pan',price:3000}],ingredients:'Tomate',sku:'CLOSURE-LEGACY-'+state.runId.slice(-8)});
 const changed=await action('save_product',{id:legacy.id,name:'Producto histórico conservado'});
 check(JSON.stringify(changed.variants)===JSON.stringify(legacy.variants)&&JSON.stringify(changed.extras)===JSON.stringify(legacy.extras)&&changed.ingredients===legacy.ingredients&&changed.price===legacy.price&&changed.category_id===category.id,'OMITTED_FIELDS_AND_HISTORIC_VARIANTS_PRESERVED');
 fs.writeFileSync('.runtime/migrations/hgntppemxwcxaxritnfq/closure-translation-probe.json',JSON.stringify({restaurantId:account.restaurantId,productId:product.id,categoryId:category.id,runId:state.runId},null,2)+'\n',{mode:0o600});
 const imports=path+'/import',header='nombre,precio,categoria,descripcion,sku\r\n';
 const count=async()=>{const r=await db.from('products').select('id',{count:'exact',head:true}).eq('restaurant_id',account.restaurantId);ok(!r.error,'COUNT');return r.count};
 const post=async(payload)=>session.request(imports,{method:'POST',data:payload});
 const csv1=header+'Producto individual,12000,Cierre CSV y traducción,Producto de prueba temporal,CLOSURE-ONE-'+state.runId.slice(-8)+'\r\n';
 const one={action:'commit',csv:csv1,createCategories:false,mode:'skip',attemptId:randomUUID()};
 const before=await count();
 const parallel=await Promise.all([post(one),post(one)]);
 check(parallel.every(r=>r.status===200&&r.data.summary.created===1)&&parallel.some(r=>r.data.replayed)&&await count()===before+1,'ONE_ROW_CONCURRENT_DOUBLE_SUBMIT_EXACTLY_ONCE');
 const recovery=await session.request(imports+'?attempt='+one.attemptId);
 check(recovery.status===200&&recovery.data.found&&recovery.data.summary.created===1,'LOST_RESPONSE_RECOVERED_FROM_PERSISTENT_JOURNAL');
 const replay=await post(one);check(replay.status===200&&replay.data.replayed&&await count()===before+1,'SAME_ATTEMPT_REPLAY_NO_DUPLICATION');
 const source=fs.readFileSync('C:/Users/sebas/OneDrive/Escritorio/tolentino_123_productos_prueba.csv','utf8');
 const csv123={action:'commit',csv:source,createCategories:true,mode:'skip',attemptId:randomUUID()};
 const preview=await post({...csv123,action:'preview'});check(preview.status===200&&preview.data.summary.valid===123&&preview.data.errors.length===0,'ACTUAL_USER_CSV_123_PREVIEW');
 const baseline123=await count(),result123=await post(csv123);
 check(result123.status===200&&result123.data.summary.created===123&&await count()===baseline123+123,'ACTUAL_USER_CSV_123_ATOMIC_CREATED');
 const skip=await post({...csv123,attemptId:randomUUID()});check(skip.status===200&&skip.data.summary.skipped===123&&skip.data.summary.created===0&&await count()===baseline123+123,'CSV_123_SKIP_REPEAT_NO_DUPLICATION');
 const rows=Array.from({length:1000},(_,i)=>`Producto lote ${i+1},15000,Cierre CSV y traducción,Prueba temporal de capacidad,CLOSURE-LARGE-${state.runId.slice(-8)}-${i+1}`).join('\r\n');
 const large={action:'commit',csv:header+rows,createCategories:false,mode:'skip',attemptId:randomUUID()};
 const preview1000=await post({...large,action:'preview'});check(preview1000.status===200&&preview1000.data.summary.valid===1000&&preview1000.data.errors.length===0,'CSV_1000_PREVIEW');
 const baseline1000=await count(),result1000=await post(large);
 check(result1000.status===200&&result1000.data.summary.created===1000&&await count()===baseline1000+1000,'CSV_1000_ATOMIC_CREATED');
 for(const [name,csv]of [['EMPTY',header],['1001',header+rows+'\r\nExtra,15000,Cierre CSV y traducción,No debe insertarse,CLOSURE-EXTRA'],['INVALID_PRICE',header+'Inválido,-1,Cierre CSV y traducción,No debe insertarse,CLOSURE-BAD']]){
  const prior=await count(),result=await post({...large,csv,attemptId:randomUUID()});check(result.status===400&&await count()===prior,'CSV_'+name+'_REJECTED_ZERO_WRITES');
 }
 const conflictStarted=Date.now();const mismatch=await post({...one,csv:csv1.replace('12000','13000')});report.conflictMilliseconds=Date.now()-conflictStarted;check(report.conflictMilliseconds<10000&&mismatch.status===409&&await count()===baseline1000+1000,'ATTEMPT_CHANGED_PAYLOAD_CONFLICT');
 report.totalTemporaryProducts=await count();report.result='PASS';
}catch(error){report.result='FAIL';report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:'CLOSURE_CONTENT_FAILED';process.exitCode=1}
finally{await session.logout().catch(()=>{});const file=evidence('content-live-integration.json',report);console.log(JSON.stringify({result:report.result,checks:report.checks.length,code:report.code,evidence:file}));}