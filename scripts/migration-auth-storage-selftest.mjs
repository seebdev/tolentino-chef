import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { migrateAuthStorage } from "./migration-auth-storage.mjs";
import { BUCKET, failReport, sha256 } from "./backup-common.mjs";
import { migrationMarker } from "./migration-data-common.mjs";

// No SDK, environment, filesystem credentials or network is used in this suite.
globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN_IN_SELFTEST"); };
const uuid = (n) => "00000000-0000-4000-8000-" + n.toString().padStart(12, "0");
const clone = (value) => structuredClone(value);
function fixture(count = 3) {
  const users = Array.from({ length: 4 }, (_, i) => ({ id: uuid(i + 1),
    email: "fixture" + i + "@example.test", user_metadata: { display_name: "Fixture " + i } }));
  const entries = users.map((user, i) => ({ userId: user.id, email: user.email,
    credentialId: uuid(i + 21), password: "LOCAL_ONLY_PASSWORD_" + "x".repeat(32) + i }));
  const credentials = { accounts: Object.fromEntries(["aurora", "bruma", "marea"].map((key, i) => [key, entries[i]])),
    admin: entries[3] };
  const objects = Array.from({ length: count }, (_, i) => {
    const bytes = Buffer.from("fixture-object-" + i);
    return { path: uuid(101) + "/" + uuid(i + 201) + ".webp", bytes: bytes.length,
      sha256: sha256(bytes), dataBase64: bytes.toString("base64"), metadata: { mimetype: "image/webp", size: bytes.length } };
  });
  return { credentials, payload: { users, objects, bucket: { id: BUCKET, name: BUCKET, public: false,
    file_size_limit: 5242880, allowed_mime_types: ["image/webp", "image/png"] } } };
}

function mock(f) {
  const state = { users: [], objects: new Map(), bucket: clone(f.payload.bucket), extraBuckets: [],
    createCalls: [], uploadCalls: [], listUserCalls: [], listObjectCalls: [], bucketCalls: [],
    failAuthAfter: false, failAuthBefore: false, failStorageAfter: false, failStorageBefore: false,
    corruptUploaded: false, corruptResponseId: false, missingResponseMarker: false, missingUserOnRead: false,
    extraAfterUpload: false, wrongUploadPath: false, throwSecret: false, metadataType: null, blobType: null,
    truncateAuth: false, duplicateEntry: false, noAuthTotal: false, omitFinalObject: false };
  const ok = (data) => ({ data, error: null });
  const fail = () => ({ data: null, error: { message: "PRIVATE_SDK_ERROR password=must-not-leak" } });
  const client = {
    auth: { admin: {
      async listUsers({ page, perPage }) {
        state.listUserCalls.push({ page, perPage });
        if (state.throwSecret) throw new Error("PRIVATE_SDK_ERROR password=must-not-leak");
        const users = state.users.filter((_, i) => !state.missingUserOnRead || i !== 0);
        const result = { users: clone(users.slice((page - 1) * perPage, page * perPage)) };
        if (!state.noAuthTotal) result.total = users.length + (state.truncateAuth ? 1 : 0);
        return ok(result);
      },
      async createUser(attributes) {
        state.createCalls.push(clone(attributes));
        if (state.failAuthBefore) { state.failAuthBefore = false; return fail(); }
        assert.equal(state.users.some((u) => u.id === attributes.id || u.email === attributes.email), false);
        const user = { id: attributes.id, email: attributes.email, app_metadata: clone(attributes.app_metadata),
          user_metadata: clone(attributes.user_metadata) };
        state.users.push(user);
        if (state.failAuthAfter) { state.failAuthAfter = false; return fail(); }
        const response = clone(user);
        if (state.corruptResponseId) response.id = uuid(999);
        if (state.missingResponseMarker) delete response.app_metadata.tolentino_migration;
        return ok({ user: response });
      },
    } },
    storage: {
      async listBuckets(options) {
        state.bucketCalls.push(options);
        return ok([state.bucket, ...state.extraBuckets].slice(options.offset, options.offset + options.limit));
      },
      async getBucket(name) { assert.equal(name, BUCKET); return ok(clone(state.bucket)); },
      from(name) {
        assert.equal(name, BUCKET);
        return {
          async list(prefix, options) {
            state.listObjectCalls.push({ prefix, ...options });
            const entries = new Map();
            for (const [path, object] of state.objects) {
              if (state.omitFinalObject && state.uploadCalls.length && path === f.payload.objects[0].path) continue;
              if (prefix && !path.startsWith(prefix + "/")) continue;
              const remaining = prefix ? path.slice(prefix.length + 1) : path;
              const name = remaining.split("/")[0];
              if (remaining.includes("/")) entries.set(name, { name, id: null });
              else entries.set(name, { name, id: uuid(901), metadata: { size: object.bytes.length,
                mimetype: state.metadataType || object.type } });
            }
            let list = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
            if (state.duplicateEntry && list.length) list = [list[0], ...list];
            return ok(list.slice(options.offset, options.offset + options.limit));
          },
          async download(path) {
            const object = state.objects.get(path);
            return object ? ok(new Blob([object.bytes], { type: state.blobType || object.type })) : fail();
          },
          async upload(path, bytes, options) {
            state.uploadCalls.push({ path, sha256: sha256(bytes), options: clone(options) });
            assert.equal(options.upsert, false);
            assert.equal(options.cacheControl, "3600");
            assert.equal(state.objects.has(path), false);
            if (state.failStorageBefore) { state.failStorageBefore = false; return fail(); }
            const stored = Buffer.from(bytes);
            if (state.corruptUploaded) stored[0] ^= 1;
            state.objects.set(path, { bytes: stored, type: options.contentType });
            if (state.extraAfterUpload) state.objects.set("foreign.webp", { bytes: Buffer.from("x"), type: "image/webp" });
            if (state.failStorageAfter) { state.failStorageAfter = false; return fail(); }
            return ok({ path: state.wrongUploadPath ? "wrong-path.webp" : path });
          },
        };
      },
    },
  };
  return { state, client };
}

const checks = [];
async function check(name, run) { await run(); checks.push({ name, result: "PASS" }); }
function alreadyMigrated(f, state) {
  const all = [...Object.values(f.credentials.accounts), f.credentials.admin];
  state.users = f.payload.users.map((u) => ({ ...clone(u), app_metadata: {
    tolentino_migration: migrationMarker(u.id, all.find((c) => c.userId === u.id).credentialId),
  } }));
  for (const object of f.payload.objects) state.objects.set(object.path,
    { bytes: Buffer.from(object.dataBase64, "base64"), type: object.metadata.mimetype });
}
const run = (f, m, extra = {}) => migrateAuthStorage({ ...f, client: m.client, ...extra });
const rejects = (promise, code) => assert.rejects(promise, (error) => {
  assert.equal(error.code, code);
  assert.equal(error.message.includes("PRIVATE_SDK_ERROR"), false);
  assert.equal(error.message.includes("must-not-leak"), false);
  return true;
});

try {
  await check("fresh-copy-preserves-ids-metadata-hashes-and-private-progress", async () => {
    const f = fixture(), m = mock(f), progress = [];
    const result = await run(f, m, { onProgress: async (event) => progress.push(event) });
    assert.deepEqual(result, { authCreated: 4, authReused: 0, objectsUploaded: 3,
      objectsReused: 0, objectsVerified: 3, bytesVerified: f.payload.objects.reduce((n, o) => n + o.bytes, 0) });
    assert.equal(m.state.createCalls.every((c) => c.email_confirm === true), true);
    assert.deepEqual(m.state.createCalls.map((c) => c.id), f.payload.users.map((u) => u.id));
    assert.deepEqual(m.state.createCalls.map((c) => c.user_metadata), f.payload.users.map((u) => u.user_metadata));
    const text = JSON.stringify(progress);
    for (const c of [...Object.values(f.credentials.accounts), f.credentials.admin])
      for (const privateValue of [c.userId, c.email, c.password, c.credentialId]) assert.equal(text.includes(privateValue), false);
    assert.equal(m.state.bucketCalls.some((o) => o.offset > 0), true);
  });
  await check("complete-rerun-reuses-with-zero-writes", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state);
    const result = await run(f, m);
    assert.equal(result.authReused, 4); assert.equal(result.objectsReused, 3);
    assert.equal(m.state.createCalls.length + m.state.uploadCalls.length, 0);
  });
  await check("lost-auth-response-resume-does-not-resend-existing-password", async () => {
    const f = fixture(), m = mock(f); m.state.failAuthAfter = true;
    await rejects(run(f, m), "AUTH_CREATE_FAILED");
    const result = await run(f, m);
    assert.equal(result.authCreated, 3); assert.equal(result.authReused, 1);
    assert.equal(m.state.createCalls.length, 4);
    assert.equal(new Set(m.state.createCalls.map((c) => c.id)).size, 4);
  });
  await check("auth-before-commit-failure-is-not-retried-until-next-invocation", async () => {
    const f = fixture(), m = mock(f); m.state.failAuthBefore = true;
    await rejects(run(f, m), "AUTH_CREATE_FAILED");
    assert.equal(m.state.createCalls.length, 1); assert.equal(m.state.users.length, 0);
    assert.equal((await run(f, m)).authCreated, 4);
  });
  await check("lost-storage-response-resume-never-overwrites", async () => {
    const f = fixture(), m = mock(f); m.state.failStorageAfter = true;
    await rejects(run(f, m), "STORAGE_UPLOAD_FAILED");
    const result = await run(f, m);
    assert.equal(result.authReused, 4); assert.equal(result.objectsReused, 1);
    assert.equal(result.objectsUploaded, 2); assert.equal(m.state.createCalls.length, 4);
    assert.equal(m.state.uploadCalls.length, 3);
    assert.equal(new Set(m.state.uploadCalls.map((c) => c.path)).size, 3);
  });
  await check("storage-before-commit-failure-stops-and-resumes", async () => {
    const f = fixture(), m = mock(f); m.state.failStorageBefore = true;
    await rejects(run(f, m), "STORAGE_UPLOAD_FAILED"); assert.equal(m.state.objects.size, 0);
    assert.equal(m.state.uploadCalls.length, 1); assert.equal((await run(f, m)).objectsUploaded, 3);
  });
  await check("foreign-auth-user-aborts-before-writes", async () => {
    const f = fixture(), m = mock(f); m.state.users.push({ id: uuid(999), email: "foreign@example.test" });
    await rejects(run(f, m), "AUTH_CONFLICT"); assert.equal(m.state.createCalls.length, 0);
  });
  await check("foreign-auth-marker-aborts-without-password-reset", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state);
    m.state.users[0].app_metadata.tolentino_migration.credentialId = uuid(777);
    await rejects(run(f, m), "AUTH_CONFLICT"); assert.equal(m.state.createCalls.length, 0);
  });
  await check("new-bundle-cannot-resume-existing-identities", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state);
    f.credentials.admin.credentialId = uuid(888);
    await rejects(run(f, m), "AUTH_CONFLICT");
  });
  for (const field of ["public", "file_size_limit", "allowed_mime_types"])
    await check("bucket-conflict-" + field, async () => {
      const f = fixture(), m = mock(f);
      m.state.bucket[field] = field === "public" ? true : field === "file_size_limit" ? 1 : ["text/html"];
      await rejects(run(f, m), "BUCKET_CONFLICT"); assert.equal(m.state.createCalls.length, 0);
    });
  await check("foreign-bucket-rejected", async () => {
    const f = fixture(), m = mock(f); m.state.extraBuckets.push({ id: "foreign", name: "foreign" });
    await rejects(run(f, m), "BUCKET_CONFLICT"); assert.equal(m.state.createCalls.length, 0);
  });
  await check("foreign-object-aborts-before-auth-write", async () => {
    const f = fixture(), m = mock(f); m.state.objects.set("foreign.webp", { bytes: Buffer.from("x"), type: "image/webp" });
    await rejects(run(f, m), "STORAGE_CONFLICT"); assert.equal(m.state.createCalls.length, 0);
  });
  await check("changed-object-aborts-no-overwrite", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state);
    m.state.objects.get(f.payload.objects[0].path).bytes[0] ^= 1;
    await rejects(run(f, m), "STORAGE_CONFLICT"); assert.equal(m.state.uploadCalls.length, 0);
  });
  for (const field of ["metadataType", "blobType"])
    await check("mime-conflict-" + field, async () => {
      const f = fixture(), m = mock(f); alreadyMigrated(f, m.state); m.state[field] = "text/html";
      await rejects(run(f, m), "STORAGE_CONFLICT"); assert.equal(m.state.uploadCalls.length, 0);
    });
  await check("corrupt-source-bytes-rejected-before-any-client-call", async () => {
    const f = fixture(), m = mock(f); f.payload.objects[0].dataBase64 = Buffer.from("wrong").toString("base64");
    await rejects(run(f, m), "SOURCE_OBJECT_INVALID"); assert.equal(m.state.listUserCalls.length, 0);
  });
  for (const field of ["corruptResponseId", "missingResponseMarker"])
    await check("invalid-create-response-" + field, async () => {
      const f = fixture(), m = mock(f); m.state[field] = true;
      await rejects(run(f, m), "AUTH_CREATE_MISMATCH"); assert.equal(m.state.createCalls.length, 1);
    });
  await check("auth-reverification-required-before-storage", async () => {
    const f = fixture(), m = mock(f); m.state.missingUserOnRead = true;
    await rejects(run(f, m), "AUTH_VERIFY_FAILED"); assert.equal(m.state.uploadCalls.length, 0);
  });
  await check("uploaded-content-is-downloaded-and-hashed", async () => {
    const f = fixture(), m = mock(f); m.state.corruptUploaded = true;
    await rejects(run(f, m), "STORAGE_CONFLICT"); assert.equal(m.state.uploadCalls.length, 3);
  });
  await check("final-inventory-rejects-extra-object", async () => {
    const f = fixture(), m = mock(f); m.state.extraAfterUpload = true;
    await rejects(run(f, m), "STORAGE_CONFLICT");
  });
  await check("final-inventory-missing-object-fails", async () => {
    const f = fixture(), m = mock(f); m.state.omitFinalObject = true;
    await rejects(run(f, m), "STORAGE_VERIFY_FAILED");
  });
  await check("upload-response-path-is-checked", async () => {
    const f = fixture(), m = mock(f); m.state.wrongUploadPath = true;
    await rejects(run(f, m), "STORAGE_UPLOAD_MISMATCH"); assert.equal(m.state.uploadCalls.length, 1);
  });
  await check("sdk-thrown-exception-is-sanitized", async () => {
    const f = fixture(), m = mock(f); m.state.throwSecret = true;
    await rejects(run(f, m), "AUTH_READ_FAILED");
  });
  await check("truncated-auth-pagination-fails", async () => {
    const f = fixture(), m = mock(f); m.state.truncateAuth = true;
    await rejects(run(f, m), "INCOMPLETE_PAGE"); assert.equal(m.state.createCalls.length, 0);
  });
  await check("auth-pagination-without-total-reads-empty-terminal-page", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state); m.state.noAuthTotal = true;
    await run(f, m); assert.equal(m.state.listUserCalls.some((c) => c.page === 2), true);
  });
  await check("duplicate-storage-list-entry-rejected", async () => {
    const f = fixture(), m = mock(f); alreadyMigrated(f, m.state); m.state.duplicateEntry = true;
    await rejects(run(f, m), "STORAGE_CONFLICT");
  });
  await check("storage-pagination-beyond-one-page-and-recursive-folders", async () => {
    const f = fixture(205), m = mock(f); alreadyMigrated(f, m.state);
    assert.equal((await run(f, m)).objectsVerified, 205);
    assert.equal(m.state.listObjectCalls.some((c) => c.offset >= 200), true);
    assert.equal(m.state.uploadCalls.length, 0);
  });
  console.log(JSON.stringify({ result: "PASS", scope: "LOCAL_MOCKS_ONLY", networkRequests: 0,
    checks: checks.length, passed: checks.length,
    fixtureDigest: createHash("sha256").update(JSON.stringify(fixture().payload)).digest("hex"),
    cases: checks }, null, 2));
} catch (error) {
  failReport(error, "migration-auth-storage-local-selftest");
  console.error(JSON.stringify({ passedBeforeFailure: checks.length }));
}
