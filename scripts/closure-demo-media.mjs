import fs from 'node:fs';
import sharp from 'sharp';
import {digest,sha256} from './backup-common.mjs';
import {ClosureSession,preflight,originalsFingerprint,readAll,requireState as ok,evidence,PROJECT} from './closure-owner-integration.mjs';
import {loadTargetDemos} from './audit-target.mjs';
import {connectTargetPg} from './migration-target-runtime.mjs';
const plan=JSON.parse(fs.readFileSync('.runtime/assets-proposed/plan.json','utf8'));
const journalFile='.runtime/migrations/'+PROJECT+'/closure-photo-uploads.json';
const report={at:new Date().toISOString(),projectRef:PROJECT,mode:process.argv.includes('--upload')?'upload-unlinked-media':process.argv.includes('--apply')?'apply-reviewed-seed-changes':process.argv.includes('--validate-transaction')?'validate-and-rollback-seed-changes':'plan',changes:[],originalObjectsDeleted:0};
const sessions=[];let pg;
try{
 const {env,db,destination}=await preflight();report.destination=destination;
 ok(plan.targetProjectRef===PROJECT&&plan.rows.length===72&&plan.excludedNonSeedProducts===123,'PHOTO_PLAN_TARGET');
 const {manifest,accounts}=loadTargetDemos();const ids=manifest.restaurants.map(r=>r.id);
 const state=fs.existsSync(journalFile)?JSON.parse(fs.readFileSync(journalFile,'utf8')):{projectRef:PROJECT,planSha256:digest(plan),uploads:{}};
 ok(state.projectRef===PROJECT&&state.planSha256===digest(plan),'PHOTO_PLAN_CHANGED');
 const save=()=>fs.writeFileSync(journalFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
 const expectedImage=async(path,hash)=>{const r=await db.storage.from('restaurant-media').download(path);ok(!r.error&&sha256(Buffer.from(await r.data.arrayBuffer()))===hash,'ORIGINAL_IMAGE_CHANGED')};
 const current=await readAll(db,'products',{field:'restaurant_id',ids});
 const checkedImages=new Set();
 if(!state.applied){
  for(const row of plan.rows){const product=current.find(p=>p.id===row.productId);ok(product&&product.restaurant_id===row.restaurantId&&product.sku===row.sku&&product.name===row.seedName&&product.description===row.seedDescription+' Producto de demostración.'&&product.image_path===row.currentImagePath&&row.originalImageVerified,'SEED_CHANGED_PRESERVE');if(!checkedImages.has(row.currentImagePath)){await expectedImage(row.currentImagePath,row.currentImageSha256);checkedImages.add(row.currentImagePath)}}
  for(const branding of plan.branding){ok(branding.logo.originalVerified,'LOGO_NOT_ORIGINAL');await expectedImage(branding.logo.currentPath,branding.logo.currentSha256)}
 }
 const tasks=plan.rows.filter(r=>r.proposedSourceId).map(r=>{const source=plan.sources.find(s=>s.id===r.proposedSourceId);ok(source?.visualReview?.status==='SELECTED','PHOTO_NOT_REVIEWED');return{restaurantId:r.restaurantId,key:r.proposedSourceId,file:source.optimized.file,sha256:source.optimized.sha256,productId:r.productId}});
 for(const logo of plan.logos)tasks.push({restaurantId:plan.branding.find(b=>b.restaurantKey===logo.restaurantKey).restaurantId,key:logo.restaurantKey+'-logo-clean',file:logo.file,sha256:logo.sha256});
 report.selectedPhotos=tasks.filter(t=>t.productId).length;report.neutralWithoutPhoto=72-report.selectedPhotos;
 if(report.mode==='upload-unlinked-media'){
  const before=await originalsFingerprint(db,ids);
  for(const restaurant of manifest.restaurants){
   const account=accounts[restaurant.key],session=new ClosureSession();sessions.push(session);
   const login=await session.login(account.email,account.password);ok(login.status===200&&login.data.role==='owner','PHOTO_OWNER_LOGIN');
   for(const task of tasks.filter(t=>t.restaurantId===restaurant.id)){
    const key=restaurant.id+':'+task.key;
    if(state.uploads[key]){const saved=state.uploads[key];ok(saved.sourceSha256===task.sha256&&saved.path.startsWith(restaurant.id+'/'),'UPLOAD_JOURNAL_CHANGED');await expectedImage(saved.path,saved.storedSha256);continue}
    const input=fs.readFileSync('.runtime/assets-proposed/'+task.file);ok(sha256(input)===task.sha256,'ASSET_CHANGED');
    const expected=await sharp(input,{limitInputPixels:16000000,animated:false}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
    const form=new FormData();form.set('file',new Blob([input],{type:'image/webp'}),task.file);
    const upload=await session.request('/api/workspace/'+restaurant.id+'/media',{method:'POST',form});ok(upload.status===201&&upload.data.path.startsWith(restaurant.id+'/'),'PHOTO_UPLOAD_FAILED');
    state.uploads[key]={path:upload.data.path,sourceSha256:task.sha256,storedSha256:sha256(expected),bytes:expected.length};save();
    await expectedImage(upload.data.path,sha256(expected));
    console.log(JSON.stringify({uploaded:Object.keys(state.uploads).length,total:tasks.length,restaurant:restaurant.key}));
   }
   await session.logout();sessions.splice(sessions.indexOf(session),1);
  }
  ok(digest(before)===digest(await originalsFingerprint(db,ids)),'UPLOAD_CHANGED_BUSINESS_DATA');
  const credits=JSON.parse(fs.readFileSync('public/photo-credits.json','utf8'));
  for(const item of credits.items){const task=tasks.find(t=>t.productId===item.productId);ok(task,'CREDIT_TASK_MISSING');item.imagePath=state.uploads[task.restaurantId+':'+task.key].path;item.changes+=' Server media processing: WebP quality 85; no cropping or generative edits.'}
  fs.writeFileSync('public/photo-credits.json',JSON.stringify(credits,null,2)+'\n');state.uploaded=true;save();report.uploads=Object.keys(state.uploads).length;report.linkedToPublicMenu=false;
 }else if(['apply-reviewed-seed-changes','validate-and-rollback-seed-changes'].includes(report.mode)){
  ok(state.uploaded&&!state.applied,'UPLOAD_REQUIRED_OR_ALREADY_APPLIED');
  if(report.mode==='apply-reviewed-seed-changes'){
  const publicCredits=await fetch('https://tolentino-restaurantes-admin.onrender.com/creditos-fotografias',{redirect:'error',signal:AbortSignal.timeout(60000)});const html=await publicCredits.text();
  ok(publicCredits.ok&&tasks.filter(t=>t.productId).every(t=>html.includes(state.uploads[t.restaurantId+':'+t.key].path)),'PUBLIC_CREDITS_NOT_DEPLOYED');
  }
  pg=await connectTargetPg(env);await pg.query('begin read write');await pg.query("set local lock_timeout='5s'");await pg.query("set local statement_timeout='30s'");
  await pg.query("select pg_advisory_xact_lock(hashtext('tolentino-functional-closure'))");
  for(const table of ['restaurants','restaurant_settings','products','promotions','restaurant_qr_configs','translations'])await pg.query('lock table public.'+table+' in share row exclusive mode');
  const tables=['restaurants','restaurant_settings','restaurant_memberships','products','categories','promotions','translations','restaurant_qr_configs','restaurant_domains','restaurant_hours','commercial_sales','platform_admins','platform_settings'];
  const snapshots=async()=>{const rows={};for(const table of tables)rows[table]=(await pg.query('select * from public.'+table)).rows;return rows};
  const before=await snapshots();
  const expectations=structuredClone(before);
  const patch=async(table,row,changes)=>{const key=table==='restaurant_settings'||table==='restaurant_qr_configs'?'restaurant_id':'id';ok(row&&ids.includes(table==='restaurants'?row.id:row.restaurant_id),'PATCH_SCOPE');const fields=Object.keys(changes);ok(fields.every(k=>/^[a-z_]+$/.test(k)),'PATCH_FIELDS');const result=await pg.query('update public.'+table+' set '+fields.map((k,i)=>k+'=$'+(i+1)).join(',')+' where '+key+'=$'+(fields.length+1)+' returning '+key,[...fields.map(k=>changes[k]&&typeof changes[k]==='object'?JSON.stringify(changes[k]):changes[k]),row[key]]);ok(result.rowCount===1,'PATCH_COUNT');const expected=expectations[table].find(r=>r[key]===row[key]);Object.assign(expected,changes);report.changes.push({table,id:row[key],fields})};
  for(const item of plan.copy.proposals){const key=item.table==='restaurant_settings'||item.table==='restaurant_qr_configs'?'restaurant_id':'id';const row=before[item.table].find(r=>r[key]===(key==='restaurant_id'?item.restaurantId:item.id));ok(row&&Object.entries(item.expected).every(([k,v])=>row[k]===v),'COPY_CHANGED_PRESERVE');await patch(item.table,row,item.changes)}
  for(const item of plan.rows){const row=before.products.find(p=>p.id===item.productId);ok(row&&row.image_path===item.currentImagePath&&row.name===item.seedName&&row.description===item.seedDescription+' Producto de demostración.','PHOTO_ROW_CHANGED');const path=item.proposedSourceId?state.uploads[item.restaurantId+':'+item.proposedSourceId].path:null;await patch('products',row,{image_path:path})}
  for(const item of plan.copy.translations.filter(t=>t.fields)){const row=before.translations.find(t=>t.restaurant_id===item.restaurantId&&t.entity_id===item.entityId&&t.entity_type===item.entityType&&t.language===item.language);ok(row&&digest(row.fields)===item.expectedFieldsSha256,'MANUAL_SEED_CHANGED');await patch('translations',row,{fields:item.fields})}
  for(const branding of plan.branding){
   const row=before.restaurant_settings.find(s=>s.restaurant_id===branding.restaurantId);ok(row.appearance.logo_path===branding.logo.currentPath,'LOGO_CHANGED_PRESERVE');
   const logo=state.uploads[branding.restaurantId+':'+branding.restaurantKey+'-logo-clean'].path;
   const appearance={...row.appearance,logo_path:logo};if(appearance.favicon_path===branding.logo.currentPath)appearance.favicon_path=logo;
   const draft={...row.draft_appearance};if(draft.logo_path===branding.logo.currentPath)draft.logo_path=logo;if(draft.favicon_path===branding.logo.currentPath)draft.favicon_path=logo;
   const changes={appearance,draft_appearance:draft,appearance_revision:(BigInt(row.appearance_revision)+1n).toString()};
   for(const key of ['name','description']){const proposal=plan.copy.proposals.find(p=>p.table==='restaurants'&&p.restaurantId===branding.restaurantId&&p.expected[key]);if(proposal&&row['draft_'+key]===proposal.expected[key])changes['draft_'+key]=proposal.changes[key]}
   await patch('restaurant_settings',row,changes);
  }
  const after=await snapshots();
  const normalized=(table,rows)=>rows.map(row=>{const copy={...row};delete copy.updated_at;if(table==='restaurants'){delete copy.menu_version;delete copy.menu_version_transaction;}return digest(copy)}).sort();
  for(const table of tables)ok(digest(normalized(table,expectations[table]))===digest(normalized(table,after[table])),'UNEXPECTED_MUTATION_'+table.toUpperCase());
  const seedIds=new Set(plan.rows.map(r=>r.productId));ok(before.products.filter(p=>!seedIds.has(p.id)).length===123,'NON_SEED_COUNT');
  const protectedRows=rows=>rows.filter(p=>!seedIds.has(p.id)).map(digest).sort();ok(digest(protectedRows(before.products))===digest(protectedRows(after.products)),'USER_IMPORT_CHANGED');
  if(report.mode==='validate-and-rollback-seed-changes'){await pg.query('rollback');report.rolledBack=true}else{await pg.query('commit');state.applied=true;state.appliedAt=report.at;save();}report.originalImportedProductsPreserved=123;report.onlyPlannedFieldsChanged=true;
 }
 report.result='PASS';
}catch(error){await pg?.query('rollback').catch(()=>{});report.result='FAIL';report.code=/^CLOSURE_[A-Z0-9_]+$/.test(error.message)?error.message:'CLOSURE_PHOTO_OPERATION_FAILED';report.sqlState=typeof error.code==='string'&&/^[A-Z0-9]{5}$/.test(error.code)?error.code:undefined;process.exitCode=1}
finally{await pg?.end().catch(()=>{});for(const session of sessions)await session.logout().catch(()=>{});const file=evidence('demo-media-'+report.mode+'-'+report.at.replace(/[^0-9TZ]/g,'')+'.json',report);console.log(JSON.stringify({...report,changes:report.changes.length,evidence:file}));}