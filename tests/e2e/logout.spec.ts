import { test, expect } from "@playwright/test";
import { auditFixture } from "./audit-fixtures";
import { LOCAL_LOGOUT_WARNING } from "../../src/lib/session-messages";

// Browser UI fixtures only: no real account, cookie revocation or database proof.
for (const cleared of [true, false])
  test(
    "logout UI " +
      (cleared
        ? "leaves panel after confirmed local cleanup"
        : "keeps an unconfirmed failure visible"),
    async ({ page }) => {
      const { data } = await auditFixture(page);
      let loggedOut = false;
      let logoutRequests = 0;
      await page.route("**/api/health", (route) =>
        route.fulfill({
          json: { status: "ok", configured: true },
        }),
      );
      await page.route("**/api/session", async (route) => {
        if (loggedOut)
          await route.fulfill({ status: 401, json: { error: "No session" } });
        else await route.fallback();
      });
      await page.route("**/api/auth", async (route) => {
        const input = route.request().postDataJSON();
        if (input.action !== "logout") return route.fallback();
        logoutRequests++;
        loggedOut = cleared;
        await route.fulfill({
          status: 503,
          json: cleared
            ? {
                ok: false,
                error: LOCAL_LOGOUT_WARNING,
                code: "AUTH_REVOCATION_UNCONFIRMED",
                localSessionCleared: true,
              }
            : { error: "No se pudo confirmar el cierre de sesión." },
        });
      });
      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", {
          name: "Tu menú, en buenas manos.",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".workspace-label")).toContainText(
        data.restaurant.name,
      );
      const openNavigation = page.getByRole("button", {
        name: "Abrir navegación",
        exact: true,
      });
      if (await openNavigation.isVisible()) await openNavigation.click();
      await page
        .getByRole("button", { name: "Cerrar sesión", exact: true })
        .click();
      if (cleared) {
        await expect(page).toHaveURL(/\/login\?logout=unconfirmed$/);
        await expect(page.getByRole("alert").filter({ hasText: cleared ? LOCAL_LOGOUT_WARNING : "No se pudo confirmar el cierre de sesión." })).toBeVisible();
        await expect(page.getByRole("alert").filter({ hasText: cleared ? LOCAL_LOGOUT_WARNING : "No se pudo confirmar el cierre de sesión." })).toContainText(
          LOCAL_LOGOUT_WARNING,
        );
      } else {
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.locator(".sidebar-backdrop")).toHaveCount(0);
        await expect(page.getByRole("alert").filter({ hasText: cleared ? LOCAL_LOGOUT_WARNING : "No se pudo confirmar el cierre de sesión." })).toBeVisible();
        await expect(page.getByRole("alert").filter({ hasText: cleared ? LOCAL_LOGOUT_WARNING : "No se pudo confirmar el cierre de sesión." })).toContainText(
          "No se pudo confirmar el cierre de sesión.",
        );
      }
      expect(logoutRequests).toBe(1);
    },
  );
