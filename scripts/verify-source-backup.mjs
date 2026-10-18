import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  ROOT,
  BACKUP_DIR,
  PROJECT,
  BUCKET,
  TABLES,
  LIMITS,
  ensure,
  failReport,
  sha256,
  digest,
  sortedRows,
  dataFingerprint,
  protectBackupDirectory,
  loadBackupKey,
  encryptArchive,
  decryptArchive,
  guardedFetch,
  collectPages,
} from "./backup-common.mjs";

const APPROVED_BASELINES = {
  "application-20261017193357263.json.enc":
    "79be105c5b3828056209dcab47c3e887dccac158e0121a8416f848b267e73207",
  "application-source-current-20261018012154252.json.enc":
    "148c4dd9feba2a2b7257e6314cf594b406a9ed80865cf08fd103503198130c6a",
};
const BASELINE_FILE =
  process.env.SOURCE_VERIFY_BASELINE ||
  "application-20261017193357263.json.enc";
const BASELINE_SHA = APPROVED_BASELINES[BASELINE_FILE];
const compareOnly = process.env.SOURCE_VERIFY_COMPARE_ONLY === "true";
const trace = [];
const verificationId =
  "source-verification-" + new Date().toISOString().replace(/[-:.]/g, "");
const evidenceDirectory = resolve(
  ROOT,
  "docs/evidence/migrations/hgntppemxwcxaxritnfq",
  verificationId,
);
function compareRows(previous, current, keys) {
  const key = (row) => JSON.stringify(keys.map((k) => row[k]));
  const old = new Map(previous.map((row) => [key(row), row]));
  const now = new Map(current.map((row) => [key(row), row]));
  const fieldChanges = {};
  let added = 0,
    removed = 0,
    changed = 0;
  for (const [id, row] of old) {
    if (!now.has(id)) {
      removed++;
      continue;
    }
    const next = now.get(id);
    if (digest(row) !== digest(next)) {
      changed++;
      for (const field of new Set([...Object.keys(row), ...Object.keys(next)]))
        if (
          digest(row[field] === undefined ? { missing: true } : row[field]) !==
          digest(next[field] === undefined ? { missing: true } : next[field])
        )
          fieldChanges[field] = (fieldChanges[field] || 0) + 1;
    }
  }
  for (const id of now.keys()) if (!old.has(id)) added++;
  return {
    beforeRows: previous.length,
    afterRows: current.length,
    added,
    removed,
    changed,
    fieldChanges,
    equal: !added && !removed && !changed,
    beforeSha256: digest(sortedRows(previous, keys)),
    afterSha256: digest(sortedRows(current, keys)),
  };
}
let stage = "initialization";
let secretKey;
try {
  ensure(
    process.env.SOURCE_VERIFY_READ_ONLY === PROJECT,
    "SOURCE_READ_OPT_IN_REQUIRED",
    "Confirme la lectura autorizada del proyecto origen.",
  );
  ensure(
    Boolean(BASELINE_SHA),
    "UNAPPROVED_BASELINE",
    "Select an explicitly approved encrypted baseline.",
  );
  const acl = protectBackupDirectory();
  const originalBytes = readFileSync(resolve(BACKUP_DIR, BASELINE_FILE));
  ensure(
    sha256(originalBytes) === BASELINE_SHA,
    "BASELINE_ARCHIVE_CHANGED",
    "El respaldo base no coincide con el hash revisado.",
  );
  const { key, mode } = loadBackupKey(false);
  secretKey = key;
  const baseline = decryptArchive(originalBytes, key);
  ensure(
    baseline.manifest.projectRef === PROJECT &&
      baseline.manifest.consistentDoubleRead,
    "BASELINE_INVALID",
    "El respaldo no corresponde al origen estable revisado.",
  );
  for (const [table] of TABLES)
    ensure(
      digest(baseline.tables[table]) ===
        baseline.manifest.tableHashes[table].sha256,
      "BASELINE_INVALID",
      "El hash interno de una tabla no coincide.",
    );
  ensure(
    digest(baseline.users) === baseline.manifest.authProfilesSha256,
    "BASELINE_INVALID",
    "El hash interno de perfiles no coincide.",
  );
  for (const object of baseline.objects)
    ensure(
      sha256(Buffer.from(object.dataBase64, "base64")) === object.sha256,
      "BASELINE_INVALID",
      "El hash interno de un objeto no coincide.",
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  ensure(
    url === "https://" + PROJECT + ".supabase.co" && serviceKey,
    "PROJECT_MISMATCH",
    "Se requiere la URL exacta del proyecto autorizado y su clave de servicio por entorno.",
  );
  const readFetch = guardedFetch(url, async (input, options = {}) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const method = (
      options.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const rest =
      method === "GET" &&
      (u.pathname === "/rest/v1/" ||
        TABLES.some(([t]) => u.pathname === "/rest/v1/" + t));
    const auth = method === "GET" && u.pathname === "/auth/v1/admin/users";
    const bucket =
      method === "GET" && u.pathname === "/storage/v1/bucket/" + BUCKET;
    const listing =
      method === "POST" && u.pathname === "/storage/v1/object/list/" + BUCKET;
    const download =
      method === "GET" &&
      u.pathname.startsWith("/storage/v1/object/" + BUCKET + "/");
    ensure(
      rest || auth || bucket || listing || download,
      "SOURCE_OPERATION_NOT_ALLOWED",
      "Blocked an operation outside the backup read allowlist.",
    );
    const response = await fetch(input, options);
    trace.push({
      operation: rest
        ? "table-or-schema-read"
        : auth
          ? "auth-profiles-read"
          : bucket
            ? "bucket-read"
            : listing
              ? "storage-list-read"
              : "object-download",
      method,
      status: response.status,
    });
    return response;
  });
  const db = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: readFetch },
  });
  // An added public table must fail closed rather than silently disappearing from a backup.
  const schemaResponse = await readFetch(url + "/rest/v1/", {
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      Accept: "application/openapi+json",
    },
  });
  ensure(
    schemaResponse.ok,
    "SCHEMA_READ_FAILED",
    "No fue posible comprobar el inventario de tablas expuestas.",
  );
  const schema = await schemaResponse.json();
  const exposedTables = Object.keys(schema.paths || {})
    .filter((name) => /^\/[a-z_]+$/.test(name))
    .map((name) => name.slice(1))
    .sort();
  ensure(
    digest(exposedTables) === digest(TABLES.map(([name]) => name).sort()),
    "TABLE_INVENTORY_CHANGED",
    "El inventario remoto de tablas no coincide con las quince tablas previstas; actualizar el respaldo antes de continuar.",
  );

  async function readTable(table, keys) {
    const rows = await collectPages(async (offset, size) => {
      let query = db.from(table).select("*", { count: "exact" });
      for (const key of keys) query = query.order(key, { ascending: true });
      const { data, count, error } = await query.range(
        offset,
        offset + size - 1,
      );
      ensure(
        !error && count !== null,
        "TABLE_READ_FAILED",
        "Falló la lectura de la tabla " + table + ".",
      );
      return { rows: data, total: count };
    });
    ensure(
      new Set(rows.map((row) => JSON.stringify(keys.map((key) => row[key]))))
        .size === rows.length,
      "DUPLICATE_PAGE",
      "Se detectaron claves repetidas en la lectura de " + table + ".",
    );
    return sortedRows(rows, keys);
  }
  async function readUsers() {
    let page = 0;
    const users = await collectPages(async (_offset, size) => {
      const { data, error } = await db.auth.admin.listUsers({
        page: ++page,
        perPage: size,
      });
      ensure(
        !error,
        "AUTH_READ_FAILED",
        "Falló la lectura paginada de identidades Auth.",
      );
      return { rows: data.users, total: data.total };
    });
    const fields = [
      "id",
      "email",
      "phone",
      "created_at",
      "updated_at",
      "email_confirmed_at",
      "phone_confirmed_at",
      "banned_until",
      "is_anonymous",
      "app_metadata",
      "user_metadata",
    ];
    const selected = users.map((user) =>
      Object.fromEntries(
        fields
          .filter((field) => user[field] !== undefined)
          .map((field) => [field, user[field]]),
      ),
    );
    ensure(
      new Set(selected.map((user) => user.id)).size === selected.length,
      "DUPLICATE_PAGE",
      "Auth devolvió identidades repetidas.",
    );
    return sortedRows(selected, ["id"]);
  }
  async function readObjects() {
    const files = [],
      pending = [""],
      folders = new Set();
    while (pending.length) {
      const prefix = pending.shift();
      ensure(
        !folders.has(prefix),
        "STORAGE_LIST_INVALID",
        "Storage devolvió una carpeta repetida.",
      );
      folders.add(prefix);
      const entries = await collectPages(
        async (offset, limit) => {
          const { data, error } = await db.storage.from(BUCKET).list(prefix, {
            limit,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
          ensure(
            !error,
            "STORAGE_READ_FAILED",
            "Falló el inventario de objetos Storage.",
          );
          return { rows: data };
        },
        { max: LIMITS.objects },
      );
      for (const entry of entries) {
        ensure(
          typeof entry.name === "string" &&
            entry.name &&
            !entry.name.includes("/") &&
            ![".", ".."].includes(entry.name),
          "STORAGE_PATH_INVALID",
          "Storage devolvió un nombre de objeto inseguro.",
        );
        const path = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.id === null) pending.push(path);
        else
          files.push({
            path,
            id: entry.id,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            metadata: entry.metadata,
          });
      }
      ensure(
        files.length + pending.length <= LIMITS.objects,
        "BACKUP_LIMIT",
        "El bucket excede el límite de objetos; no se truncó el respaldo.",
      );
    }
    ensure(
      new Set(files.map((file) => file.path)).size === files.length,
      "DUPLICATE_PAGE",
      "Storage devolvió rutas repetidas.",
    );
    return sortedRows(files, ["path"]);
  }
  async function capture() {
    const tables = {};
    for (const [table, keys] of TABLES)
      tables[table] = await readTable(table, keys);
    const users = await readUsers();
    const { data: bucket, error } = await db.storage.getBucket(BUCKET);
    ensure(
      !error && bucket && bucket.public === false,
      "BUCKET_INVALID",
      "El bucket de la aplicación debe existir y permanecer privado.",
    );
    const objects = await readObjects();
    return { tables, users, bucket, objects };
  }

  stage = "source-before";
  const startedAt = new Date().toISOString();
  const before = await capture();
  stage = "object-downloads";
  let objectBytes = 0;
  const objects = [];
  for (const object of before.objects) {
    const { data, error } = await db.storage.from(BUCKET).download(object.path);
    ensure(
      !error && data,
      "OBJECT_READ_FAILED",
      "No fue posible leer un objeto privado; no se genera un respaldo parcial.",
    );
    const bytes = Buffer.from(await data.arrayBuffer());
    objectBytes += bytes.length;
    ensure(
      objectBytes <= LIMITS.totalObjectBytes,
      "BACKUP_LIMIT",
      "Los objetos exceden el límite de memoria declarado; no se truncó el respaldo.",
    );
    if (object.metadata?.size !== undefined)
      ensure(
        Number(object.metadata.size) === bytes.length,
        "OBJECT_CHANGED",
        "Cambió el tamaño de un objeto durante el respaldo.",
      );
    objects.push({
      ...object,
      bytes: bytes.length,
      sha256: sha256(bytes),
      dataBase64: bytes.toString("base64"),
    });
  }
  stage = "source-after";
  const after = await capture();
  const beforeHash = dataFingerprint(before),
    afterHash = dataFingerprint(after);
  ensure(
    beforeHash === afterHash,
    "SOURCE_CHANGED",
    "Los datos cambiaron entre las lecturas; el respaldo se descarta. Repetir sin ediciones ni tráfico que cambie métricas.",
  );
  const migrations = readdirSync(resolve(ROOT, "supabase", "migrations"))
    .filter((file) => /^\d+_[a-z0-9_]+[.]sql$/.test(file))
    .sort()
    .map((file) => {
      const sql = readFileSync(
        resolve(ROOT, "supabase", "migrations", file),
        "utf8",
      ).replace(/^\uFEFF/, "");
      return { file, sql, sha256: sha256(sql) };
    });
  const manifest = {
    formatVersion: 1,
    scope: "application-logical-readonly",
    projectRef: PROJECT,
    bucket: BUCKET,
    startedAt,
    completedAt: new Date().toISOString(),
    consistentDoubleRead: true,
    sourceBeforeSha256: beforeHash,
    sourceAfterSha256: afterHash,
    tableHashes: Object.fromEntries(
      TABLES.map(([table]) => [
        table,
        {
          rows: before.tables[table].length,
          sha256: digest(before.tables[table]),
        },
      ]),
    ),
    authProfileCount: before.users.length,
    authProfilesSha256: digest(before.users),
    bucketSha256: digest(before.bucket),
    objectCount: objects.length,
    objectBytes,
    objectManifestSha256: digest(
      objects.map(({ path, id, bytes, sha256 }) => ({
        path,
        id,
        bytes,
        sha256,
      })),
    ),
    migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })),
    excluded: [
      "Auth password hashes, sessions, refresh tokens and MFA secrets",
      "private.rate_limits",
      "private.restaurant_creation_requests",
      "Supabase managed schemas, roles, extension binaries and full PostgreSQL snapshot",
      "Auth/SMTP/JWT/provider settings and secret keys",
      "Storage managed DB metadata not exposed by list/getBucket",
    ],
    consistencyLimit:
      "Two equal API reads detect observed changes but do not provide a PostgreSQL transaction snapshot or PITR.",
  };
  const payload = {
    manifest,
    tables: before.tables,
    users: before.users,
    bucket: before.bucket,
    objects,
    migrations,
  };
  stage = "compare-baseline";
  const tableChanges = Object.fromEntries(
    TABLES.map(([table, keys]) => [
      table,
      compareRows(baseline.tables[table], before.tables[table], keys),
    ]),
  );
  const authChanges = compareRows(baseline.users, before.users, ["id"]);
  const stableAuth = (user) =>
    Object.fromEntries(
      Object.entries(user).filter(([key]) => key !== "updated_at"),
    );
  const authWithoutUpdatedAt = compareRows(
    baseline.users.map(stableAuth),
    before.users.map(stableAuth),
    ["id"],
  );
  const inventoryFields = ({ path, id, created_at, updated_at, metadata }) => ({
    path,
    id,
    created_at,
    updated_at,
    metadata,
  });
  const contentFields = ({ path, bytes, sha256 }) => ({ path, bytes, sha256 });
  const storageInventory = compareRows(
    baseline.objects.map(inventoryFields),
    objects.map(inventoryFields),
    ["path"],
  );
  const storageBytes = compareRows(
    baseline.objects.map(contentFields),
    objects.map(contentFields),
    ["path"],
  );
  const bucketEqual = digest(baseline.bucket) === digest(before.bucket);
  const migrationEqual =
    digest(baseline.manifest.migrations) === digest(manifest.migrations);
  const changed =
    Object.values(tableChanges).some((c) => !c.equal) ||
    !authChanges.equal ||
    !storageInventory.equal ||
    !storageBytes.equal ||
    !bucketEqual ||
    !migrationEqual;
  let refreshedArchive = null;
  if (changed && !compareOnly) {
    stage = "encrypt-new-archive";
    const encrypted = encryptArchive(payload, key, mode);
    ensure(
      digest(decryptArchive(encrypted, key)) === digest(payload),
      "ENCRYPTION_VERIFY_FAILED",
      "New encrypted archive failed integrity validation.",
    );
    const basename =
      "application-source-current-" +
      startedAt.replace(/[^0-9]/g, "") +
      ".json.enc";
    writeFileSync(resolve(BACKUP_DIR, basename), encrypted, {
      flag: "wx",
      mode: 0o600,
    });
    refreshedArchive = {
      file: ".runtime/backups/" + basename,
      bytes: encrypted.length,
      sha256: sha256(encrypted),
      keyProtection: mode,
    };
  }
  ensure(
    sha256(readFileSync(resolve(BACKUP_DIR, BASELINE_FILE))) === BASELINE_SHA,
    "BASELINE_ARCHIVE_CHANGED",
    "Baseline archive changed during verification.",
  );
  const evidence = {
    at: new Date().toISOString(),
    result: "PASS",
    comparison: changed ? "DIFFERENCES_FOUND" : "UNCHANGED",
    comparisonOnly: compareOnly,
    refreshedCaptureSkipped: changed && compareOnly,
    projectRef: PROJECT,
    baseline: {
      file: ".runtime/backups/" + BASELINE_FILE,
      sha256: BASELINE_SHA,
      preserved: true,
    },
    refreshedArchive,
    tableChanges,
    authChanges,
    authWithoutUpdatedAt,
    storage: {
      inventory: storageInventory,
      content: storageBytes,
      objects: objects.length,
      bytes: objectBytes,
      bucketEqual,
      beforeBucketSha256: digest(baseline.bucket),
      afterBucketSha256: digest(before.bucket),
    },
    migrationEqual,
    sourceDoubleRead: {
      beforeSha256: beforeHash,
      afterSha256: afterHash,
      equal: true,
      transactionSnapshot: false,
    },
    acl,
    requestSummary: {
      total: trace.length,
      byOperation: Object.fromEntries(
        [...new Set(trace.map((t) => t.operation))].map((op) => [
          op,
          trace.filter((t) => t.operation === op).length,
        ]),
      ),
      unexpectedStatus: trace.filter((t) => t.status >= 400),
    },
    remoteMutations: 0,
    authLogins: 0,
    authLogouts: 0,
    sqlConnections: 0,
    plaintextBackupFilesWritten: 0,
    migrationContractChanged: false,
    cutoffDeclared: false,
    limits: [
      ...manifest.excluded,
      "Auth comparison includes only profile fields exported in the original archive; last_sign_in_at was not exported.",
      "Read-only revalidation is not a maintenance window, source freeze, or authority to import a refreshed archive.",
    ],
  };
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(
    resolve(evidenceDirectory, "source-currentness.json"),
    JSON.stringify(evidence, null, 2) + "\n",
    { flag: "wx" },
  );
  if (changed && compareOnly) process.exitCode = 2;
  console.log(
    JSON.stringify({
      result: evidence.result,
      comparison: evidence.comparison,
      evidence:
        "docs/evidence/migrations/hgntppemxwcxaxritnfq/" +
        verificationId +
        "/source-currentness.json",
      changedTables: Object.fromEntries(
        Object.entries(tableChanges).filter(([, v]) => !v.equal),
      ),
      auth: authChanges,
      storage: {
        inventoryEqual: storageInventory.equal,
        contentEqual: storageBytes.equal,
        objects: objects.length,
        bytes: objectBytes,
      },
      refreshedArchive,
      originalArchivePreserved: true,
      remoteMutations: 0,
      authLogins: 0,
    }),
  );
} catch (error) {
  failReport(error, stage);
} finally {
  secretKey?.fill(0);
}
