import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  ROOT, BUCKET, TABLES, LIMITS, ensure, failReport, sha256, digest, sortedRows,
  collectPages, safeLocalPath, loadBackupKey, decryptArchive,
} from "./backup-common.mjs";
import {
  TARGET_PROJECT, SOURCE_ARCHIVE_SHA256, assertTargetEnvironment, validateMigrationSource,
} from "./migration-data-common.mjs";
import { saveTargetEvidence } from "./migration-target-inspect.mjs";

export const BUSINESS_TABLES = TABLES.filter(([table]) =>
  !["security_audit_events", "visit_events"].includes(table));
const SOURCE_FILE = "application-source-current-20261018012154252.json.enc";
const safePath = (path) => typeof path === "string" && path.length <= 1024 &&
  path.split("/").every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..");

export function normalizedBusinessRows(table, rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([field]) =>
    field !== "updated_at" && !(table === "restaurants" &&
      ["menu_version", "menu_version_transaction"].includes(field)))));
}

export function rowComparison(expected, actual, keys) {
  const key = (row) => JSON.stringify(keys.map((field) => row[field]));
  const left = new Map(expected.map((row) => [key(row), row]));
  const right = new Map(actual.map((row) => [key(row), row]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, row] of left) {
    if (!right.has(id)) removed++;
    else if (digest(row) !== digest(right.get(id))) changed++;
  }
  for (const id of right.keys()) if (!left.has(id)) added++;
  const duplicates = left.size !== expected.length || right.size !== actual.length;
  return { expectedRows: expected.length, actualRows: actual.length, added, removed, changed, duplicates,
    expectedSha256: digest(sortedRows(expected, keys)), actualSha256: digest(sortedRows(actual, keys)),
    equal: !duplicates && added === 0 && removed === 0 && changed === 0 };
}

// No Auth login/logout, RPC, write endpoint or arbitrary origin can reach fetch.
export function integrityReadFetch(env, stats, delegate = fetch) {
  const { origin } = assertTargetEnvironment(env);
  return async (input, options = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (options.method || request?.method || "GET").toUpperCase();
    const table = method === "GET" && BUSINESS_TABLES.some(([name]) => url.pathname === "/rest/v1/" + name);
    const auth = method === "GET" && url.pathname === "/auth/v1/admin/users";
    const buckets = method === "GET" && ["/storage/v1/bucket", "/storage/v1/bucket/" + BUCKET].includes(url.pathname);
    const list = method === "POST" && url.pathname === "/storage/v1/object/list/" + BUCKET;
    const prefix = "/storage/v1/object/" + BUCKET + "/";
    const download = method === "GET" && url.pathname.startsWith(prefix) && safePath(url.pathname.slice(prefix.length));
    ensure(url.origin === origin && !url.username && !url.password &&
      (table || auth || buckets || list || download),
    "INTEGRITY_REQUEST_BLOCKED", "La verificacion solo permite lecturas del nuevo destino autorizado.");
    const kind = table ? "businessTable" : auth ? "authProfiles" : buckets ? "buckets" : list ? "storageList" : "storageDownload";
    stats.requests++;
    stats.operations[kind] = (stats.operations[kind] || 0) + 1;
    const response = await delegate(input, { ...options, redirect: "error",
      signal: options.signal || AbortSignal.timeout(60_000) });
    if (!response.ok) stats.failedRequests++;
    return response;
  };
}

async function resultOf(call, code) {
  let result;
  try { result = await call(); } catch { /* Never propagate private SDK error text. */ }
  ensure(result && !result.error && result.data !== null && result.data !== undefined,
    code, "No se pudo completar una lectura de integridad; se omiten datos privados.");
  return result;
}

function bucketProjection(bucket) {
  return { id: bucket.id, name: bucket.name, public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    allowed_mime_types: Array.isArray(bucket.allowed_mime_types) ? [...bucket.allowed_mime_types].sort() : null };
}

async function targetSnapshot(db) {
  const tables = {};
  for (const [table, keys] of BUSINESS_TABLES) {
    const rows = await collectPages(async (offset, size) => {
      let query = db.from(table).select("*", { count: "exact" });
      for (const key of keys) query = query.order(key, { ascending: true });
      const result = await resultOf(() => query.range(offset, offset + size - 1), "INTEGRITY_TABLE_READ_FAILED");
      ensure(Number.isSafeInteger(result.count) && result.count >= 0,
        "INTEGRITY_TABLE_READ_FAILED", "El conteo de tabla no es valido.");
      return { rows: result.data, total: result.count };
    });
    tables[table] = sortedRows(normalizedBusinessRows(table, rows), keys);
  }
  let page = 0;
  const users = (await collectPages(async (_offset, perPage) => {
    const { data } = await resultOf(() => db.auth.admin.listUsers({ page: ++page, perPage }), "INTEGRITY_AUTH_READ_FAILED");
    return { rows: data.users, total: data.total };
  })).map(({ id, email }) => ({ id, email }));
  const buckets = await collectPages(async (offset, limit) => {
    const { data } = await resultOf(() => db.storage.listBuckets({ limit, offset, sortColumn: "name", sortOrder: "asc" }),
      "INTEGRITY_BUCKET_READ_FAILED");
    return { rows: data.map(bucketProjection) };
  }, { max: 10000 });
  ensure(buckets.some((bucket) => bucket.id === BUCKET), "INTEGRITY_BUCKET_MISSING", "Falta el bucket de la aplicacion.");
  const bucket = bucketProjection((await resultOf(() => db.storage.getBucket(BUCKET), "INTEGRITY_BUCKET_READ_FAILED")).data);
  const storage = db.storage.from(BUCKET), queue = [""], visited = new Set([""]), objects = [];
  const paths = new Set();
  for (let i = 0; i < queue.length; i++) {
    const prefix = queue[i];
    const entries = await collectPages(async (offset, limit) => ({ rows: (await resultOf(
      () => storage.list(prefix, { offset, limit, sortBy: { column: "name", order: "asc" } }),
      "INTEGRITY_STORAGE_LIST_FAILED",
    )).data }), { max: LIMITS.objects });
    for (const entry of entries) {
      ensure(safePath(entry.name) && !entry.name.includes("/"), "INTEGRITY_STORAGE_PATH_INVALID", "Ruta no permitida en el inventario.");
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      ensure(safePath(path), "INTEGRITY_STORAGE_PATH_INVALID", "Ruta no permitida en el inventario.");
      if (entry.id === null) {
        ensure(!visited.has(path) && queue.length < LIMITS.objects,
          "INTEGRITY_STORAGE_LIST_FAILED", "Carpeta repetida o limite de inventario excedido.");
        visited.add(path); queue.push(path);
      } else {
        ensure(!paths.has(path) && objects.length < LIMITS.objects,
          "INTEGRITY_STORAGE_LIST_FAILED", "Objeto repetido o limite de inventario excedido.");
        paths.add(path);
        objects.push({ path, id: entry.id, updated_at: entry.updated_at, metadata: entry.metadata });
      }
    }
  }
  return { tables, users: sortedRows(users, ["id"]), buckets: sortedRows(buckets, ["id"]), bucket,
    objects: sortedRows(objects, ["path"]) };
}

export async function verifyIntegrity({ client, payload }) {
  const before = await targetSnapshot(client);
  const tableComparisons = Object.fromEntries(BUSINESS_TABLES.map(([table, keys]) => [table,
    rowComparison(normalizedBusinessRows(table, payload.tables[table]), before.tables[table], keys)]));
  const auth = rowComparison(payload.users.map(({ id, email }) => ({ id, email })), before.users, ["id"]);
  const buckets = rowComparison([bucketProjection(payload.bucket)], before.buckets, ["id"]);
  const bucketPrivateAndConfigEqual = before.bucket.public === false && digest(before.bucket) === digest(bucketProjection(payload.bucket));
  const sourceByPath = new Map(payload.objects.map((object) => [object.path, object]));
  const objects = [];
  let downloadedObjects = 0, downloadedBytes = 0, metadataMatches = true;
  for (const entry of before.objects) {
    // Extra paths are counted as differences without reading unrelated contents.
    if (!sourceByPath.has(entry.path)) {
      objects.push({ path: entry.path, bytes: Number(entry.metadata?.size), sha256: null,
        contentType: entry.metadata?.mimetype || null });
      continue;
    }
    const source = sourceByPath.get(entry.path);
    ensure(Number(entry.metadata?.size) <= LIMITS.totalObjectBytes - downloadedBytes,
      "INTEGRITY_BYTE_LIMIT", "El inventario supera el limite de descarga autorizado.");
    const { data: blob } = await resultOf(() => client.storage.from(BUCKET).download(entry.path), "INTEGRITY_DOWNLOAD_FAILED");
    ensure(Number.isSafeInteger(blob.size) && blob.size >= 0 && blob.size <= LIMITS.totalObjectBytes - downloadedBytes,
      "INTEGRITY_BYTE_LIMIT", "El objeto supera el limite de descarga autorizado.");
    let bytes;
    try { bytes = Buffer.from(await blob.arrayBuffer()); } catch { /* safe failure below */ }
    ensure(bytes && bytes.length === blob.size, "INTEGRITY_DOWNLOAD_FAILED", "No se pudo leer el objeto completo.");
    downloadedObjects++; downloadedBytes += bytes.length;
    metadataMatches &&= Number(entry.metadata?.size) === bytes.length && entry.metadata?.mimetype === blob.type &&
      entry.metadata?.mimetype === source.metadata.mimetype;
    objects.push({ path: entry.path, bytes: bytes.length, sha256: sha256(bytes), contentType: blob.type });
  }
  const storage = rowComparison(payload.objects.map((object) => ({ path: object.path,
    bytes: object.bytes, sha256: object.sha256, contentType: object.metadata.mimetype })), objects, ["path"]);
  const after = await targetSnapshot(client);
  const doubleRead = { equal: digest(before) === digest(after), beforeSha256: digest(before), afterSha256: digest(after),
    transactionSnapshot: false };
  return { result: Object.values(tableComparisons).every((table) => table.equal) && auth.equal &&
      buckets.equal && bucketPrivateAndConfigEqual && storage.equal && metadataMatches && doubleRead.equal ? "PASS" : "FAIL",
    tables: tableComparisons, auth, buckets, bucketPrivateAndConfigEqual,
    storage: { ...storage, downloadedObjects, downloadedBytes, metadataMatches }, targetDoubleRead: doubleRead };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let key;
  try {
    const args = process.argv.slice(2);
    ensure(args.length === 4 && args[0] === "--target" && args[1] === TARGET_PROJECT &&
      args[2] === "--stage" && ["before-qa", "after-qa"].includes(args[3]),
    "INTEGRITY_USAGE", "Uso: --target referencia-nueva-exacta --stage before-qa|after-qa.");
    const env = parseEnv(readFileSync(resolve(ROOT, ".env.migration.local"), "utf8").replace(/^\uFEFF/, ""));
    assertTargetEnvironment(env);
    const archive = readFileSync(safeLocalPath(resolve(ROOT, ".runtime", "backups", SOURCE_FILE)));
    key = loadBackupKey(false).key;
    const payload = decryptArchive(archive, key);
    validateMigrationSource(payload, archive);
    const stats = { requests: 0, failedRequests: 0, operations: {} };
    const client = createClient(env.TARGET_SUPABASE_URL, env.TARGET_SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: integrityReadFetch(env, stats) },
    });
    const report = await verifyIntegrity({ client, payload });
    const evidence = {
      at: new Date().toISOString(), targetProjectRef: TARGET_PROJECT, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
      stage: args[3], ...report,
      excludedTables: ["security_audit_events", "visit_events"],
      excludedFields: { allBusinessTables: ["updated_at"], restaurants: ["menu_version", "menu_version_transaction"] },
      authScope: "All four original Auth UUIDs and exact emails; no sessions or password values read or tested",
      storageScope: "Exact bucket configuration and complete path/byte/MIME/SHA256 comparison; no extra buckets or objects",
      sourceRequests: 0, remoteMutations: 0, businessContentMutations: false, authSessionLifecycle: false,
      requests: stats, privateRowsOrCredentialValuesPrinted: false,
    };
    const file = saveTargetEvidence("target-integrity-" + args[3] + ".json", evidence);
    console.log(JSON.stringify({ result: report.result, stage: args[3], tables: BUSINESS_TABLES.length,
      differingTables: Object.entries(report.tables).filter(([, table]) => !table.equal).map(([table]) => table),
      authEqual: report.auth.equal, storageEqual: report.storage.equal,
      bucketPrivateAndConfigEqual: report.bucketPrivateAndConfigEqual,
      objectsDownloaded: report.storage.downloadedObjects, bytesDownloaded: report.storage.downloadedBytes,
      remoteMutations: 0, evidence: file }));
    if (report.result !== "PASS") process.exitCode = 2;
  } catch (error) { failReport(error, "new-target-readonly-integrity"); }
  finally { key?.fill(0); }
}
