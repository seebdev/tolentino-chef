import { test, expect } from "@playwright/test";
import { auditFixture, navigateAudit, tenantId } from "./audit-fixtures";

test("appearance with persisted brand images fits desktop, tablet and mobile", async ({
  page,
}) => {
  const { data } = await auditFixture(page);
  data.restaurant.name = "Pizzería Aurora · DEMO";
  data.restaurant.description =
    "DEMO · Una mesa italiana: masa de fermentación lenta, recetas de temporada y el placer de compartir.";
  const appearance = {
    ...data.settings.appearance,
    logo_path: tenantId + "/logo.webp",
    cover_path: tenantId + "/cover.webp",
    favicon_path: tenantId + "/favicon.webp",
  };
  data.settings.appearance = appearance;
  data.settings.draft_appearance = appearance;
  await page.route("**/api/media/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="#751d2c"/></svg>',
    }),
  );
  for (const [width, height] of [
    [1440, 1000],
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");
    await navigateAudit(page, "Apariencia");
    await expect(
      page.getByRole("heading", { name: "Identidad de tu restaurante" }),
    ).toBeVisible();
    await expect(page.locator(".brand-upload img")).toHaveCount(3);
    await expect(page.locator(".phone-cover img")).toBeVisible();
    await page
      .locator(".brand-upload img")
      .first()
      .evaluate(async (image) => {
        if (image instanceof HTMLImageElement) await image.decode();
      });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll("main *")]
        .map((el) => ({
          element: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
        }))
        .filter((x) => x.right > innerWidth + 1),
    }));
    await test
      .info()
      .attach("appearance-dimensions-" + width, {
        body: JSON.stringify(dimensions, null, 2),
        contentType: "application/json",
      });
    expect(
      dimensions.document,
      JSON.stringify(dimensions.offenders),
    ).toBeLessThanOrEqual(width + 1);
    await expect(
      page.getByRole("button", { name: "Publicar cambios", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/evidence/audit-appearance-" + width + ".png",
      fullPage: true,
    });
  }
});
