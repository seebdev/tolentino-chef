import { test, expect } from "@playwright/test";
import { auditFixture, navigateAudit, tenantId } from "./audit-fixtures";

test("audit UI failed CSV download shows its error instead of saving an error file", async ({
  page,
}) => {
  await auditFixture(page);
  let requests = 0;
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  await page.route(
    "**/api/workspace/" + tenantId + "/import?download=catalog",
    async (route) => {
      requests++;
      await route.fulfill({
        status: 401,
        json: {
          error: "Tu sesión venció. Inicia sesión para descargar el catálogo.",
        },
      });
    },
  );
  await page.goto("/dashboard");
  await navigateAudit(page, "Importar productos");
  await page.getByRole("link", { name: "Exportar catálogo CSV" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "Tu sesión venció",
  );
  expect(requests).toBe(1);
  expect(downloads).toEqual([]);
});

test("audit UI QR download checks HTTP errors and names a successful file", async ({
  page,
}) => {
  const { data } = await auditFixture(page);
  let failed = true;
  let previewed = false;
  await page.route("**/api/workspace/" + tenantId + "/qr?*", async (route) => {
    if (!previewed) {
      previewed = true;
      return route.fulfill({
        contentType: "image/svg+xml",
        headers: {
          "X-QR-Validated": "true",
          "X-QR-Permanent-URL": "https://permanent.example.test/q/fixture",
        },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/></svg>',
      });
    }
    if (failed)
      return route.fulfill({
        status: 503,
        json: { error: "El QR no se pudo generar. Intenta de nuevo." },
      });
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/></svg>',
    });
  });
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Mi código QR");
  const link = page.getByRole("link", { name: "SVG", exact: true });
  await link.click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "El QR no se pudo generar",
  );
  failed = false;
  const downloading = page.waitForEvent("download");
  await link.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe("qr-" + data.restaurant.slug + ".svg");
  await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
});
