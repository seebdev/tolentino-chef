import {
  loadTargetDemos,
  assertAppTarget,
  evidencePath,
  targetMenuUrl,
  projectRef,
  runId,
} from "./audit-target.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { base } from "./live-client.mjs";
const { manifest, accounts } = loadTargetDemos();
await assertAppTarget(base, { fresh: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (
    r.status() >= 400 &&
    !(r.status() === 401 && new URL(r.url()).pathname === "/api/session")
  )
    errors.push("HTTP" + r.status() + " " + new URL(r.url()).pathname);
});
const result = {
  at: new Date().toISOString(),
  projectRef,
  runId,
  base,
  mode: "next start (production build served locally)",
  browser: await browser.version(),
  menus: [],
};
try {
  const health = await context.request.get(base + "/api/health");
  assert.equal(health.status(), 200);
  result.health = await health.json();
  for (const item of manifest.restaurants) {
    const response = await page.goto(targetMenuUrl(item, base), {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200);
    assert((await page.locator("body").innerText()).includes(item.name));
    const data = await (
      await context.request.get(
        base + "/api/public/menu/" + item.localMenu.split("/").at(-1),
      )
    ).json();
    assert.equal(data.restaurant.id, item.id);
    assert.equal(data.products.length, 24);
    const csp = response.headers()["content-security-policy"];
    assert(csp && !csp.includes("unsafe-eval"));
    result.menus.push({
      key: item.key,
      http: 200,
      products: 24,
      cspProduction: true,
    });
  }
  await assertAppTarget(base, { fresh: true });
  const hydration = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/health",
  );
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await hydration;
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill(accounts.aurora.email);
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill(accounts.aurora.password);
  await Promise.all([
    page.waitForURL("**/dashboard"),
    page.getByRole("button", { name: "Entrar a mi espacio" }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  const session = await (
    await context.request.get(base + "/api/session")
  ).json();
  assert.equal(session.role, "owner");
  assert.equal(session.restaurantId, accounts.aurora.restaurantId);
  const logout = await context.request.post(base + "/api/auth", {
    headers: { origin: base },
    data: { action: "logout" },
  });
  assert.equal(logout.status(), 200);
  assert.equal(
    (await context.request.get(base + "/api/session")).status(),
    401,
  );
  result.ownerLoginLogout = "PASS";
  assert.deepEqual(errors, []);
  result.runtimeErrors = errors;
  result.result = "PASS";
} finally {
  await browser.close();
}
writeFileSync(
  evidencePath("production-local-smoke.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  "PASS production build: 3 real menus, 72 products, CSP, health, owner login/logout; no JS or unexpected HTTP errors",
);
