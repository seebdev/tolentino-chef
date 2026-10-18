import {
  loadTargetDemos,
  loadTargetAdmin,
  requireDemoMutations,
  evidencePath as targetEvidencePath,
  artifactPath,
  projectRef,
  runId,
} from "./audit-target.mjs";
// Supplemental live QA. Runs only on the three manifested DEMOs and restores every mutation.
// Credentials are loaded from the ignored account file / process environment and never reported.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { Session, base } from "./live-client.mjs";
import { demos } from "./demo-catalog.mjs";

const { manifest, accounts } = loadTargetDemos();
requireDemoMutations();
const adminAccount = loadTargetAdmin();
assert.equal(manifest.restaurants.length, 3);
assert.ok(
  adminAccount.email && adminAccount.password,
  "Admin environment credentials are required; do not print them.",
);
artifactPath("screenshots");

const evidence = {
  startedAt: new Date().toISOString(),
  projectRef,
  runId,
  base,
  database: "Supabase real",
  scope: "Restorable live checks on manifested DEMOs only",
  credentialsPrinted: false,
  externalEmailSent: false,
  externalLinksOpened: false,
  checks: [],
  cleanupErrors: [],
};
const evidencePath = targetEvidencePath("live-gap-audit.json");
const snapshots = { platform: null, restaurants: [] };
const ownerSessions = [];
const admin = new Session();
let browser;
async function check(id, name, run) {
  try {
    const detail = await run();
    evidence.checks.push({ id, name, pass: true, detail: detail ?? null });
    console.log("PASS " + id + " " + name);
  } catch (error) {
    evidence.checks.push({ id, name, pass: false, error: error.message });
    console.log("FAIL " + id + " " + name + ": " + error.message);
  }
}
async function restore(label, run) {
  try {
    await run();
  } catch (error) {
    evidence.cleanupErrors.push({ label, error: error.message });
    console.log("RESTORE FAILED " + label);
  }
}
const workspace = async (s, id) =>
  (await s.request("/api/workspace/" + id)).data;
const save = async (s, id, action, data) =>
  (
    await s.request("/api/workspace/" + id, {
      method: "POST",
      data: { action, data },
    })
  ).data.data;
const adminAction = async (action, data, restaurantId) =>
  admin.request("/api/admin/restaurants", {
    method: "POST",
    data: { action, data, ...(restaurantId ? { restaurantId } : {}) },
  });
const menu = async (slug, expected) =>
  (await admin.request("/api/public/menu/" + slug, { expected })).data;
const productFields = [
  "id",
  "category_id",
  "name",
  "description",
  "price",
  "image_path",
  "tags",
  "ingredients",
  "variants",
  "extras",
  "is_published",
  "is_available",
  "is_featured",
  "sort_order",
  "sku",
];
const categoryFields = ["id", "parent_id", "name", "sort_order", "is_visible"];
const pick = (value, fields) =>
  Object.fromEntries(fields.map((field) => [field, value[field]]));
const snapshotSave = () =>
  writeFileSync(
    ".runtime/gap-audit-restore.json",
    JSON.stringify(snapshots, null, 2),
    { mode: 0o600 },
  );

try {
  const logged = await admin.login(adminAccount.email, adminAccount.password);
  assert.equal(logged.role, "superadmin");
  const listing = (await admin.request("/api/admin/restaurants")).data;
  // Global contact changes are permitted only while the entire platform contains these DEMOs.
  assert.equal(listing.total, 3, "Refusing global QA with additional tenants");
  assert.equal(listing.restaurants.length, 3);
  assert.deepEqual(
    listing.restaurants.map((r) => r.id).sort(),
    manifest.restaurants.map((r) => r.id).sort(),
  );
  for (const item of manifest.restaurants) {
    const demo = demos.find((d) => d.key === item.key);
    const account = accounts[item.key];
    assert.ok(demo && account);
    assert.equal(item.isDemo, true);
    assert.equal(account.restaurantId, item.id);
    assert.equal(account.email, demo.email);
    assert.match(demo.email, /@[^@]+\.test$/);
    const listed = listing.restaurants.find((r) => r.id === item.id);
    assert.equal(listed.is_demo, true);
    const s = new Session();
    ownerSessions.push(s);
    await s.login(account.email, account.password);
    const auth = (await s.request("/api/session")).data;
    assert.equal(auth.role, "owner");
    assert.equal(auth.restaurantId, item.id);
    const initial = await workspace(s, item.id);
    assert.equal(initial.restaurant.is_demo, true);
    assert.equal(initial.restaurant.owner_email, demo.email);
    assert.equal(initial.restaurant.status, "active");
    assert.equal(initial.restaurant.slug, demo.slug);
    assert.equal(initial.total, 24);
    assert.equal(initial.products.length, 24);
    assert.equal(initial.categories.length, 8);
    s.plan = { item, demo, initial };
    snapshots.restaurants.push({
      id: item.id,
      slug: demo.slug,
      status: initial.restaurant.status,
      products: initial.products.map((p) => pick(p, productFields)),
      categories: initial.categories.map((c) => pick(c, categoryFields)),
    });
  }
  snapshots.platform = pick(listing.platform, [
    "contact_label",
    "contact_url",
    "suspension_message",
  ]);
  snapshotSave();

  for (const s of ownerSessions) {
    const { item, demo, initial } = s.plan;
    const original = initial.products.find(
      (p) => p.sku === "DEMO-" + demo.key.toUpperCase() + "-01",
    );
    assert.ok(original);
    await check(
      "F027",
      demo.key +
        " duplicate is draft, has no SKU, preserves options and original",
      async () => {
        let copyId;
        try {
          const copy = await save(s, item.id, "duplicate_product", {
            id: original.id,
          });
          copyId = copy.id;
          assert.notEqual(copyId, original.id);
          assert.equal(copy.name, original.name + " (copia)");
          assert.equal(copy.sku, null);
          assert.equal(copy.is_published, false);
          for (const field of productFields.filter(
            (f) => !["id", "name", "sku", "is_published"].includes(f),
          ))
            assert.deepEqual(copy[field], original[field]);
          const after = await workspace(s, item.id);
          assert.equal(after.total, 25);
          assert.deepEqual(
            after.products.find((p) => p.id === original.id),
            original,
          );
          assert.ok(
            !(await menu(demo.slug)).products.some((p) => p.id === copyId),
          );
        } finally {
          // Resolve an uncertain creation response using only the exact new draft copy identity.
          const current = await workspace(s, item.id);
          const originalIds = new Set(initial.products.map((p) => p.id));
          const copies = current.products.filter(
            (p) =>
              p.id === copyId ||
              (!originalIds.has(p.id) &&
                p.name === original.name + " (copia)" &&
                p.category_id === original.category_id &&
                p.sku === null &&
                p.is_published === false),
          );
          for (const copy of copies)
            await save(s, item.id, "delete_product", { id: copy.id });
        }
        return {
          copiedOptions: true,
          originalIntact: true,
          temporaryCopyDeleted: true,
        };
      },
    );
    await check(
      "F032",
      demo.key + " product order persists and changes public order",
      async () => {
        try {
          await save(s, item.id, "save_product", {
            ...pick(original, productFields),
            sort_order: 100000,
          });
          const after = await workspace(s, item.id);
          assert.equal(after.products.at(-1).id, original.id);
          assert.equal(after.products.at(-1).sort_order, 100000);
          const publicMenu = await menu(demo.slug);
          assert.equal(publicMenu.products.at(-1).id, original.id);
        } finally {
          await save(s, item.id, "save_product", pick(original, productFields));
        }
        return { publicOrderChanged: true, restored: true };
      },
    );
    const parent = initial.categories.find(
      (c) => !c.parent_id && c.sort_order === 0,
    );
    assert.ok(parent);
    await check(
      "F032-category",
      demo.key +
        " parent category order persists without changing subcategory relations",
      async () => {
        try {
          await save(s, item.id, "save_category", {
            ...pick(parent, categoryFields),
            sort_order: 100000,
          });
          const after = await workspace(s, item.id);
          assert.equal(
            after.categories.filter((c) => !c.parent_id).at(-1).id,
            parent.id,
          );
          const publicMenu = await menu(demo.slug);
          assert.equal(
            publicMenu.categories.filter((c) => !c.parent_id).at(-1).id,
            parent.id,
          );
          for (const child of initial.categories.filter(
            (c) => c.parent_id === parent.id,
          ))
            assert.equal(
              after.categories.find((c) => c.id === child.id).parent_id,
              parent.id,
            );
        } finally {
          await save(s, item.id, "save_category", pick(parent, categoryFields));
        }
        return {
          parentOrderChanged: true,
          hierarchyPreserved: true,
          restored: true,
        };
      },
    );
    await check(
      "RESTORE-owner",
      demo.key + " final catalogue and order equal the original snapshot",
      async () => {
        const final = await workspace(s, item.id);
        assert.equal(final.total, 24);
        assert.deepEqual(
          final.products.map((p) => pick(p, productFields)),
          initial.products.map((p) => pick(p, productFields)),
        );
        assert.deepEqual(
          final.categories.map((c) => pick(c, categoryFields)),
          initial.categories.map((c) => pick(c, categoryFields)),
        );
        assert.equal((await menu(demo.slug)).products.length, 24);
      },
    );
  }

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies(
    [...admin.jar].map(([name, value]) => ({
      name,
      value,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  const first = ownerSessions[0].plan;
  const beforeIdentity = (await admin.request("/api/session")).data;
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await check(
      "F013",
      name +
        " leaves support for administration without changing authenticated identity",
      async () => {
        await page.setViewportSize({ width, height });
        await page.goto(base + "/admin/restaurants/" + first.item.id);
        await expect(page.locator(".support-banner")).toContainText(
          first.demo.name,
        );
        const during = await page.evaluate(async () =>
          (await fetch("/api/session")).json(),
        );
        assert.equal(during.role, "superadmin");
        assert.equal(during.user.id, beforeIdentity.user.id);
        await page.getByRole("link", { name: "Volver a restaurantes" }).click();
        await page.waitForURL(base + "/admin");
        await expect(page.locator(".support-banner")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Nuevo restaurante", exact: true }),
        ).toBeVisible();
        const after = await page.evaluate(async () =>
          (await fetch("/api/session")).json(),
        );
        assert.equal(after.role, "superadmin");
        assert.equal(after.user.id, beforeIdentity.user.id);
        assert.equal(after.restaurantId, beforeIdentity.restaurantId);
        await expect(page.locator("tbody tr")).toHaveCount(3);
        for (const restaurant of listing.restaurants)
          await expect(page.locator(".table-identity strong").filter({ hasText: restaurant.name })).toBeVisible();
        await expect(page.locator(".loading")).toHaveCount(0);
        await page.screenshot({
          path: artifactPath(
            "screenshots",
            "real-support-exit-" + name + ".png",
          ),
          fullPage: true,
          mask: [page.getByText(adminAccount.email, { exact: true })],
        });
        return {
          identityUnchanged: true,
          role: "superadmin",
          supportBannerRemoved: true,
        };
      },
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const publicPage = await publicContext.newPage();
  const temp = {
    contact_label: "Contacto DEMO QA temporal",
    contact_url: "https://example.test/tolentino-qa",
    suspension_message:
      "DEMO QA: menú en pausa temporal para comprobar el mensaje.",
  };
  try {
    await check(
      "F014",
      "platform contact and suspension message save through the real admin form",
      async () => {
        const initialLoad = page.waitForResponse(
          (r) =>
            r.url().includes("/api/admin/restaurants") &&
            r.request().method() === "GET" &&
            r.status() === 200,
        );
        await page.goto(base + "/admin");
        await initialLoad;
        await page
          .locator(".sidebar")
          .getByRole("button", { name: "Configuración", exact: true })
          .click();
        await page
          .getByLabel("Texto del enlace", { exact: true })
          .fill(temp.contact_label);
        await page
          .getByLabel("Destino del contacto", { exact: true })
          .fill(temp.contact_url);
        await page
          .getByLabel("Mensaje para restaurantes suspendidos", { exact: true })
          .fill(temp.suspension_message);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/admin/restaurants") &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "Guardar configuración", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        const saved = (await admin.request("/api/admin/restaurants")).data
          .platform;
        assert.deepEqual(pick(saved, Object.keys(temp)), temp);
        const reloaded = page.waitForResponse(
          (r) =>
            r.url().includes("/api/admin/restaurants") &&
            r.request().method() === "GET" &&
            r.status() === 200,
        );
        await page.reload();
        await reloaded;
        await page
          .locator(".sidebar")
          .getByRole("button", { name: "Configuración", exact: true })
          .click();
        await expect(
          page.getByLabel("Texto del enlace", { exact: true }),
        ).toHaveValue(temp.contact_label);
        await expect(
          page.getByLabel("Destino del contacto", { exact: true }),
        ).toHaveValue(temp.contact_url);
        await expect(
          page.getByLabel("Mensaje para restaurantes suspendidos", {
            exact: true,
          }),
        ).toHaveValue(temp.suspension_message);
      },
    );
    await check(
      "F068",
      "configured commercial contact is projected and rendered in all three public footers",
      async () => {
        for (const s of ownerSessions) {
          const { demo } = s.plan;
          assert.deepEqual((await menu(demo.slug)).contact, {
            label: temp.contact_label,
            url: temp.contact_url,
          });
          await publicPage.goto(base + "/menu/" + demo.slug);
          const link = publicPage
            .locator(".public-footer")
            .getByRole("link", { name: temp.contact_label, exact: true });
          await expect(link).toHaveAttribute("href", temp.contact_url);
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", /noopener/);
        }
        return { menus: 3, externalNavigationPerformed: false };
      },
    );
    await check(
      "F014-message",
      "temporary suspension uses the saved platform message in public API and UI",
      async () => {
        try {
          await adminAction("status", { status: "suspended" }, first.item.id);
          const unavailable = await menu(first.demo.slug, [410]);
          assert.equal(unavailable.suspended, true);
          assert.equal(unavailable.message, temp.suspension_message);
          assert.ok(!("products" in unavailable));
          await publicPage.goto(base + "/menu/" + first.demo.slug);
          await expect(
            publicPage.getByText(temp.suspension_message, { exact: true }),
          ).toBeVisible();
          await expect(publicPage.locator(".public-product")).toHaveCount(0);
          await publicPage.screenshot({
            path: artifactPath(
              "screenshots",
              "real-platform-suspension-message.png",
            ),
            fullPage: true,
          });
        } finally {
          await adminAction(
            "status",
            { status: first.initial.restaurant.status },
            first.item.id,
          );
        }
      },
    );
    await check(
      "F068-clear",
      "clearing the commercial URL hides the public footer link",
      async () => {
        await page.getByLabel("Destino del contacto", { exact: true }).fill("");
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/admin/restaurants") &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "Guardar configuración", exact: true })
          .click();
        assert.equal((await response).status(), 200);
        for (const s of ownerSessions)
          assert.equal((await menu(s.plan.demo.slug)).contact, null);
        await publicPage.goto(base + "/menu/" + first.demo.slug);
        await expect(publicPage.locator(".public-footer")).toBeVisible();
        await expect(publicPage.locator(".public-footer a")).toHaveCount(0);
      },
    );
  } finally {
    await restore("platform and first demo status", async () => {
      await adminAction("platform", snapshots.platform);
      await adminAction(
        "status",
        { status: first.initial.restaurant.status },
        first.item.id,
      );
    });
  }
  await check(
    "RESTORE-admin",
    "platform contact, message, all statuses and public menus match original configuration",
    async () => {
      const final = (await admin.request("/api/admin/restaurants")).data;
      assert.deepEqual(
        pick(final.platform, Object.keys(snapshots.platform)),
        snapshots.platform,
      );
      for (const s of ownerSessions) {
        const current = await workspace(s, s.plan.item.id);
        assert.equal(
          current.restaurant.status,
          s.plan.initial.restaurant.status,
        );
        assert.equal(current.total, 24);
        const publicMenu = await menu(s.plan.demo.slug);
        assert.equal(publicMenu.products.length, 24);
        const expected = snapshots.platform.contact_url
          ? {
              url: snapshots.platform.contact_url,
              label: snapshots.platform.contact_label,
            }
          : null;
        assert.deepEqual(publicMenu.contact, expected);
      }
    },
  );
} finally {
  // Keep authenticated cleanup independent of browser closure.
  for (const s of ownerSessions)
    await restore("owner session logout", () => s.logout());
  await restore("admin session logout", () => admin.logout());
  if (browser) await browser.close();
  evidence.completedAt = new Date().toISOString();
  evidence.passed = evidence.checks.filter((c) => c.pass).length;
  evidence.failed =
    evidence.checks.filter((c) => !c.pass).length +
    evidence.cleanupErrors.length;
  evidence.restoreSnapshot =
    ".runtime/gap-audit-restore.json (ignored, no credentials)";
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
}
console.log(
  JSON.stringify({
    passed: evidence.passed,
    failed: evidence.failed,
    evidence: evidencePath,
  }),
);
if (evidence.failed) process.exitCode = 1;
