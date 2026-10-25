# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: menu-closure.spec.ts >> closure: recommendations survive category selection
- Location: tests\e2e\menu-closure.spec.ts:33:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.featured-section')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.featured-section') with timeout 20000ms
  - waiting for locator('.featured-section')

```

```yaml
- main:
  - link "DEMO UI Restaurante":
    - /url: /menu/demo-ui-restaurante
  - button "Mis favoritos"
  - combobox "Language / Idioma":
    - option "Español" [selected]
    - option "English"
    - option "Français"
    - option "Italiano"
    - option "中文"
    - option "日本語"
    - option "हिन्दी"
  - text: Menú digital
  - heading "DEMO UI Restaurante" [level=1]
  - paragraph: Datos sintéticos para interfaz.
  - text: HECHO CON CUIDADO · SERVIDO CON AMOR Menú digital
  - heading "Nuestro menú" [level=2]
  - searchbox "Buscar platos o ingredientes"
  - navigation "Nuestro menú":
    - button "Todo el menú"
    - button "Pizzas"
    - button "Especiales"
    - button "Bebidas" [pressed]
  - heading "Bebidas" [level=2]
  - text: "2"
  - article:
    - button "Producto largo con ingredientes y un nombre completo 4 Tomate y albahaca 28.000 COP":
      - heading "Producto largo con ingredientes y un nombre completo 4" [level=3]
      - paragraph: Tomate y albahaca
      - strong: 28.000 COP
    - button "Guardar favorito"
  - article:
    - button "Producto largo con ingredientes y un nombre completo 5 Tomate y albahaca 28.000 COP":
      - heading "Producto largo con ingredientes y un nombre completo 5" [level=3]
      - paragraph: Tomate y albahaca
      - strong: 28.000 COP
    - button "Guardar favorito"
  - strong: DEMO UI Restaurante
  - paragraph: Menú digital
  - link "Creado por Tolentino Chef · 3108853158":
    - /url: https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante
- alert
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test";
  2  | import { auditData, navigateAudit, tenantId } from "./audit-fixtures";
  3  | import { languages } from "../../src/lib/i18n";
  4  | async function setup(page: Page) {
  5  |  const data = auditData();
  6  |  data.products = Array.from({length:6},(_,i)=>({...data.products[0],id:"closure-"+i,name:"Producto largo con ingredientes y un nombre completo "+i,category_id:i<4?"cat-main":"cat-drinks",is_featured:i<2,sort_order:i}));
  7  |  data.total=6;
  8  |  Object.assign(data.restaurant,{menu_version:1});
  9  |  Object.assign(data.settings,{appearance_revision:0,draft_name:null,draft_description:null});
  10 |  Object.assign(data.settings.appearance,{columns_mobile:2,columns_desktop:1,background:"#fff0df",card:"#fffaf5",text:"#252525",muted:"#555555",cover_overlay:"#132417",cover_overlay_opacity:0.7});
  11 |  data.settings.draft_appearance={...data.settings.appearance};
  12 |  const contact={url:"https://wa.me/573108853158?text="+encodeURIComponent("Hola, quiero información sobre un menú digital para mi restaurante"),label:"Creado por Tolentino Chef · 3108853158",brand:"Tolentino Chef",phone:"3108853158"};
  13 |  await page.route("**/api/**",async route=>{
  14 |  const u=new URL(route.request().url());
  15 |  if(u.pathname==="/api/session")return route.fulfill({json:{user:{id:"fixture",email:"fixture@example.test"},role:"owner",restaurantId:tenantId}});
  16 |  if(u.pathname==="/api/health")return route.fulfill({json:{status:"ok",configured:true}});
  17 |  if(u.pathname.endsWith("/version"))return route.fulfill({json:{restaurantId:tenantId,menu_version:data.restaurant.menu_version,status:"active"}});
  18 |  if(u.pathname.includes("/api/public/menu/")||u.pathname.endsWith("/preview"))return route.fulfill({json:{...data,contact}});
  19 |  if(u.pathname==="/api/workspace/"+tenantId)return route.fulfill({json:data});
  20 |  return route.fulfill({status:404,json:{error:"Fixture route intentionally unavailable"}});
  21 |  });
  22 |  return data;
  23 | }
  24 | test("closure: seven local flags and selected language persist per restaurant",async({page})=>{
  25 |  await setup(page);await page.goto("/menu/demo-ui-restaurante");
  26 |  await expect(page.locator(".public-product").first()).toBeVisible();
  27 |  await expect(page.locator(".language-flag"),{timeout:4000}).toHaveCount(7);
  28 |  for(const lang of languages)await expect(page.locator('.language-flag[data-language="'+lang.code+'"]')).toBeVisible();
  29 |  await page.getByRole("button",{name:"English",exact:true}).click();
  30 |  await page.reload();
  31 |  await expect(page.locator(".public-menu")).toHaveAttribute("lang","en");
  32 | });
  33 | test("closure: recommendations survive category selection",async({page})=>{
  34 |  await setup(page);await page.goto("/menu/demo-ui-restaurante");
  35 |  await expect(page.locator(".featured-section")).toBeVisible();
  36 |  await page.getByRole("button",{name:"Bebidas",exact:true}).click();
> 37 |  await expect(page.locator(".featured-section"),{timeout:4000}).toBeVisible();
     |                                                                 ^ Error: expect(locator).toBeVisible() failed
  38 |  await expect(page.locator(".public-product")).toHaveCount(2);
  39 | });
  40 | test("closure: configured mobile two columns and desktop one column",async({page})=>{
  41 |  await setup(page);await page.setViewportSize({width:390,height:844});await page.goto("/menu/demo-ui-restaurante");
  42 |  await expect(page.locator(".public-product").first()).toBeVisible();
  43 |  const cols=()=>page.locator(".public-product-grid").first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(" ").length);
  44 |  await expect.poll(cols,{timeout:4000}).toBe(2);
  45 |  await page.setViewportSize({width:1440,height:1000});await expect.poll(cols).toBe(1);
  46 | });
  47 | test("closure: complete preview uses a real viewport and same renderer",async({page})=>{
  48 |  await setup(page);await page.goto("/dashboard");await navigateAudit(page,"Apariencia");
  49 |  const frame=page.frameLocator('iframe[title="Vista previa del menú"]');
  50 |  await expect(frame.locator(".public-product"),{timeout:4000}).toHaveCount(6);
  51 |  await expect(frame.locator(".public-footer")).toContainText("Tolentino Chef");
  52 |  await expect(frame.locator(".featured-section")).toBeVisible();
  53 | });
  54 |
```