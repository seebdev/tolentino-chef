import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {targetEnvironment} from './migration-target-inspect.mjs';
import {createHash} from 'node:crypto';
import {validateQrArtifact} from '../src/lib/qr.ts';
const env=targetEnvironment();Object.assign(process.env,env,{AUDIT_BASE_URL:'https://tolentino-restaurantes-admin.onrender.com'});
const {loadTargetDemos,loadTargetAdmin,assertAppTarget}=await import('./audit-target.mjs');
const {Session,base}=await import('./live-client.mjs');
const {manifest,accounts}=loadTargetDemos();
const report={at:new Date().toISOString(),scope:'public-production-read-only-business',origin:base,projectRef:'hgntppemxwcxaxritnfq',checks:[],menus:[],qrArtifacts:[],physicalCameraScan:false,printedPdfScan:false};
const check=(condition,name)=>{if(!condition)throw Error(name);report.checks.push({name,result:'PASS'})};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sessions=[];
try{
 await assertAppTarget(base,{fresh:true});
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const r=await fetch('https://api.render.com/v1/services/srv-dba32beq1p3s73a4g6v0/deploys?limit=20',{headers:{Authorization:'Bearer '+env.TARGET_RENDER_API_KEY},redirect:'error'});check(r.ok,'RENDER_READ');const deploys=await r.json();const live=deploys.map(x=>x.deploy).find(x=>x.status==='live');check(live?.commit?.id===head,'DEPLOYED_COMMIT_MATCHES');report.commit=head;report.deployId=live.id;
 const admin=loadTargetAdmin(),adminSession=new Session();sessions.push(adminSession);const adminLogin=await adminSession.login(admin.email,admin.password);check(adminLogin.role==='superadmin','SUPERADMIN_PUBLIC_LOGIN');
 const adminState=await adminSession.request('/api/session');check(adminState.data.role==='superadmin','SUPERADMIN_SERVER_ROLE');
 for(const route of ['/login','/admin']){const response=await fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(60000)});check(response.status===200||[302,303,307,308].includes(response.status),'PUBLIC_ROUTE_'+route.replaceAll('/','_'))}
 const photos=JSON.parse(fs.readFileSync('public/photo-credits.json','utf8')).items;
 fs.mkdirSync('artifacts/functional-closure-20261018/qr',{recursive:true});
 for(const restaurant of manifest.restaurants){
  const slug=new URL(restaurant.localMenu).pathname.split("/").at(-1);
  const account=accounts[restaurant.key],owner=new Session();sessions.push(owner);const login=await owner.login(account.email,account.password);check(login.role==='owner','OWNER_PUBLIC_LOGIN_'+restaurant.key);
  for(const other of manifest.restaurants.filter(r=>r.id!==restaurant.id))for(const suffix of ['', '/preview', '/translations', '/qr?format=png']){const denied=await owner.request('/api/workspace/'+other.id+suffix,{expected:[403]});check(denied.status===403,'ISOLATION_'+restaurant.key+'_'+other.key+'_'+suffix.replace(/[^a-z]/g,''));}
  const workspace=await owner.request('/api/workspace/'+restaurant.id);check(workspace.data.role==='owner'&&workspace.data.restaurant.id===restaurant.id,'OWNER_CONTEXT_'+restaurant.key);
  const response=await fetch(base+'/api/public/menu/'+slug,{redirect:'error',signal:AbortSignal.timeout(60000)}),menu=await response.json();check(response.status===200&&menu.restaurant.id===restaurant.id,'PUBLIC_MENU_'+restaurant.key);check(!/\bDEMO\b/i.test(menu.restaurant.name),'SAMPLE_NAME_CLEAN_'+restaurant.key);
  check(menu.contact.brand==='Tolentino Chef'&&menu.contact.phone==='3108853158'&&menu.contact.url.startsWith('https://wa.me/573108853158'),'CREATOR_CONTACT_'+restaurant.key);
  const version=await fetch(base+'/api/public/menu/'+slug+'/version',{redirect:'error'});const versionBody=await version.json();check(version.ok&&versionBody.restaurantId===restaurant.id&&versionBody.menu_version===menu.restaurant.menu_version,'VERSION_ENDPOINT_'+restaurant.key);
  const destination=base+'/q/'+restaurant.publicToken;const qrRedirect=await fetch(destination,{redirect:'manual',signal:AbortSignal.timeout(60000)});check([302,307,308].includes(qrRedirect.status)&&qrRedirect.headers.get('location')===base+'/menu/'+slug,'PERMANENT_QR_REDIRECT_'+restaurant.key);
  const inject=await fetch(destination+'?redirect=https://example.org',{redirect:'manual'});check(inject.headers.get('location')===base+'/menu/'+slug,'QR_EXTERNAL_REDIRECT_IGNORED_'+restaurant.key);
  for(const format of ['png','svg','pdf']){
   const download=await owner.request('/api/workspace/'+restaurant.id+'/qr?format='+format+'&size=1024');check(download.status===200&&download.headers.get('x-qr-validated')==='true'&&download.headers.get('x-qr-permanent-url')===destination,'QR_FINAL_ARTIFACT_'+restaurant.key+'_'+format);
   const validation=await validateQrArtifact(download.data,format,destination,[1024,768,512]);const file='artifacts/functional-closure-20261018/qr/'+restaurant.key+'.'+format;fs.writeFileSync(file,download.data);report.qrArtifacts.push({restaurant:restaurant.key,format,file,bytes:download.data.length,sha256:sha256(download.data),destination,validation});
  }
  const registered=photos.filter(x=>x.restaurantId===restaurant.id&&x.imagePath);
  for(const photo of registered){const file=await fetch(base+'/api/media/'+photo.imagePath,{redirect:'error',signal:AbortSignal.timeout(60000)});check(file.status===200&&file.headers.get('content-type')?.startsWith('image/'),'PHOTO_PUBLIC_'+photo.productId);await file.arrayBuffer()}
  const credit=await fetch(base+'/creditos-fotografias?restaurant='+restaurant.id,{redirect:'error'}),html=await credit.text();check(credit.status===200&&registered.every(x=>html.includes(x.sourceUrl.replaceAll('&','&amp;'))),'PHOTO_CREDITS_'+restaurant.key);
  report.menus.push({id:restaurant.id,url:base+'/menu/'+slug,qrUrl:destination,name:menu.restaurant.name,products:menu.products.length,categories:menu.categories.length,languages:menu.settings.enabled_languages,photos:registered.length,version:menu.restaurant.menu_version});await owner.logout();sessions.splice(sessions.indexOf(owner),1);
 }
 for(const flag of ['co','gb','fr','it','cn','jp','in']){const response=await fetch(base+'/flags/'+flag+'.svg',{redirect:'error'});check(response.ok&&response.headers.get('content-type')?.includes('svg'),'FLAG_PUBLIC_'+flag)}
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=/^[A-Z_a-z0-9-]+$/.test(error.message)?error.message:'PUBLIC_CLOSURE_CHECK_FAILED';process.exitCode=1}
finally{for(const session of sessions)await session.logout().catch(()=>{});fs.writeFileSync('docs/evidence/functional-closure-20261018/public-release-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,error:report.error,commit:report.commit,checks:report.checks.length,qrArtifacts:report.qrArtifacts.length,menus:report.menus,evidence:'docs/evidence/functional-closure-20261018/public-release-smoke.json'}));}