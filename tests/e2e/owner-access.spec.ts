import { test, expect, type Page } from "@playwright/test";
import { auditData, tenantId } from "./audit-fixtures";
const pendingId="44444444-4444-4444-8444-444444444444";
async function adminFixture(page:Page,{pending=false}={}) {
 let posts=0;const requests:Record<string,unknown>[]=[];
 await page.route("**/api/**",async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==="/api/session")return route.fulfill({json:{role:"superadmin",user:{id:"admin",email:"admin@example.test"}}});
  if(path==="/api/health")return route.fulfill({json:{configured:true,status:"ok"}});
  if(path==="/api/admin/restaurants")return route.fulfill({json:{restaurants:[auditData().restaurant],total:1,stats:{active:1,total:1},platform:{},configured:true}});
  if(path==="/api/admin/owner-access"){
   if(route.request().method()==="GET")return route.fulfill({json:{email:"owner@example.test",alias:pending?"aurora.owner":null,isActive:true,hasAccess:true,requiresPasswordChange:posts>0,operationPending:pending&&posts===0,pendingRequestId:pending&&posts===0?pendingId:null}});
   posts++;requests.push(route.request().postDataJSON());
   await new Promise(resolve=>setTimeout(resolve,100));
   return route.fulfill({json:pending?{ok:true,secretAvailable:false,message:"Acceso confirmado. La contraseña no se conserva; establece otra si no la recibiste."}:{ok:true,temporaryPassword:"Only-A-UI-Fixture123",requiresPasswordChange:true,secretAvailable:true}});
  }
  return route.fulfill({status:404,json:{error:"Fixture route unavailable"}});
 });
 return {requests,posts:()=>posts};
}
test("owner temporary credential is delivered once and immediate double submission sends one request",async({page})=>{
 const fixture=await adminFixture(page);
 await page.goto("/admin");
 await page.getByRole("button",{name:/Acceso del propietario de/}).click();
 const dialog=page.getByRole("dialog");
 await dialog.getByLabel("Usuario de acceso",{exact:true}).fill("Aurora.Owner");
 await dialog.getByLabel("Escribir una contraseña temporal").check();
 await dialog.getByLabel("Contraseña temporal",{exact:true}).fill("Only-A-UI-Fixture123");
 await dialog.locator("form").evaluate(form=>{(form as HTMLFormElement).requestSubmit();(form as HTMLFormElement).requestSubmit();});
 await expect(dialog.getByText("Only-A-UI-Fixture123",{exact:true})).toBeVisible();
 expect(fixture.posts()).toBe(1);
 expect(fixture.requests[0]).toMatchObject({restaurantId:tenantId,action:"set_password",alias:"aurora.owner"});
 expect(fixture.requests[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
 await dialog.getByRole("button",{name:"Cerrar",exact:true}).click();
 await page.getByRole("button",{name:/Acceso del propietario de/}).click();
 await expect(page.getByRole("dialog").getByText("Only-A-UI-Fixture123",{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>Object.keys(localStorage).length)).toBe(0);
});
test("pending owner attempt survives a fresh dialog without retaining its password",async({page})=>{
 const fixture=await adminFixture(page,{pending:true});
 await page.goto("/admin");await page.getByRole("button",{name:/Acceso del propietario de/}).click();
 const dialog=page.getByRole("dialog");
 await expect(dialog.getByLabel("Usuario de acceso",{exact:true})).toBeDisabled();
 await dialog.getByRole("button",{name:"Comprobar operación pendiente",exact:true}).click();
 await expect(dialog.getByText(/La contraseña no se conserva/)).toBeVisible();
 expect(fixture.requests).toHaveLength(1);expect(fixture.requests[0]!.requestId).toBe(pendingId);
 expect(fixture.requests[0]).not.toHaveProperty("password");
});
test("alias login requiring first change opens the password screen without entering the dashboard",async({page})=>{
 let loggedIn=false;const logins:Record<string,unknown>[]=[];
 await page.route("**/api/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==="/api/health")return route.fulfill({json:{configured:true}});
  if(path==="/api/session")return route.fulfill(loggedIn?{json:{role:"owner",restaurantId:tenantId,requiresPasswordChange:true}}:{status:401,json:{error:"No session"}});
  if(path==="/api/auth"){logins.push(route.request().postDataJSON());loggedIn=true;return route.fulfill({json:{ok:true,role:"owner",requiresPasswordChange:true,redirect:"/login?mode=password"}});}
  return route.fulfill({status:404,json:{error:"Unexpected fixture request"}});
 });
 await page.goto("/login");await page.getByLabel("Correo o usuario de acceso",{exact:true}).fill("aurora.owner");
 await page.getByLabel("Contraseña",{exact:true}).fill("Only-A-UI-Fixture123");
 await page.getByRole("button",{name:"Entrar a mi espacio"}).click();
 await expect(page).toHaveURL(/\/login\?mode=password/);
 await expect(page.getByRole("heading",{name:"Una nueva contraseña"})).toBeVisible();
 expect(logins).toHaveLength(1);expect(logins[0]).toMatchObject({action:"login",identifier:"aurora.owner"});
});
