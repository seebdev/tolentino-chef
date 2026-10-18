import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import {
  ROOT, ensure, failReport, collectPages, sortedRows, digest,
} from "./backup-common.mjs";
import { TARGET_PROJECT, assertTargetEnvironment } from "./migration-data-common.mjs";

export const PG_BIN = resolve(ROOT, ".runtime", "postgresql-17.11", "bin");
export function targetEnvironment() {
  const env = parseEnv(readFileSync(resolve(ROOT, ".env.migration.local"), "utf8").replace(/^\uFEFF/, ""));
  assertTargetEnvironment(env, { requireDatabase: true });
  return env;
}
export function pgReadEnvironment(env) {
  assertTargetEnvironment(env, { requireDatabase: true });
  return {
    ...process.env,
    PGHOST: env.TARGET_SUPABASE_DB_HOST, PGPORT: env.TARGET_SUPABASE_DB_PORT,
    PGUSER: env.TARGET_SUPABASE_DB_USER, PGDATABASE: env.TARGET_SUPABASE_DB_NAME,
    PGPASSWORD: env.TARGET_SUPABASE_DB_PASSWORD, PGSSLMODE: "verify-full",
    PGSSLROOTCERT: resolve(ROOT, ".runtime", "supabase-ca.crt"),
    PGCONNECT_TIMEOUT: "15", PGAPPNAME: "tolentino-readonly-migration-preflight",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=60000",
  };
}
export function readonlyPgTool(tool, args, env, input, timeout = 120_000) {
  ensure(["psql", "pg_dump", "pg_dumpall"].includes(tool),
    "PG_TOOL_INVALID", "Herramienta de lectura PostgreSQL no permitida.");
  const result = spawnSync(resolve(PG_BIN, tool + ".exe"), args, {
    env: pgReadEnvironment(env), input, windowsHide: true, timeout,
    maxBuffer: 256 * 1024 * 1024,
  });
  ensure(result.status === 0, "PG_READ_FAILED",
    "Falló una operación PostgreSQL de sólo lectura; se omiten mensajes con información privada.");
  return { bytes: result.stdout, warningBytes: result.stderr.length };
}
export function sqlRead(env, sql) {
  const result = readonlyPgTool("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-w"],
    env, "begin read only;\n" + sql + "\ncommit;");
  return JSON.parse(result.bytes.toString("utf8").trim());
}
export function readFetchForTarget(env, stats = { requests: 0 }) {
  const { origin } = assertTargetEnvironment(env);
  return async (input, options = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (options.method || request?.method || "GET").toUpperCase();
    ensure(url.origin === origin && (
      method === "GET" || method === "HEAD" ||
      (method === "POST" && /^\/storage\/v1\/object\/list\/[a-zA-Z0-9_.-]+$/.test(url.pathname))
    ), "REMOTE_WRITE_BLOCKED", "La inspección bloqueó una operación que no es de lectura en el destino.");
    stats.requests++;
    return fetch(input, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(60_000) });
  };
}
export function readonlyTargetClient(env, stats) {
  return createClient(env.TARGET_SUPABASE_URL, env.TARGET_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readFetchForTarget(env, stats) },
  });
}
export async function inspectTarget(env, stats = { requests: 0 }) {
  const sql = sqlRead(env, String.raw`
    select json_build_object(
      'serverVersion',current_setting('server_version'),
      'serverVersionNum',current_setting('server_version_num'),
      'database',current_database(),'sessionUser',session_user,
      'transactionReadOnly',current_setting('transaction_read_only'),
      'backendSsl',(select ssl from pg_stat_ssl where pid=pg_backend_pid()),
      'schemas',(select json_agg(nspname order by nspname) from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'),
      'extensions',(select coalesce(json_agg(json_build_object('name',extname,'version',extversion) order by extname),'[]'::json) from pg_extension),
      'applicationRelations',(select coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity) order by n.nspname,c.relname),'[]'::json) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private')),
      'applicationFunctions',(select coalesce(json_agg(json_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'securityDefiner',p.prosecdef) order by n.nspname,p.proname),'[]'::json) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')),
      'applicationPolicies',(select coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'qual',qual,'check',with_check) order by schemaname,tablename,policyname),'[]'::json) from pg_policies where schemaname in('public','private','storage')),
      'applicationTriggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and not t.tgisinternal),
      'migrationTableExists',to_regclass('supabase_migrations.schema_migrations') is not null,
      'authUserCount',(select count(*) from auth.users),
      'storageBucketCount',(select count(*) from storage.buckets),
      'storageObjectCount',(select count(*) from storage.objects)
    );
  `);
  ensure(sql.transactionReadOnly === "on" && sql.database === "postgres" && sql.sessionUser === "postgres",
    "DATABASE_SESSION_INVALID", "La sesión PostgreSQL no coincide con el destino esperado.");
  const conninfo = readonlyPgTool("psql", ["-X", "-q", "-A", "-t", "-w"], env, "\\conninfo\n")
    .bytes.toString("utf8");
  const tls = conninfo.match(/SSL connection \(protocol: ([^,]+), cipher: ([^,)]+)/);
  ensure(tls, "CLIENT_TLS_UNVERIFIED", "No se pudo verificar TLS en la conexión cliente al pooler.");
  sql.clientTls = { protocol: tls[1], cipher: tls[2] };
  sql.migrations = sql.migrationTableExists ?
    sqlRead(env, "select coalesce(json_agg(to_jsonb(t) order by version),'[]'::json) from supabase_migrations.schema_migrations t;") : [];
  const db = readonlyTargetClient(env, stats);
  const publicResponse = await readFetchForTarget(env, stats)(env.TARGET_SUPABASE_URL + "/auth/v1/settings", {
    headers: { apikey: env.TARGET_SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" },
  });
  ensure(publicResponse.ok, "PUBLIC_KEY_INVALID", "La clave pública nueva no superó su verificación HTTP.");
  const publicSettings = await publicResponse.json();
  ensure(typeof publicSettings.disable_signup === "boolean", "PUBLIC_KEY_INVALID", "Respuesta Auth inesperada.");
  // The OpenAPI root requires the administrative key; publishable keys can be rejected there.
  const schemaResponse = await readFetchForTarget(env, stats)(env.TARGET_SUPABASE_URL + "/rest/v1/", {
    headers: { apikey: env.TARGET_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.TARGET_SUPABASE_SERVICE_ROLE_KEY, Accept: "application/openapi+json" },
  });
  ensure(schemaResponse.ok, "SCHEMA_READ_FAILED", "No se pudo leer el esquema REST con la clave administrativa.");
  const publicSchema = await schemaResponse.json();
  let page = 0;
  const users = await collectPages(async (_offset, perPage) => {
    const { data, error } = await db.auth.admin.listUsers({ page: ++page, perPage });
    ensure(!error, "AUTH_INSPECTION_FAILED", "No se pudieron leer las identidades Auth del destino.");
    return { rows: data.users, total: data.total };
  });
  const buckets = await collectPages(async (offset, limit) => {
    const { data, error } = await db.storage.listBuckets({ offset, limit, sortColumn: "id", sortOrder: "asc" });
    ensure(!error, "STORAGE_INSPECTION_FAILED", "No se pudo listar los buckets del destino.");
    return { rows: data };
  }, { max: 10_000 });
  const objects = [];
  for (const bucket of buckets) {
    const pending = [""], visited = new Set();
    while (pending.length) {
      const prefix = pending.shift();
      ensure(!visited.has(prefix), "STORAGE_LIST_INVALID", "Carpetas repetidas en el inventario.");
      visited.add(prefix);
      const entries = await collectPages(async (offset, limit) => {
        const { data, error } = await db.storage.from(bucket.id).list(prefix, {
          offset, limit, sortBy: { column: "name", order: "asc" },
        });
        ensure(!error, "STORAGE_INSPECTION_FAILED", "Falló la lectura de objetos del destino.");
        return { rows: data };
      }, { max: 100_000 });
      for (const entry of entries) {
        ensure(entry.name && !entry.name.includes("/") && ![".", ".."].includes(entry.name),
          "STORAGE_PATH_INVALID", "Ruta inesperada en Storage.");
        const path = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.id === null) pending.push(path);
        else objects.push({ bucket: bucket.id, path, ...entry });
      }
      ensure(objects.length + pending.length <= 100_000, "STORAGE_LIMIT", "El inventario excede el límite explícito.");
    }
  }
  ensure(new Set(users.map((u) => u.id)).size === users.length &&
    new Set(buckets.map((b) => b.id)).size === buckets.length &&
    new Set(objects.map((o) => o.bucket + "/" + o.path)).size === objects.length,
    "DUPLICATE_PAGE", "La inspección devolvió elementos duplicados.");
  ensure(users.length === sql.authUserCount && buckets.length === sql.storageBucketCount &&
    objects.length === sql.storageObjectCount,
    "TARGET_CHANGED", "Los conteos SQL y API difieren; detener la migración.");
  return {
    sql,
    api: {
      publicKeyAccepted: true, adminKeyAccepted: true,
      exposedPaths: Object.keys(publicSchema.paths || {}).sort(),
      users: sortedRows(users, ["id"]), buckets: sortedRows(buckets, ["id"]),
      objects: sortedRows(objects, ["bucket", "path"]),
    },
  };
}
export function initialTargetIsEmpty(snapshot) {
  return snapshot.sql.applicationRelations.length === 0 &&
    snapshot.sql.applicationFunctions.length === 0 &&
    snapshot.sql.applicationPolicies.length === 0 &&
    snapshot.sql.applicationTriggers === 0 &&
    !snapshot.sql.migrationTableExists &&
    snapshot.sql.authUserCount === 0 && snapshot.sql.storageBucketCount === 0 &&
    snapshot.sql.storageObjectCount === 0 && !snapshot.sql.schemas.includes("private");
}
export function publicInspection(snapshot, stats) {
  return {
    at: new Date().toISOString(), result: "PASS", targetProjectRef: TARGET_PROJECT,
    serverVersion: snapshot.sql.serverVersion, clientTls: snapshot.sql.clientTls,
    backendSsl: snapshot.sql.backendSsl,
    backendSslNote: "pg_stat_ssl describes pooler-to-backend; client-to-pooler TLS is verified separately by libpq conninfo.",
    sqlReadOnly: snapshot.sql.transactionReadOnly === "on",
    schemas: snapshot.sql.schemas, extensions: snapshot.sql.extensions,
    applicationRelations: snapshot.sql.applicationRelations.length,
    applicationFunctions: snapshot.sql.applicationFunctions.length,
    applicationPolicies: snapshot.sql.applicationPolicies.length,
    migrationCount: snapshot.sql.migrations.length,
    authUsers: snapshot.sql.authUserCount, storageBuckets: snapshot.sql.storageBucketCount,
    storageObjects: snapshot.sql.storageObjectCount, publicKeyAccepted: snapshot.api.publicKeyAccepted,
    adminKeyAccepted: snapshot.api.adminKeyAccepted, initialTargetIsEmpty: initialTargetIsEmpty(snapshot),
    inventorySha256: digest(snapshot), apiReadRequests: stats.requests, remoteMutations: 0,
  };
}
export function saveTargetEvidence(filename, value, runId = new Date().toISOString().replace(/[^0-9TZ]/g, "")) {
  ensure(/^[a-z0-9-]+[.]json$/.test(filename) && /^[0-9TZ]+$/.test(runId),
    "EVIDENCE_PATH_INVALID", "Ruta de evidencia inválida.");
  const folder = resolve(ROOT, "docs", "evidence", "migrations", TARGET_PROJECT, runId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, filename), JSON.stringify(value, null, 2) + "\n");
  return "docs/evidence/migrations/" + TARGET_PROJECT + "/" + runId + "/" + filename;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const stats = { requests: 0 };
    const snapshot = await inspectTarget(targetEnvironment(), stats);
    const evidence = publicInspection(snapshot, stats);
    const file = saveTargetEvidence("target-inspection.json", evidence);
    console.log(JSON.stringify({ ...evidence, evidence: file }));
  } catch (error) { failReport(error, "target-readonly-inspection"); }
}
