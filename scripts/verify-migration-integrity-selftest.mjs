import assert from "node:assert/strict";
import { BUSINESS_TABLES, normalizedBusinessRows, rowComparison, integrityReadFetch, verifyIntegrity } from "./verify-migration-integrity.mjs";
import { TARGET_PROJECT } from "./migration-data-common.mjs";
import { BUCKET, sha256, failReport } from "./backup-common.mjs";

globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN_IN_SELFTEST"); };
const clone = (value) => structuredClone(value);
const checks = [];
async function check(name, test) { await test(); checks.push({ name, result: "PASS" }); }
function fixture() {
  const tables = Object.fromEntries(BUSINESS_TABLES.map(([table, keys]) => [table, [{
    ...Object.fromEntries(keys.map((key) => [key, table + "-fixture"])),
    created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T01:00:00Z", content: { stable: true },
    ...(table === "restaurants" ? { public_token: "stable-token", menu_version: 3, menu_version_transaction: 12 } : {}),
  }]]));
  const bytes = Buffer.from("synthetic-contents");
  return { tables, users: Array.from({ length: 4 }, (_, n) => ({ id: "user-" + n, email: "fixture" + n + "@example.test" })),
    bucket: { id: BUCKET, name: BUCKET, public: false, file_size_limit: 5242880, allowed_mime_types: ["image/webp"] },
    objects: [{ path: "tenant/image.webp", bytes: bytes.length, sha256: sha256(bytes),
      dataBase64: bytes.toString("base64"), metadata: { size: bytes.length, mimetype: "image/webp" } }] };
}
function mock(payload) {
  const state = { tables: clone(payload.tables), users: clone(payload.users), bucket: clone(payload.bucket),
    extraBuckets: [], objects: new Map(payload.objects.map((object) => [object.path,
      { bytes: Buffer.from(object.dataBase64, "base64"), mime: object.metadata.mimetype }])),
    downloads: 0, mutateDuringDownload: false, blobType: null };
  const ok = (data) => ({ data, error: null });
  const client = {
    from(table) {
      assert.equal(BUSINESS_TABLES.some(([name]) => name === table), true);
      const query = { select() { return query; }, order() { return query; }, async range(first, last) {
        return { ...ok(clone(state.tables[table].slice(first, last + 1))), count: state.tables[table].length };
      } };
      return query;
    },
    auth: { admin: { async listUsers({ page, perPage }) {
      return ok({ users: clone(state.users.slice((page - 1) * perPage, page * perPage)), total: state.users.length });
    } } },
    storage: {
      async listBuckets({ offset, limit }) { return ok(clone([state.bucket, ...state.extraBuckets].slice(offset, offset + limit))); },
      async getBucket(name) { assert.equal(name, BUCKET); return ok(clone(state.bucket)); },
      from(name) {
        assert.equal(name, BUCKET);
        return {
          async list(prefix, { offset, limit }) {
            const entries = new Map();
            for (const [path, value] of state.objects) {
              if (prefix && !path.startsWith(prefix + "/")) continue;
              const tail = prefix ? path.slice(prefix.length + 1) : path;
              const name = tail.split("/")[0];
              entries.set(name, tail.includes("/") ? { id: null, name } : {
                id: "technical-id", name, metadata: { size: value.bytes.length, mimetype: value.mime }, updated_at: "2026-10-17T00:00:00Z",
              });
            }
            return ok([...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit));
          },
          async download(path) {
            state.downloads++;
            if (state.mutateDuringDownload) state.tables.products[0].content.stable = false;
            const object = state.objects.get(path);
            return ok(new Blob([object.bytes], { type: state.blobType || object.mime }));
          },
        };
      },
    },
  };
  return { client, state };
}
try {
  await check("exact-thirteen-business-tables", async () => {
    assert.equal(BUSINESS_TABLES.length, 13);
    assert.equal(BUSINESS_TABLES.some(([name]) => ["security_audit_events", "visit_events"].includes(name)), false);
  });
  await check("only-permitted-top-level-volatile-fields-ignored", async () => {
    const source = { id: 1, created_at: "stable", updated_at: "old", menu_version: 2, menu_version_transaction: 8,
      appearance: { updated_at: "must-preserve" } };
    const next = { ...source, updated_at: "new", menu_version: 30, menu_version_transaction: 89 };
    assert.deepEqual(normalizedBusinessRows("restaurants", [source]), normalizedBusinessRows("restaurants", [next]));
    assert.notDeepEqual(normalizedBusinessRows("products", [source]), normalizedBusinessRows("products", [next]));
    assert.notDeepEqual(normalizedBusinessRows("restaurants", [source]), normalizedBusinessRows("restaurants", [{ ...next, created_at: "changed" }]));
    assert.notDeepEqual(normalizedBusinessRows("restaurants", [source]), normalizedBusinessRows("restaurants", [{ ...next, appearance: { updated_at: "changed" } }]));
  });
  await check("comparisons-detect-changed-rows-with-equal-counts-and-never-output-values", async () => {
    const report = rowComparison([{ id: "private-uuid", email: "private@example.test", data: 1 }],
      [{ id: "private-uuid", email: "private@example.test", data: 2 }], ["id"]);
    assert.equal(report.changed, 1); assert.equal(report.equal, false);
    assert.equal(JSON.stringify(report).includes("private"), false);
    assert.equal(rowComparison([{ id: 1 }], [{ id: 1 }, { id: 1 }], ["id"]).duplicates, true);
  });
  await check("identical-target-passes-byte-hashes-and-double-read", async () => {
    const payload = fixture(), m = mock(payload), report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "PASS"); assert.equal(report.storage.downloadedObjects, 1);
    assert.equal(report.storage.downloadedBytes, payload.objects[0].bytes);
    assert.equal(report.targetDoubleRead.equal, true); assert.equal(report.targetDoubleRead.transactionSnapshot, false);
  });
  await check("qa-volatility-passes-without-hiding-business-content", async () => {
    const payload = fixture(), m = mock(payload);
    for (const rows of Object.values(m.state.tables)) rows[0].updated_at = "2026-10-18T00:00:00Z";
    m.state.tables.restaurants[0].menu_version = 99; m.state.tables.restaurants[0].menu_version_transaction = 0;
    assert.equal((await verifyIntegrity({ payload, client: m.client })).result, "PASS");
    m.state.tables.restaurants[0].public_token = "different";
    const result = await verifyIntegrity({ payload, client: m.client });
    assert.equal(result.result, "FAIL"); assert.equal(result.tables.restaurants.changed, 1);
  });
  await check("catalogue-change-is-not-masked-by-same-count", async () => {
    const payload = fixture(), m = mock(payload); m.state.tables.products[0].content.stable = false;
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.tables.products.changed, 1);
  });
  await check("auth-exact-email-and-no-extra-identity", async () => {
    const payload = fixture(), m = mock(payload); m.state.users[0].email = "changed@example.test";
    assert.equal((await verifyIntegrity({ payload, client: m.client })).auth.changed, 1);
    m.state.users.push({ id: "foreign", email: "foreign@example.test" });
    assert.equal((await verifyIntegrity({ payload, client: m.client })).auth.added, 1);
  });
  await check("storage-same-length-corruption-detected", async () => {
    const payload = fixture(), m = mock(payload); m.state.objects.get(payload.objects[0].path).bytes[0] ^= 1;
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.storage.changed, 1);
  });
  await check("storage-mime-response-mismatch-detected", async () => {
    const payload = fixture(), m = mock(payload); m.state.blobType = "image/png";
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.storage.metadataMatches, false);
  });
  await check("extra-object-counted-without-downloading-foreign-content", async () => {
    const payload = fixture(), m = mock(payload); m.state.objects.set("foreign/extra.webp", { bytes: Buffer.from("private"), mime: "image/webp" });
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.storage.added, 1); assert.equal(m.state.downloads, 1);
  });
  await check("missing-object-counted", async () => {
    const payload = fixture(), m = mock(payload); m.state.objects.clear();
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.storage.removed, 1);
  });
  await check("public-or-extra-bucket-fails", async () => {
    const payload = fixture(), m = mock(payload); m.state.bucket.public = true;
    assert.equal((await verifyIntegrity({ payload, client: m.client })).bucketPrivateAndConfigEqual, false);
    m.state.extraBuckets.push({ id: "foreign", name: "foreign", public: false });
    assert.equal((await verifyIntegrity({ payload, client: m.client })).buckets.added, 1);
  });
  await check("concurrent-content-change-detected-by-double-read", async () => {
    const payload = fixture(), m = mock(payload); m.state.mutateDuringDownload = true;
    const report = await verifyIntegrity({ payload, client: m.client });
    assert.equal(report.result, "FAIL"); assert.equal(report.targetDoubleRead.equal, false);
  });
  await check("http-guard-blocks-source-and-all-writes-auth-and-rpc", async () => {
    const env = { TARGET_SUPABASE_URL: "https://" + TARGET_PROJECT + ".supabase.co",
      TARGET_SUPABASE_PUBLISHABLE_KEY: "synthetic", TARGET_SUPABASE_SERVICE_ROLE_KEY: "synthetic" };
    let calls = 0;
    const guard = integrityReadFetch(env, { requests: 0, failedRequests: 0, operations: {} }, async (_url, options) => {
      assert.equal(options.redirect, "error"); calls++; return new Response("{}", { status: 200 });
    });
    for (const [path, method] of [["/auth/v1/token", "POST"], ["/auth/v1/logout", "POST"],
      ["/rest/v1/products", "POST"], ["/rest/v1/rpc/admin_stats", "GET"], ["/storage/v1/object/restaurant-media/x.webp", "POST"],
      ["/rest/v1/security_audit_events", "GET"]])
      await assert.rejects(guard(env.TARGET_SUPABASE_URL + path, { method }), { code: "INTEGRITY_REQUEST_BLOCKED" });
    await assert.rejects(guard("https://ylcnrfzosjzuljufwups.supabase.co/rest/v1/products"), { code: "INTEGRITY_REQUEST_BLOCKED" });
    assert.equal(calls, 0);
    await guard(env.TARGET_SUPABASE_URL + "/rest/v1/products");
    await guard(env.TARGET_SUPABASE_URL + "/storage/v1/object/list/restaurant-media", { method: "POST", body: "{}" });
    assert.equal(calls, 2);
  });
  console.log(JSON.stringify({ result: "PASS", scope: "LOCAL_MOCKS_ONLY", networkRequests: 0,
    passed: checks.length, cases: checks }, null, 2));
} catch (error) { failReport(error, "migration-integrity-local-selftest"); console.error(JSON.stringify({ passedBeforeFailure: checks.length })); }
