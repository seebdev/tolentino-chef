# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: menu-closure.spec.ts >> closure: complete preview uses a real viewport and same renderer
- Location: tests\e2e\menu-closure.spec.ts:47:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('iframe[title="Vista previa del menú"]').contentFrame().locator('.public-product')
Expected: 6
Received: 0
Timeout:  20000ms

Call log:
  - Expect "toHaveCount" locator('iframe[title="Vista previa del menú"]').contentFrame().locator('.public-product') with timeout 20000ms
  - waiting for locator('iframe[title="Vista previa del menú"]').contentFrame().locator('.public-product')
    42 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - link "Tolentino, inicio" [ref=e4] [cursor=pointer]:
        - /url: /
        - generic [ref=e11]:
          - text: tolentino
          - generic [ref=e12]: RESTAURANTES ADMIN
      - generic [ref=e13]:
        - generic [ref=e14]: D
        - generic [ref=e15]:
          - strong [ref=e16]: DEMO UI Restaurante
          - generic [ref=e17]: Espacio del restaurante
      - navigation "Navegación principal" [ref=e18]:
        - generic [ref=e19]:
          - paragraph [ref=e20]: MI RESTAURANTE
          - button "Resumen" [ref=e21] [cursor=pointer]
        - button "Productos" [ref=e28] [cursor=pointer]
        - button "Categorías" [ref=e35] [cursor=pointer]
        - button "Promociones" [ref=e41] [cursor=pointer]
        - generic [ref=e45]:
          - paragraph [ref=e46]: PERSONALIZACIÓN
          - button "Apariencia" [active] [ref=e47] [cursor=pointer]
        - button "Horarios" [ref=e57] [cursor=pointer]
        - button "Idiomas" [ref=e62] [cursor=pointer]
        - generic [ref=e67]:
          - paragraph [ref=e68]: HERRAMIENTAS
          - button "Mi código QR" [ref=e69] [cursor=pointer]
        - button "Importar productos" [ref=e77] [cursor=pointer]
        - button "Cuenta y acceso" [ref=e83] [cursor=pointer]
      - generic [ref=e87]:
        - generic [ref=e88]:
          - text: Un menú. Muchas posibilidades.
          - generic [ref=e90]: El control de tu restaurante, en un lugar.
        - button "Cerrar sesión" [ref=e91] [cursor=pointer]
        - generic [ref=e95]: © 2026 Tolentino
    - generic [ref=e96]:
      - banner [ref=e97]:
        - generic [ref=e98]:
          - generic [ref=e99]: Espacio del restaurante
          - strong [ref=e102]: Apariencia
        - generic [ref=e103]:
          - link "Ver menú" [ref=e104] [cursor=pointer]:
            - /url: /menu/demo-ui-restaurante
          - generic [ref=e112]: D
      - main [ref=e113]:
        - generic [ref=e115]:
          - paragraph [ref=e116]: DEMO UI RESTAURANTE
          - heading "Tan único como tu restaurante." [level=1] [ref=e117]
          - paragraph [ref=e118]: Dale a tu menú los colores y la personalidad de tu marca.
        - generic [ref=e119]:
          - generic [ref=e120]:
            - generic [ref=e121]:
              - heading "Identidad de tu restaurante" [level=2] [ref=e122]
              - paragraph [ref=e123]: Colores, tipografía e imágenes se guardan como borrador. El nombre y la descripción se actualizan al guardar.
            - generic [ref=e124]:
              - generic [ref=e125]:
                - generic [ref=e126]: Nombre
                - textbox "Nombre del restaurante" [ref=e128]: DEMO UI Restaurante
              - generic [ref=e129]:
                - generic [ref=e130]: Tipografía
                - combobox "Tipografía" [ref=e132] [cursor=pointer]:
                  - option "Moderna · Sans serif" [selected]
                  - option "Clásica · Serif"
                  - option "Cercana · Rounded"
            - generic [ref=e133]:
              - generic [ref=e134]: Descripción
              - textbox "Descripción del restaurante" [ref=e136]: Datos sintéticos para interfaz.
            - generic [ref=e137]:
              - generic [ref=e138]:
                - generic [ref=e139]: Color principal
                - generic [ref=e141]:
                  - textbox "Color principal" [ref=e142] [cursor=pointer]: "#264b3c"
                  - generic [ref=e143]: "#264B3C"
              - generic [ref=e144]:
                - generic [ref=e145]: Color secundario
                - generic [ref=e147]:
                  - textbox "Color secundario" [ref=e148] [cursor=pointer]: "#f5f1e8"
                  - generic [ref=e149]: "#F5F1E8"
            - generic [ref=e150]: IMÁGENES DE MARCA
            - generic [ref=e151]:
              - generic [ref=e152]:
                - strong [ref=e158]: Logo
                - generic [ref=e159] [cursor=pointer]:
                  - text: Subir imagen
                  - button "Subir imagen" [ref=e160]
              - generic [ref=e161]:
                - strong [ref=e167]: Portada
                - generic [ref=e168] [cursor=pointer]:
                  - text: Subir imagen
                  - button "Subir imagen" [ref=e169]
              - generic [ref=e170]:
                - strong [ref=e176]: Favicon
                - generic [ref=e177] [cursor=pointer]:
                  - text: Subir imagen
                  - button "Subir imagen" [ref=e178]
            - generic [ref=e179]: JPG, PNG y WebP · hasta 5 MB por archivo.
            - generic [ref=e180]:
              - button "Guardar borrador" [ref=e181] [cursor=pointer]
              - button "Publicar cambios" [ref=e182] [cursor=pointer]
          - complementary [ref=e185]:
            - generic [ref=e186]: VISTA PREVIA DEL BORRADOR
            - generic [ref=e190]:
              - generic [ref=e195]:
                - generic [ref=e196]: D
                - heading "DEMO UI Restaurante" [level=3] [ref=e197]
                - paragraph [ref=e198]: Datos sintéticos para interfaz.
              - generic [ref=e199]:
                - generic [ref=e200]: Todo el menú
                - generic [ref=e201]: Pizzas
                - generic [ref=e202]: Bebidas
              - generic [ref=e203]:
                - generic [ref=e205]:
                  - strong [ref=e206]: Producto largo con ingredientes y un nombre completo 0
                  - generic [ref=e207]: Tomate y albahaca
                  - generic [ref=e208]: 28.000 COP
                - generic [ref=e210]:
                  - strong [ref=e211]: Producto largo con ingredientes y un nombre completo 1
                  - generic [ref=e212]: Tomate y albahaca
                  - generic [ref=e213]: 28.000 COP
                - generic [ref=e215]:
                  - strong [ref=e216]: Producto largo con ingredientes y un nombre completo 2
                  - generic [ref=e217]: Tomate y albahaca
                  - generic [ref=e218]: 28.000 COP
              - generic [ref=e219]: MENÚ DIGITAL · TOLENTINO
            - paragraph [ref=e220]: La vista previa muestra tu borrador visual. Publica para aplicar colores, tipografía e imágenes.
  - button "Open Next.js Dev Tools" [ref=e226] [cursor=pointer]
  - alert [ref=e230]
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
  44 |  await expect.poll(cols,{timeout:4000}).toBe(2);
  45 |  await page.setViewportSize({width:1440,height:1000});await expect.poll(cols).toBe(1);
  46 | });
  47 | test("closure: complete preview uses a real viewport and same renderer",async({page})=>{
  48 |  await setup(page);await page.goto("/dashboard");await navigateAudit(page,"Apariencia");
  49 |  const frame=page.frameLocator('iframe[title="Vista previa del menú"]');
> 50 |  await expect(frame.locator(".public-product"),{timeout:4000}).toHaveCount(6);
     |                                                                ^ Error: expect(locator).toHaveCount(expected) failed
  51 |  await expect(frame.locator(".public-footer")).toContainText("Tolentino Chef");
  52 |  await expect(frame.locator(".featured-section")).toBeVisible();
  53 | });
  54 |
```