import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, ensure, failReport, sha256, safeLocalPath, loadBackupKey, decryptArchive,
} from "./backup-common.mjs";
import {
  TARGET_PROJECT, validateMigrationSource, newCredentialBundle, planAuthUsers,
} from "./migration-data-common.mjs";
import { migrationWriteFetch, progressCheckpoint } from "./migration-target-runtime.mjs";
import { applyVersionedSchema, verifyTargetSecurity } from "./migration-target-schema.mjs";
import { saveTargetEvidence } from "./migration-target-inspect.mjs";

const checks = [];
let key, db, rollbackDb;
function check(name, condition) {
  ensure(condition, "RUNNER_TEST_FAILED", "Falló la prueba local: " + name);
  checks.push({ name, pass: true });
}
async function rejects(name, operation, expected) {
  let error;
  try { await operation(); } catch (caught) { error = caught; }
  check(name, error?.code === expected);
}
async function isolated() {
  const db = new PGlite();
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;" +
    "create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;" +
    "create table auth.users(id uuid primary key);" +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
    "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));" +
    "alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;",
  );
  return db;
}
try {
  ensure(process.argv.length === 3, "USAGE", "Se requiere archivo cifrado de origen.");
  key = loadBackupKey(false).key;
  const encrypted = readFileSync(safeLocalPath(resolve(ROOT, process.argv[2])));
  const payload = decryptArchive(encrypted, key);
  validateMigrationSource(payload, encrypted);
  const credentials = newCredentialBundle(payload);
  const authPlan = planAuthUsers(payload, [], credentials);
  const env = {
    TARGET_SUPABASE_URL: "https://" + TARGET_PROJECT + ".supabase.co",
    TARGET_SUPABASE_PUBLISHABLE_KEY: "synthetic-key", TARGET_SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin",
    TARGET_SUPABASE_DB_HOST: "aws-0-us-east-1.pooler.supabase.com",
    TARGET_SUPABASE_DB_PORT: "5432", TARGET_SUPABASE_DB_USER: "postgres." + TARGET_PROJECT,
    TARGET_SUPABASE_DB_NAME: "postgres", TARGET_SUPABASE_DB_PASSWORD: "synthetic-rotated",
    TARGET_SUPABASE_DB_PASSWORD_ROTATED: "true", TARGET_SUPABASE_DB_SESSION_CONFIRMED: "true",
  };
  const calls = [];
  const guard = migrationWriteFetch(env, payload, { requests: 0, mutations: 0 }, async (url, options) => {
    calls.push({ url: String(url), method: options.method || "GET", redirect: options.redirect });
    return new Response("{}", { status: 200 });
  });
  await rejects("Source project cannot receive any request", () => guard(
    "https://ylcnrfzosjzuljufwups.supabase.co/auth/v1/admin/users",
  ), "MIGRATION_TARGET_INVALID");
  await rejects("DELETE is always blocked", () => guard(
    env.TARGET_SUPABASE_URL + "/auth/v1/admin/users/" + payload.users[0].id, { method: "DELETE" },
  ), "REMOTE_OPERATION_BLOCKED");
  await rejects("Password reset and arbitrary user updates are blocked", () => guard(
    env.TARGET_SUPABASE_URL + "/auth/v1/admin/users/" + payload.users[0].id,
    { method: "PUT", body: JSON.stringify({ password: "synthetic" }) },
  ), "REMOTE_OPERATION_BLOCKED");
  await rejects("Recovery email requests are blocked", () => guard(
    env.TARGET_SUPABASE_URL + "/auth/v1/recover", { method: "POST", body: "{}" },
  ), "REMOTE_OPERATION_BLOCKED");
  await rejects("Unplanned Auth UUID is blocked", () => guard(
    env.TARGET_SUPABASE_URL + "/auth/v1/admin/users", { method: "POST",
      body: JSON.stringify({ ...authPlan[0].attributes, id: "00000000-0000-4000-8000-000000000001" }) },
  ), "REMOTE_OPERATION_BLOCKED");
  await guard(env.TARGET_SUPABASE_URL + "/auth/v1/admin/users", {
    method: "POST", body: JSON.stringify(authPlan[0].attributes),
  });
  check("Reviewed explicit Auth identity can be created through mocked transport",
    calls.length === 1 && calls[0].redirect === "error");
  const path = env.TARGET_SUPABASE_URL + "/storage/v1/object/restaurant-media/" + payload.objects[0].path;
  await rejects("Storage overwrite is blocked by HTTP guard", () => guard(path,
    { method: "POST", headers: { "x-upsert": "true" }, body: new Uint8Array([1]) }), "REMOTE_OPERATION_BLOCKED");
  await rejects("Unplanned Storage route is blocked", () => guard(
    env.TARGET_SUPABASE_URL + "/storage/v1/object/restaurant-media/unrelated/file.png",
    { method: "POST", headers: { "x-upsert": "false" }, body: new Uint8Array([1]) }), "REMOTE_OPERATION_BLOCKED");
  await guard(path, { method: "POST", headers: { "x-upsert": "false" }, body: new Uint8Array([1]) });
  check("Only an exact planned Storage path with no upsert reaches mocked transport", calls.length === 2);
  const progress = [];
  const checkpoint = progressCheckpoint(async (phase, counts) => progress.push({ stage: phase, ...counts }));
  await checkpoint({ phase: "auth-created", count: 1 });
  check("Structured helper progress reaches journal as a string stage",
    progress[0].stage === "auth-created" && typeof progress[0].stage === "string" && progress[0].count === 1);
  await rejects("An object cannot become the journal stage", () =>
    checkpoint({ phase: { unexpected: true }, count: 1 }), "JOURNAL_PROGRESS_INVALID");
  db = await isolated();
  const first = await applyVersionedSchema(db, payload.migrations);
  check("Both schema migrations and history apply together", first.applied === 2);
  const security = await verifyTargetSecurity(db);
  check("Fifteen RLS tables and restricted anonymous/owner permissions verified", security.public_rls === 15);
  const repeat = await applyVersionedSchema(db, payload.migrations);
  check("Second schema run verifies exact SQL hashes and reuses both versions",
    repeat.applied === 0 && repeat.reused === 2);
  await db.query("update supabase_migrations.schema_migrations set name=$1 where version=$2",
    ["unexpected-history", payload.migrations[0].file.split("_")[0]]);
  await rejects("Unexpected migration history cannot be silently accepted", () =>
    applyVersionedSchema(db, payload.migrations), "MIGRATION_HISTORY_CONFLICT");
  rollbackDb = await isolated();
  const broken = structuredClone(payload.migrations);
  broken[1].sql += "\nselect deliberate_missing_function_for_local_rollback_test();";
  broken[1].sha256 = sha256(broken[1].sql);
  await rejects("Failure in migration two rolls back the entire schema transaction", () =>
    applyVersionedSchema(rollbackDb, broken), "42883");
  const empty = (await rollbackDb.query(
    "select to_regclass('public.restaurants') is null as no_restaurants," +
    "to_regclass('supabase_migrations.schema_migrations') is null as no_history",
  )).rows[0];
  check("No first-migration schema or history remains after rollback", empty.no_restaurants && empty.no_history);
  const report = {
    at: new Date().toISOString(), result: "PASS", targetProjectRef: TARGET_PROJECT,
    scope: "Local runner guards and versioned schema transaction; in-memory PGlite and mocked HTTP",
    passedChecks: checks.length, failedChecks: 0, checks, remoteRequests: 0,
    remoteMutations: 0, credentialFilesWritten: 0,
    command: "node scripts/migration-target-selftest.mjs .runtime/backups/application-source-current-20261018012154252.json.enc",
  };
  const file = saveTargetEvidence("migration-runner-local-tests.json", report);
  console.log(JSON.stringify({ result: "PASS", passedChecks: checks.length, failedChecks: 0,
    remoteRequests: 0, credentialFilesWritten: 0, evidence: file }));
} catch (error) { failReport(error, "migration-runner-local-tests"); }
finally { key?.fill(0); await db?.close(); await rollbackDb?.close(); }
