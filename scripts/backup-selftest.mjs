import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  collectPages,
  encryptArchive,
  decryptArchive,
  guardedFetch,
  canonical,
  protectBackupDirectory,
  loadBackupKey,
  safeLocalPath,
  BACKUP_DIR,
} from "./backup-common.mjs";

test("pagination exports 2051 rows despite server caps smaller than the requested page", async () => {
  const source = Array.from({ length: 2051 }, (_, id) => ({ id }));
  const rows = await collectPages(async (offset) => ({
    rows: source.slice(offset, offset + 37),
    total: source.length,
  }));
  assert.deepEqual(rows, source);
});
test("storage-style pagination continues after a short page until an empty page", async () => {
  const rows = await collectPages(async (offset) => ({
    rows: Array.from(
      { length: Math.max(0, Math.min(17, 1007 - offset)) },
      (_, i) => offset + i,
    ),
  }));
  assert.equal(rows.length, 1007);
  assert.equal(rows.at(-1), 1006);
});
test("changed counts and premature end fail instead of producing a partial backup", async () => {
  await assert.rejects(
    collectPages(async (offset) => ({
      rows: [{ id: offset }],
      total: offset ? 3 : 2,
    })),
    { code: "SOURCE_CHANGED" },
  );
  await assert.rejects(
    collectPages(async () => ({ rows: [], total: 1 })),
    { code: "INCOMPLETE_PAGE" },
  );
});
test("authenticated encryption round trips and rejects wrong key or tampering", () => {
  const key = randomBytes(32),
    other = randomBytes(32);
  const source = {
    synthetic: true,
    values: ["á", 42],
    manifest: { qr: "constant-id" },
  };
  const encoded = encryptArchive(source, key, "test");
  assert.deepEqual(decryptArchive(encoded, key), source);
  assert.throws(() => decryptArchive(encoded, other), {
    code: "ARCHIVE_INVALID",
  });
  const envelope = JSON.parse(encoded);
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  assert.throws(
    () => decryptArchive(Buffer.from(JSON.stringify(envelope)), key),
    { code: "ARCHIVE_INVALID" },
  );
  assert.equal(encoded.includes(Buffer.from("constant-id")), false);
  key.fill(0);
  other.fill(0);
});
test("network guard blocks all remote writes and foreign destinations before fetch", async () => {
  let calls = 0;
  const read = guardedFetch("https://example.test", async () => {
    calls++;
    return new Response("{}");
  });
  await read("https://example.test/rest/v1/products");
  await read("https://example.test/storage/v1/object/list/restaurant-media", {
    method: "POST",
  });
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    await assert.rejects(
      read("https://example.test/rest/v1/products", { method }),
      { code: "REMOTE_WRITE_BLOCKED" },
    );
  }
  await assert.rejects(read("https://other.test/rest/v1/products"), {
    code: "REMOTE_WRITE_BLOCKED",
  });
  assert.equal(calls, 2);
});
test("timestamp normalization preserves all six microsecond digits", () => {
  assert.equal(
    canonical("2026-10-17T01:02:03.123456+00:00"),
    "2026-10-17T01:02:03.123456Z",
  );
  assert.notEqual(
    canonical("2026-10-17T01:02:03.123456Z"),
    canonical("2026-10-17T01:02:03.123457Z"),
  );
});
test("private directory ACL and DPAPI key round trip; archive paths cannot escape", () => {
  const acl = protectBackupDirectory();
  assert.equal(acl.inheritedAccessDisabled, true);
  const first = loadBackupKey(true),
    second = loadBackupKey(false);
  assert.deepEqual(first.key, second.key);
  assert.throws(() => safeLocalPath(BACKUP_DIR + "/../outside.enc"), {
    code: "UNSAFE_PATH",
  });
  assert.throws(() => safeLocalPath(BACKUP_DIR + "-other/file.enc"), {
    code: "UNSAFE_PATH",
  });
  first.key.fill(0);
  second.key.fill(0);
});
