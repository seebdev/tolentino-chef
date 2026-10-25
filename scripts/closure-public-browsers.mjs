import fs from 'node:fs';
import {chromium,firefox,webkit,expect} from '@playwright/test';
import {loadTargetDemos} from './audit-target.mjs';
const base='https://tolentino-restaurantes-admin.onrender.com';
const {manifest}=loadTargetDemos({accounts:false});
const report={at:new Date().toISOString(),origin:base,realPublicNetwork:true,interceptedRoutes:false,physicalDevices:false,checks:[],screenshots:[]};
const check=(v,name)=>{if(!v)throw Error(name);report.checks.push(name)};
fs.mkdirSync('docs/evidence/functional-closure-20261018/public-browser',{recursive:true});
let browser;
try{
 for(const [name,engine,options] of [['chrome',chromium,{channel:'chrome'}],['firefox',firefox,{}],['webkit',webkit,{}],['edge',chromium,{channel:'msedge'}]]){
  browser=await engine.launch({headless:true,...options});const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',()=>errors.push('uncaught_page_error'));
  for(const restaurant of manifest.restaurants){
   const route=new URL(restaurant.localMenu).pathname;await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator('.public-product').first()).toBeVisible({timeout:60000});
   check(!/\bDEMO\b/i.test(await page.locator('h1').innerText()),name+'_'+restaurant.key+'_name');
   const languages=await page.locator('.language-flag').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-language')));check(languages.includes('es')&&languages.includes('en'),name+'_'+restaurant.key+'_languages');
   for(const language of languages){await page.locator('.language-flag[data-language="'+language+'"]').click();await expect(page.locator('.public-menu')).toHaveAttribute('lang',language);await expect.poll(()=>page.locator('.language-flag.active img').evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:30000}).toBe(true);check(true,name+'_'+restaurant.key+'_flag_'+language)}
   await page.locator('.language-flag[data-language="en"]').click();await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('.public-menu')).toHaveAttribute('lang','en');await page.locator('.language-flag[data-language="es"]').click();
   for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.locator('.public-product').first().waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('.menu-hero img')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:60000});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+'_'+restaurant.key+'_no_overflow_'+width);
    const file='docs/evidence/functional-closure-20261018/public-browser/'+name+'-'+restaurant.key+'-'+width+'.png';await page.screenshot({path:file,animations:'disabled'});report.screenshots.push(file);
   }
   await page.setViewportSize({width:390,height:900});await page.locator('.public-product').first().scrollIntoViewIfNeeded();await expect(page.locator('.public-product img').first()).toBeVisible();await page.waitForFunction(()=>{const img=document.querySelector('.public-product img');return img?.complete&&img.naturalWidth>0},null,{timeout:60000});const productsFile='docs/evidence/functional-closure-20261018/public-browser/'+name+'-'+restaurant.key+'-products.png';await page.screenshot({path:productsFile,animations:'disabled'});report.screenshots.push(productsFile);check(true,name+'_'+restaurant.key+'_brand_and_product_images_loaded');
   const contact=page.locator('.creator-contact');await contact.scrollIntoViewIfNeeded();check((await contact.getAttribute('href')).startsWith('https://wa.me/573108853158'),name+'_'+restaurant.key+'_creator');
   const credit=page.locator('a[href^="/creditos-fotografias"]');await expect(credit).toBeVisible();const [creditPage]=await Promise.all([context.waitForEvent('page'),credit.click()]);await creditPage.waitForLoadState('domcontentloaded');await expect(creditPage.locator('h1')).toContainText('fotograf');check(await creditPage.locator('img').count()>0,name+'_'+restaurant.key+'_credits');await creditPage.close();
  }
  check(errors.length===0,name+'_no_uncaught_errors');await context.close();await browser.close();browser=null;console.log(JSON.stringify({browser:name,status:'PASS',checks:report.checks.length}));
 }
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=/^[a-zA-Z0-9_]+$/.test(error.message)?error.message:'PUBLIC_BROWSER_ASSERTION_FAILED';report.detail=String(error.message).slice(0,2400);const failedPage=browser?.contexts()[0]?.pages()[0];if(failedPage){report.failedUrl=failedPage.url();await failedPage.screenshot({path:'docs/evidence/functional-closure-20261018/public-browser/failure.png'}).catch(()=>{})}process.exitCode=1}
finally{await browser?.close();fs.writeFileSync('docs/evidence/functional-closure-20261018/public-browsers-final.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,error:report.error,detail:report.detail,failedUrl:report.failedUrl,checks:report.checks.length,screenshots:report.screenshots.length}));}