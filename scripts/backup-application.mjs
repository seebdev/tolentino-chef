import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
  writeEvidence,
} from "./backup-common.mjs";

let stage = "initialization";
let secretKey;
try {
  const acl = protectBackupDirectory();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  ensure(
    url === "https://" + PROJECT + ".supabase.co" && serviceKey,
    "PROJECT_MISMATCH",
    "Se requiere la URL exacta del proyecto autorizado y su clave de servicio por entorno.",
  );
  const readFetch = guardedFetch(url);
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
          const { data, error } = await db.storage
            .from(BUCKET)
            .list(prefix, {
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
  stage = "encrypt-write";
  const { key, mode } = loadBackupKey(true);
  secretKey = key;
  const encrypted = encryptArchive(payload, key, mode);
  ensure(
    digest(decryptArchive(encrypted, key)) === digest(payload),
    "ENCRYPTION_VERIFY_FAILED",
    "El cifrado no pasó su comprobación de integridad.",
  );
  const basename =
    "application-" + startedAt.replace(/[^0-9]/g, "") + ".json.enc";
  writeFileSync(resolve(BACKUP_DIR, basename), encrypted, {
    flag: "wx",
    mode: 0o600,
  });
  const evidence = {
    at: new Date().toISOString(),
    result: "PASS",
    operation: "Read-only remote application backup",
    projectRef: PROJECT,
    archive: ".runtime/backups/" + basename,
    archiveBytes: encrypted.length,
    encryptedArchiveSha256: sha256(encrypted),
    cipher: "AES-256-GCM",
    keyProtection: mode,
    acl,
    tables: Object.fromEntries(
      TABLES.map(([table]) => [table, before.tables[table].length]),
    ),
    authProfiles: before.users.length,
    objectCount: objects.length,
    objectBytes,
    migrationCount: migrations.length,
    consistency: {
      beforeAfterEqual: true,
      method:
        "Full row hashes and Auth profiles plus Storage inventory before/after downloads",
      transactionSnapshot: false,
    },
    remoteMutations: 0,
    plaintextBackupFilesWritten: 0,
    completePostgresAuthBackup: false,
    exclusions: manifest.excluded,
  };
  writeEvidence("backup-capture.json", evidence);
  console.log(JSON.stringify(evidence));
} catch (error) {
  failReport(error, stage);
} finally {
  secretKey?.fill(0);
}
