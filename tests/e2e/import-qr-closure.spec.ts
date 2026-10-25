import { test, expect } from "@playwright/test";
import { auditFixture, navigateAudit, tenantId } from "./audit-fixtures";
const sample = "nombre,precio,categoria,sku\nProducto local,12,Bebidas,LOCAL-1";
const preview = {
  headers: ["nombre", "precio", "categoria", "sku"],
  rows: [
    { name: "Producto local", price: 12, category: "Bebidas", sku: "LOCAL-1" },
  ],
  summary: { total: 1, valid: 1, invalid: 0 },
  errors: [],
};
const complete = {
  found: true,
  status: "completed",
  summary: { total: 1, created: 1, updated: 0, skipped: 0, rejected: 0 },
  message: "Importación completada y guardada en la base de datos.",
};
test("CSV fixtures: lost response is recovered with one commit, including after reload", async ({
  page,
}) => {
  await auditFixture(page);
  let commits = 0,
    attempt = "";
  await page.route(
    "**/api/workspace/" + tenantId + "/import**",
    async (route) => {
      const request = route.request();
      if (request.method() === "GET")
        return route.fulfill({
          json: attempt
            ? { ...complete, attemptId: attempt }
            : { found: false },
        });
      const input = request.postDataJSON();
      if (input.action === "preview") return route.fulfill({ json: preview });
      commits++;
      attempt = input.attemptId;
      expect(attempt).toMatch(/^[a-f0-9-]{36}$/);
      await route.abort("connectionreset");
    },
  );
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Importar productos");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "local.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(sample),
    });
  const confirm = page.getByRole("button", { name: "Confirmar importación" });
  await expect(confirm).toBeEnabled();
  await confirm.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText(complete.message)).toBeVisible();
  expect(commits).toBe(1);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  const descriptor = await page.evaluate(
    (key) => localStorage.getItem(key),
    "tolentino:import-attempt:" + tenantId,
  );
  expect(descriptor).toContain(attempt);
  expect(descriptor).not.toContain("Producto local");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Importar productos");
  await expect(page.getByText(complete.message)).toBeVisible();
  expect(commits).toBe(1);
});
test("CSV fixtures: no result is not success; resend retains id after reload", async ({
  page,
}) => {
  await auditFixture(page);
  const ids: string[] = [];
  let acknowledged = false;
  await page.route(
    "**/api/workspace/" + tenantId + "/import**",
    async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: acknowledged
            ? complete
            : { found: false, status: "unconfirmed" },
        });
      const input = route.request().postDataJSON();
      if (input.action === "preview") return route.fulfill({ json: preview });
      ids.push(input.attemptId);
      if (ids.length === 1) return route.abort("connectionreset");
      acknowledged = true;
      return route.fulfill({ json: complete });
    },
  );
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Importar productos");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "local.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(sample),
    });
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(
    page.getByRole("button", { name: "Consultar resultado del intento" }),
  ).toBeEnabled();
  await expect(page.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Importar productos");
  await expect(
    page.getByRole("button", { name: "Consultar resultado del intento" }),
  ).toBeEnabled();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "local.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(sample),
    });
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByText(complete.message)).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});
test("QR fixtures: newest validated draft wins, bad contrast keeps last image and blocks export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL;
    const fixtureWindow = window as typeof window & {
      qrBlobs: Record<string, string>;
    };
    fixtureWindow.qrBlobs = {};
    URL.createObjectURL = (blob: Blob) => {
      const url = original(blob);
      void blob.text().then((text) => (fixtureWindow.qrBlobs[url] = text));
      return url;
    };
  });
  const { data, mutations } = await auditFixture(page, "superadmin");
  const canonical =
    "https://permanent.example.test/q/" + data.restaurant.public_token;
  const labels: string[] = [];
  await page.route("**/api/workspace/" + tenantId + "/qr**", async (route) => {
    const input = route.request().postDataJSON();
    labels.push(input.label);
    if (input.label === "primero")
      await new Promise((resolve) => setTimeout(resolve, 1200));
    if (input.foreground === "#ffffff")
      return route.fulfill({
        status: 400,
        json: { error: "Contraste insuficiente." },
      });
    return route.fulfill({
      headers: {
        "Content-Type": "image/svg+xml",
        "X-QR-Validated": "true",
        "X-QR-Permanent-URL": canonical,
      },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#163c2c"/><text fill="white" y="50">${input.label || "base"}</text></svg>`,
    });
  });
  await page.goto("/admin/restaurants/" + tenantId);
  await page.waitForLoadState("networkidle");
  await navigateAudit(page, "Mi código QR");
  await expect(
    page.getByText("Validación automática completada."),
  ).toBeVisible();
  await page.getByLabel("Texto del QR", { exact: true }).fill("primero");
  await expect.poll(() => labels.includes("primero")).toBeTruthy();
  await page.getByLabel("Texto del QR", { exact: true }).fill("último");
  await expect(
    page.getByText("Validación automática completada."),
  ).toBeVisible();
  await page.waitForTimeout(1300);
  const image = page.getByAltText("Código QR del restaurante");
  const text = await image.evaluate(
    async (img) =>
      (window as typeof window & { qrBlobs: Record<string, string> }).qrBlobs[
        (img as HTMLImageElement).src
      ],
  );
  expect(text).toContain("último");
  expect(text).not.toContain("primero");
  await expect(
    page.getByRole("button", { name: "PNG", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Abrir enlace del QR" }),
  ).toHaveAttribute("href", canonical);
  await page.getByRole("button", { name: "Guardar diseño" }).click();
  await expect
    .poll(() => mutations.filter((m) => m.action === "save_qr").length)
    .toBe(1);
  await expect(
    page.getByRole("link", { name: "PNG", exact: true }),
  ).toBeVisible();
  const before = await image.getAttribute("src");
  await page.getByLabel("Color del código", { exact: true }).fill("#ffffff");
  await expect(page.getByText("Contraste insuficiente.")).toBeVisible();
  expect(await image.getAttribute("src")).toBe(before);
  await expect(
    page.getByRole("button", { name: "Guardar diseño" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "PNG", exact: true }),
  ).toBeDisabled();
});
