# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: menu-closure.spec.ts >> closure: preview and public share styles and geometry at four real widths
- Location: tests\e2e\menu-closure.spec.ts:267:5

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.evaluate: Test timeout of 90000ms exceeded.
Call log:
  - waiting for locator('iframe[title="Vista previa del menú"]').contentFrame().locator('.public-menu')
    - waiting for "http://localhost:3002/dashboard" navigation to finish...
    - navigated to "http://localhost:3002/dashboard"

```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - generic [ref=f3e2]:
    - complementary [ref=f3e3]:
      - link "Tolentino, inicio" [ref=f3e4] [cursor=pointer]:
        - /url: /
        - generic [ref=f3e11]:
          - text: tolentino
          - generic [ref=f3e12]: RESTAURANTES ADMIN
      - generic [ref=f3e13]:
        - generic [ref=f3e14]: M
        - generic [ref=f3e15]:
          - strong [ref=f3e16]: Mi restaurante
          - generic [ref=f3e17]: Espacio del restaurante
      - navigation "Navegación principal" [ref=f3e18]:
        - generic [ref=f3e19]:
          - paragraph [ref=f3e20]: MI RESTAURANTE
          - button "Resumen" [ref=f3e21] [cursor=pointer]
        - button "Productos" [ref=f3e30] [cursor=pointer]
        - button "Categorías" [ref=f3e37] [cursor=pointer]
        - button "Promociones" [ref=f3e43] [cursor=pointer]
        - generic [ref=f3e47]:
          - paragraph [ref=f3e48]: PERSONALIZACIÓN
          - button "Apariencia" [ref=f3e49] [cursor=pointer]
        - button "Horarios" [ref=f3e57] [cursor=pointer]
        - button "Idiomas" [ref=f3e62] [cursor=pointer]
        - generic [ref=f3e67]:
          - paragraph [ref=f3e68]: HERRAMIENTAS
          - button "Mi código QR" [ref=f3e69] [cursor=pointer]
        - button "Importar productos" [ref=f3e77] [cursor=pointer]
        - button "Cuenta y acceso" [ref=f3e83] [cursor=pointer]
      - generic [ref=f3e87]:
        - generic [ref=f3e88]:
          - text: Un menú. Muchas posibilidades.
          - generic [ref=f3e90]: El control de tu restaurante, en un lugar.
        - button "Cerrar sesión" [ref=f3e91] [cursor=pointer]
        - generic [ref=f3e95]: © 2026 Tolentino
    - generic [ref=f3e96]:
      - banner [ref=f3e97]:
        - generic [ref=f3e98]:
          - generic [ref=f3e99]: Espacio del restaurante
          - strong [ref=f3e102]: Resumen
        - generic [ref=f3e103]: M
      - main [ref=f3e105]:
        - generic [ref=f3e107]:
          - paragraph [ref=f3e108]: MI RESTAURANTE
          - heading "Tu menú, en buenas manos." [level=1] [ref=f3e109]
          - paragraph [ref=f3e110]: Todo lo que necesitas para cuidar tu experiencia digital.
        - paragraph [ref=f3e114]: Cargando tu espacio…
  - button "Open Next.js Dev Tools" [ref=f3e120] [cursor=pointer]
  - alert [ref=f3e124]
```

# Test source

```ts
  214 |     ).toBeVisible();
  215 |     await expect(dialog).toContainText("Ingredientes " + l.code);
  216 |     await expect(dialog).toContainText("Etiqueta " + l.code);
  217 |     await expect(dialog).toContainText("Extra " + l.code);
  218 |     await expect(dialog).toContainText("Variante " + l.code);
  219 |     await expect(dialog.locator(".detail-price strong")).toHaveText(
  220 |       money(28000, "COP", l.code),
  221 |     );
  222 |     await dialog
  223 |       .getByRole("button", { name: copy[l.code].close, exact: true })
  224 |       .click();
  225 |     const img = page.locator(
  226 |       '.language-flag[data-language="' + l.code + '"] img',
  227 |     );
  228 |     await expect
  229 |       .poll(() =>
  230 |         img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
  231 |       )
  232 |       .toBe(true);
  233 |     const response = await page.request.get(l.flag);
  234 |     expect(response.status()).toBe(200);
  235 |     expect(response.headers()["content-type"]).toContain("image/svg");
  236 |   }
  237 | });
  238 |
  239 | test("closure: focus refresh preserves search, language, favorites and scroll", async ({
  240 |   page,
  241 | }) => {
  242 |   const data = await setup(page);
  243 |   await page.goto("/menu/demo-ui-restaurante");
  244 |   await page.getByRole("button", { name: "English", exact: true }).click();
  245 |   await page.getByRole("searchbox").fill("Producto");
  246 |   await page.locator(".public-product .favorite-button").first().click();
  247 |   await page.evaluate(() => window.scrollTo(0, 650));
  248 |   const scroll = await page.evaluate(() => scrollY);
  249 |   data.restaurant.menu_version = 2;
  250 |   data.products[0].price = 41000;
  251 |   await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  252 |   await expect(page.locator(".public-menu")).toHaveAttribute(
  253 |     "data-menu-version",
  254 |     "2",
  255 |   );
  256 |   await expect(page.getByRole("searchbox")).toHaveValue("Producto");
  257 |   await expect(page.locator(".public-menu")).toHaveAttribute("lang", "en");
  258 |   await expect(
  259 |     page.locator(".public-product .favorite-button").first(),
  260 |   ).toHaveClass(/is-favorite/);
  261 |   expect(await page.evaluate(() => scrollY)).toBe(scroll);
  262 |   await expect(
  263 |     page.locator(".public-product-bottom strong").first(),
  264 |   ).toHaveText(money(41000, "COP", "en"));
  265 | });
  266 |
  267 | test("closure: preview and public share styles and geometry at four real widths", async ({
  268 |   page,
  269 |   browser,
  270 | }, testInfo) => {
  271 |   await page.setViewportSize({ width: 1800, height: 1100 });
  272 |   await setup(page);
  273 |   await page.goto("/dashboard");
  274 |   await navigateAudit(page, "Apariencia");
  275 |   const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  276 |   await expect(frame.locator(".public-product")).toHaveCount(6);
  277 |   const publicPage = await browser.newPage();
  278 |   await setup(publicPage);
  279 |   const snapshot = (element: Element) => {
  280 |     const doc = element.ownerDocument,
  281 |       win = doc.defaultView!;
  282 |     const styles = (selector: string) => {
  283 |       const el = doc.querySelector(selector)!;
  284 |       const css = win.getComputedStyle(el);
  285 |       return {
  286 |         background: css.backgroundColor,
  287 |         color: css.color,
  288 |         font: css.fontFamily,
  289 |         fontSize: css.fontSize,
  290 |         columns: css.gridTemplateColumns,
  291 |         width: Math.round(el.getBoundingClientRect().width),
  292 |       };
  293 |     };
  294 |     return {
  295 |       width: win.innerWidth,
  296 |       pageWidth: doc.documentElement.scrollWidth,
  297 |       main: styles(".public-menu"),
  298 |       card: styles(".public-product"),
  299 |       grid: styles(".public-product-grid"),
  300 |       title: styles(".public-product h3"),
  301 |       hero: styles(".menu-hero-shade"),
  302 |       price: styles(".public-product-bottom strong"),
  303 |       count: doc.querySelectorAll(".public-product").length,
  304 |     };
  305 |   };
  306 |   try {
  307 |     for (const width of [320, 390, 768, 1440]) {
  308 |       await page
  309 |         .getByLabel("Ancho de vista previa")
  310 |         .selectOption(String(width));
  311 |       await publicPage.setViewportSize({ width, height: 820 });
  312 |       await publicPage.goto("/menu/demo-ui-restaurante");
  313 |       await expect(publicPage.locator(".public-product")).toHaveCount(6);
> 314 |       const preview = await frame.locator(".public-menu").evaluate(snapshot),
      |                                                           ^ Error: locator.evaluate: Test timeout of 90000ms exceeded.
  315 |         published = await publicPage.locator(".public-menu").evaluate(snapshot);
  316 |       expect(preview).toEqual(published);
  317 |       expect(preview.pageWidth).toBe(width);
  318 |       const bounds = await frame
  319 |         .locator(".public-product")
  320 |         .evaluateAll((cards) =>
  321 |           cards.map((card) => {
  322 |             const price = card.querySelector(".public-product-bottom strong")!;
  323 |             return {
  324 |               card: card.getBoundingClientRect().right,
  325 |               price: price.getBoundingClientRect().right,
  326 |             };
  327 |           }),
  328 |         );
  329 |       expect(bounds.every((x) => x.price <= x.card)).toBe(true);
  330 |       const prefix =
  331 |         "docs/evidence/closure-" + testInfo.project.name + "-" + width;
  332 |       await publicPage.screenshot({ path: prefix + "-public.png" });
  333 |       await page
  334 |         .locator('iframe[title="Vista previa del menú"]')
  335 |         .screenshot({ path: prefix + "-preview.png" });
  336 |       await testInfo.attach("same-renderer-" + width, {
  337 |         body: JSON.stringify({ preview, published }),
  338 |         contentType: "application/json",
  339 |       });
  340 |     }
  341 |   } finally {
  342 |     await publicPage.close();
  343 |   }
  344 | });
  345 |
  346 | test("closure: draft save is private, publish is one atomic request and conflict preserves local form", async ({
  347 |   page,
  348 |   browser,
  349 | }) => {
  350 |   const data = await setup(page);
  351 |   const requests: {
  352 |     action: string;
  353 |     data: {
  354 |       appearance: typeof data.settings.appearance;
  355 |       name: string;
  356 |       description: string;
  357 |       expectedRevision: number;
  358 |     };
  359 |   }[] = [];
  360 |   await page.route("**/api/workspace/" + tenantId, async (route) => {
  361 |     if (route.request().method() !== "POST")
  362 |       return route.fulfill({ json: data });
  363 |     const body = route.request().postDataJSON();
  364 |     requests.push(body);
  365 |     if (body.data.expectedRevision !== data.settings.appearance_revision)
  366 |       return route.fulfill({
  367 |         status: 409,
  368 |         json: {
  369 |           error: "Otro editor guardó cambios. Recarga el borrador.",
  370 |           code: "APPEARANCE_CONFLICT",
  371 |         },
  372 |       });
  373 |     data.settings.draft_appearance = body.data.appearance;
  374 |     data.settings.draft_name = body.data.name;
  375 |     data.settings.draft_description = body.data.description;
  376 |     data.settings.appearance_revision!++;
  377 |     if (body.action === "publish_appearance") {
  378 |       data.settings.appearance = body.data.appearance;
  379 |       data.restaurant.name = body.data.name;
  380 |       data.restaurant.description = body.data.description;
  381 |       data.restaurant.menu_version!++;
  382 |     }
  383 |     return route.fulfill({
  384 |       json: {
  385 |         ok: true,
  386 |         data: { appearance_revision: data.settings.appearance_revision },
  387 |       },
  388 |     });
  389 |   });
  390 |   await page.goto("/dashboard");
  391 |   await navigateAudit(page, "Apariencia");
  392 |   await page.getByLabel("Nombre del restaurante").fill("Nombre privado");
  393 |   const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  394 |   await expect(
  395 |     frame.getByRole("heading", { name: "Nombre privado", exact: true }),
  396 |   ).toBeVisible();
  397 |   await page.getByLabel("Fondo del menú", { exact: true }).fill("#e8effa");
  398 |   await page.getByLabel("Tipografía", { exact: true }).selectOption("serif");
  399 |   await page
  400 |     .getByLabel("Productos por fila en móvil", { exact: true })
  401 |     .selectOption("1");
  402 |   await expect(frame.locator(".public-menu")).toHaveCSS(
  403 |     "background-color",
  404 |     "rgb(232, 239, 250)",
  405 |   );
  406 |   await expect(frame.locator(".public-product h3").first()).toHaveCSS(
  407 |     "font-family",
  408 |     "Georgia, serif",
  409 |   );
  410 |   await expect
  411 |     .poll(() =>
  412 |       frame
  413 |         .locator(".public-product-grid")
  414 |         .first()
```