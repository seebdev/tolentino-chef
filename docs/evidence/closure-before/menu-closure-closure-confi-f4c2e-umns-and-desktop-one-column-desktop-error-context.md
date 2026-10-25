# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: menu-closure.spec.ts >> closure: configured mobile two columns and desktop one column
- Location: tests\e2e\menu-closure.spec.ts:40:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 1

Call Log:
- Timeout 4000ms exceeded while waiting on the predicate
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
        - combobox "Language / Idioma" [ref=e13] [cursor=pointer]:
          - option "Español" [selected]
          - option "English"
          - option "Français"
          - option "Italiano"
          - option "中文"
          - option "日本語"
          - option "हिन्दी"
    - generic [ref=e14]:
      - generic [ref=e16]:
        - generic [ref=e17]: Menú digital
        - heading "DEMO UI Restaurante" [level=1] [ref=e18]
        - paragraph [ref=e19]: Datos sintéticos para interfaz.
      - generic [ref=e20]: HECHO CON CUIDADO · SERVIDO CON AMOR
    - generic [ref=e21]:
      - generic [ref=e22]:
        - generic [ref=e23]:
          - text: Menú digital
          - heading "Nuestro menú" [level=2] [ref=e24]
        - searchbox "Buscar platos o ingredientes" [ref=e29]
      - navigation "Nuestro menú" [ref=e30]:
        - button "Todo el menú" [pressed] [ref=e31] [cursor=pointer]
        - button "Pizzas" [ref=e32] [cursor=pointer]
        - button "Especiales" [ref=e33] [cursor=pointer]
        - button "Bebidas" [ref=e34] [cursor=pointer]
      - generic [ref=e35]:
        - generic [ref=e36]: Recomendado
        - generic [ref=e39]:
          - article [ref=e40]:
            - button [ref=e41] [cursor=pointer]:
              - generic [ref=e48]:
                - text: Pizzas
                - heading "Producto largo con ingredientes y un nombre completo 0" [level=3] [ref=e49]
                - paragraph [ref=e50]: Tomate y albahaca
                - strong [ref=e51]: 28.000 COP
            - button "Guardar favorito" [ref=e52] [cursor=pointer]
          - article [ref=e55]:
            - button [ref=e56] [cursor=pointer]:
              - generic [ref=e63]:
                - text: Pizzas
                - heading "Producto largo con ingredientes y un nombre completo 1" [level=3] [ref=e64]
                - paragraph [ref=e65]: Tomate y albahaca
                - strong [ref=e66]: 28.000 COP
            - button "Guardar favorito" [ref=e67] [cursor=pointer]
      - generic [ref=e70]:
        - generic [ref=e71]:
          - heading "Pizzas" [level=2] [ref=e72]
          - generic [ref=e73]: "4"
        - generic [ref=e75]:
          - article [ref=e76]:
            - button [ref=e77] [cursor=pointer]:
              - generic [ref=e78]:
                - generic [ref=e79]: Recomendado
                - heading "Producto largo con ingredientes y un nombre completo 0" [level=3] [ref=e82]
                - paragraph [ref=e83]: Tomate y albahaca
                - strong [ref=e85]: 28.000 COP
            - button "Guardar favorito" [ref=e86] [cursor=pointer]
          - article [ref=e89]:
            - button [ref=e90] [cursor=pointer]:
              - generic [ref=e91]:
                - generic [ref=e92]: Recomendado
                - heading "Producto largo con ingredientes y un nombre completo 1" [level=3] [ref=e95]
                - paragraph [ref=e96]: Tomate y albahaca
                - strong [ref=e98]: 28.000 COP
            - button "Guardar favorito" [ref=e99] [cursor=pointer]
          - article [ref=e102]:
            - button [ref=e103] [cursor=pointer]:
              - generic [ref=e104]:
                - heading "Producto largo con ingredientes y un nombre completo 2" [level=3] [ref=e105]
                - paragraph [ref=e106]: Tomate y albahaca
                - strong [ref=e108]: 28.000 COP
            - button "Guardar favorito" [ref=e109] [cursor=pointer]
          - article [ref=e112]:
            - button [ref=e113] [cursor=pointer]:
              - generic [ref=e114]:
                - heading "Producto largo con ingredientes y un nombre completo 3" [level=3] [ref=e115]
                - paragraph [ref=e116]: Tomate y albahaca
                - strong [ref=e118]: 28.000 COP
            - button "Guardar favorito" [ref=e119] [cursor=pointer]
      - generic [ref=e122]:
        - generic [ref=e123]:
          - heading "Bebidas" [level=2] [ref=e124]
          - generic [ref=e125]: "2"
        - generic [ref=e127]:
          - article [ref=e128]:
            - button [ref=e129] [cursor=pointer]:
              - generic [ref=e130]:
                - heading "Producto largo con ingredientes y un nombre completo 4" [level=3] [ref=e131]
                - paragraph [ref=e132]: Tomate y albahaca
                - strong [ref=e134]: 28.000 COP
            - button "Guardar favorito" [ref=e135] [cursor=pointer]
          - article [ref=e138]:
            - button [ref=e139] [cursor=pointer]:
              - generic [ref=e140]:
                - heading "Producto largo con ingredientes y un nombre completo 5" [level=3] [ref=e141]
                - paragraph [ref=e142]: Tomate y albahaca
                - strong [ref=e144]: 28.000 COP
            - button "Guardar favorito" [ref=e145] [cursor=pointer]
    - generic [ref=e148]:
      - strong [ref=e149]: DEMO UI Restaurante
      - paragraph [ref=e150]: Menú digital
      - link "Creado por Tolentino Chef · 3108853158" [ref=e151] [cursor=pointer]:
        - /url: https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante
  - button "Open Next.js Dev Tools" [ref=e160] [cursor=pointer]
  - alert [ref=e164]
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
  37 |  await expect(page.locator(".featured-section"),{timeout:4000}).toBeVisible();
  38 |  await expect(page.locator(".public-product")).toHaveCount(2);
  39 | });
  40 | test("closure: configured mobile two columns and desktop one column",async({page})=>{
  41 |  await setup(page);await page.setViewportSize({width:390,height:844});await page.goto("/menu/demo-ui-restaurante");
  42 |  await expect(page.locator(".public-product").first()).toBeVisible();
  43 |  const cols=()=>page.locator(".public-product-grid").first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(" ").length);
> 44 |  await expect.poll(cols,{timeout:4000}).toBe(2);
     |                                         ^ Error: expect(received).toBe(expected) // Object.is equality
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