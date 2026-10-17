import { PGlite } from "@electric-sql/pglite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, TABLES, ensure, digest, sha256, sortedRows, safeLocalPath,
  loadBackupKey, decryptArchive, failReport, protectBackupDirectory,
} from "./backup-common.mjs";
import {
  TARGET_PROJECT, SOURCE_ARCHIVE_SHA256, assertTargetEnvironment, validateMigrationSource,
  newCredentialBundle, planAuthUsers, planStorageObjects,
  planTableRows, importApplicationRows, sameRows, prepareApplicationTables,
} from "./migration-data-common.mjs";

let db, secretKey;
let stage = "source-validation";
const checks = [];
function check(name, condition) {
  ensure(condition, "LOCAL_MIGRATION_CHECK_FAILED", "Falló una comprobación local de migración: " + name);
  checks.push({ name, pass: true });
}
async function rejects(name, fn, code) {
  let caught;
  try { await fn(); } catch (error) { caught = error; }
  check(name, caught?.code === code);
}
const rowsOf = async (table) =>
  (await db.query('select to_jsonb(t) as row from public."' + table + '" t')).rows.map((r) => r.row);
try {
  ensure(process.argv.length === 3, "USAGE",
    "Uso: node scripts/migration-data-local.mjs .runtime/backups/archivo.json.enc");
  protectBackupDirectory();
  const encrypted = readFileSync(safeLocalPath(resolve(ROOT, process.argv[2])));
  secretKey = loadBackupKey(false).key;
  const payload = decryptArchive(encrypted, secretKey);
  const inventory = validateMigrationSource(payload, encrypted);
  const preparedTables = prepareApplicationTables(payload);
  check("Authorized encrypted archive, all source hashes and demo relationships", true);
  await rejects("A different encrypted archive is rejected", () =>
    validateMigrationSource(payload, Buffer.from("different")), "SOURCE_ARCHIVE_INVALID");
  const invalidSource = structuredClone(payload);
  invalidSource.tables.restaurants[0].public_token = "00000000-0000-0000-0000-000000000000";
  await rejects("Modified permanent QR is rejected by source integrity", () =>
    validateMigrationSource(invalidSource, encrypted), "SOURCE_ROWS_INVALID");

  stage = "destination-guards";
  const env = {
    TARGET_SUPABASE_URL: "https://" + TARGET_PROJECT + ".supabase.co",
    TARGET_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-test-key",
    TARGET_SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-test-key",
    TARGET_SUPABASE_DB_HOST: "db." + TARGET_PROJECT + ".supabase.co",
    TARGET_SUPABASE_DB_PORT: "5432",
    TARGET_SUPABASE_DB_NAME: "postgres",
    TARGET_SUPABASE_DB_USER: "postgres",
    TARGET_SUPABASE_DB_PASSWORD: "synthetic-new-test-password",
    TARGET_SUPABASE_DB_PASSWORD_ROTATED: "true",
  };
  check("Exact new project direct connection accepted without connecting",
    assertTargetEnvironment(env, { requireDatabase: true }).projectRef === TARGET_PROJECT);
  await rejects("Old Supabase URL blocked before network", () => assertTargetEnvironment({
    ...env, TARGET_SUPABASE_URL: "https://ylcnrfzosjzuljufwups.supabase.co",
  }), "TARGET_INVALID");
  await rejects("Lookalike host blocked before network", () => assertTargetEnvironment({
    ...env, TARGET_SUPABASE_URL: "https://" + TARGET_PROJECT + ".supabase.co.attacker.test",
  }), "TARGET_INVALID");
  await rejects("Unconfirmed password rotation blocked", () => assertTargetEnvironment({
    ...env, TARGET_SUPABASE_DB_PASSWORD_ROTATED: "",
  }, { requireDatabase: true }), "ROTATED_PASSWORD_REQUIRED");
  await rejects("Transaction pooler 6543 rejected", () => assertTargetEnvironment({
    ...env, TARGET_SUPABASE_DB_PORT: "6543",
  }, { requireDatabase: true }), "DATABASE_MODE_INVALID");
  const session = {
    ...env, TARGET_SUPABASE_DB_HOST: "aws-0-us-east-1.pooler.supabase.com",
    TARGET_SUPABASE_DB_USER: "postgres." + TARGET_PROJECT,
  };
  await rejects("Unconfirmed Session parameters rejected", () =>
    assertTargetEnvironment(session, { requireDatabase: true }), "DATABASE_TARGET_INVALID");
  check("Confirmed actual Session parameters accepted without connecting",
    assertTargetEnvironment({ ...session, TARGET_SUPABASE_DB_SESSION_CONFIRMED: "true" },
      { requireDatabase: true }).projectRef === TARGET_PROJECT);

  stage = "auth-and-storage-planning";
  const credentials = newCredentialBundle(payload);
  const secondCredentials = newCredentialBundle(payload);
  const plannedUsers = planAuthUsers(payload, [], credentials);
  check("Four explicit Auth UUIDs preserved in create plans",
    plannedUsers.length === 4 && plannedUsers.every((p) =>
      p.action === "create" && payload.users.some((u) => u.id === p.attributes.id)));
  check("New random credentials generated independently; no old password input",
    digest(credentials) !== digest(secondCredentials) &&
    new Set([...Object.values(credentials.accounts), credentials.admin].map((a) => a.password)).size === 4);
  check("Demo account schema has exactly three demo keys; administrator separate",
    Object.keys(credentials.accounts).sort().join(",") === "aurora,bruma,marea" &&
    !Object.hasOwn(credentials.accounts, "admin"));
  const resumedUsers = plannedUsers.map((p) => ({
    id: p.attributes.id, email: p.attributes.email,
    app_metadata: p.attributes.app_metadata,
  }));
  check("Marked exact Auth identities reuse without resetting credentials",
    planAuthUsers(payload, resumedUsers, credentials).every((p) => p.action === "reuse" && !p.attributes));
  await rejects("Regenerated local credentials cannot silently reuse existing Auth accounts", () =>
    planAuthUsers(payload, resumedUsers, secondCredentials), "AUTH_CONFLICT");
  await rejects("Unmarked pre-existing Auth identity rejected", () =>
    planAuthUsers(payload, [{ ...resumedUsers[0], app_metadata: {} }], credentials), "AUTH_CONFLICT");
  await rejects("Same Auth UUID with a different email rejected", () =>
    planAuthUsers(payload, [{ ...resumedUsers[0], email: "unrelated@example.test" }], credentials), "AUTH_CONFLICT");
  await rejects("Unrelated destination Auth account rejected", () =>
    planAuthUsers(payload, [{ id: "00000000-0000-4000-8000-000000000001", email: "unrelated@example.test" }], credentials), "AUTH_CONFLICT");
  check("Private object upload plans preserve every exact source path",
    planStorageObjects(payload.objects, []).every((p) => p.action === "upload"));
  const storedObjects = payload.objects.map((o) => ({
    path: o.path, sha256: o.sha256, bytes: o.bytes, contentType: o.metadata.mimetype,
  }));
  check("Second Storage pass reuses all equal bytes and MIME types",
    planStorageObjects(payload.objects, storedObjects).every((p) => p.action === "reuse"));
  await rejects("Existing Storage bytes are never overwritten", () =>
    planStorageObjects(payload.objects, [{ ...storedObjects[0], sha256: "different" }]), "STORAGE_CONFLICT");
  await rejects("Unexpected MIME on an existing object aborts", () =>
    planStorageObjects(payload.objects, [{ ...storedObjects[0], contentType: "text/html" }]), "STORAGE_CONFLICT");
  await rejects("Unexpected destination object aborts", () =>
    planStorageObjects(payload.objects, [{ ...storedObjects[0], path: "unrelated/file.png" }]), "STORAGE_CONFLICT");
  await rejects("Unknown destination row cannot be removed by import", () =>
    planTableRows([{ id: 1 }], [{ id: 2 }], ["id"]), "DATA_CONFLICT");

  stage = "isolated-schema-and-import";
  db = new PGlite();
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;" +
    "create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;" +
    "create table auth.users(id uuid primary key);" +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
    "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));" +
    "alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;set timezone='UTC';",
  );
  for (const migration of payload.migrations) await db.exec(migration.sql);
  check("Both reviewed migrations apply in isolated PostgreSQL", true);
  for (const user of payload.users) await db.query("insert into auth.users(id) values($1)", [user.id]);
  const bootstrapSettings = await rowsOf("platform_settings");
  const customizedBootstrap = structuredClone(bootstrapSettings);
  customizedBootstrap[0].contact_label = "Already customized";
  await rejects("A customized singleton is rejected even when supplied as trusted bootstrap", () =>
    importApplicationRows(db, preparedTables, { bootstrapSettings: customizedBootstrap }), "BOOTSTRAP_INVALID");
  const malformed = structuredClone(preparedTables);
  malformed.products[0].category_id = "00000000-0000-4000-8000-000000000002";
  await rejects("Invalid product FK rolls back earlier restaurant/category inserts", () =>
    importApplicationRows(db, malformed, { bootstrapSettings }), "23503");
  check("Failed import leaves all business tables empty and initial singleton intact",
    (await rowsOf("restaurants")).length === 0 &&
    (await rowsOf("categories")).length === 0 &&
    sameRows(await rowsOf("platform_settings"), bootstrapSettings, ["id"]));
  const first = await importApplicationRows(db, preparedTables, { bootstrapSettings });
  check("First import inserts data and replaces only the verified initial singleton",
    first.inserted > 0 && first.bootstrapReplaced === 1);
  for (const [table, keys] of TABLES)
    check("Exact restored data including generated columns: " + table,
      sameRows(await rowsOf(table), preparedTables[table], keys));
  check("Source transaction IDs reset without changing permanent IDs or menu versions",
    preparedTables.restaurants.every((r) => r.menu_version_transaction === 0 &&
      r.menu_version === payload.tables.restaurants.find((s) => s.id === r.id).menu_version));
  const second = await importApplicationRows(db, preparedTables);
  check("Second import creates no duplicate or update and reuses every row",
    second.inserted === 0 && second.bootstrapReplaced === 0 &&
    second.reused === Object.values(payload.tables).reduce((n, rows) => n + rows.length, 0));
  check("All original permanent QR UUIDs preserved after both imports",
    digest(sortedRows((await rowsOf("restaurants")).map(({ id, public_token }) => ({ id, public_token })), ["id"])) ===
    digest(sortedRows(payload.tables.restaurants.map(({ id, public_token }) => ({ id, public_token })), ["id"])));
  const enabled = (await db.query(
    "select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid " +
    "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'",
  )).rows[0].n;
  check("All application triggers enabled after committed and failed imports", enabled === 0);
  check("All fifteen public tables retain RLS", (await db.query(
    "select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
    "where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
  )).rows[0].n === 15);
  await db.query("update public.products set price=price+1 where id=$1", [payload.tables.products[0].id]);
  const beforeConflict = digest(await rowsOf("products"));
  await rejects("A changed target row stops rerun without overwriting it", () =>
    importApplicationRows(db, preparedTables), "DATA_CONFLICT");
  check("Conflict leaves destination changes untouched", digest(await rowsOf("products")) === beforeConflict);
  check("Transient operational tables remain intentionally empty", (await db.query(
    "select (select count(*) from private.rate_limits)+(select count(*) from private.restaurant_creation_requests) as n",
  )).rows[0].n === 0);

  stage = "sanitized-evidence";
  const directory = resolve(ROOT, "docs", "evidence", "migrations", TARGET_PROJECT);
  mkdirSync(directory, { recursive: true });
  const report = {
    at: new Date().toISOString(), result: "PASS", scope: "Local preparation; no target project connection",
    targetProjectRef: TARGET_PROJECT, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    inventory, engine: "PGlite 0.5.10", node: process.version,
    passedChecks: checks.length, failedChecks: 0, checks,
    idempotentImport: { first, second }, remoteRequests: 0, remoteMutations: 0,
    plaintextSourceFilesWritten: 0, credentialFilesWritten: 0,
    schemaVerifiedOnRemote: false, authRuntimeVerifiedOnRemote: false,
    storageHttpVerifiedOnRemote: false, targetBackupCompleted: false,
    applicationRowsPreserved: true, qrIdentifiersPreserved: true,
    normalizedOperationalColumns: ["restaurants.menu_version_transaction reset to 0"],
    storageTechnicalIdsPreservedByFutureApiUpload: false,
    command: "node scripts/migration-data-local.mjs .runtime/backups/application-20261017193357263.json.enc",
    limitations: [
      "Auth and Storage decisions tested with in-memory snapshots, not target APIs.",
      "Only application SQL restored into PGlite; managed Supabase Auth/Storage services not restored.",
      "No destination credentials yet; preflight, encrypted target backup and remote execution remain pending.",
      "Source double read detects stability but is not a transaction snapshot.",
    ],
  };
  writeFileSync(resolve(directory, "local-data-preparation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    result: "PASS", passedChecks: checks.length, failedChecks: 0,
    sourceArchiveSha256: sha256(encrypted), remoteRequests: 0, remoteMutations: 0,
    credentialFilesWritten: 0, tableRows: second.reused,
  }));
} catch (error) {
  failReport(error, stage);
} finally {
  secretKey?.fill(0);
  await db?.close();
}
