import { expect, type Page } from "@playwright/test";
import { DEFAULT_APPEARANCE, type WorkspaceData } from "../../src/lib/types";
import { languages } from "../../src/lib/i18n";

// Synthetic data for UI behavior only. These fixtures do not verify a database.
export const tenantId = "11111111-1111-4111-8111-111111111111";
export function auditData(): WorkspaceData {
  return {
    restaurant: {
      id: tenantId,
      public_token: "ui-fixture-permanent",
      name: "DEMO UI Restaurante",
      slug: "demo-ui-restaurante",
      description: "Datos sintéticos para interfaz.",
      status: "active",
      owner_name: "DEMO UI Propietario",
      owner_email: "ui@example.test",
      phone: "",
      currency: "COP",
      default_language: "es",
      created_at: "2026-10-01T12:00:00Z",
    },
    settings: {
      appearance: { ...DEFAULT_APPEARANCE },
      draft_appearance: { ...DEFAULT_APPEARANCE },
      enabled_languages: languages.map((l) => l.code),
      suspension_message: "",
    },
    categories: [
      {
        id: "cat-main",
        name: "Pizzas",
        parent_id: null,
        sort_order: 0,
        is_visible: true,
      },
      {
        id: "cat-drinks",
        name: "Bebidas",
        parent_id: null,
        sort_order: 1,
        is_visible: true,
      },
      {
        id: "cat-child",
        name: "Especiales",
        parent_id: "cat-main",
        sort_order: 8,
        is_visible: true,
      },
    ],
    products: [
      {
        id: "product-main",
        category_id: "cat-main",
        name: "Margherita DEMO",
        description: "Tomate y albahaca",
        price: 28000,
        image_path: "",
        tags: [],
        ingredients: "Tomate, queso",
        variants: [{ name: "Grande", price: 42000 }],
        extras: [{ name: "Queso extra", price: 5000 }],
        is_published: true,
        is_available: true,
        is_featured: false,
        sort_order: 0,
        sku: "DEMO-1",
      },
      {
        id: "product-child",
        category_id: "cat-child",
        name: "Trufa DEMO",
        description: "Especial de la casa",
        price: 35000,
        image_path: "",
        tags: [],
        ingredients: "",
        variants: [],
        extras: [],
        is_published: true,
        is_available: false,
        is_featured: false,
        sort_order: 1,
        sku: "DEMO-2",
      },
    ],
    promotions: [],
    hours: [],
    translations: [],
    qr: {
      foreground: "#163c2c",
      background: "#ffffff",
      frame: "none",
      label: "",
      include_logo: false,
    },
    domains: [],
    membership: { is_active: true, user_id: "ui-owner" },
    sale: null,
    stats: { products: 2, published: 2 },
    role: "owner",
    total: 2,
    page: 1,
  };
}
export async function auditFixture(
  page: Page,
  role: "owner" | "superadmin" = "owner",
) {
  const data = auditData();
  data.role = role;
  const mutations: {
    action: string;
    requestId?: string;
    data: Record<string, unknown>;
  }[] = [];
  await page.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: { id: "ui-user", email: "ui@example.test" },
        role,
        restaurantId: role === "owner" ? tenantId : null,
      },
    }),
  );
  await page.route("**/api/admin/restaurants**", async (r) => {
    if (r.request().method() === "POST") {
      mutations.push(r.request().postDataJSON());
      await r.fulfill({ json: { ok: true } });
    } else
      await r.fulfill({
        json: {
          restaurants: [],
          total: 0,
          stats: { total: 0, active: 0, suspended: 0, publishedProducts: 0 },
          platform: {},
          configured: true,
        },
      });
  });
  await page.route("**/api/workspace/" + tenantId + "*", async (r) => {
    if (new URL(r.request().url()).pathname !== "/api/workspace/" + tenantId)
      return r.fallback();
    if (r.request().method() === "POST") {
      mutations.push(r.request().postDataJSON());
      await r.fulfill({ json: { ok: true } });
    } else await r.fulfill({ json: data });
  });
  await page.route("**/api/public/menu/" + data.restaurant.slug, (r) =>
    r.fulfill({ json: { ...data, contact: null } }),
  );
  return { data, mutations };
}
export async function navigateAudit(page: Page, label: string) {
  const open = page.getByRole("button", {
    name: "Abrir navegación",
    exact: true,
  });
  if (await open.isVisible()) await open.click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: label, exact: true })
    .click();
}
export async function fillRestaurant(page: Page) {
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Nuevo restaurante", exact: true })
    .click();
  await page.getByLabel("Nombre del restaurante").fill("DEMO UI Nuevo");
  await page.getByLabel("Dirección del menú").fill("demo-ui-nuevo");
  await page.getByLabel("Nombre del propietario").fill("DEMO UI Propietario");
  await page.getByLabel("Correo del propietario").fill("new-ui@example.test");
  await expect(
    page.getByRole("button", { name: "Crear restaurante", exact: true }),
  ).toBeEnabled();
}
