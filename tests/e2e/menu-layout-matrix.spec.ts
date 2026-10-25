import { test, expect } from "@playwright/test";
import { auditData } from "./audit-fixtures";
for (const mobile of [1, 2] as const)
  for (const desktop of [1, 2] as const) {
    test(
      "layout matrix: mobile " +
        mobile +
        " desktop " +
        desktop +
        " at four widths",
      async ({ page }, info) => {
        const data = auditData();
        data.products = Array.from({ length: 4 }, (_, i) => ({
          ...data.products[0],
          id: "matrix-" + i,
          category_id: i === 3 ? "cat-drinks" : "cat-main",
          name:
            "Nombre de producto suficientemente largo para comprobar ajuste " +
            i,
          price: 123456.78,
          is_featured: i === 0,
          image_path: "fixture/image.webp",
        }));
        data.settings.appearance = {
          ...data.settings.appearance,
          columns_mobile: mobile,
          columns_desktop: desktop,
        };
        await page.route("**/api/**", (r) => {
          const path = new URL(r.request().url()).pathname;
          if (path.startsWith("/api/media/"))
            return r.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#cab797"/></svg>',
            });
          if (path.includes("/api/public/menu/"))
            return r.fulfill({ json: { ...data, contact: null } });
          return r.fulfill({ status: 404, json: { error: "Fixture only" } });
        });
        await page.goto("/menu/demo-ui-restaurante");
        await expect(page.locator(".public-product")).toHaveCount(4);
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const grid = page.locator(".public-product-grid").first();
          await expect
            .poll(() =>
              grid.evaluate(
                (e) =>
                  getComputedStyle(e).gridTemplateColumns.split(" ").length,
              ),
            )
            .toBe(width < 700 ? mobile : desktop);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBe(width);
          const fits = await page
            .locator(".public-product")
            .evaluateAll((cards) =>
              cards.every((card) => {
                const a = card.getBoundingClientRect(),
                  p = card
                    .querySelector(".public-product-bottom strong")!
                    .getBoundingClientRect();
                return p.left >= a.left && p.right <= a.right && p.width > 0;
              }),
            );
          expect(fits).toBe(true);
          await expect(page.locator(".featured-product")).toHaveCount(1);
          if (width === 320 || width === 1440) {
            await page
              .locator(".public-product")
              .first()
              .scrollIntoViewIfNeeded();
            await page.screenshot({
              path:
                "docs/evidence/closure-matrix-" +
                info.project.name +
                "-" +
                mobile +
                "-" +
                desktop +
                "-" +
                width +
                ".png",
            });
            await page.evaluate(() => window.scrollTo(0, 0));
          }
        }
        await page
          .getByRole("button", { name: "Bebidas", exact: true })
          .click();
        await expect(page.locator(".public-product")).toHaveCount(1);
        await expect(page.locator(".featured-product")).toHaveCount(1);
        await page.getByRole("searchbox").fill("sin coincidencia");
        await expect(page.locator(".public-product")).toHaveCount(0);
        await expect(page.locator(".featured-product")).toHaveCount(1);
        await page
          .getByRole("button", { name: "English", exact: true })
          .click();
        await expect(page.locator(".featured-product")).toHaveCount(1);
        await page.locator(".favorite-nav").click();
        await expect(page.locator(".featured-product")).toHaveCount(1);
      },
    );
  }
