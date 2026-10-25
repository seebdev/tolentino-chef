import { test, expect, type Page } from "@playwright/test";
import { auditData, navigateAudit, tenantId } from "./audit-fixtures";
import { money } from "../../src/lib/types";
import { copy, languages } from "../../src/lib/i18n";
async function setup(page: Page) {
  const data = auditData();
  data.products = Array.from({ length: 6 }, (_, i) => ({
    ...data.products[0],
    id: "closure-" + i,
    name: "Producto largo con ingredientes y un nombre completo " + i,
    category_id: i < 4 ? "cat-main" : "cat-drinks",
    is_featured: i < 2,
    sort_order: i,
    image_path: "fixture/image-" + i + ".webp",
  }));
  data.total = 6;
  Object.assign(data.restaurant, { menu_version: 1 });
  Object.assign(data.settings, {
    appearance_revision: 0,
    draft_name: null,
    draft_description: null,
  });
  Object.assign(data.settings.appearance, {
    logo_path: "fixture/logo.webp",
    cover_path: "fixture/cover.webp",
    favicon_path: "fixture/favicon.webp",
    columns_mobile: 2,
    columns_desktop: 1,
    background: "#fff0df",
    card: "#fffaf5",
    text: "#252525",
    muted: "#555555",
    cover_overlay: "#132417",
    cover_overlay_opacity: 0.7,
  });
  data.settings.draft_appearance = { ...data.settings.appearance };
  const contact = {
    url:
      "https://wa.me/573108853158?text=" +
      encodeURIComponent(
        "Hola, quiero información sobre un menú digital para mi restaurante",
      ),
    label: "Creado por Tolentino Chef · 3108853158",
    brand: "Tolentino Chef",
    phone: "3108853158",
  };
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/api/media/"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dfbb85"/></svg>',
      });
    if (u.pathname === "/api/session")
      return route.fulfill({
        json: {
          user: { id: "fixture", email: "fixture@example.test" },
          role: "owner",
          restaurantId: tenantId,
        },
      });
    if (u.pathname === "/api/health")
      return route.fulfill({ json: { status: "ok", configured: true } });
    if (u.pathname.endsWith("/version"))
      return route.fulfill({
        json: {
          restaurantId: tenantId,
          menu_version: data.restaurant.menu_version,
          status: "active",
        },
      });
    if (
      u.pathname.includes("/api/public/menu/") ||
      u.pathname.endsWith("/preview")
    )
      return route.fulfill({ json: { ...data, contact } });
    if (u.pathname === "/api/workspace/" + tenantId)
      return route.fulfill({ json: data });
    return route.fulfill({
      status: 404,
      json: { error: "Fixture route intentionally unavailable" },
    });
  });
  return data;
}
test("closure: seven local flags and selected language persist per restaurant", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/menu/demo-ui-restaurante");
  await expect(page.locator(".public-product").first()).toBeVisible();
  await expect(page.locator(".language-flag")).toHaveCount(7, {
    timeout: 4000,
  });
  for (const lang of languages)
    await expect(
      page.locator('.language-flag[data-language="' + lang.code + '"]'),
    ).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.reload();
  await expect(page.locator(".public-menu")).toHaveAttribute("lang", "en");
});
test("closure: recommendations survive category selection", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/menu/demo-ui-restaurante");
  await expect(page.locator(".featured-section")).toBeVisible();
  await page.getByRole("button", { name: "Bebidas", exact: true }).click();
  await expect(page.locator(".featured-section")).toBeVisible({
    timeout: 4000,
  });
  await expect(page.locator(".public-product")).toHaveCount(2);
});
test("closure: configured mobile two columns and desktop one column", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu/demo-ui-restaurante");
  await expect(page.locator(".public-product").first()).toBeVisible();
  const cols = () =>
    page
      .locator(".public-product-grid")
      .first()
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
  await expect.poll(cols, { timeout: 4000 }).toBe(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(cols).toBe(1);
});
test("closure: complete preview uses a real viewport and same renderer", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/dashboard");
  await navigateAudit(page, "Apariencia");
  const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  await expect(frame.locator(".public-product")).toHaveCount(6, {
    timeout: 4000,
  });
  await expect(frame.locator(".public-footer")).toContainText("Tolentino Chef");
  await expect(frame.locator(".featured-section")).toBeVisible();
});

test("closure: all seven languages translate interface and available content without changing prices", async ({
  page,
}) => {
  const data = await setup(page);
  data.products[0].tags = ["Source tag"];
  data.promotions = [
    {
      id: "promo",
      title: "Promoción original",
      description: "Descripción original",
      is_active: true,
      starts_at: null,
      ends_at: null,
    },
  ];
  const names = [
    "Pizza de albahaca",
    "Basil pizza",
    "Pizza au basilic",
    "Pizza al basilico",
    "罗勒比萨",
    "バジルピザ",
    "तुलसी पिज़्ज़ा",
  ];
  for (const [i, l] of languages.entries()) {
    data.translations.push({
      entity_type: "product",
      entity_id: data.products[0].id,
      language: l.code,
      fields: {
        name: names[i],
        description: "Descripción " + l.code,
        ingredients: "Ingredientes " + l.code,
        tags: ["Etiqueta " + l.code],
        extras: [{ name: "Extra " + l.code }],
        variants: [{ name: "Variante " + l.code }],
      },
    });
    data.translations.push({
      entity_type: "promotion",
      entity_id: "promo",
      language: l.code,
      fields: {
        title: "Promoción " + l.code,
        description: "Promoción descripción " + l.code,
      },
    });
  }
  await page.goto("/menu/demo-ui-restaurante");
  for (const [i, l] of languages.entries()) {
    await page
      .getByRole("button", { name: l.label, exact: true })
      .press("Enter");
    await expect(page.locator(".public-menu")).toHaveAttribute("lang", l.code);
    await expect(page.locator(".public-heading h2")).toHaveText(
      copy[l.code].menu,
    );
    await expect(page.locator(".public-promotion")).toContainText(
      "Promoción " + l.code,
    );
    await expect(page.locator(".creator-contact")).toContainText(
      copy[l.code].createdBy + " Tolentino Chef · 3108853158",
    );
    await expect(page.locator(".photo-credits-link")).toHaveText(
      copy[l.code].photoCredits,
    );
    await expect(page.locator(".photo-credits-link")).toHaveAttribute(
      "href",
      "/creditos-fotografias?restaurant=" + tenantId,
    );
    await page.locator(".public-product-main").first().click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: names[i], exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText("Ingredientes " + l.code);
    await expect(dialog).toContainText("Etiqueta " + l.code);
    await expect(dialog).toContainText("Extra " + l.code);
    await expect(dialog).toContainText("Variante " + l.code);
    await expect(dialog.locator(".detail-price strong")).toHaveText(
      money(28000, "COP", l.code),
    );
    await dialog
      .getByRole("button", { name: copy[l.code].close, exact: true })
      .click();
    const img = page.locator(
      '.language-flag[data-language="' + l.code + '"] img',
    );
    await expect
      .poll(() =>
        img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
      )
      .toBe(true);
    const response = await page.request.get(l.flag);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg");
  }
});

test("closure: focus refresh preserves search, language, favorites and scroll", async ({
  page,
}) => {
  const data = await setup(page);
  await page.goto("/menu/demo-ui-restaurante");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("searchbox").fill("Producto");
  await page.locator(".public-product .favorite-button").first().click();
  await page.evaluate(() => window.scrollTo(0, 650));
  const scroll = await page.evaluate(() => scrollY);
  data.restaurant.menu_version = 2;
  data.products[0].price = 41000;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".public-menu")).toHaveAttribute(
    "data-menu-version",
    "2",
  );
  await expect(page.getByRole("searchbox")).toHaveValue("Producto");
  await expect(page.locator(".public-menu")).toHaveAttribute("lang", "en");
  await expect(
    page.locator(".public-product .favorite-button").first(),
  ).toHaveClass(/is-favorite/);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(
    page.locator(".public-product-bottom strong").first(),
  ).toHaveText(money(41000, "COP", "en"));
});

test("closure: preview and public share styles and geometry at four real widths", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1800, height: 1100 });
  await setup(page);
  await page.goto("/dashboard");
  await navigateAudit(page, "Apariencia");
  const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  await expect(frame.locator(".public-product")).toHaveCount(6);
  const publicPage = await browser.newPage();
  await setup(publicPage);
  const snapshot = (element: Element) => {
    const doc = element.ownerDocument,
      win = doc.defaultView!;
    const styles = (selector: string) => {
      const el = doc.querySelector(selector)!;
      const css = win.getComputedStyle(el);
      return {
        background: css.backgroundColor,
        color: css.color,
        font: css.fontFamily,
        fontSize: css.fontSize,
        columns: css.gridTemplateColumns,
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
        top: Math.round(el.getBoundingClientRect().top + win.scrollY),
      };
    };
    return {
      compatMode: doc.compatMode,
      width: win.innerWidth,
      pageWidth: doc.documentElement.scrollWidth,
      main: styles(".public-menu"),
      card: styles(".public-product"),
      grid: styles(".public-product-grid"),
      title: styles(".public-product h3"),
      hero: styles(".menu-hero-shade"),
      price: styles(".public-product-bottom strong"),
      count: doc.querySelectorAll(".public-product").length,
    };
  };
  try {
    await publicPage.goto("/menu/demo-ui-restaurante");
    await expect(publicPage.locator(".public-product")).toHaveCount(6);
    for (const width of [320, 390, 768, 1440]) {
      await page
        .getByLabel("Ancho de vista previa")
        .selectOption(String(width));
      await publicPage.setViewportSize({ width, height: 820 });
      await expect
        .poll(() =>
          frame
            .locator(".public-menu")
            .evaluate((e) => e.ownerDocument.defaultView!.innerWidth),
        )
        .toBe(width);
      const loadImages = async (element: Element) => {
        const images = Array.from(element.ownerDocument.images);
        images.forEach((image) => (image.loading = "eager"));
        await Promise.all(
          images.map(async (image) => {
            await image.decode();
          }),
        );
      };
      await frame.locator(".public-menu").evaluate(loadImages);
      await publicPage.locator(".public-menu").evaluate(loadImages);
      const preview = await frame.locator(".public-menu").evaluate(snapshot),
        published = await publicPage.locator(".public-menu").evaluate(snapshot);
      expect(preview).toEqual(published);
      expect(preview.pageWidth).toBe(width);
      const bounds = await frame
        .locator(".public-product")
        .evaluateAll((cards) =>
          cards.map((card) => {
            const price = card.querySelector(".public-product-bottom strong")!;
            return {
              card: card.getBoundingClientRect().right,
              price: price.getBoundingClientRect().right,
            };
          }),
        );
      expect(bounds.every((x) => x.price <= x.card)).toBe(true);
      const prefix =
        "docs/evidence/closure-" + testInfo.project.name + "-" + width;
      await publicPage.screenshot({ path: prefix + "-public.png" });
      await page
        .locator('iframe[title="Vista previa del menú"]')
        .screenshot({ path: prefix + "-preview.png" });
      const scroll = await frame
        .locator(".public-product")
        .first()
        .evaluate(
          (e) =>
            Math.floor(
              e.getBoundingClientRect().top +
                e.ownerDocument.defaultView!.scrollY,
            ) - 20,
        );
      await frame
        .locator(".public-menu")
        .evaluate(
          (e, y) => e.ownerDocument.defaultView!.scrollTo(0, y),
          scroll,
        );
      await publicPage.evaluate((y) => window.scrollTo(0, y), scroll);
      await publicPage.screenshot({ path: prefix + "-products-public.png" });
      await page
        .locator('iframe[title="Vista previa del menú"]')
        .screenshot({ path: prefix + "-products-preview.png" });
      await frame
        .locator(".public-menu")
        .evaluate((e) => e.ownerDocument.defaultView!.scrollTo(0, 0));
      await publicPage.evaluate(() => window.scrollTo(0, 0));
      await testInfo.attach("same-renderer-" + width, {
        body: JSON.stringify({ preview, published }),
        contentType: "application/json",
      });
    }
  } finally {
    await publicPage.close();
  }
});

test("closure: draft save is private, publish is one atomic request and conflict preserves local form", async ({
  page,
  browser,
}) => {
  const data = await setup(page);
  const requests: {
    action: string;
    data: {
      appearance: typeof data.settings.appearance;
      name: string;
      description: string;
      expectedRevision: number;
    };
  }[] = [];
  await page.route("**/api/workspace/" + tenantId, async (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: data });
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.data.expectedRevision !== data.settings.appearance_revision)
      return route.fulfill({
        status: 409,
        json: {
          error: "Otro editor guardó cambios. Recarga el borrador.",
          code: "APPEARANCE_CONFLICT",
        },
      });
    data.settings.draft_appearance = body.data.appearance;
    data.settings.draft_name = body.data.name;
    data.settings.draft_description = body.data.description;
    data.settings.appearance_revision!++;
    if (body.action === "publish_appearance") {
      data.settings.appearance = body.data.appearance;
      data.restaurant.name = body.data.name;
      data.restaurant.description = body.data.description;
      data.restaurant.menu_version!++;
    }
    return route.fulfill({
      json: {
        ok: true,
        data: { appearance_revision: data.settings.appearance_revision },
      },
    });
  });
  await page.goto("/dashboard");
  await navigateAudit(page, "Apariencia");
  await page.getByLabel("Nombre del restaurante").fill("Nombre privado");
  const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  await expect(
    frame.getByRole("heading", { name: "Nombre privado", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fondo del menú", { exact: true }).fill("#e8effa");
  await page.getByLabel("Tipografía", { exact: true }).selectOption("serif");
  await page
    .getByLabel("Productos por fila en móvil", { exact: true })
    .selectOption("1");
  await expect(frame.locator(".public-menu")).toHaveCSS(
    "background-color",
    "rgb(232, 239, 250)",
  );
  await expect(frame.locator(".public-product h3").first()).toHaveCSS(
    "font-family",
    "Georgia, serif",
  );
  await expect
    .poll(() =>
      frame
        .locator(".public-product-grid")
        .first()
        .evaluate(
          (e) =>
            e.ownerDocument
              .defaultView!.getComputedStyle(e)
              .gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(1);
  expect(data.settings.appearance.background).toBe("#fff0df");
  expect(data.restaurant.name).toBe("DEMO UI Restaurante");
  await page
    .getByRole("button", { name: "Guardar borrador", exact: true })
    .click();
  await expect(
    page.getByText("Borrador guardado.", { exact: false }),
  ).toBeVisible();
  expect(data.restaurant.name).toBe("DEMO UI Restaurante");
  expect(data.settings.draft_name).toBe("Nombre privado");
  await page.reload();
  await navigateAudit(page, "Apariencia");
  await expect(page.getByLabel("Nombre del restaurante")).toHaveValue(
    "Nombre privado",
  );
  await page
    .getByRole("button", { name: "Publicar cambios", exact: true })
    .click();
  await expect(
    page.getByText("Publicación confirmada.", { exact: false }),
  ).toBeVisible();
  expect(requests.map((r) => r.action)).toEqual([
    "save_appearance",
    "publish_appearance",
  ]);
  expect(requests[1].data.expectedRevision).toBe(1);
  expect(requests[1].data.appearance).toMatchObject({
    background: "#e8effa",
    font: "serif",
    columns_mobile: 1,
    card: "#fffaf5",
    logo_path: "fixture/logo.webp",
    cover_path: "fixture/cover.webp",
    favicon_path: "fixture/favicon.webp",
  });
  expect(data.restaurant.name).toBe("Nombre privado");
  data.settings.appearance_revision!++;
  await page
    .getByLabel("Nombre del restaurante")
    .fill("Cambio local en conflicto");
  await page
    .getByRole("button", { name: "Publicar cambios", exact: true })
    .click();
  await expect(page.getByLabel("Nombre del restaurante")).toHaveValue(
    "Cambio local en conflicto",
  );
  await expect(
    page.getByText("No se confirmó el guardado.", { exact: false }),
  ).toBeVisible();
  expect(data.restaurant.name).toBe("Nombre privado");
  const anonymous = await browser.newPage();
  try {
    await setup(anonymous);
    await anonymous.route("**/api/public/menu/demo-ui-restaurante", (r) =>
      r.fulfill({ json: { ...data, contact: null } }),
    );
    await anonymous.goto("/menu/demo-ui-restaurante");
    await expect(
      anonymous.getByRole("heading", { name: "Nombre privado", exact: true }),
    ).toBeVisible();
    await expect(anonymous.getByText("Cambio local en conflicto")).toHaveCount(
      0,
    );
  } finally {
    await anonymous.close();
  }
});
