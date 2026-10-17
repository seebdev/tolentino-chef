import { test, expect } from "@playwright/test";
import {
  auditFixture,
  fillRestaurant,
  navigateAudit,
  tenantId,
} from "./audit-fixtures";

test("audit UI create prevents synchronous double submission", async ({
  page,
}) => {
  await auditFixture(page, "superadmin");
  const requests: unknown[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/restaurants", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    await held;
    await route.fulfill({ json: { ok: true } });
  });
  await fillRestaurant(page);
  await page
    .getByRole("dialog")
    .locator("form")
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Crear restaurante", exact: true }),
  ).toBeDisabled();
  const count = requests.length;
  release();
  expect(count).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("audit UI create reuses a request ID after uncertain failures and changes it for corrected data", async ({
  page,
}) => {
  await auditFixture(page, "superadmin");
  const requests: { requestId: string; data: Record<string, unknown> }[] = [];
  await page.route("**/api/admin/restaurants", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    const n = requests.length;
    await route.fulfill(
      n < 3
        ? {
            status: n === 1 ? 503 : 409,
            json: {
              error:
                n === 1
                  ? "Servicio temporalmente no disponible."
                  : "La dirección del menú ya está en uso.",
              code: "SLUG_CONFLICT",
            },
          }
        : { json: { ok: true } },
    );
  });
  await fillRestaurant(page);
  const submit = page.getByRole("button", {
    name: "Crear restaurante",
    exact: true,
  });
  await submit.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Servicio temporalmente",
  );
  await submit.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "ya está en uso",
  );
  expect(requests[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(requests[1].requestId).toBe(requests[0].requestId);
  await page.getByLabel("Dirección del menú").fill("demo-ui-corregido");
  await submit.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests[2].requestId).not.toBe(requests[1].requestId);
});

test("audit UI appearance publication respects required fields", async ({
  page,
}) => {
  const { mutations } = await auditFixture(page);
  await page.goto("/dashboard");
  await navigateAudit(page, "Apariencia");
  await page.getByLabel("Nombre del restaurante").fill("");
  await page
    .getByRole("button", { name: "Publicar cambios", exact: true })
    .click();
  expect(
    await page
      .getByLabel("Nombre del restaurante")
      .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
  ).toBe(true);
  expect(mutations).toHaveLength(0);
});

test("audit UI validates variant prices before submitting and preserves the form", async ({
  page,
}) => {
  const { mutations } = await auditFixture(page);
  await page.goto("/dashboard");
  await navigateAudit(page, "Productos");
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await page.getByLabel("Nombre del producto").fill("Pizza DEMO");
  await page.getByLabel("Categoría", { exact: true }).selectOption("cat-main");
  await page.getByLabel("Precio", { exact: true }).fill("20000");
  await page
    .getByLabel("Presentaciones y precios")
    .fill("Grande | no-es-precio");
  await page
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "línea 1",
  );
  expect(mutations).toHaveLength(0);
  await page.getByLabel("Presentaciones y precios").fill("Grande | 30000");
  await page.getByLabel("Extras y precios").fill("Queso | 5000");
  await page
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations[0].data).toMatchObject({
    variants: [{ name: "Grande", price: 30000 }],
    extras: [{ name: "Queso", price: 5000 }],
  });
});

test("audit UI public menu groups subcategories and shows read-only options", async ({
  page,
}, info) => {
  const { data } = await auditFixture(page);
  await page.goto("/menu/" + data.restaurant.slug);
  const nav = page.locator(".public-categories");
  await expect(nav.getByRole("button")).toHaveText([
    "Todo el menú",
    "Pizzas",
    "Especiales",
    "Bebidas",
  ]);
  await nav.getByRole("button", { name: "Pizzas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trufa DEMO", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Agotado", { exact: true })).toBeVisible();
  await page
    .locator(".public-product-main")
    .filter({ hasText: "Margherita DEMO" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Presentaciones" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Grande", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Queso extra", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /comprar|pedir|pagar/i }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "docs/evidence/audit-ui-public-options-" + info.project.name + ".png",
    fullPage: true,
  });
});

test("audit UI upload errors are visible and a valid retry updates preview", async ({
  page,
}) => {
  await auditFixture(page);
  let uploads = 0;
  await page.route("**/api/workspace/" + tenantId + "/media", async (route) => {
    uploads++;
    await route.fulfill(
      uploads === 1
        ? { status: 400, json: { error: "La imagen no se pudo procesar." } }
        : { json: { path: tenantId + "/test.webp" } },
    );
  });
  await page.route("**/api/media/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#163c2c"/></svg>',
    }),
  );
  await page.goto("/dashboard");
  await navigateAudit(page, "Productos");
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  const file = {
    name: "demo.png",
    mimeType: "image/png",
    buffer: Buffer.from("ui-fixture-only"),
  };
  const input = page.getByRole("dialog").locator("input[type=file]");
  await input.setInputFiles(file);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "no se pudo procesar",
  );
  await input.setInputFiles(file);
  await expect(
    page.getByRole("dialog").getByAltText("Imagen del producto"),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
});
