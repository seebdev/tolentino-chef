import { test, expect } from "@playwright/test";
import {
  auditFixture,
  fillRestaurant,
  navigateAudit,
  tenantId,
} from "./audit-fixtures";

test("audit UI keeps a pending creation open and retries the same operation", async ({
  page,
}) => {
  await auditFixture(page, "superadmin");
  const requests: { requestId: string }[] = [];
  await page.route("**/api/admin/restaurants", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON());
    await route.fulfill(
      requests.length === 1
        ? {
            status: 202,
            json: {
              ok: false,
              pending: true,
              code: "REQUEST_IN_PROGRESS",
              error:
                "La creación sigue en proceso. Reintenta con la misma solicitud.",
            },
          }
        : { status: 201, json: { ok: true, replayed: true } },
    );
  });
  await fillRestaurant(page);
  await page
    .getByRole("button", { name: "Crear restaurante", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "sigue en proceso",
  );
  await page
    .getByRole("button", { name: "Crear restaurante", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
});

test("audit UI DEMO creation requires a reserved email and sends the explicit flag", async ({
  page,
}, info) => {
  const { mutations } = await auditFixture(page, "superadmin");
  await fillRestaurant(page);
  await page.getByLabel("Crear restaurante DEMO").check();
  await page.getByLabel("Correo del propietario").fill("someone@example.com");
  await page
    .getByRole("button", { name: "Crear restaurante", exact: true })
    .click();
  expect(mutations).toHaveLength(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByLabel("Correo del propietario")
      .evaluate((input: HTMLInputElement) => input.validity.patternMismatch),
  ).toBe(true);
  await page.getByLabel("Correo del propietario").fill("demo-ui@example.test");
  await page.getByLabel("Crear restaurante DEMO").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/evidence/audit-ui-demo-form-" + info.project.name + ".png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Crear restaurante", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations[0]).toMatchObject({
    action: "create",
    requestId: expect.any(String),
    data: { demo: true, owner_email: "demo-ui@example.test" },
  });
});

test("audit UI export downloads from the authenticated catalog route", async ({
  page,
}) => {
  await auditFixture(page);
  let calls = 0;
  await page.route(
    "**/api/workspace/" + tenantId + "/import?download=catalog",
    async (route) => {
      calls++;
      await route.fulfill({
        contentType: "text/csv; charset=utf-8",
        headers: {
          "Content-Disposition":
            'attachment; filename="catalogo-productos.csv"',
        },
        body: "nombre,precio,categoria,descripcion,sku\r\nDEMO,20,Prueba,Prueba,DEMO-1",
      });
    },
  );
  await page.goto("/dashboard");
  await navigateAudit(page, "Importar productos");
  const link = page.getByRole("link", { name: "Exportar catálogo CSV" });
  await expect(link).toHaveAttribute(
    "href",
    "/api/workspace/" + tenantId + "/import?download=catalog",
  );
  const downloading = page.waitForEvent("download");
  await link.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("catalogo-productos.csv");
  expect(calls).toBe(1);
});

test("audit UI cannot submit a product until its image upload completes", async ({
  page,
}) => {
  const { mutations } = await auditFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploading = false;
  await page.route("**/api/workspace/" + tenantId + "/media", async (route) => {
    uploading = true;
    await held;
    await route.fulfill({ json: { path: tenantId + "/uploaded.webp" } });
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
  await page.getByLabel("Nombre del producto").fill("Producto con foto DEMO");
  await page.getByLabel("Categoría", { exact: true }).selectOption("cat-main");
  await page.getByLabel("Precio", { exact: true }).fill("100");
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "demo.png",
      mimeType: "image/png",
      buffer: Buffer.from("ui-fixture-only"),
    });
  await expect.poll(() => uploading).toBe(true);
  await page
    .getByRole("dialog")
    .locator("form")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  expect(mutations).toHaveLength(0);
  release();
  await expect(
    page.getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toHaveLength(1);
  expect(mutations[0].data.image_path).toBe(tenantId + "/uploaded.webp");
});
