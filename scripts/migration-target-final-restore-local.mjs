import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT, LIMITS, ensure, failReport, digest, sha256, sortedRows, safeLocalPath,
  loadBackupKey, decryptArchive, protectBackupDirectory,
} from "./backup-common.mjs";
import { TARGET_PROJECT, sameRows } from "./migration-data-common.mjs";
import { decodeLocalArchive, applicationCatalog, capturedMigrations } from "./migration-target-final-backup.mjs";
import { saveTargetEvidence } from "./migration-target-inspect.mjs";

let db;

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

const ordered = (rows) => [...rows].sort((a, b) => digest(a).localeCompare(digest(b)));
const rowsOf = async (schema, name) => (await db.query(
  'select to_jsonb(t) as row from "' + schema + '"."' + name + '" t',
)).rows.map((r) => r.row);
export function catalogOrder(catalog) {
 const pending=new Map(catalog.map(r=>[r.schema+"."+r.name,r])),ordered=[];
 ensure(pending.size===catalog.length,"CATALOG_INVALID","Tablas repetidas en catálogo.");
 while(pending.size){
  const ready=[...pending].filter(([,row])=>row.dependencies.every(dep=>!pending.has(dep.schema+"."+dep.name)));
  ensure(ready.length>0,"FOREIGN_KEY_CYCLE","El ensayo requiere un orden explícito para un ciclo de claves externas.");
  for(const [name,row] of ready){ordered.push(row);pending.delete(name);}
 }
 return ordered;
}
export async function restoreCapturedRows(connection,payload) {
 // This helper cannot accept a remote PostgreSQL adapter.
 ensure(connection instanceof PGlite,"LOCAL_ENGINE_REQUIRED","La restauración de ensayo sólo admite PGlite local.");
 const catalog=await applicationCatalog(connection);
 const capturedKeys=[...Object.keys(payload.tables).map(name=>"public."+name),...Object.keys(payload.privateTables).map(name=>"private."+name)].sort();
 ensure(capturedKeys.join()===catalog.map(row=>row.schema+"."+row.name).sort().join(),
  "CATALOG_MISMATCH","Las tablas capturadas no coinciden con las migraciones capturadas.");
 if(payload.catalog)ensure(digest(payload.catalog)===digest(catalog),"CATALOG_MISMATCH","El catálogo restaurado difiere del capturado.");
 const order=catalogOrder(catalog),quote=row=>'"'+row.schema+'"."'+row.name+'"';
 let inserted=0;
 await connection.exec("begin");
 try{
  for(const row of order)await connection.exec("alter table "+quote(row)+" disable trigger user");
  // The caller has just created this isolated database from the verified migration SQL.
  // Remove only its migration seed rows; FK checks stay enabled throughout.
  for(const row of [...order].reverse())await connection.exec("delete from "+quote(row));
  for(const row of order){
   const values=(row.schema==="public"?payload.tables:payload.privateTables)[row.name];
   ensure(Array.isArray(values)&&values.length<=LIMITS.rowsPerTable,"TABLE_LIMIT","Tabla inválida o demasiado grande.");
   const columns=(await connection.query("select column_name from information_schema.columns where table_schema=$1 and table_name=$2 and is_generated='NEVER' order by ordinal_position",[row.schema,row.name])).rows.map(r=>r.column_name);
   ensure(columns.length&&columns.every(c=>/^[a-z_][a-z0-9_]*$/.test(c)),"SCHEMA_INVALID","Columnas inválidas.");
   const names=columns.map(c=>'"'+c+'"').join(",");
   if(values.length)await connection.query("insert into "+quote(row)+"("+names+") select "+names+" from jsonb_populate_recordset(null::"+quote(row)+",$1::jsonb)",[JSON.stringify(values)]);
   inserted+=values.length;
  }
  for(const row of order)await connection.exec("alter table "+quote(row)+" enable trigger user");
  for(const row of order){
   const actual=(await connection.query("select to_jsonb(t) as row from "+quote(row)+" t")).rows.map(r=>r.row);
   const expected=(row.schema==="public"?payload.tables:payload.privateTables)[row.name];
   ensure(digest(ordered(actual))===digest(ordered(expected)),"RESTORE_HASH_MISMATCH","La restauración no conserva las filas exactas.");
  }
  await connection.exec("commit");
  return {inserted,tables:catalog.length};
 }catch(error){await connection.exec("rollback");throw error;}
}

export async function restoreFinalTarget() {
 let key, stage = "local-archive-validation";
 checks.length=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error("LOCAL_RESTORE_NETWORK_FORBIDDEN");};
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
  const migrations = capturedMigrations(payload.before.sql.migrations);
  check("Only captured migrations selected; newer local SQL is excluded", migrations.length === payload.before.sql.migrations.length);
  if(manifest.catalogSha256) check("Captured table catalog hash", digest(payload.catalog)===manifest.catalogSha256);
  if(manifest.schemaHistorySha256) check("Captured migration history hash", digest(payload.before.sql.migrations)===manifest.schemaHistorySha256);
  check("Distinct Auth identity UUIDs captured", new Set(payload.authUsers.map(u=>u.id)).size===payload.authUsers.length && payload.authUsers.length===manifest.counts.authUsers);
  stage = "isolated-pglite-restore";
  db = new PGlite();
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;" +
    "create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;" +
    "create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}');create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz not null default now());" +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
    "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));" +
    "alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;set timezone='UTC';",
  );
  for (const {sql} of migrations) await db.exec(sql);
  for (const user of payload.authUsers) await db.query("insert into auth.users(id,raw_app_meta_data) values($1,$2::jsonb)", [user.id,JSON.stringify(user.raw_app_meta_data||{})]);
  const imported = await restoreCapturedRows(db,payload);
  const catalog = await applicationCatalog(db);
  for(const row of catalog) check("Exact restored rows: "+row.schema+"."+row.name, digest(ordered(await rowsOf(row.schema,row.name)))===digest(ordered((row.schema==="public"?payload.tables:payload.privateTables)[row.name])));
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
  check("Captured restaurants and one-owner memberships retain their identities",
    restaurantIds.size === payload.tables.restaurants.length &&
    new Set(members.map((row) => row.restaurant_id)).size === members.length &&
    new Set(members.map((row) => row.user_id)).size === members.length &&
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
  check("All captured owner-to-other-tenant pairs tested", tenantPairs === members.length*(members.length-1));
  const security = (await db.query(
    "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as rls," +
    "(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D')::int as disabled",
  )).rows[0];
  check("All captured public tables retain RLS and application triggers are enabled", security.rls === Object.keys(payload.tables).length && security.disabled === 0);
  const restoredTables = {};
  for (const name of Object.keys(payload.tables)) restoredTables[name] = ordered(await rowsOf("public", name));
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
      "Auth uses identity/metadata and empty session stubs; captured profile bytes/hashes and full PostgreSQL dump are verified, but GoTrue/password/session restoration is not executed.",
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
  globalThis.fetch=originalFetch;
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await restoreFinalTarget();
