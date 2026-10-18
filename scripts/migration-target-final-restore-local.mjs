import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, TABLES, ensure, failReport, digest, sha256, sortedRows, safeLocalPath,
  loadBackupKey, decryptArchive, protectBackupDirectory,
} from "./backup-common.mjs";
import { TARGET_PROJECT, importApplicationRows, sameRows } from "./migration-data-common.mjs";
import { decodeLocalArchive } from "./migration-target-final-backup.mjs";
import { saveTargetEvidence } from "./migration-target-inspect.mjs";

let db, key, stage = "local-archive-validation";
const checks = [];
const check = (name, pass) => {
  ensure(pass, "LOCAL_RESTORE_FAILED", "Falló una comprobación del ensayo de restauración local.");
  checks.push({ name, pass: true });
};
const argument = (name) => {
  const index = process.argv.indexOf(name);
  ensure(index >= 0 && process.argv[index + 1], "USAGE", "Falta un argumento de restauración local.");
  return process.argv[index + 1];
};
// Any accidental HTTP use in this isolated restore fails before reaching the network.
globalThis.fetch = async () => { throw Error("LOCAL_RESTORE_NETWORK_FORBIDDEN"); };
const ordered = (rows) => [...rows].sort((a, b) => digest(a).localeCompare(digest(b)));
const rowsOf = async (schema, name) => (await db.query(
  'select to_jsonb(t) as row from "' + schema + '"."' + name + '" t',
)).rows.map((r) => r.row);
try {
  const expectedSha = argument("--sha256");
  ensure(/^[0-9a-f]{64}$/.test(expectedSha), "ARCHIVE_SHA_REQUIRED", "Se requiere el hash cifrado registrado en la captura.");
  protectBackupDirectory();
  const archive = readFileSync(safeLocalPath(resolve(ROOT, argument("--archive"))));
  check("Encrypted archive matches independently supplied capture hash", sha256(archive) === expectedSha);
  key = loadBackupKey(false).key;
  const payload = decryptArchive(archive, key), manifest = payload.manifest;
  check("Encrypted payload belongs to the populated new-target backup",
    manifest.projectRef === TARGET_PROJECT && manifest.scope === "populated-target-logical-postgresql-and-storage");
  check("Inventory was stable at capture", digest(payload.before) === digest(payload.after) &&
    digest(payload.before) === manifest.inventorySha256);
  check("Application snapshot hash", digest(payload.tables) === manifest.applicationDataSha256);
  check("Private snapshot hash", digest(payload.privateTables) === manifest.privateDataSha256);
  check("Full captured Auth profile hash", digest(payload.authUsers) === manifest.authUsersSha256);
  const dump = Buffer.from(payload.dumpBase64, "base64");
  check("PostgreSQL custom dump exact bytes", dump.length === manifest.dump.bytes && sha256(dump) === manifest.dump.sha256);
  check("Role dump exact bytes without role passwords", Buffer.byteLength(payload.rolesSql) === manifest.roles.bytes &&
    sha256(payload.rolesSql) === manifest.roles.sha256 && manifest.roles.passwordsIncluded === false);
  const decoded = decodeLocalArchive(dump);
  check("Complete custom archive decodes locally", decoded.includes(Buffer.from("CREATE TABLE public.restaurants")) &&
    decoded.includes(Buffer.from("CREATE TABLE auth.users")) && decoded.includes(Buffer.from("CREATE TABLE storage.objects")));
  const migrationDir = resolve(ROOT, "supabase", "migrations");
  const names = readdirSync(migrationDir).filter((name) => /^\d+_.+[.]sql$/.test(name)).sort();
  const history = payload.before.sql.migrations;
  check("Exactly two captured and local migrations", names.length === 2 && history.length === 2);
  const migrations = names.map((file, index) => {
    const sql = readFileSync(resolve(migrationDir, file), "utf8"), row = history[index];
    check("Captured history equals local reviewed SQL: " + file,
      row.version === file.split("_")[0] && row.name === file.replace(/^\d+_/, "").replace(/[.]sql$/, "") &&
      row.statements?.length === 1 && sha256(row.statements[0]) === sha256(sql));
    return sql;
  });
  check("All application tables and the two transient tables are present",
    Object.keys(payload.tables).sort().join() === TABLES.map(([name]) => name).sort().join() &&
    Object.keys(payload.privateTables).sort().join() === "rate_limits,restaurant_creation_requests");
  check("Four distinct identity UUIDs captured", payload.authUsers.length === 4 &&
    new Set(payload.authUsers.map((u) => u.id)).size === 4);
  stage = "isolated-pglite-restore";
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
  for (const sql of migrations) await db.exec(sql);
  for (const user of payload.authUsers) await db.query("insert into auth.users(id) values($1)", [user.id]);
  const bootstrapSettings = await rowsOf("public", "platform_settings");
  const imported = await importApplicationRows(db, payload.tables, { bootstrapSettings });
  for (const [table, keys] of TABLES)
    check("Restored exact rows including generated columns: " + table,
      sameRows(await rowsOf("public", table), payload.tables[table], keys));
  for (const name of ["rate_limits", "restaurant_creation_requests"]) {
    await db.query('insert into private."' + name + '" select * from jsonb_populate_recordset(null::private."' + name + '",$1::jsonb)',
      [JSON.stringify(payload.privateTables[name])]);
    check("Restored exact private operational rows: " + name,
      digest(ordered(await rowsOf("private", name))) === digest(ordered(payload.privateTables[name])));
  }
  check("Menu transaction values preserved without additional normalization",
    digest(sortedRows((await rowsOf("public", "restaurants")).map(({ id, menu_version, menu_version_transaction }) =>
      ({ id, menu_version, menu_version_transaction })), ["id"])) ===
    digest(sortedRows(payload.tables.restaurants.map(({ id, menu_version, menu_version_transaction }) =>
      ({ id, menu_version, menu_version_transaction })), ["id"])));
  const bytesInMemory = new Map();
  for (const object of payload.objects) {
    const bytes = Buffer.from(object.dataBase64, "base64");
    check("Storage content restored in memory: " + sha256(object.path).slice(0, 12),
      bytes.length === object.bytes && sha256(bytes) === object.sha256 && !bytesInMemory.has(object.path));
    bytesInMemory.set(object.path, bytes);
    const record = payload.before.api.objects.find((r) => r.path === object.path);
    ensure(record && record.metadata.mimetype === object.contentType, "OBJECT_METADATA_INVALID", "Falta metadata del objeto.");
    await db.query("insert into storage.objects(id,bucket_id,name) values($1,$2,$3)", [record.id, record.bucket, object.path]);
  }
  check("Storage object inventory hash and count exact",
    digest(payload.objects.map(({ path, bytes, sha256, contentType }) => ({ path, bytes, sha256, contentType }))) ===
    manifest.objectInventorySha256 && bytesInMemory.size === manifest.counts.objects &&
    [...bytesInMemory.values()].reduce((n, bytes) => n + bytes.length, 0) === manifest.counts.objectBytes);
  check("Original QR UUIDs retained",
    sameRows((await rowsOf("public", "restaurants")).map(({ id, public_token }) => ({ id, public_token })),
      payload.tables.restaurants.map(({ id, public_token }) => ({ id, public_token })), ["id"]));
  const members = payload.tables.restaurant_memberships;
  const restaurantIds = new Set(payload.tables.restaurants.map((row) => row.id));
  check("Three unique restaurants and owner memberships support all six tenant pairs",
    payload.tables.restaurants.length === 3 && restaurantIds.size === 3 && members.length === 3 &&
    new Set(members.map((row) => row.restaurant_id)).size === 3 &&
    new Set(members.map((row) => row.user_id)).size === 3 &&
    members.every((row) => restaurantIds.has(row.restaurant_id) && payload.authUsers.some((u) => u.id === row.user_id)));
  let tenantPairs = 0;
  for (const owner of members) for (const other of members.filter((m) => m.restaurant_id !== owner.restaurant_id)) {
    await db.exec("begin;set local role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner.user_id]);
      const visible = (await db.query("select count(*)::int as n from public.products where restaurant_id=$1",
        [other.restaurant_id])).rows[0].n;
      tenantPairs++;
      check("Owner RLS isolation pair " + tenantPairs, visible === 0);
    } finally { await db.exec("rollback"); }
  }
  check("Exactly six owner-to-other-tenant pairs tested", tenantPairs === 6);
  const security = (await db.query(
    "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as rls," +
    "(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D')::int as disabled",
  )).rows[0];
  check("Fifteen public tables retain RLS and all application triggers enabled", security.rls === 15 && security.disabled === 0);
  const restoredTables = {};
  for (const [name] of TABLES) restoredTables[name] = ordered(await rowsOf("public", name));
  check("Final application hash equals captured target", digest(restoredTables) === manifest.applicationDataSha256);
  const evidence = {
    at: new Date().toISOString(), result: "PASS", targetProjectRef: TARGET_PROJECT,
    archiveSha256: expectedSha, operation: "Isolated application restore from populated-target encrypted backup",
    engine: "PGlite 0.5.10 in memory", passed: checks.length, failed: 0, checks, imported,
    counts: manifest.counts, tenantPairs, privateRows: Object.fromEntries(Object.entries(payload.privateTables).map(([name, rows]) => [name, rows.length])),
    remoteRequests: 0, remoteMutations: 0, plaintextFilesWritten: 0,
    fullManagedSupabaseRestoreExecuted: false, authLoginTested: false, storageHttpTested: false,
    limitations: [
      "Only the application schema and rows plus captured private rows are restored in isolated PGlite.",
      "Auth uses UUID-only stubs; captured profile bytes/hashes and full PostgreSQL dump are verified, but GoTrue/password/session restoration is not executed.",
      "Storage object bytes and technical IDs are restored in memory/stub table, not through the Storage HTTP service.",
      "Full custom dump decode is validation, not execution of all managed Supabase DDL.",
    ],
  };
  const file = saveTargetEvidence("target-final-restore-local.json", evidence);
  console.log(JSON.stringify({ result: "PASS", passed: checks.length, counts: manifest.counts,
    privateRows: evidence.privateRows, remoteRequests: 0, evidence: file }));
} catch (error) {
  failReport(error, stage);
} finally {
  key?.fill(0);
  await db?.close();
}
