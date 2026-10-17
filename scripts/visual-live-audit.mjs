import {
  loadTargetDemos,
  auditBase,
  assertAppTarget,
  evidencePath,
  artifactPath,
  relativePath,
  projectRef,
  runId,
} from "./audit-target.mjs";
import { chromium, webkit, expect } from "@playwright/test";
import { writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import jsQR from "jsqr";
import { PNG } from "pngjs";

// Real browser traffic only. This script never intercepts or fulfills API routes.
// Demo credentials are read in memory and never persisted in evidence or console.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = expect.configure({ timeout: 30000 });
const { manifest, accounts } = loadTargetDemos();
const secretStrings = Object.values(accounts)
  .flatMap((account) => [account.email, account.password])
  .filter(Boolean);
const sanitize = (value) => {
  let text = String(value).replaceAll(root, "[PROJECT_ROOT]");
  for (const secret of secretStrings)
    text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_TOKEN]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 1800);
};
const base = auditBase();
await assertAppTarget(base, { fresh: true });
const originType = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(base).hostname,
)
  ? "local"
  : "public";
const toPath = (value) => {
  try {
    const url = new URL(value, base);
    return sanitize(url.origin + url.pathname);
  } catch {
    return "[invalid URL]";
  }
};
const digest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const devices = [
  {
    key: "mobile",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  {
    key: "tablet",
    viewport: { width: 768, height: 1024 },
    isMobile: false,
    hasTouch: true,
  },
  {
    key: "desktop",
    viewport: { width: 1440, height: 1000 },
    isMobile: false,
    hasTouch: false,
  },
];
const chosenKeys = (process.env.LIVE_AUDIT_KEYS || "")
  .split(",")
  .filter(Boolean);
const restaurants = manifest.restaurants.filter(
  (restaurant) => !chosenKeys.length || chosenKeys.includes(restaurant.key),
);
const selectedBrowsers = (
  process.env.LIVE_AUDIT_BROWSERS || "chrome,msedge"
).split(",");
const phase = process.env.LIVE_AUDIT_PHASE || "all";
const evidence = {
  startedAt: new Date().toISOString(),
  projectRef,
  runId,
  phase,
  base,
  applicationScope: originType,
  serverMode: process.env.LIVE_AUDIT_SERVER_MODE || "development",
  traffic:
    "Real Next.js application, Supabase Auth and persisted data. No API mocks or route interception.",
  mutations:
    "Only login/logout sessions, rate-limit/visit counters and local browser favorites; no menu edits, emails, reset or domain changes.",
  physicalDevices: false,
  physicalQrScanning: false,
  browsers: [],
  publicMenus: [],
  owners: [],
  results: [],
};
artifactPath("screenshots");
const reportName =
  process.env.LIVE_AUDIT_REPORT ||
  (phase === "screenshots"
    ? "live-browser-screenshots.json"
    : "live-browser-audit.json");
if (!/^[a-z0-9.-]+\.json$/.test(reportName))
  throw new Error("INVALID_AUDIT_REPORT_FILENAME");
const reportFile = evidencePath(reportName);
async function persist() {
  evidence.updatedAt = new Date().toISOString();
  evidence.counts = {
    passed: evidence.results.filter((item) => item.status === "PASS").length,
    failed: evidence.results.filter((item) => item.status === "FAIL").length,
  };
  await writeFile(reportFile, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}
function record(scope, name, status, detail) {
  evidence.results.push({
    scope,
    name,
    status,
    ...(detail ? { detail: sanitize(detail) } : {}),
  });
}
function monitor(page) {
  const errors = {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    httpErrors: [],
  };
  page.on("pageerror", (error) =>
    errors.pageErrors.push(sanitize(error.message)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = toPath(message.location().url);
      errors.consoleErrors.push({
        message: sanitize(message.text()),
        location,
        expected:
          (location.endsWith("/api/session") &&
            message.text().includes("401")) ||
          location.endsWith("/favicon.ico"),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown";
    errors.failedRequests.push({
      url: toPath(request.url()),
      method: request.method(),
      failure: sanitize(failure),
      expectedNavigationAbort: failure === "net::ERR_ABORTED",
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    errors.httpErrors.push({
      url: toPath(response.url()),
      status: response.status(),
      expected:
        (pathname === "/api/session" && response.status() === 401) ||
        pathname === "/favicon.ico",
    });
  });
  return errors;
}
async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  check(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  check(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  return dimensions;
}
async function loadImages(page) {
  for (const image of await page.locator(".public-menu img").all()) {
    await image.scrollIntoViewIfNeeded();
  }
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".public-menu img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    undefined,
    { timeout: 45000 },
  );
  const images = await page.locator(".public-menu img").evaluateAll((items) =>
    items.map((image) => ({
      path: new URL(image.currentSrc || image.src).pathname,
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  );
  await page.evaluate(() => {
    for (const container of document.querySelectorAll(
      ".featured-grid,.public-categories",
    ))
      container.scrollLeft = 0;
    window.scrollTo(0, 0);
  });
  return images;
}
async function readDownload(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("DOWNLOAD_STREAM_MISSING");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function contentSnapshot(data) {
  return digest({
    restaurant: [
      data.restaurant.id,
      data.restaurant.name,
      data.restaurant.slug,
      data.restaurant.public_token,
    ],
    settings: data.settings,
    products: [...data.products].sort((a, b) => a.id.localeCompare(b.id)),
    categories: [...data.categories].sort((a, b) => a.id.localeCompare(b.id)),
    promotions: [...data.promotions].sort((a, b) => a.id.localeCompare(b.id)),
    hours: data.hours,
    translations: data.translations,
    total: data.total,
  });
}
async function publicInteractions(page, data, restaurant, device, scope) {
  const details = {};
  const search = page.getByRole("searchbox");
  await search.fill(data.products[0].name);
  await check(page.locator(".public-product")).not.toHaveCount(24);
  await check(
    page.locator(".public-product").getByRole("heading", {
      name: data.products[0].name,
      exact: true,
    }),
  ).toBeVisible();
  details.searchResultCount = await page.locator(".public-product").count();
  await search.fill("");
  await check(page.locator(".public-product")).toHaveCount(24);
  record(
    scope,
    "Real product search narrows results and clearing restores the menu",
    "PASS",
  );

  const child = data.categories.find((category) => category.parent_id);
  check(Boolean(child)).toBe(true);
  const parent = data.categories.find(
    (category) => category.id === child.parent_id,
  );
  const navigation = page.locator(".public-categories");
  await navigation
    .getByRole("button", { name: parent.name, exact: true })
    .click();
  const family = data.categories
    .filter(
      (category) =>
        category.id === parent.id || category.parent_id === parent.id,
    )
    .map((category) => category.id);
  const familyCount = data.products.filter((product) =>
    family.includes(product.category_id),
  ).length;
  await check(page.locator(".public-product")).toHaveCount(familyCount);
  await navigation
    .getByRole("button", { name: child.name, exact: true })
    .click();
  const childCount = data.products.filter(
    (product) => product.category_id === child.id,
  ).length;
  await check(page.locator(".public-product")).toHaveCount(childCount);
  details.categoryFilters = {
    parentIncludesChildren: familyCount,
    subcategoryOnly: childCount,
  };
  await navigation
    .getByRole("button", { name: "Todo el menú", exact: true })
    .click();
  await check(page.locator(".public-product")).toHaveCount(24);
  record(
    scope,
    "Parent category includes its children; subcategory filter selects its own products",
    "PASS",
  );

  await page
    .locator(".public-product")
    .first()
    .getByRole("button", { name: "Guardar favorito", exact: true })
    .click();
  await check(page.locator(".favorite-nav b")).toHaveText("1");
  await page.locator(".favorite-nav").click();
  await check(page.locator(".public-product")).toHaveCount(1);
  const storedFavorite = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("tolentino:favorites:" + id) || "[]"),
    restaurant.id,
  );
  check(storedFavorite).toHaveLength(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await check(page.locator(".favorite-nav b")).toHaveText("1");
  if (device.key === "desktop") {
    const other = manifest.restaurants.find(
      (entry) => entry.id !== restaurant.id,
    );
    await page.goto(new URL(other.localMenu).pathname, {
      waitUntil: "domcontentloaded",
    });
    await check(page.locator(".menu-hero h1")).toHaveText(other.name);
    await check(page.locator(".favorite-nav b")).toHaveCount(0);
    await page.locator(".favorite-nav").click();
    await check(page.locator(".public-product")).toHaveCount(0);
    await page.goto(new URL(restaurant.localMenu).pathname, {
      waitUntil: "domcontentloaded",
    });
    await check(page.locator(".favorite-nav b")).toHaveText("1");
    details.favoriteTenantIsolation = {
      other: other.key,
      noFavoriteLeak: true,
      sourceFavoritePreserved: true,
    };
    record(
      scope,
      "Favorite from this tenant is absent in another real menu and remains when returning",
      "PASS",
    );
  }
  details.favoritePersistsOnReload = true;
  record(
    scope,
    "Favorite filtering and reload persistence use browser storage only",
    "PASS",
  );

  await page.locator(".public-hours").click();
  const hours = page.getByRole("dialog");
  await check(hours).toBeVisible();
  await check(hours.locator(".details-list > div")).toHaveCount(
    data.hours.length,
  );
  for (const day of data.hours) {
    const expected = day.is_closed
      ? "Cerrado"
      : day.opens_at.slice(0, 5) + " – " + day.closes_at.slice(0, 5);
    await check(hours).toContainText(expected);
  }
  await page.keyboard.press("Escape");
  await check(hours).toHaveCount(0);
  details.hoursRows = data.hours.length;
  record(
    scope,
    "Opening-hours dialog shows persisted hours and closes with Escape",
    "PASS",
  );

  if (data.contact?.url) {
    const link = page.locator(".public-footer > a");
    await check(link).toHaveAttribute("href", data.contact.url);
    await check(link).toHaveAttribute("target", "_blank");
    await check(link).toHaveAttribute("rel", /noopener/);
    details.footerContact = {
      status: "PASS",
      url: toPath(data.contact.url),
      followed: false,
    };
    record(
      scope,
      "Configured footer contact link uses correct target and safe rel",
      "PASS",
    );
  } else {
    await check(page.locator(".public-footer > a")).toHaveCount(0);
    details.footerContact = {
      status: "NOT APPLICABLE",
      reason: "No platform contact URL is configured.",
    };
  }

  details.accessibility = await page.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0;
    const unlabeledInputs = [
      ...document.querySelectorAll("input:not([type=hidden]),select,textarea"),
    ]
      .filter(visible)
      .filter(
        (element) =>
          !element.labels?.length &&
          !element.getAttribute("aria-label") &&
          !element.getAttribute("aria-labelledby"),
      )
      .map((element) => ({ tag: element.tagName, type: element.type }));
    const imagesWithoutAlt = [...document.querySelectorAll("img")].filter(
      (element) => !element.hasAttribute("alt"),
    ).length;
    const parse = (color) => color.match(/[\d.]+/g)?.map(Number) || [];
    const luminance = (rgb) =>
      rgb
        .slice(0, 3)
        .map((value) => value / 255)
        .map((value) =>
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const contrast = [];
    for (const selector of [
      ".public-product-main h3",
      ".public-product-main p",
      ".public-product-bottom > strong",
      ".public-categories > button.active",
      ".public-categories > button:not(.active)",
    ]) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element);
      let backgroundElement = element;
      let background = "rgb(255, 255, 255)";
      while (backgroundElement) {
        const candidate = getComputedStyle(backgroundElement).backgroundColor;
        const channels = parse(candidate);
        if (channels.length === 3 || channels[3] === 1) {
          background = candidate;
          break;
        }
        backgroundElement = backgroundElement.parentElement;
      }
      const foregroundLum = luminance(parse(style.color));
      const backgroundLum = luminance(parse(background));
      const ratio =
        (Math.max(foregroundLum, backgroundLum) + 0.05) /
        (Math.min(foregroundLum, backgroundLum) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          parseInt(style.fontWeight) >= 700);
      const minimum = large ? 3 : 4.5;
      contrast.push({
        selector,
        foreground: style.color,
        background,
        ratio: Number(ratio.toFixed(2)),
        minimum,
        pass: ratio >= minimum,
      });
    }
    return {
      scope:
        "Basic DOM labels/alt and five opaque-background text samples; not a formal accessibility audit.",
      unlabeledInputs,
      imagesWithoutAlt,
      contrast,
    };
  });
  check(details.accessibility.unlabeledInputs).toEqual([]);
  check(details.accessibility.imagesWithoutAlt).toBe(0);
  await page.locator(".public-wordmark").focus();
  await page.keyboard.press("Tab");
  await check(page.locator(".favorite-nav")).toBeFocused();
  details.accessibility.keyboardFocus = await page
    .locator(".favorite-nav")
    .evaluate((element) => ({
      focusVisible: element.matches(":focus-visible"),
      outlineWidth: getComputedStyle(element).outlineWidth,
      outlineStyle: getComputedStyle(element).outlineStyle,
    }));
  check(details.accessibility.keyboardFocus.focusVisible).toBe(true);
  check(
    parseFloat(details.accessibility.keyboardFocus.outlineWidth),
  ).toBeGreaterThan(0);
  record(
    scope,
    "Visible inputs have accessible labels, images have alt attributes, keyboard focus is visible",
    "PASS",
  );
  const failingContrast = details.accessibility.contrast.filter(
    (sample) => !sample.pass,
  );
  record(
    scope,
    "Sampled text contrast on opaque backgrounds meets applicable minimum",
    failingContrast.length ? "FAIL" : "PASS",
    failingContrast.length ? JSON.stringify(failingContrast) : undefined,
  );
  return details;
}

async function publicScenario(browser, browserKey, restaurant, device) {
  const scope = `${browserKey}/${restaurant.key}/${device.key}/public`;
  const context = await browser.newContext({
    baseURL: base,
    locale: "es-CO",
    viewport: device.viewport,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const errors = monitor(page);
  const item = {
    browser: browserKey,
    restaurant: restaurant.key,
    device: device.key,
    viewport: device.viewport,
    status: "RUNNING",
    errors,
  };
  evidence.publicMenus.push(item);
  try {
    const slug = new URL(restaurant.localMenu, base).pathname.split("/").pop();
    const response = await context.request.get(
      `/api/public/menu/${encodeURIComponent(slug)}`,
    );
    check(response.status()).toBe(200);
    const data = await response.json();
    check(data.restaurant.id).toBe(restaurant.id);
    check(data.products).toHaveLength(24);
    item.productCount = data.products.length;
    item.categoryCount = data.categories.length;
    await page.goto(`/menu/${encodeURIComponent(slug)}`, {
      waitUntil: "domcontentloaded",
    });
    await check(page.locator(".menu-hero h1")).toHaveText(data.restaurant.name);
    await check(page.locator(".public-product")).toHaveCount(24);
    record(
      scope,
      "Real anonymous API and UI show the correct restaurant and 24 products",
      "PASS",
    );
    item.images = await loadImages(page);
    check(item.images.length).toBeGreaterThan(0);
    record(scope, "All menu images load from actual media routes", "PASS");
    item.dimensions = await noOverflow(page);
    record(scope, "No page-level horizontal overflow", "PASS");
    const imageSuffix = browserKey === "chrome" ? "" : `-${browserKey}`;
    item.screenshot = relativePath(
      artifactPath(
        "screenshots",
        `real-${restaurant.key}-${device.key}${imageSuffix}.png`,
      ),
    );
    await page.screenshot({
      path: path.join(root, item.screenshot),
      fullPage: true,
    });
    if (phase === "screenshots") {
      item.status = "PASS";
      return;
    }
    const selector = page.getByLabel("Language / Idioma");
    await selector.selectOption("en");
    await check(page.locator(".public-menu")).toHaveAttribute("lang", "en");
    await check(
      page.getByRole("heading", { name: "Our menu", exact: true }),
    ).toBeVisible();
    const productTranslations = data.translations.filter(
      (entry) => entry.entity_type === "product" && entry.language === "en",
    );
    const categoryTranslations = data.translations.filter(
      (entry) => entry.entity_type === "category" && entry.language === "en",
    );
    check(productTranslations).toHaveLength(24);
    check(categoryTranslations).toHaveLength(8);
    for (const product of data.products) {
      const translation = productTranslations.find(
        (entry) => entry.entity_id === product.id,
      );
      check(Boolean(translation?.fields.name?.trim())).toBe(true);
      check(Boolean(translation?.fields.description?.trim())).toBe(true);
      const card = page.locator(".public-product").filter({
        has: page.getByRole("heading", {
          name: translation.fields.name,
          exact: true,
        }),
      });
      await check(card).toHaveCount(1);
      await check(card).toContainText(translation.fields.description);
    }
    const categoryLabels = await page
      .locator(".public-categories > button")
      .allTextContents();
    const categoryHeadings = await page
      .locator(".menu-category-section .public-section-heading h2")
      .allTextContents();
    for (const category of data.categories) {
      const translation = categoryTranslations.find(
        (entry) => entry.entity_id === category.id,
      );
      check(Boolean(translation?.fields.name?.trim())).toBe(true);
      check(categoryLabels).toContain(translation.fields.name);
      if (data.products.some((product) => product.category_id === category.id))
        check(categoryHeadings).toContain(translation.fields.name);
    }
    item.englishTranslations = {
      products: 24,
      categories: 8,
      verifiedRendered: true,
    };
    record(
      scope,
      "All persisted English product names/descriptions and category names render",
      "PASS",
    );
    await selector.selectOption("es");
    await check(
      page.getByRole("heading", { name: "Nuestro menú", exact: true }),
    ).toBeVisible();
    record(
      scope,
      "English/Spanish language selection changes the real menu interface",
      "PASS",
    );
    const product = data.products.find(
      (entry) => entry.variants?.length && entry.extras?.length,
    );
    check(Boolean(product)).toBe(true);
    await page
      .locator(".public-product-main")
      .filter({
        has: page.getByRole("heading", { name: product.name, exact: true }),
      })
      .click();
    const dialog = page.getByRole("dialog");
    await check(dialog).toBeVisible();
    await check(
      dialog.getByRole("heading", { name: "Presentaciones", exact: true }),
    ).toBeVisible();
    await check(
      dialog.getByRole("heading", { name: "Extras", exact: true }),
    ).toBeVisible();
    const price = new Intl.NumberFormat("es", {
      style: "currency",
      currency: data.restaurant.currency,
      maximumFractionDigits: data.restaurant.currency === "COP" ? 0 : 2,
    }).format(product.price);
    await check(dialog.locator(".detail-price strong")).toHaveText(price);
    await check(
      dialog.getByText(product.variants[0].name, { exact: true }),
    ).toBeVisible();
    await check(
      dialog.getByText(product.extras[0].name, { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await check(dialog).toHaveCount(0);
    record(
      scope,
      "Product detail shows persisted price, variants and extras; modal closes",
      "PASS",
    );
    if (data.products.some((product) => !product.is_available)) {
      await check(
        page.locator(".public-product.product-unavailable").first(),
      ).toBeVisible();
      record(
        scope,
        "Persisted sold-out products are visibly identified",
        "PASS",
      );
    }
    item.interactions = await publicInteractions(
      page,
      data,
      restaurant,
      device,
      scope,
    );
    const before = digest(
      data.products.map(({ id, name, price, category_id, is_available }) => ({
        id,
        name,
        price,
        category_id,
        is_available,
      })),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await check(page.locator(".public-product")).toHaveCount(24);
    const reloaded = await (
      await context.request.get(`/api/public/menu/${encodeURIComponent(slug)}`)
    ).json();
    const after = digest(
      reloaded.products.map(
        ({ id, name, price, category_id, is_available }) => ({
          id,
          name,
          price,
          category_id,
          is_available,
        }),
      ),
    );
    check(after).toBe(before);
    item.reloadSnapshotUnchanged = true;
    record(scope, "Reload preserves persisted public product data", "PASS");
    check(errors.pageErrors).toEqual([]);
    check(errors.consoleErrors.filter((error) => !error.expected)).toEqual([]);
    check(errors.httpErrors.filter((error) => !error.expected)).toEqual([]);
    check(
      errors.failedRequests.filter((error) => !error.expectedNavigationAbort),
    ).toEqual([]);
    record(
      scope,
      "No runtime errors, failed resources or unexpected HTTP errors",
      "PASS",
    );
    item.status = evidence.results.some(
      (result) => result.scope === scope && result.status === "FAIL",
    )
      ? "FAIL"
      : "PASS";
  } catch (error) {
    item.status = "FAIL";
    item.error = sanitize(error.message);
    record(scope, "Scenario completion", "FAIL", error.message);
  } finally {
    await context.close();
    await persist();
    console.log(JSON.stringify({ scope, status: item.status }));
  }
}
async function navigate(page, label) {
  const toggle = page.getByRole("button", { name: "Abrir navegación" });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function login(page, account, diagnostics = []) {
  await assertAppTarget(base, { fresh: true });
  const step = (phase, detail = {}) =>
    diagnostics.push({ at: new Date().toISOString(), phase, ...detail });
  step("opening-login");
  try {
    const healthReady = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/health" &&
        response.request().method() === "GET",
      { timeout: 90000 },
    );
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const health = await healthReady;
    check(health.status()).toBe(200);
    step("hydration-health-response", { status: health.status() });
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    step("network-idle");
    const email = page.getByLabel("Correo electrónico", { exact: true });
    const password = page.getByLabel("Contraseña", { exact: true });
    await email.fill(account.email);
    await password.fill(account.password);
    await password.press("Tab");
    const formState = {
      emailMatches: (await email.inputValue()) === account.email,
      passwordMatches: (await password.inputValue()) === account.password,
      valid: await page
        .locator("form")
        .evaluate((form) => form.checkValidity()),
    };
    step("filled-valid-form", formState);
    check(formState).toEqual({
      emailMatches: true,
      passwordMatches: true,
      valid: true,
    });
    const button = page.getByRole("button", {
      name: "Entrar a mi espacio",
      exact: true,
    });
    await check(button).toBeEnabled();
    const [authResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth" &&
          response.request().method() === "POST",
        { timeout: 90000 },
      ),
      button.click(),
    ]);
    step("auth-response", { status: authResponse.status() });
    check(authResponse.status()).toBe(200);
    await page.waitForURL("**/dashboard", { timeout: 90000 });
    await check(
      page.getByRole("heading", {
        name: "Tu menú, en buenas manos.",
        exact: true,
      }),
    ).toBeVisible();
    await check(
      page.getByRole("link", { name: "Ver menú", exact: true }),
    ).toBeVisible();
    step("workspace-rendered");
  } catch (error) {
    step("failed", {
      path: new URL(page.url()).pathname,
      formValid: await page
        .locator("form")
        .evaluate((form) => form.checkValidity())
        .catch(() => null),
      alert: sanitize(
        await page
          .getByRole("alert")
          .allTextContents()
          .catch(() => []),
      ),
      error: sanitize(error.message),
    });
    throw error;
  }
}
async function ownerScenario(browser, browserKey, restaurant) {
  const scope = `${browserKey}/${restaurant.key}/owner`;
  const account = accounts[restaurant.key];
  if (
    !account?.email ||
    !account.password ||
    account.restaurantId !== restaurant.id
  )
    throw new Error("DEMO_ACCOUNT_MISMATCH");
  const context = await browser.newContext({
    baseURL: base,
    locale: "es-CO",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const errors = monitor(page);
  const item = {
    browser: browserKey,
    restaurant: restaurant.key,
    status: "RUNNING",
    errors,
    visitedTabs: [],
    downloads: [],
  };
  evidence.owners.push(item);
  try {
    await login(page, account, (item.loginDiagnostics ||= []));
    await check(
      page.getByRole("link", { name: "Ver menú", exact: true }),
    ).toBeVisible();
    const session = await (await context.request.get("/api/session")).json();
    check(session.role).toBe("owner");
    check(session.restaurantId).toBe(restaurant.id);
    record(scope, "Real owner login and restaurant-bound session", "PASS");
    const workspaceResponse = await context.request.get(
      `/api/workspace/${restaurant.id}`,
    );
    check(workspaceResponse.status()).toBe(200);
    const workspace = await workspaceResponse.json();
    check(workspace.total).toBe(24);
    const before = contentSnapshot(workspace);
    item.productCount = workspace.total;
    for (const [label, heading] of [
      ["Productos", "Cada plato cuenta."],
      ["Categorías", "Un menú bien organizado."],
      ["Promociones", "Una razón para volver."],
      ["Apariencia", "Tan único como tu restaurante."],
      ["Horarios", "Siempre a tiempo."],
      ["Idiomas", "Un menú sin fronteras."],
      ["Mi código QR", "Una puerta a tu menú."],
      ["Importar productos", "Tu carta, lista en minutos."],
      ["Cuenta y acceso", "Tu espacio, protegido."],
    ]) {
      await navigate(page, label);
      await check(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      item.visitedTabs.push(label);
      const missingLabels = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            "input:not([type=hidden]),select,textarea",
          ),
        ]
          .filter((element) => element.getClientRects().length > 0)
          .filter(
            (element) =>
              !element.labels?.length &&
              !element.getAttribute("aria-label") &&
              !element.getAttribute("aria-labelledby"),
          )
          .map((element) => ({ tag: element.tagName, type: element.type })),
      );
      item.tabLabels ||= [];
      item.tabLabels.push({ tab: label, missingLabels });
      record(
        scope,
        `Visible controls have labels in ${label}`,
        missingLabels.length ? "FAIL" : "PASS",
        missingLabels.length ? JSON.stringify(missingLabels) : undefined,
      );
      if (label === "Apariencia")
        await check(page.locator(".phone-preview")).toBeVisible();
    }
    record(
      scope,
      "All owner tabs and appearance preview open without editing records",
      "PASS",
    );
    await navigate(page, "Productos");
    await check(page.locator("tbody tr")).toHaveCount(24);
    await navigate(page, "Importar productos");
    const exportLink = page
      .getByRole("link", { name: /Exportar catálogo CSV/i })
      .first();
    await check(exportLink).toBeVisible();
    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportLink.click(),
    ]);
    const csvBytes = await readDownload(csvDownload);
    const parsed = Papa.parse(csvBytes.toString("utf8"), {
      header: true,
      skipEmptyLines: true,
    });
    check(parsed.meta.fields).toEqual([
      "nombre",
      "precio",
      "categoria",
      "descripcion",
      "sku",
    ]);
    check(parsed.data).toHaveLength(24);
    item.downloads.push({
      kind: "catalog-csv",
      filename: sanitize(csvDownload.suggestedFilename()),
      bytes: csvBytes.length,
      rows: parsed.data.length,
      sha256: digest(csvBytes),
    });
    record(
      scope,
      "Owner downloads real persisted catalog CSV with24 products",
      "PASS",
    );
    await navigate(page, "Mi código QR");
    const qrImage = page.getByAltText("Código QR del restaurante");
    await check(qrImage).toBeVisible();
    await check
      .poll(() =>
        qrImage.evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    for (const format of ["png", "svg", "pdf"]) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page
          .getByRole("link", { name: format.toUpperCase(), exact: true })
          .click(),
      ]);
      const bytes = await readDownload(download);
      let decodedUrl;
      if (format === "png") {
        const png = PNG.sync.read(bytes);
        const decoded = jsQR(
          new Uint8ClampedArray(png.data),
          png.width,
          png.height,
        );
        check(decoded?.data).toBe(`${base}/q/${restaurant.publicToken}`);
        decodedUrl = decoded.data;
      } else if (format === "svg")
        check(bytes.toString("utf8")).toContain("<svg");
      else check(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      item.downloads.push({
        kind: `qr-${format}`,
        filename: sanitize(download.suggestedFilename()),
        bytes: bytes.length,
        sha256: digest(bytes),
        ...(decodedUrl ? { decodedUrl, targetScope: originType } : {}),
      });
    }
    record(
      scope,
      "Real owner PNG/SVG/PDF downloads; PNG independently decoded to stable route",
      "PASS",
    );
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Ver menú", exact: true }).click(),
    ]);
    await check(preview.locator(".menu-hero h1")).toHaveText(
      workspace.restaurant.name,
    );
    await check(preview.locator(".public-product")).toHaveCount(24);
    await preview.close();
    record(
      scope,
      "Owner menu preview opens the correct real public menu",
      "PASS",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await check(
      page.getByRole("heading", {
        name: "Tu menú, en buenas manos.",
        exact: true,
      }),
    ).toBeVisible();
    await check(
      page.getByRole("link", { name: "Ver menú", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    const afterReload = await (
      await context.request.get(`/api/workspace/${restaurant.id}`)
    ).json();
    check(contentSnapshot(afterReload)).toBe(before);
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await page.waitForURL("**/login");
    check((await context.request.get("/api/session")).status()).toBe(401);
    await login(page, account, (item.loginDiagnostics ||= []));
    await check(
      page.getByRole("link", { name: "Ver menú", exact: true }),
    ).toBeVisible();
    const afterLogin = await (
      await context.request.get(`/api/workspace/${restaurant.id}`)
    ).json();
    check(contentSnapshot(afterLogin)).toBe(before);
    item.persistedSnapshotSha256 = before;
    item.reloadAndReLoginPreserved = true;
    record(
      scope,
      "Reload, logout, anonymous rejection and real re-login preserve catalog data",
      "PASS",
    );
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    // Explicitly close the final authenticated session, without changing account details.
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await page.waitForURL("**/login");
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    check(errors.pageErrors).toEqual([]);
    check(errors.consoleErrors.filter((error) => !error.expected)).toEqual([]);
    check(errors.httpErrors.filter((error) => !error.expected)).toEqual([]);
    check(
      errors.failedRequests.filter((error) => !error.expectedNavigationAbort),
    ).toEqual([]);
    record(scope, "No runtime errors or unexpected failed requests", "PASS");
    item.status = evidence.results.some(
      (result) => result.scope === scope && result.status === "FAIL",
    )
      ? "FAIL"
      : "PASS";
  } catch (error) {
    item.status = "FAIL";
    item.error = sanitize(error.message);
    record(scope, "Scenario completion", "FAIL", error.message);
  } finally {
    await context.close();
    await persist();
    console.log(JSON.stringify({ scope, status: item.status }));
  }
}

for (const browserKey of selectedBrowsers) {
  let browser;
  try {
    browser = await chromium.launch({ channel: browserKey, headless: true });
    evidence.browsers.push({
      name: browserKey,
      available: true,
      version: browser.version(),
      headless: true,
    });
  } catch (error) {
    evidence.browsers.push({
      name: browserKey,
      available: false,
      status: "NOT RUN",
      reason: sanitize(error.message),
    });
    await persist();
    continue;
  }
  try {
    if (phase !== "owners")
      for (const restaurant of restaurants)
        for (const device of devices)
          await publicScenario(browser, browserKey, restaurant, device);
    if (phase === "all" || phase === "owners")
      for (const restaurant of restaurants)
        await ownerScenario(browser, browserKey, restaurant);
  } finally {
    await browser.close();
  }
}
let webkitInstalled = false;
try {
  await access(webkit.executablePath());
  webkitInstalled = true;
} catch {
  /* No browser installation is performed. */
}
evidence.browsers.push({
  name: "WebKit/Safari",
  installed: webkitInstalled,
  status: "NOT RUN",
  reason: webkitInstalled
    ? "WebKit availability detected; Safari compatibility is not inferred."
    : "No installed WebKit executable; no browser was installed for this audit.",
});
evidence.completedAt = new Date().toISOString();
await persist();
console.log(
  JSON.stringify({
    completed: true,
    passed: evidence.counts.passed,
    failed: evidence.counts.failed,
    publicMenus: evidence.publicMenus.length,
    owners: evidence.owners.length,
  }),
);
if (evidence.counts.failed) process.exitCode = 1;
