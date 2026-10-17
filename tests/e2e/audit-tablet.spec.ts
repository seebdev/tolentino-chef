import { test, expect } from "@playwright/test";
import { auditFixture, navigateAudit } from "./audit-fixtures";

test.use({
  viewport: { width: 820, height: 1180 },
  isMobile: false,
  hasTouch: true,
});
test("audit UI tablet layouts keep administration and public menu usable", async ({
  page,
}) => {
  await auditFixture(page, "superadmin");
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Nuevo restaurante", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(820);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.screenshot({
    path: "docs/evidence/audit-ui-tablet-admin.png",
    fullPage: true,
  });
  const { data } = await auditFixture(page);
  await page.goto("/dashboard");
  await navigateAudit(page, "Productos");
  await expect(
    page.getByText("Margherita DEMO", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/evidence/audit-ui-tablet-owner.png",
    fullPage: true,
  });
  await page.goto("/menu/" + data.restaurant.slug);
  await expect(
    page.getByRole("heading", { name: data.restaurant.name, exact: true }),
  ).toBeVisible();
  await page
    .locator(".public-categories")
    .getByRole("button", { name: "Pizzas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trufa DEMO", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/evidence/audit-ui-tablet-public.png",
    fullPage: true,
  });
});
