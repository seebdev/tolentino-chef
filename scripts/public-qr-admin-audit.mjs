import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import {
  loadTargetDemos,
  loadTargetAdmin,
  auditBase,
  assertAppTarget,
  evidencePath,
  artifactPath,
  relativePath,
  projectRef,
  runId,
} from "./audit-target.mjs";

export const PUBLIC_ORIGIN =
  "https://tolentino-restaurantes-admin.onrender.com";
const ensure = (condition, code) => {
  if (!condition) throw Error(code);
};
const hash = (value) =>
  createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");
export function confirmedPublicOrigin(base, confirmed, explicitRunId) {
  const url = new URL(base);
  ensure(
    url.protocol === "https:" &&
      url.origin === PUBLIC_ORIGIN &&
      url.origin === base &&
      confirmed === base &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "PUBLIC_ORIGIN_NOT_CONFIRMED",
  );
  ensure(
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !/\.(?:localhost|test|local)$/.test(url.hostname) &&
      !/^[\d.]+$/.test(url.hostname),
    "PUBLIC_HOST_REQUIRED",
  );
  ensure(
    explicitRunId && /^public-[a-zA-Z0-9_-]+$/.test(explicitRunId),
    "PUBLIC_RUN_ID_REQUIRED",
  );
  return url.origin;
}
export async function decodeQrArtifact(input, format) {
  ensure(
    Buffer.isBuffer(input) &&
      input.length > 0 &&
      input.length <= 10 * 1024 * 1024,
    "QR_BYTES_INVALID",
  );
  ensure(["png", "svg", "pdf"].includes(format), "QR_FORMAT_INVALID");
  let rgba, width, height;
  if (format === "pdf") {
    const pdf = await PDFDocument.load(input);
    ensure(pdf.getPageCount() === 1, "QR_PDF_PAGE_COUNT");
    const resources = pdf
      .getPage(0)
      .node.Resources()
      .lookup(PDFName.of("XObject"), PDFDict);
    const images = resources
      .keys()
      .map((key) => resources.lookup(key))
      .filter(
        (stream) =>
          stream instanceof PDFRawStream &&
          stream.dict.lookup(PDFName.of("Subtype"))?.toString() === "/Image",
      );
    ensure(images.length === 1, "QR_PDF_IMAGE_COUNT");
    const image = images[0];
    ensure(
      image.dict.lookup(PDFName.of("ColorSpace")).toString() === "/DeviceRGB" &&
        image.dict.lookup(PDFName.of("Filter")).toString() === "/FlateDecode",
      "QR_PDF_IMAGE_FORMAT",
    );
    width = image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    height = image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    ensure(
      Number.isInteger(width) &&
        Number.isInteger(height) &&
        width > 0 &&
        height > 0 &&
        width * height <= 5_000_000,
      "QR_PIXEL_LIMIT",
    );
    const rgb = inflateSync(image.getContents(), {
      maxOutputLength: width * height * 3,
    });
    ensure(rgb.length === width * height * 3, "QR_PDF_IMAGE_BYTES");
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    const image = await sharp(input, { limitInputPixels: 5_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    width = image.info.width;
    height = image.info.height;
    rgba = new Uint8ClampedArray(image.data);
  }
  const decoded = jsQR(rgba, width, height)?.data;
  ensure(typeof decoded === "string", "QR_NOT_DECODABLE");
  return { decoded, width, height };
}
function contentSnapshot(data) {
  const keys = [
    "restaurant",
    "settings",
    "categories",
    "products",
    "promotions",
    "hours",
    "translations",
    "qr",
    "domains",
  ];
  return hash(Object.fromEntries(keys.map((key) => [key, data[key]])));
}

export async function publicQrAdminAudit() {
  const base = confirmedPublicOrigin(
    auditBase(),
    process.env.AUDIT_PUBLIC_ORIGIN,
    process.env.AUDIT_RUN_ID,
  );
  await assertAppTarget(base, { fresh: true });
  const { manifest, accounts } = loadTargetDemos();
  const admin = loadTargetAdmin();
  const secrets = [
    admin.email,
    admin.password,
    ...Object.values(accounts).flatMap((a) => [a.email, a.password]),
  ];
  const sanitize = (value) => {
    let text = String(value);
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    return text
      .replace(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        "[REDACTED_TOKEN]",
      )
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .slice(0, 1500);
  };
  const report = {
    startedAt: new Date().toISOString(),
    projectRef,
    runId,
    base,
    scope:
      "Real public HTTPS admin session and permanent QR GET exports; no catalog/settings writes",
    requests: { catalogMutations: 0, resetOrInvitationEmails: 0 },
    browser: null,
    checks: [],
    menus: [],
    qr: [],
    screenshots: [],
    physicalQrScanning: false,
    mockedResponses: false,
  };
  const check = expect.configure({ timeout: 45000 });
  const record = (name, detail) =>
    report.checks.push({ name, pass: true, ...(detail ? { detail } : {}) });
  let browser, context, anonymous;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    report.browser = {
      name: "Chrome",
      version: browser.version(),
      headless: true,
      ignoresHttpsErrors: false,
    };
    context = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1000 },
      locale: "es-CO",
    });
    anonymous = await browser.newContext({
      baseURL: base,
      viewport: { width: 1440, height: 1000 },
      locale: "es-CO",
    });
    const page = await context.newPage(),
      publicPage = await anonymous.newPage();
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(90000);
    publicPage.setDefaultTimeout(45000);
    publicPage.setDefaultNavigationTimeout(90000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(sanitize(error.message)));
    publicPage.on("pageerror", (error) =>
      pageErrors.push(sanitize(error.message)),
    );
    const ready = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/health",
    );
    const loginPage = await page.goto("/login", {
      waitUntil: "domcontentloaded",
    });
    ensure(
      loginPage?.status() === 200 && new URL(page.url()).origin === base,
      "PUBLIC_LOGIN_HTTP",
    );
    ensure((await ready).status() === 200, "PUBLIC_HYDRATION_HEALTH");
    await page.waitForLoadState("networkidle");
    await page
      .getByLabel("Correo electrónico", { exact: true })
      .fill(admin.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(admin.password);
    await page
      .getByRole("button", { name: "Entrar a mi espacio", exact: true })
      .click();
    await page.waitForURL(base + "/admin");
    await check(page.locator("tbody tr")).toHaveCount(3);
    const getJson = async (client, path) => {
      const response = await client.get(path, {
        timeout: 90000,
        maxRedirects: 0,
      });
      ensure(response.status() === 200, "PUBLIC_READ_HTTP");
      return response.json();
    };
    const identity = await getJson(context.request, "/api/session");
    ensure(
      identity.role === "superadmin" && identity.user.id === admin.userId,
      "ADMIN_IDENTITY_MISMATCH",
    );
    const cookiePattern = new RegExp(
      "^sb-" + projectRef + "-auth-token(?:\\.\\d+)?$",
    );
    const cookies = (await context.cookies()).filter((cookie) =>
      cookiePattern.test(cookie.name),
    );
    ensure(
      cookies.length > 0 &&
        cookies.every(
          (cookie) =>
            cookie.secure &&
            cookie.httpOnly &&
            cookie.sameSite === "Lax" &&
            cookie.path === "/" &&
            cookie.domain === new URL(base).hostname,
        ),
      "PUBLIC_COOKIE_POLICY",
    );
    record("Real admin login on confirmed HTTPS origin", {
      role: "superadmin",
    });
    record(
      "Current-project cookies use Secure, HttpOnly, SameSite=Lax and host-only scope",
      { cookies: cookies.length },
    );
    const beforeListing = await getJson(
      context.request,
      "/api/admin/restaurants",
    );
    ensure(
      beforeListing.total === 3 && beforeListing.restaurants.length === 3,
      "PUBLIC_RESTAURANT_COUNT",
    );
    assert.deepEqual(
      beforeListing.restaurants.map((r) => r.id).sort(),
      manifest.restaurants.map((r) => r.id).sort(),
    );
    for (const restaurant of manifest.restaurants) {
      const row = beforeListing.restaurants.find((r) => r.id === restaurant.id);
      ensure(
        row.is_demo === true &&
          row.status === "active" &&
          row.public_token === restaurant.publicToken,
        "PUBLIC_PERMANENT_IDENTITY_CHANGED",
      );
      const before = await getJson(
        context.request,
        "/api/workspace/" + restaurant.id,
      );
      ensure(
        before.total === 24 &&
          before.restaurant.public_token === restaurant.publicToken,
        "PUBLIC_WORKSPACE_CONTENT",
      );
      const snapshot = contentSnapshot(before);
      const expectedQr = base + restaurant.stableRoute;
      for (const format of ["png", "svg", "pdf"]) {
        const response = await context.request.get(
          "/api/workspace/" + restaurant.id + "/qr?format=" + format,
          { timeout: 90000, maxRedirects: 0 },
        );
        ensure(response.status() === 200, "PUBLIC_QR_HTTP");
        const contentType = response.headers()["content-type"] || "";
        ensure(
          contentType.startsWith(
            { png: "image/png", svg: "image/svg+xml", pdf: "application/pdf" }[
              format
            ],
          ),
          "PUBLIC_QR_CONTENT_TYPE",
        );
        const bytes = await response.body();
        const decoded = await decodeQrArtifact(bytes, format);
        ensure(
          decoded.decoded === expectedQr &&
            new URL(decoded.decoded).protocol === "https:",
          "PUBLIC_QR_PAYLOAD",
        );
        const file = artifactPath("qr", restaurant.key + "." + format);
        writeFileSync(file, bytes, { flag: "wx" });
        report.qr.push({
          restaurant: restaurant.key,
          format,
          path: relativePath(file),
          bytes: bytes.length,
          sha256: hash(bytes),
          decodedUrl: decoded.decoded,
          width: decoded.width,
          height: decoded.height,
          tokenUnchanged: true,
          artifactRegeneratedForPublicOrigin: true,
          physicalScan: false,
        });
      }
      const redirect = await anonymous.request.get(restaurant.stableRoute, {
        maxRedirects: 0,
        timeout: 90000,
      });
      const expectedMenu = base + "/menu/" + encodeURIComponent(row.slug);
      ensure(
        redirect.status() === 302 &&
          redirect.headers().location === expectedMenu,
        "PUBLIC_QR_REDIRECT",
      );
      const resolved = await publicPage.goto(restaurant.stableRoute, {
        waitUntil: "domcontentloaded",
      });
      ensure(
        resolved?.status() === 200 && publicPage.url() === expectedMenu,
        "PUBLIC_QR_BROWSER_RESOLUTION",
      );
      await check(publicPage.locator(".menu-hero h1")).toHaveText(row.name);
      await check(publicPage.locator(".public-product")).toHaveCount(24);
      const projected = await getJson(
        anonymous.request,
        "/api/public/menu/" + encodeURIComponent(row.slug),
      );
      ensure(
        projected.restaurant.id === restaurant.id &&
          projected.products.length === 24,
        "PUBLIC_MENU_IDENTITY",
      );
      const csp = resolved.headers()["content-security-policy"] || "";
      ensure(csp && !csp.includes("unsafe-eval"), "PUBLIC_CSP");
      const security = await resolved.securityDetails();
      ensure(
        security && new Date(security.validTo * 1000).getTime() > Date.now(),
        "PUBLIC_TLS_CERTIFICATE",
      );
      const after = await getJson(
        context.request,
        "/api/workspace/" + restaurant.id,
      );
      ensure(
        contentSnapshot(after) === snapshot &&
          after.restaurant.public_token === restaurant.publicToken,
        "PUBLIC_QR_CHANGED_DATA",
      );
      report.menus.push({
        restaurant: restaurant.key,
        url: expectedMenu,
        qrUrl: expectedQr,
        products: 24,
        redirectStatus: 302,
        finalStatus: 200,
        publicReady: true,
        tokenUnchanged: true,
        catalogAndQrSettingsUnchanged: true,
        tlsProtocol: security.protocol,
        productionCsp: true,
      });
      record(
        restaurant.key +
          " PNG/SVG/PDF decode, stable HTTPS redirect and real anonymous menu",
        { files: 3, products: 24 },
      );
    }
    for (const [device, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/admin/restaurants/" + manifest.restaurants[0].id);
      await check(page.locator(".support-banner")).toBeVisible();
      await page
        .getByRole("link", { name: "Volver a restaurantes", exact: false })
        .click();
      await page.waitForURL(base + "/admin");
      await check(page.locator("tbody tr")).toHaveCount(3);
      await check(page.locator(".loading")).toHaveCount(0);
      const session = await getJson(context.request, "/api/session");
      ensure(
        session.role === "superadmin" && session.user.id === identity.user.id,
        "PUBLIC_SUPPORT_IDENTITY",
      );
      const file = artifactPath(
        "screenshots",
        "public-admin-loaded-" + device + ".png",
      );
      await page.screenshot({
        path: file,
        fullPage: true,
        mask: [page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)],
      });
      report.screenshots.push({ device, file: relativePath(file) });
      record(
        device +
          " support exit preserves administrator identity and loads all three restaurants",
      );
    }
    const logout = await context.request.post("/api/auth", {
      headers: { origin: base },
      data: { action: "logout" },
      timeout: 90000,
    });
    ensure(logout.status() === 200, "PUBLIC_LOGOUT_HTTP");
    ensure(
      (await context.request.get("/api/session")).status() === 401,
      "PUBLIC_LOGOUT_SESSION",
    );
    ensure(
      !(await context.cookies()).some((cookie) =>
        cookiePattern.test(cookie.name),
      ),
      "PUBLIC_LOGOUT_COOKIES",
    );
    record(
      "Real admin logout removes local project cookies and denies anonymous session",
    );
    ensure(pageErrors.length === 0, "PUBLIC_BROWSER_ERROR");
    record("No browser page errors");
    report.result = "PASS";
  } catch (error) {
    report.result = "FAIL";
    report.error = sanitize(error.message);
    process.exitCode = 1;
  } finally {
    if (report.result !== "PASS" && context)
      await context.request
        .post("/api/auth", {
          headers: { origin: base },
          data: { action: "logout" },
          timeout: 30000,
        })
        .catch(() => {});
    await anonymous?.close();
    await context?.close();
    await browser?.close();
    report.completedAt = new Date().toISOString();
    report.passed = report.checks.length;
    report.browserContextsClosed = true;
    report.limitations = [
      "Public HTTPS acceptance on Chrome headless; owner/mobile menu matrix is recorded separately by visual-live-audit.",
      "QR payload decoding and HTTPS browser resolution do not prove a physical camera scan or printed contrast.",
      "No SMTP invitation/recovery email, customer catalog edits or platform settings changes.",
      "Session, rate-limit and QR/visit counters may change during normal reads and authentication.",
    ];
    const file = evidencePath("public-qr-admin-audit.json");
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify({
        result: report.result,
        passed: report.passed,
        qrFiles: report.qr.length,
        publicMenus: report.menus.length,
        evidence: relativePath(file),
      }),
    );
  }
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await publicQrAdminAudit();
