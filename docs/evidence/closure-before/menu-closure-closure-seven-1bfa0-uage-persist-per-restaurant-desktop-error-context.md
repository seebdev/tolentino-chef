# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: menu-closure.spec.ts >> closure: seven local flags and selected language persist per restaurant
- Location: tests\e2e\menu-closure.spec.ts:24:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.language-flag')
Expected: 7
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" locator('.language-flag') with timeout 20000ms
  - waiting for locator('.language-flag')
    43 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - link "DEMO UI Restaurante" [ref=e4] [cursor=pointer]:
        - /url: /menu/demo-ui-restaurante
      - generic [ref=e5]:
        - button "Mis favoritos" [ref=e6] [cursor=pointer]
        - combobox "Language / Idioma" [ref=e14] [cursor=pointer]:
          - option "Español" [selected]
          - option "English"
          - option "Français"
          - option "Italiano"
          - option "中文"
          - option "日本語"
          - option "हिन्दी"
    - generic [ref=e15]:
      - generic [ref=e17]:
        - generic [ref=e18]: Menú digital
        - heading "DEMO UI Restaurante" [level=1] [ref=e19]
        - paragraph [ref=e20]: Datos sintéticos para interfaz.
      - generic [ref=e21]: HECHO CON CUIDADO · SERVIDO CON AMOR
    - generic [ref=e22]:
      - generic [ref=e23]:
        - generic [ref=e24]:
          - text: Menú digital
          - heading "Nuestro menú" [level=2] [ref=e25]
        - searchbox "Buscar platos o ingredientes" [ref=e30]
      - navigation "Nuestro menú" [ref=e31]:
        - button "Todo el menú" [pressed] [ref=e32] [cursor=pointer]
        - button "Pizzas" [ref=e33] [cursor=pointer]
        - button "Especiales" [ref=e34] [cursor=pointer]
        - button "Bebidas" [ref=e35] [cursor=pointer]
      - generic [ref=e36]:
        - generic [ref=e37]: Recomendado
        - generic [ref=e40]:
          - article [ref=e41]:
            - button [ref=e42] [cursor=pointer]:
              - generic [ref=e49]:
                - text: Pizzas
                - heading "Producto largo con ingredientes y un nombre completo 0" [level=3] [ref=e50]
                - paragraph [ref=e51]: Tomate y albahaca
                - strong [ref=e52]: 28.000 COP
            - button "Guardar favorito" [ref=e53] [cursor=pointer]
          - article [ref=e56]:
            - button [ref=e57] [cursor=pointer]:
              - generic [ref=e64]:
                - text: Pizzas
                - heading "Producto largo con ingredientes y un nombre completo 1" [level=3] [ref=e65]
                - paragraph [ref=e66]: Tomate y albahaca
                - strong [ref=e67]: 28.000 COP
            - button "Guardar favorito" [ref=e68] [cursor=pointer]
      - generic [ref=e71]:
        - generic [ref=e72]:
          - heading "Pizzas" [level=2] [ref=e73]
          - generic [ref=e74]: "4"
        - generic [ref=e76]:
          - article [ref=e77]:
            - button [ref=e78] [cursor=pointer]:
              - generic [ref=e79]:
                - generic [ref=e80]: Recomendado
                - heading "Producto largo con ingredientes y un nombre completo 0" [level=3] [ref=e83]
                - paragraph [ref=e84]: Tomate y albahaca
                - strong [ref=e86]: 28.000 COP
            - button "Guardar favorito" [ref=e87] [cursor=pointer]
          - article [ref=e90]:
            - button [ref=e91] [cursor=pointer]:
              - generic [ref=e92]:
                - generic [ref=e93]: Recomendado
                - heading "Producto largo con ingredientes y un nombre completo 1" [level=3] [ref=e96]
                - paragraph [ref=e97]: Tomate y albahaca
                - strong [ref=e99]: 28.000 COP
            - button "Guardar favorito" [ref=e100] [cursor=pointer]
          - article [ref=e103]:
            - button [ref=e104] [cursor=pointer]:
              - generic [ref=e105]:
                - heading "Producto largo con ingredientes y un nombre completo 2" [level=3] [ref=e106]
                - paragraph [ref=e107]: Tomate y albahaca
                - strong [ref=e109]: 28.000 COP
            - button "Guardar favorito" [ref=e110] [cursor=pointer]
          - article [ref=e113]:
            - button [ref=e114] [cursor=pointer]:
              - generic [ref=e115]:
                - heading "Producto largo con ingredientes y un nombre completo 3" [level=3] [ref=e116]
                - paragraph [ref=e117]: Tomate y albahaca
                - strong [ref=e119]: 28.000 COP
            - button "Guardar favorito" [ref=e120] [cursor=pointer]
      - generic [ref=e123]:
        - generic [ref=e124]:
          - heading "Bebidas" [level=2] [ref=e125]
          - generic [ref=e126]: "2"
        - generic [ref=e128]:
          - article [ref=e129]:
            - button [ref=e130] [cursor=pointer]:
              - generic [ref=e131]:
                - heading "Producto largo con ingredientes y un nombre completo 4" [level=3] [ref=e132]
                - paragraph [ref=e133]: Tomate y albahaca
                - strong [ref=e135]: 28.000 COP
            - button "Guardar favorito" [ref=e136] [cursor=pointer]
          - article [ref=e139]:
            - button [ref=e140] [cursor=pointer]:
              - generic [ref=e141]:
                - heading "Producto largo con ingredientes y un nombre completo 5" [level=3] [ref=e142]
                - paragraph [ref=e143]: Tomate y albahaca
                - strong [ref=e145]: 28.000 COP
            - button "Guardar favorito" [ref=e146] [cursor=pointer]
    - generic [ref=e149]:
      - strong [ref=e150]: DEMO UI Restaurante
      - paragraph [ref=e151]: Menú digital
      - link "Creado por Tolentino Chef · 3108853158" [ref=e152] [cursor=pointer]:
        - /url: https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante
  - button "Open Next.js Dev Tools" [ref=e161] [cursor=pointer]
  - alert [ref=e165]
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
> 27 |  await expect(page.locator(".language-flag"),{timeout:4000}).toHaveCount(7);
     |                                                              ^ Error: expect(locator).toHaveCount(expected) failed
  28 |  for(const lang of languages)await expect(page.locator('.language-flag[data-language="'+lang.code+'"]')).toBeVisible();
  29 |  await page.getByRole("button",{name:"English",exact:true}).click();
  30 |  await page.reload();
  31 |  await expect(page.locator(".public-menu")).toHaveAttribute("lang","en");
  32 | });
  33 | test("closure: recommendations survive category selection",async({page})=>{
  34 |  await setup(page);await page.goto("/menu/demo-ui-restaurante");
  35 |  await expect(page.locator(".featured-section")).toBeVisible();
  36 |  await page.getByRole("button",{name:"Bebidas",exact:true}).click();
  37 |  await expect(page.locator(".featured-section"),{timeout:4000}).toBeVisible();
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