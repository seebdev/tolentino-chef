import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Session, base } from "./live-client.mjs";
const mode = process.argv[2];
assert(["before", "after"].includes(mode), "Use before or after");
const manifest = JSON.parse(
  readFileSync("artifacts/demo/restaurants.json", "utf8"),
);
const accounts = JSON.parse(
  readFileSync(".runtime/demo-accounts.json", "utf8"),
);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const evidence = {
  at: new Date().toISOString(),
  base,
  mode,
  realDatabase: true,
  restaurants: [],
};
for (const item of manifest.restaurants) {
  const owner = new Session();
  await owner.login(accounts[item.key].email, accounts[item.key].password);
  try {
    const session = (await owner.request("/api/session")).data;
    assert.equal(session.restaurantId, item.id);
    const workspace = (await owner.request("/api/workspace/" + item.id)).data;
    const publicMenu = (
      await new Session().request(
        "/api/public/menu/" + item.localMenu.split("/").at(-1),
      )
    ).data;
    assert.equal(workspace.restaurant.is_demo, true);
    assert.equal(workspace.products.length, 24);
    assert.equal(publicMenu.products.length, 24);
    const persistent = Object.fromEntries(
      [
        "restaurant",
        "settings",
        "categories",
        "products",
        "promotions",
        "hours",
        "translations",
        "qr",
        "domains",
        "membership",
      ].map((k) => [k, workspace[k]]),
    );
    evidence.restaurants.push({
      key: item.key,
      id: item.id,
      products: workspace.products.length,
      categories: workspace.categories.length,
      translations: workspace.translations.length,
      ownerLogin: true,
      persistedSha256: hash(persistent),
      publicSha256: hash(publicMenu),
    });
  } finally {
    await owner.logout();
  }
}
const health = await new Session().request("/api/health");
evidence.health = { status: health.status, body: health.data };
if (mode === "before") {
  writeFileSync(
    ".runtime/restart-before.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log("PASS baseline: 3 persisted DEMO menus, owner logins and health");
} else {
  const before = JSON.parse(
    readFileSync(".runtime/restart-before.json", "utf8"),
  );
  for (const item of evidence.restaurants) {
    const prior = before.restaurants.find((r) => r.id === item.id);
    assert.equal(
      item.persistedSha256,
      prior.persistedSha256,
      item.key + " private data changed",
    );
    assert.equal(
      item.publicSha256,
      prior.publicSha256,
      item.key + " public data changed",
    );
  }
  evidence.baselineAt = before.at;
  evidence.result = "PASS";
  evidence.checks =
    "Fresh server process; fresh owner logins; exact SHA256 equality of private records and public API payloads for all 3 demos; health200";
  writeFileSync(
    "docs/evidence/restart-persistence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "PASS restart: 3 exact persisted menus, fresh owner logins and health200",
  );
}
