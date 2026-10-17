// Updates translations only for the three explicitly manifested DEMO tenants.
// No account creation, password changes, email, direct database or service key use.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { demos, englishCatalog } from "./demo-catalog.mjs";
import { Session, base } from "./live-client.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}
function validateCatalog() {
  assert.equal(demos.length, 3);
  return demos.map((demo) => {
    const english = englishCatalog[demo.key];
    const rows = demo.categories.flatMap(([, , ...products]) => products);
    const categoryNames = demo.categories.flatMap(([name, sub]) =>
      sub ? [name, sub] : [name],
    );
    assert.equal(rows.length, 24, demo.key + ": source product count");
    assert.equal(english.products.length, rows.length);
    assert.equal(categoryNames.length, 8);
    assert.deepEqual(
      Object.keys(english.categories).sort(),
      [...categoryNames].sort(),
      demo.key + ": category translation coverage",
    );
    for (const value of Object.values(english.categories))
      assert.ok(typeof value === "string" && value.trim());
    for (const fields of english.products)
      for (const key of ["name", "description"])
        assert.ok(typeof fields[key] === "string" && fields[key].trim());
    return {
      key: demo.key,
      products: rows.length,
      categories: categoryNames.length,
    };
  });
}
const coverage = validateCatalog();
if (process.argv.includes("--check")) {
  console.log(
    JSON.stringify({
      mode: "offline catalogue validation",
      coverage,
      products: 72,
      categories: 24,
    }),
  );
  process.exit(0);
}

const manifest = readJson("artifacts/demo/restaurants.json");
const accounts = readJson(".runtime/demo-accounts.json");
assert.equal(manifest.target, "ylcnrfzosjzuljufwups.supabase.co");
assert.equal(new URL(base).origin, new URL(manifest.base).origin);
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert.equal(manifest.restaurants.length, 3);
const sessions = [];
const evidence = {
  startedAt: new Date().toISOString(),
  target: manifest.target,
  base,
  maxConcurrentWrites: 3,
  scope:
    "English product names/descriptions and category names for manifested DEMOs only",
  externalEmailSent: false,
  credentialsPrinted: false,
  restaurants: [],
  status: "running",
};
const evidencePath = "docs/evidence/demo-english-translations.json";

async function workspace(session, id) {
  const first = (await session.request("/api/workspace/" + id)).data;
  const products = [...first.products];
  const pages = Math.ceil(first.total / 25);
  for (let page = 2; page <= pages; page++) {
    const next = (
      await session.request("/api/workspace/" + id + "?page=" + page)
    ).data;
    products.push(...next.products);
  }
  return { ...first, products };
}
function verifyTranslations(payload, jobs, label) {
  for (const job of jobs) {
    const matches = payload.translations.filter(
      (t) =>
        t.language === "en" &&
        t.entity_type === job.entity_type &&
        t.entity_id === job.entity_id,
    );
    assert.equal(
      matches.length,
      1,
      label + ": exactly one English translation",
    );
    for (const [key, value] of Object.entries(job.fields))
      assert.equal(
        matches[0].fields[key],
        value,
        label + ": exact saved " + key,
      );
  }
}

try {
  // Complete all tenant and ownership checks before the first translation write.
  for (const demo of demos) {
    const item = manifest.restaurants.find((r) => r.key === demo.key);
    const account = accounts[demo.key];
    assert.ok(item && account, demo.key + ": manifested demo account required");
    assert.equal(item.isDemo, true);
    assert.equal(account.restaurantId, item.id);
    assert.equal(account.email, demo.email);
    assert.equal(item.owner, demo.email);
    assert.match(demo.email, /@[^@]+\.test$/);
    assert.equal(new URL(item.localMenu).pathname, "/menu/" + demo.slug);
    const session = new Session();
    sessions.push(session);
    const login = await session.login(account.email, account.password);
    assert.equal(login.role, "owner");
    const auth = (await session.request("/api/session")).data;
    assert.equal(auth.role, "owner");
    assert.equal(auth.restaurantId, item.id);
    const current = await workspace(session, item.id);
    assert.equal(current.role, "owner");
    assert.equal(current.restaurant.id, item.id);
    assert.equal(
      current.restaurant.is_demo,
      true,
      "Refusing to modify a non-DEMO restaurant",
    );
    assert.equal(current.restaurant.owner_email, demo.email);
    assert.equal(current.restaurant.slug, demo.slug);
    assert.equal(current.restaurant.status, "active");
    assert.equal(current.products.length, 24);
    assert.equal(current.total, 24);
    assert.equal(current.categories.length, 8);
    assert.ok(current.settings.enabled_languages.includes("en"));
    const english = englishCatalog[demo.key];
    const jobs = [];
    for (const [name, sub] of demo.categories) {
      const parents = current.categories.filter(
        (c) => c.name === name && !c.parent_id,
      );
      assert.equal(parents.length, 1);
      const parent = parents[0];
      jobs.push({
        entity_type: "category",
        entity_id: parent.id,
        language: "en",
        fields: { name: english.categories[name] },
      });
      if (sub) {
        const children = current.categories.filter(
          (c) => c.name === sub && c.parent_id === parent.id,
        );
        assert.equal(children.length, 1);
        jobs.push({
          entity_type: "category",
          entity_id: children[0].id,
          language: "en",
          fields: { name: english.categories[sub] },
        });
      }
    }
    const sourceRows = demo.categories.flatMap(([, , ...rows]) => rows);
    for (let index = 0; index < sourceRows.length; index++) {
      const sku =
        "DEMO-" +
        demo.key.toUpperCase() +
        "-" +
        String(index + 1).padStart(2, "0");
      const matches = current.products.filter((p) => p.sku === sku);
      assert.equal(matches.length, 1, demo.key + ": expected unique demo SKU");
      assert.equal(
        matches[0].name,
        sourceRows[index][0],
        demo.key + ": source item identity",
      );
      jobs.push({
        entity_type: "product",
        entity_id: matches[0].id,
        language: "en",
        fields: english.products[index],
      });
    }
    evidence.restaurants.push({
      key: demo.key,
      restaurantId: item.id,
      verifiedDemo: true,
      productTranslations: 24,
      categoryTranslations: 8,
      verified: false,
    });
    sessions[sessions.length - 1].translationPlan = { demo, id: item.id, jobs };
  }

  const writes = sessions.flatMap((session) =>
    session.translationPlan.jobs.map((data) => ({ session, data })),
  );
  let cursor = 0;
  let failure;
  const workers = Array.from({ length: 3 }, async () => {
    while (!failure && cursor < writes.length) {
      const job = writes[cursor++];
      try {
        await job.session.request(
          "/api/workspace/" + job.session.translationPlan.id,
          {
            method: "POST",
            data: { action: "save_translation", data: job.data },
          },
        );
      } catch (error) {
        failure = error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;

  for (const session of sessions) {
    const { demo, id, jobs } = session.translationPlan;
    const current = await workspace(session, id);
    assert.equal(current.restaurant.is_demo, true);
    assert.equal(current.products.length, 24);
    verifyTranslations(current, jobs, demo.key + " owner API");
    const publicMenu = (await session.request("/api/public/menu/" + demo.slug))
      .data;
    assert.equal(publicMenu.restaurant.id, id);
    assert.equal(publicMenu.products.length, 24);
    assert.equal(publicMenu.categories.length, 8);
    verifyTranslations(publicMenu, jobs, demo.key + " public API");
    const result = evidence.restaurants.find((r) => r.key === demo.key);
    result.verified = true;
    result.ownerApiVerified = true;
    result.publicApiVerified = true;
    console.log(
      demo.key + ": 24 product and 8 category translations saved and verified",
    );
  }
  evidence.status = "passed";
  evidence.productTranslations = 72;
  evidence.categoryTranslations = 24;
} catch (error) {
  evidence.status = "failed";
  // Record only the safe error message, never session, account or request objects.
  evidence.error =
    error instanceof Error ? error.message : "Translation update failed";
  throw error;
} finally {
  for (const session of sessions) {
    try {
      await session.logout();
    } catch {
      evidence.logoutFailure = true;
    }
  }
  evidence.completedAt = new Date().toISOString();
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
}
console.log(
  JSON.stringify({
    status: evidence.status,
    products: 72,
    categories: 24,
    evidence: evidencePath,
  }),
);
