import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { serviceRead, assertOwned } from "./closure-owner-integration.mjs";
import {
  root,
  projectRef,
  runId,
  targetConfig,
  auditBase,
  assertAppTarget,
  requireDemoMutations,
  evidencePath,
  artifactPath,
  relativePath,
} from "./audit-target.mjs";

// Explicitly task-owned alpha only. No route interception, provider execution or email.
const cfg = targetConfig(process.env, { service: true });
requireDemoMutations();
const base = auditBase();
if (base !== "http://localhost:3002") throw Error("LOCAL_3002_ONLY");
if (process.env.APPEARANCE_QA_ALLOW !== projectRef)
  throw Error("APPEARANCE_QA_NOT_ENABLED");
await assertAppTarget(base, { fresh: true });
const manifestFile = path.join(
  root,
  ".runtime/migrations",
  projectRef,
  "closure-test-accounts.json",
);
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const account = manifest.accounts?.alpha;
if (
  manifest.projectRef !== projectRef ||
  manifest.format !== "tolentino-closure-owned-v1" ||
  manifest.base !== base ||
  account?.stage !== "ready" ||
  !account?.restaurantId ||
  !account?.requestId ||
  !manifest.meta?.adminId ||
  !account.email?.endsWith(".test")
)
  throw Error("TASK_MANIFEST_INVALID");
const sdk = serviceRead(process.env);
async function ownership() {
  await assertOwned(sdk, manifest, account);
}
await ownership();
const endpoint = "/api/workspace/" + account.restaurantId;
const report = {
  projectRef,
  runId,
  base,
  startedAt: new Date().toISOString(),
  traffic: "Real browser and application APIs; no interception",
  businessScope: "Only task-owned temporary alpha",
  checks: [],
  cleanup: { status: "not_started" },
  physicalDevices: false,
  providerCalls: false,
};
const reportFile = evidencePath("appearance-live-audit.json");
const journalFile = path.join(
  root,
  ".runtime/migrations",
  projectRef,
  "appearance-" + runId + ".json",
);
const journal = {
  projectRef,
  runId,
  restaurantId: account.restaurantId,
  requestId: account.requestId,
  createdProducts: [],
  createdCategory: null,
  phase: "before_login",
};
const secretStrings = [
  account.email,
  account.password,
  cfg.serviceKey,
  cfg.publicKey,
].filter(Boolean);
function sanitize(value) {
  let s = String(value);
  for (const item of secretStrings) s = s.replaceAll(item, "[REDACTED]");
  return s
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED_TOKEN]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 1200);
}
const saveJournal = () =>
  writeFile(journalFile, JSON.stringify(journal, null, 2) + "\n", {
    mode: 0o600,
  });
const record = (name, detail = {}) => {
  report.checks.push({ name, status: "PASS", ...detail });
  console.log(JSON.stringify({ check: name, status: "PASS", ...detail }));
};
const check = expect.configure({ timeout: 30000 });
const browser = await chromium.launch({ channel: "chrome" });
const owner = await browser.newContext({
  viewport: { width: 1800, height: 1100 },
});
const anonymous = await browser.newContext({
  viewport: { width: 390, height: 820 },
});
const page = await owner.newPage();
const publicPage = await anonymous.newPage();
const normalizeAppearance = (value) =>
  Object.fromEntries(
    Object.entries({
      primary: "#264b3c",
      secondary: "#f5f1e8",
      font: "sans",
      logo_path: "",
      cover_path: "",
      favicon_path: "",
      background: "#fcfcf8",
      card: "#ffffff",
      text: "#253026",
      muted: "#596a4c",
      cover_overlay: "#132417",
      cover_overlay_opacity: 0.7,
      columns_mobile: 1,
      columns_desktop: 2,
      ...value,
    }).map(([key, v]) => [key, key.endsWith("_path") ? v || "" : v]),
  );
let baseline = null;
let changed = false;
async function read(context, url) {
  const response = await context.request.get(base + url);
  if (!response.ok()) throw Error("READ_HTTP_" + response.status());
  return response.json();
}
async function post(action, data) {
  const response = await owner.request.post(base + endpoint, {
    headers: { origin: base },
    data: { action, data },
  });
  if (!response.ok())
    throw Error(
      "MUTATION_" + action.toUpperCase() + "_HTTP_" + response.status(),
    );
  return (await response.json()).data;
}
async function appearanceTab(p) {
  await check(p.locator(".sidebar")).toBeVisible();
  await p
    .locator(".sidebar")
    .getByRole("button", { name: "Apariencia", exact: true })
    .click();
  await check(p.getByLabel("Nombre del restaurante")).toBeVisible();
}
async function guardedSnapshot() {
  const current = await read(owner, endpoint);
  if (
    current.restaurant.id !== account.restaurantId ||
    current.restaurant.is_demo !== true ||
    current.membership?.user_id !== account.userId
  )
    throw Error("TASK_RESTAURANT_GUARD_FAILED");
  return current;
}
async function clickAction(p, name, action, status = 200) {
  const response = p.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === endpoint &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === action,
  );
  await p.getByRole("button", { name, exact: true }).click();
  check((await response).status()).toBe(status);
}
try {
  const hydrated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/health" &&
      r.request().method() === "GET",
  );
  await page.goto(base + "/login");
  check((await hydrated).status()).toBe(200);
  await page
    .getByLabel("Correo o usuario de acceso", { exact: true })
    .fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  await page
    .getByRole("button", { name: "Entrar a mi espacio", exact: true })
    .click();
  await check(page).toHaveURL(/\/dashboard/);
  const session = await read(owner, "/api/session");
  check(session.role).toBe("owner");
  check(session.user.id).toBe(account.userId);
  check(session.restaurantId).toBe(account.restaurantId);
  record("real-owner-session-and-task-ownership");
  baseline = await guardedSnapshot();
  if (baseline.total !== 0 || baseline.categories.length !== 0)
    throw Error("FRESH_EMPTY_ALPHA_REQUIRED");
  journal.before = {
    restaurant: {
      name: baseline.restaurant.name,
      description: baseline.restaurant.description,
      slug: baseline.restaurant.slug,
      public_token: baseline.restaurant.public_token,
      default_language: baseline.restaurant.default_language,
    },
    settings: baseline.settings,
  };
  journal.phase = "seed_intent";
  journal.seedPrefix = "QA apariencia " + randomUUID().slice(0, 8);
  await saveJournal();
  changed = true;
  const category = await post("save_category", {
    name: journal.seedPrefix,
    sort_order: 0,
    is_visible: true,
  });
  journal.createdCategory = category.id;
  await saveJournal();
  for (let i = 0; i < 3; i++) {
    const p = await post("save_product", {
      category_id: category.id,
      name: journal.seedPrefix + " producto " + (i + 1),
      description: "Contenido temporal para verificar publicación.",
      price: 12000 + i * 1000,
      is_published: true,
      is_available: true,
      is_featured: i === 0,
      sort_order: i,
      extras: [{ name: "Extra temporal", price: 500 }],
      ingredients: "Texto de comprobación",
    });
    journal.createdProducts.push(p.id);
    await saveJournal();
  }
  await post("save_languages", {
    default_language: "es",
    enabled_languages: ["es", "en", "fr", "it", "zh", "ja", "hi"],
  });
  record("task-owned-seed-and-seven-languages", { products: 3 });
  await page.reload();
  await appearanceTab(page);
  const frame = page.frameLocator('iframe[title="Vista previa del menú"]');
  await check(frame.locator(".public-product")).toHaveCount(3);
  const draftName = ("QA Apariencia " + runId).slice(0, 90);
  await page.getByLabel("Nombre del restaurante").fill(draftName);
  await page
    .getByLabel("Descripción del restaurante")
    .fill("Descripción privada temporal de comprobación.");
  await page.getByLabel("Fondo del menú", { exact: true }).fill("#eef4ff");
  await page.getByLabel("Texto principal", { exact: true }).fill("#10282e");
  await page.getByLabel("Texto secundario", { exact: true }).fill("#52636f");
  await page.getByLabel("Tipografía", { exact: true }).selectOption("serif");
  await page
    .getByLabel("Productos por fila en móvil", { exact: true })
    .selectOption("2");
  await page
    .getByLabel("Productos por fila en escritorio", { exact: true })
    .selectOption("1");
  await check(frame.locator(".public-menu")).toHaveCSS(
    "background-color",
    "rgb(238, 244, 255)",
  );
  await clickAction(page, "Guardar borrador", "save_appearance");
  await check(
    page.getByText("Borrador guardado.", { exact: false }),
  ).toBeVisible();
  const privateState = await guardedSnapshot();
  const beforePublish = await read(
    anonymous,
    "/api/public/menu/" + account.slug,
  );
  check(privateState.settings.draft_name).toBe(draftName);
  check(beforePublish.restaurant.name).toBe(baseline.restaurant.name);
  check(beforePublish.settings.appearance).toEqual(
    baseline.settings.appearance,
  );
  check("draft_appearance" in beforePublish.settings).toBe(false);
  check("draft_name" in beforePublish.settings).toBe(false);
  record("draft-persists-and-remains-private");
  await page.reload();
  await appearanceTab(page);
  await check(page.getByLabel("Nombre del restaurante")).toHaveValue(draftName);
  await check(page.getByLabel("Fondo del menú", { exact: true })).toHaveValue(
    "#eef4ff",
  );
  record("draft-reopened-after-real-reload");
  const stale = await owner.newPage();
  await stale.goto(base + "/dashboard");
  await appearanceTab(stale);
  await clickAction(page, "Publicar cambios", "publish_appearance");
  await check(
    page.getByText("Publicación confirmada.", { exact: false }),
  ).toBeVisible();
  await publicPage.goto(base + "/menu/" + account.slug);
  await check(
    publicPage.getByRole("heading", { name: draftName, exact: true }),
  ).toBeVisible();
  await check(publicPage.locator(".public-product")).toHaveCount(3);
  await check(publicPage.locator(".public-menu")).toHaveCSS(
    "background-color",
    "rgb(238, 244, 255)",
  );
  await check(publicPage.locator(".public-product h3").first()).toHaveCSS(
    "font-family",
    "Georgia, serif",
  );
  const published = await read(anonymous, "/api/public/menu/" + account.slug);
  check(published.restaurant.menu_version).toBeGreaterThan(
    beforePublish.restaurant.menu_version,
  );
  check(published.settings.appearance.columns_mobile).toBe(2);
  check(published.settings.appearance.columns_desktop).toBe(1);
  record("published-version-visible-to-anonymous-browser");
  await stale
    .getByLabel("Nombre del restaurante")
    .fill("Conflicto temporal no publicado");
  const conflictStarted = performance.now();
  await clickAction(stale, "Publicar cambios", "publish_appearance", 409);
  const conflictElapsedMs = Math.round(performance.now() - conflictStarted);
  check(
    conflictElapsedMs,
    "A warmed conflict must terminate promptly",
  ).toBeLessThan(10000);
  await check(stale.getByLabel("Nombre del restaurante")).toHaveValue(
    "Conflicto temporal no publicado",
  );
  await check(
    stale.getByText("No se confirmó el guardado.", { exact: false }),
  ).toBeVisible();
  check(
    (await read(anonymous, "/api/public/menu/" + account.slug)).restaurant.name,
  ).toBe(draftName);
  record("second-editor-conflict-retains-local-input-and-published-version", {
    conflictElapsedMs,
    maximumElapsedMs: 10000,
  });
  await stale.close();
  await check(publicPage.locator(".language-flag")).toHaveCount(7);
  for (const flag of await publicPage.locator(".language-flag img").all())
    check(await flag.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(
      true,
    );
  for (const label of [
    "Español",
    "English",
    "Français",
    "Italiano",
    "中文",
    "日本語",
    "हिन्दी",
  ]) {
    await publicPage
      .getByRole("button", { name: label, exact: true })
      .press("Enter");
    await check(publicPage.locator(".public-product")).toHaveCount(3);
  }
  await publicPage
    .getByRole("button", { name: "Español", exact: true })
    .click();
  record("seven-real-local-flags-and-language-controls");
  const styles = (e) => {
    const doc = e.ownerDocument,
      w = doc.defaultView;
    const targets = [
      ".public-menu",
      ".public-product-grid",
      ".public-product",
      ".public-product h3",
      ".public-product-bottom strong",
    ];
    return {
      mode: doc.compatMode,
      width: w.innerWidth,
      pageWidth: doc.documentElement.scrollWidth,
      elements: targets.map((selector) => {
        const el = doc.querySelector(selector),
          s = w.getComputedStyle(el),
          r = el.getBoundingClientRect();
        return {
          selector,
          color: s.color,
          background: s.backgroundColor,
          font: s.fontFamily,
          columns: s.gridTemplateColumns,
          width: Math.round(r.width),
          height: Math.round(r.height),
          top: Math.round(r.top + w.scrollY),
        };
      }),
    };
  };
  for (const width of [320, 390, 768, 1440]) {
    await page.getByLabel("Ancho de vista previa").selectOption(String(width));
    await publicPage.setViewportSize({ width, height: 820 });
    const a = await frame.locator(".public-menu").evaluate(styles),
      b = await publicPage.locator(".public-menu").evaluate(styles);
    check(a).toEqual(b);
    check(a.pageWidth).toBe(width);
    const columns = await publicPage
      .locator(".public-product-grid")
      .first()
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
    check(columns).toBe(width < 700 ? 2 : 1);
    await check(publicPage.locator(".creator-contact")).toContainText(
      "Tolentino Chef",
    );
    const publicFile = artifactPath(
        "screenshots",
        "appearance-real-" + width + "-public.png",
      ),
      previewFile = artifactPath(
        "screenshots",
        "appearance-real-" + width + "-preview.png",
      );
    await publicPage.screenshot({ path: publicFile, fullPage: true });
    await page
      .locator('iframe[title="Vista previa del menú"]')
      .screenshot({ path: previewFile });
    record("real-preview-public-parity-" + width, {
      publicScreenshot: relativePath(publicFile),
      previewScreenshot: relativePath(previewFile),
    });
  }
  check((await guardedSnapshot()).restaurant.public_token).toBe(
    baseline.restaurant.public_token,
  );
  record("permanent-token-and-slug-unchanged");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = sanitize(error.message);
} finally {
  if (changed && baseline) {
    try {
      await ownership();
      let latest = await guardedSnapshot();
      journal.phase = "cleanup";
      await saveJournal();
      for (const id of journal.createdProducts)
        if (latest.products.some((p) => p.id === id))
          await post("delete_product", { id });
      if (
        journal.createdCategory &&
        latest.categories.some((c) => c.id === journal.createdCategory)
      )
        await post("delete_category", { id: journal.createdCategory });
      await post("save_languages", {
        default_language: baseline.restaurant.default_language,
        enabled_languages: baseline.settings.enabled_languages,
      });
      latest = await guardedSnapshot();
      await post("publish_appearance", {
        appearance: normalizeAppearance(baseline.settings.appearance),
        name: baseline.restaurant.name,
        description: baseline.restaurant.description || "",
        expectedRevision: latest.settings.appearance_revision,
      });
      latest = await guardedSnapshot();
      await post("save_appearance", {
        appearance: normalizeAppearance({
          ...baseline.settings.appearance,
          ...baseline.settings.draft_appearance,
        }),
        name: baseline.settings.draft_name ?? baseline.restaurant.name,
        description:
          baseline.settings.draft_description ??
          baseline.restaurant.description ??
          "",
        expectedRevision: latest.settings.appearance_revision,
      });
      latest = await guardedSnapshot();
      const restored = await read(
        anonymous,
        "/api/public/menu/" + account.slug,
      );
      check(normalizeAppearance(restored.settings.appearance)).toEqual(
        normalizeAppearance(baseline.settings.appearance),
      );
      check(restored.restaurant.description).toBe(
        baseline.restaurant.description,
      );
      check(latest.total).toBe(0);
      check(latest.categories.length).toBe(0);
      check(latest.restaurant.name).toBe(baseline.restaurant.name);
      check(latest.restaurant.slug).toBe(baseline.restaurant.slug);
      check(latest.restaurant.public_token).toBe(
        baseline.restaurant.public_token,
      );
      journal.phase = "content_restored";
      await saveJournal();
      report.cleanup = {
        status: "PASS",
        productsDeleted: journal.createdProducts.length,
        categoryDeleted: Boolean(journal.createdCategory),
        contentRestored: true,
        revisionCountersIncreaseNormally: true,
        draftNullsMayBeNormalized: true,
        appearanceDefaultsNormalized: true,
        containerDeletion:
          "Parent/database owns final deletion of task-owned alpha and Auth",
      };
    } catch (error) {
      report.cleanup = { status: "FAIL", detail: sanitize(error.message) };
      report.status = "FAIL";
    }
  }
  try {
    await owner.request.post(base + "/api/auth", {
      headers: { origin: base },
      data: { action: "logout" },
    });
  } catch {
    /* Browser is closed below; failure is not evidence of remote revocation. */
  }
  await owner.close();
  await anonymous.close();
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.length;
  await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      status: report.status,
      passed: report.passed,
      cleanup: report.cleanup.status,
      report: relativePath(reportFile),
    }),
  );
  if (report.status !== "PASS") process.exitCode = 1;
}
