import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import {
  demos,
  englishCatalog,
  productData,
  artwork,
  coverArtwork,
} from "./demo-catalog.mjs";
import { Session } from "./live-client.mjs";
const base = process.env.AUDIT_BASE_URL || "http://localhost:3000";
const target = "ylcnrfzosjzuljufwups.supabase.co";
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== target)
  throw Error("Unexpected Supabase target");
if (!process.env.AUDIT_ADMIN_EMAIL || !process.env.AUDIT_ADMIN_PASSWORD)
  throw Error(
    "Supply AUDIT_ADMIN_EMAIL and AUDIT_ADMIN_PASSWORD in process environment",
  );
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
mkdirSync(".runtime", { recursive: true });
mkdirSync("artifacts/demo", { recursive: true });
mkdirSync("artifacts/screenshots", { recursive: true });
const stateFile = ".runtime/demo-accounts.json";
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8").replace(/^\uFEFF/, ""))
  : {};
const save = () =>
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = new Session();
await admin.login(
  process.env.AUDIT_ADMIN_EMAIL,
  process.env.AUDIT_ADMIN_PASSWORD,
);
const evidence = {
  at: new Date().toISOString(),
  target,
  base,
  restaurants: [],
  assets:
    "Original SVG illustrations rendered with sharp; no third-party images",
  externalEmailSent: false,
};
async function uiCreate(d) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(base + "/login");
    await page
      .getByLabel("Correo electrónico")
      .fill(process.env.AUDIT_ADMIN_EMAIL);
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(process.env.AUDIT_ADMIN_PASSWORD);
    await page
      .getByRole("button", { name: "Entrar a mi espacio", exact: true })
      .click();
    await page.waitForURL("**/admin");
    await page
      .getByRole("button", { name: "Nuevo restaurante", exact: true })
      .click();
    await page
      .getByLabel("Nombre del restaurante", { exact: true })
      .fill(d.name);
    await page.getByLabel("Dirección del menú", { exact: true }).fill(d.slug);
    await page
      .getByLabel("Nombre del propietario", { exact: true })
      .fill(d.owner);
    await page
      .getByLabel("Correo del propietario", { exact: true })
      .fill(d.email);
    await page.getByLabel("Descripción", { exact: true }).fill(d.description);
    await page
      .getByRole("checkbox", { name: "Crear restaurante DEMO" })
      .check();
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/restaurants") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Crear restaurante", exact: true })
      .click();
    const response = await responsePromise;
    const payload = await response.json();
    if (response.status() !== 201)
      throw Error(
        "UI creation failed HTTP " +
          response.status() +
          " " +
          (payload.error || ""),
      );
    await page
      .getByRole("heading", { name: "Un nuevo restaurante" })
      .waitFor({ state: "hidden" });
    await page.screenshot({
      path: "artifacts/screenshots/real-admin-created-aurora.png",
      fullPage: true,
      mask: [page.getByText(process.env.AUDIT_ADMIN_EMAIL, { exact: true })],
    });
    return payload.restaurantId;
  } finally {
    await browser.close();
  }
}
try {
  for (const d of demos) {
    console.log("Preparing " + d.name);
    const existing = await db
      .from("restaurants")
      .select("*")
      .eq("slug", d.slug)
      .maybeSingle();
    if (existing.error) throw Error(existing.error.code);
    let id = existing.data?.id;
    if (
      existing.data &&
      (!existing.data.is_demo || existing.data.owner_email !== d.email)
    )
      throw Error("Refusing to modify a non-demo restaurant");
    if (!id) {
      if (d.key === "aurora" && process.env.DEMO_CREATE_UI !== "0")
        id = await uiCreate(d);
      else {
        const requestId = randomUUID();
        let result;
        for (let attempt = 0; attempt < 6; attempt++) {
          result = await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "create",
              requestId,
              data: {
                name: d.name,
                slug: d.slug,
                owner_name: d.owner,
                owner_email: d.email,
                description: d.description,
                demo: true,
              },
            },
            expected: [200, 201, 202],
          });
          if (result.status !== 202) break;
          await wait(2000);
        }
        id = result.data.restaurantId;
        if (!id) throw Error("Creation did not complete");
      }
    }
    const membership = await db
      .from("restaurant_memberships")
      .select("user_id")
      .eq("restaurant_id", id)
      .single();
    if (membership.error) throw Error(membership.error.code);
    if (!state[d.key]) {
      state[d.key] = {
        email: d.email,
        password: randomBytes(24).toString("base64url"),
        restaurantId: id,
        userId: membership.data.user_id,
        media: {},
      };
      save();
      const updated = await db.auth.admin.updateUserById(
        membership.data.user_id,
        { password: state[d.key].password, email_confirm: true },
      );
      if (updated.error)
        throw Error(
          "Could not provision demo credentials: " + updated.error.code,
        );
    }
    const s = new Session();
    const logged = await s.login(d.email, state[d.key].password);
    if (logged.role !== "owner") throw Error("Unexpected demo role");
    const call = async (action, data) =>
      (
        await s.request("/api/workspace/" + id, {
          method: "POST",
          data: { action, data },
        })
      ).data.data;
    const upload = async (key, svg) => {
      if (state[d.key].media[key]) return state[d.key].media[key];
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
      writeFileSync("artifacts/demo/" + d.key + "-" + key + ".png", buffer);
      const form = new FormData();
      form.set("file", new Blob([buffer], { type: "image/png" }), key + ".png");
      const r = await s.request("/api/workspace/" + id + "/media", {
        method: "POST",
        form,
      });
      state[d.key].media[key] = r.data.path;
      save();
      return r.data.path;
    };
    const logo = await upload("logo", artwork(d, d.name, 0, true));
    const cover = await upload("cover", coverArtwork(d));
    let workspace = (await s.request("/api/workspace/" + id)).data;
    const categories = workspace.categories;
    let index = 0;
    for (let ci = 0; ci < d.categories.length; ci++) {
      const [name, sub, ...items] = d.categories[ci];
      let parent = categories.find((x) => x.name === name && !x.parent_id);
      if (!parent) {
        parent = await call("save_category", {
          name,
          sort_order: ci * 10,
          is_visible: true,
        });
        categories.push(parent);
      }
      let category = parent;
      if (sub) {
        category = categories.find(
          (x) => x.name === sub && x.parent_id === parent.id,
        );
        if (!category) {
          category = await call("save_category", {
            name: sub,
            parent_id: parent.id,
            sort_order: ci * 10 + 1,
            is_visible: true,
          });
          categories.push(category);
        }
      }
      await call("save_translation", {
        entity_type: "category",
        entity_id: parent.id,
        language: "en",
        fields: { name: englishCatalog[d.key].categories[name] },
      });
      if (sub)
        await call("save_translation", {
          entity_type: "category",
          entity_id: category.id,
          language: "en",
          fields: { name: englishCatalog[d.key].categories[sub] },
        });
      const imagePath = await upload("category-" + ci, artwork(d, name, ci));
      for (const row of items) {
        const value = productData(d, category.id, row, index);
        value.image_path = imagePath;
        const found = await db
          .from("products")
          .select("id")
          .eq("restaurant_id", id)
          .eq("sku", value.sku)
          .maybeSingle();
        if (found.error) throw Error(found.error.code);
        if (found.data) value.id = found.data.id;
        const product = await call("save_product", value);
        await call("save_translation", {
          entity_type: "product",
          entity_id: product.id,
          language: "en",
          fields: englishCatalog[d.key].products[index],
        });
        index++;
      }
      console.log(d.key + ": " + index + " products saved through owner API");
    }
    await call("save_appearance", {
      name: d.name,
      description: d.description,
      appearance: {
        primary: d.primary,
        secondary: d.secondary,
        font: d.font,
        logo_path: logo,
        cover_path: cover,
        favicon_path: logo,
      },
    });
    await call("publish_appearance", {});
    await call("save_hours", {
      hours: Array.from({ length: 7 }, (_, i) => ({
        day_of_week: i,
        opens_at: d.key === "bruma" ? "07:00" : "12:00",
        closes_at: d.key === "bruma" ? "20:00" : "22:00",
        is_closed: i === 1,
      })),
    });
    await call("save_languages", {
      default_language: "es",
      enabled_languages: ["es", "en"],
    });
    workspace = (await s.request("/api/workspace/" + id)).data;
    const promo = workspace.promotions.find((p) => p.title === d.promo);
    await call("save_promotion", {
      ...(promo ? { id: promo.id } : {}),
      title: d.promo,
      description: d.promoDescription,
      is_active: true,
    });
    await admin.request("/api/workspace/" + id, {
      method: "POST",
      data: {
        action: "save_qr",
        data: {
          foreground: d.primary,
          background: "#FFFFFF",
          frame: "rounded",
          label: d.name,
          include_logo: true,
        },
      },
    });
    const menu = (await s.request("/api/public/menu/" + d.slug)).data;
    if (menu.products.length !== 24 || menu.restaurant.id !== id)
      throw Error("Public catalogue count mismatch");
    const restaurant = (
      await db
        .from("restaurants")
        .select("public_token,status,is_demo")
        .eq("id", id)
        .single()
    ).data;
    const item = {
      key: d.key,
      name: d.name,
      id,
      owner: d.email,
      ownerRole: logged.role,
      status: restaurant.status,
      isDemo: restaurant.is_demo,
      products: menu.products.length,
      categories: menu.categories.length,
      publicToken: restaurant.public_token,
      localMenu: base + "/menu/" + d.slug,
      stableRoute: "/q/" + restaurant.public_token,
      createdVia: d.key === "aurora" ? "real browser UI" : "real API",
      logoPath: logo,
    };
    evidence.restaurants.push(item);
    writeFileSync(
      "artifacts/demo/restaurants.json",
      JSON.stringify(evidence, null, 2),
    );
    await s.logout();
    console.log(
      d.name + ": ready, 24 products, private storage and public menu verified",
    );
  }
} finally {
  await admin.logout();
  writeFileSync(
    "docs/evidence/demo-provisioning.json",
    JSON.stringify(evidence, null, 2),
  );
}
console.log(
  JSON.stringify({
    restaurants: evidence.restaurants.length,
    products: evidence.restaurants.reduce((sum, r) => sum + r.products, 0),
    credentialFile: ".runtime/demo-accounts.json",
    credentialsPrinted: false,
  }),
);
