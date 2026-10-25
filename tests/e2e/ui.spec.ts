import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { copy, languages } from "../../src/lib/i18n";
import {
  DEFAULT_APPEARANCE,
  type WorkspaceData,
  type Restaurant,
  type PublicMenuData,
} from "../../src/lib/types";
// Explicit API fixtures only for browser/UI coverage. These are not proof of Supabase persistence or authorization.
const restaurant: Restaurant = {
  id: "11111111-1111-4111-8111-111111111111",
  public_token: "fixed-public-token-a",
  name: "Jardín de prueba A",
  slug: "jardin-prueba-a",
  description: "Cocina de temporada, preparada con cuidado.",
  status: "active",
  owner_name: "Propietaria de prueba A",
  owner_email: "owner-a@example.test",
  phone: "",
  currency: "COP",
  default_language: "es",
  created_at: "2026-10-01T12:00:00Z",
  sale_date: "2026-10-01T12:00:00Z",
  product_count: 2,
};
const restaurantB: Restaurant = {
  ...restaurant,
  id: "22222222-2222-4222-8222-222222222222",
  public_token: "fixed-public-token-b",
  name: "Mesa de prueba B",
  slug: "mesa-prueba-b",
  owner_name: "Propietario de prueba B",
  owner_email: "owner-b@example.test",
};
function workspace(): WorkspaceData {
  return {
    restaurant: { ...restaurant },
    settings: {
      appearance: { ...DEFAULT_APPEARANCE },
      draft_appearance: { ...DEFAULT_APPEARANCE },
      enabled_languages: languages.map((l) => l.code),
      suspension_message: "",
    },
    categories: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        parent_id: null,
        name: "Entradas",
        sort_order: 0,
        is_visible: true,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        parent_id: null,
        name: "Bebidas",
        sort_order: 1,
        is_visible: true,
      },
    ],
    products: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        category_id: "33333333-3333-4333-8333-333333333333",
        name: "Sopa de temporada",
        description: "Vegetales frescos de la huerta con hierbas aromáticas.",
        price: 18000,
        image_path: "",
        tags: ["Vegetariano"],
        ingredients: "Zanahoria, papa, cilantro",
        variants: [{ name: "Grande", price: 22000 }],
        extras: [{ name: "Pan artesanal", price: 4000 }],
        is_published: true,
        is_available: true,
        is_featured: true,
        sort_order: 0,
        sku: "SOPA-01",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        category_id: "44444444-4444-4444-8444-444444444444",
        name: "Limonada de hierbabuena",
        description: "Limón fresco y hojas de nuestra huerta.",
        price: 9000,
        image_path: "",
        tags: [],
        ingredients: "Limón, hierbabuena",
        variants: [],
        extras: [],
        is_published: true,
        is_available: false,
        is_featured: false,
        sort_order: 1,
        sku: "BEB-01",
      },
    ],
    promotions: [],
    hours: [
      {
        day_of_week: 1,
        opens_at: "09:00",
        closes_at: "18:00",
        is_closed: false,
      },
    ],
    translations: [],
    qr: {
      foreground: "#163c2c",
      background: "#ffffff",
      frame: "simple",
      label: "Descubre nuestro menú",
      include_logo: false,
    },
    domains: [],
    membership: { is_active: true, user_id: "owner-a" },
    sale: {
      sold_at: "2026-10-01T12:00:00Z",
      amount: 300000,
      currency: "COP",
      notes: "Fixture exclusivo para pruebas",
    },
    stats: { products: 2, published: 2, visits: 0 },
    role: "owner",
    total: 2,
    page: 1,
  };
}
async function fixture(page: Page, role: "owner" | "superadmin" = "owner") {
  const data = workspace();
  data.role = role;
  const mutations: unknown[] = [];
  await page.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "fixture-user",
          email:
            role === "owner" ? restaurant.owner_email : "admin@example.test",
        },
        role,
        restaurantId: role === "owner" ? restaurant.id : null,
      },
    }),
  );
  await page.route("**/api/admin/restaurants**", async (r) => {
    if (r.request().method() === "POST") {
      mutations.push(r.request().postDataJSON());
      await r.fulfill({
        json: { ok: true, message: "Cambio guardado en fixture de interfaz." },
      });
    } else
      await r.fulfill({
        json: {
          restaurants: [restaurant, restaurantB],
          total: 2,
          page: 1,
          configured: true,
          platform: {
            contact_label: "Menú digital por Tolentino",
            contact_url: "",
          },
          stats: {
            total: 2,
            active: 2,
            suspended: 0,
            products: 3,
            publishedProducts: 2,
            qr: 2,
            visits: 0,
            scans: 0,
          },
        },
      });
  });
  await page.route("**/api/workspace/"+restaurant.id+"/preview",r=>r.fulfill({json:{...data,contact:null}}));
  await page.route("**/api/workspace/" + restaurant.id + "*", async (r) => {
    if (
      new URL(r.request().url()).pathname !==
      "/api/workspace/" + restaurant.id
    ) {
      await r.fallback();
      return;
    }
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      mutations.push(body);
      if (body.action === "save_product") {
        data.products.push({
          ...body.data,
          id: "77777777-7777-4777-8777-777777777777",
        });
        data.total++;
      }
      await r.fulfill({ json: { ok: true } });
    } else await r.fulfill({ json: data });
  });
  await page.route("**/api/public/menu/**", async (r) => {
    const slug = new URL(r.request().url()).pathname.split("/").pop();
    const publicData: PublicMenuData = {
      ...data,
      restaurant: slug === restaurantB.slug ? restaurantB : restaurant,
      contact: null,
    };
    await r.fulfill({ json: publicData });
  });
  return { data, mutations };
}
async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Abrir navegación" });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
test.beforeAll(async () => {
  await mkdir("docs/evidence", { recursive: true });
});
test("real setup login and recovery have no public signup", async ({
  page,
}, info) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Qué bueno tenerte aquí." }),
  ).toBeVisible();
  await expect(page.getByLabel("Correo o usuario de acceso")).toBeVisible();
  await expect(
    page.getByText("Las cuentas se crean por invitación."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /registr/i })).toHaveCount(0);
  const health = await page.request.get("/api/health");
  const status = await health.json();
  if (status.configured === false) {
    await expect(
      page.getByText("La plataforma está pendiente de conexión.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Entrar a mi espacio" }),
    ).toBeDisabled();
  }
  await page.screenshot({
    path: "docs/evidence/ui-real-login-" + info.project.name + ".png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Olvidé mi contraseña" }).click();
  await expect(
    page.getByRole("heading", { name: "Recupera tu acceso" }),
  ).toBeVisible();
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveCount(0);
});
test("admin fixture dashboard and create restaurant form", async ({
  page,
}, info) => {
  await fixture(page, "superadmin");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Cada restaurante, bajo control." }),
  ).toBeVisible();
  await expect(page.getByText(restaurant.name, { exact: true })).toBeVisible();
  await expect(page.getByText(restaurantB.name, { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Productos publicados" })
      .locator(".stat-number"),
  ).toHaveText("2");
  await page.screenshot({
    path: "docs/evidence/ui-fixture-admin-" + info.project.name + ".png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Nuevo restaurante", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Correo del propietario")).toBeVisible();
  await expect(page.getByLabel("Precio cobrado")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("owner fixture product form persists to intercepted API and confirms delete", async ({
  page,
}) => {
  const { mutations } = await fixture(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Tu menú, en buenas manos." }),
  ).toBeVisible();
  await navigate(page, "Productos");
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await page.getByLabel("Nombre del producto").fill("Ensalada de prueba");
  await page
    .getByLabel("Categoría", { exact: true })
    .selectOption("33333333-3333-4333-8333-333333333333");
  await page.getByLabel("Precio", { exact: true }).fill("22000");
  await page
    .getByLabel("Descripción", { exact: true })
    .fill("Solo datos de prueba");
  await expect(page.getByLabel("Presentaciones y precios")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Ensalada de prueba", { exact: true }),
  ).toBeVisible();
  expect(mutations).toContainEqual(
    expect.objectContaining({
      action: "save_product",
      data: expect.objectContaining({
        name: "Ensalada de prueba",
        price: 22000,
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Eliminar Ensalada de prueba", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Confirmar eliminación" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(mutations).toHaveLength(1);
});
test("CSV fixture maps columns and previews before committing", async ({
  page,
}) => {
  await fixture(page);
  const actions: string[] = [];
  await page.route(
    "**/api/workspace/" + restaurant.id + "/import",
    async (r) => {
      const b = r.request().postDataJSON();
      actions.push(b.action);
      await r.fulfill({
        json: {
          headers: ["nombre", "precio", "categoria", "descripcion", "sku"],
          rows: [
            {
              name: "Sopa de prueba",
              price: 10000,
              category: "Entradas",
              description: "Prueba",
              sku: "TEST-1",
            },
          ],
          errors: [],
          duplicates: [],
          summary: { total: 1, valid: 1, invalid: 0, duplicates: 0 },
        },
      });
    },
  );
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Tu menú, en buenas manos." }),
  ).toBeVisible();
  await navigate(page, "Importar productos");
  await page.locator("input[type=file]").setInputFiles({
    name: "fixture.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "nombre,precio,categoria,descripcion,sku\nSopa de prueba,10000,Entradas,Prueba,TEST-1",
    ),
  });
  await expect(
    page.getByRole("button", { name: "Validar y previsualizar" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Confirmar importación" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  await expect(
    page.getByRole("heading", { name: "Resultado de la validación" }),
  ).toBeVisible();
  expect(actions).toEqual(["preview", "preview"]);
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(actions).toEqual(["preview", "preview", "commit"]);
});
test("public fixture supports all seven languages and fallback product text", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/menu/" + restaurant.slug);
  await expect(
    page.getByRole("heading", { name: restaurant.name, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/ui-fixture-public-" + info.project.name + ".png",
    fullPage: true,
  });
  for (const language of languages) {
    await page
      .getByRole("combobox", { name: "Language / Idioma" })
      .selectOption(language.code);
    await expect(
      page.getByRole("heading", {
        name: copy[language.code].menu,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("heading", { name: "Sopa de temporada", exact: true })
        .first(),
    ).toBeVisible();
  }
});
test("public fixture search, favorites, detail and hours are usable", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/menu/" + restaurant.slug);
  await expect(
    page.getByRole("heading", { name: "Nuestro menú", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("limonada");
  await expect(
    page.getByRole("heading", { name: "Sopa de temporada", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Agotado", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").clear();
  await page
    .getByRole("button", { name: "Guardar favorito", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Mis favoritos", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Limonada de hierbabuena" }),
  ).toHaveCount(0);
  await page.locator(".public-product-main").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ingredientes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Horarios", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("09:00 – 18:00"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("public fixture favorites are partitioned by restaurant", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/menu/" + restaurant.slug);
  await page
    .getByRole("button", { name: "Guardar favorito", exact: true })
    .first()
    .click();
  await expect(page.locator(".favorite-nav b")).toHaveText("1");
  await page.goto("/menu/" + restaurantB.slug);
  await expect(
    page.getByRole("heading", { name: restaurantB.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".favorite-nav b")).toHaveCount(0);
});
test("public suspended fixture exposes only restaurant message", async ({
  page,
}) => {
  await page.route("**/api/public/menu/**", (r) =>
    r.fulfill({
      status: 410,
      json: {
        suspended: true,
        name: restaurant.name,
        message: "Este menú no está disponible temporalmente.",
      },
    }),
  );
  await page.goto("/menu/" + restaurant.slug);
  await expect(
    page.getByText("Este menú no está disponible temporalmente."),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Volver a intentar" }),
  ).toHaveCount(0);
});
test("fixture layouts do not overflow the viewport", async ({ page }) => {
  await fixture(page);
  for (const route of ["/dashboard", "/menu/" + restaurant.slug]) {
    await page.goto(route);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      )
      .toBe(true);
  }
});

test("support fixture registers a domain only after confirmation", async ({
  page,
}) => {
  const { data, mutations } = await fixture(page, "superadmin");
  data.domains.push({
    id: "88888888-8888-4888-8888-888888888888",
    hostname: "menu.example.test",
    status: "pending",
    dns_instructions: [
      {
        type: "TXT",
        name: "_tolentino.menu.example.test",
        value: "tolentino-verification=test-only",
      },
    ],
  });
  await page.goto("/admin/restaurants/" + restaurant.id);
  await expect(
    page.getByText("Administrando como Tolentino", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Dominios");
  await expect(
    page.getByText("_tolentino.menu.example.test", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Registrar en Render", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(mutations).toHaveLength(0);
  await page
    .getByRole("button", { name: "Registrar en Render", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Registrar dominio", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toContainEqual({
    action: "register_domain",
    data: { id: "88888888-8888-4888-8888-888888888888" },
  });
});
test("admin fixture copies design only to an explicitly selected restaurant", async ({
  page,
}) => {
  const { mutations } = await fixture(page, "superadmin");
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Duplicar " + restaurant.name, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Copiar diseño", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Restaurante de destino", { exact: true })
    .selectOption(restaurantB.id);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toContainEqual({
    action: "duplicate",
    restaurantId: restaurant.id,
    data: { targetRestaurantId: restaurantB.id },
  });
});
