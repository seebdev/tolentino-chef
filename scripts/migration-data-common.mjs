import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT, PROJECT as SOURCE_PROJECT, BUCKET, TABLES,
  ensure, digest, sha256, sortedRows,
} from "./backup-common.mjs";

export const TARGET_PROJECT = "hgntppemxwcxaxritnfq";
export const SOURCE_ARCHIVE_SHA256 =
  "79be105c5b3828056209dcab47c3e887dccac158e0121a8416f848b267e73207";
export const DEMO_KEYS = {
  "1932e721-78ab-4320-9f84-f186a80fba48": "aurora",
  "eca7481c-fc27-479c-b364-76274b0b4230": "bruma",
  "e2cda10d-2771-4056-8cf0-13e00f4b1bd8": "marea",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unique = (rows, key) => new Set(rows.map(key)).size === rows.length;
const rowKey = (row, keys) => JSON.stringify(keys.map((key) => row[key]));
export const sameRows = (a, b, keys) =>
  digest(sortedRows(a, keys)) === digest(sortedRows(b, keys));

export function assertTargetEnvironment(env, { requireDatabase = false } = {}) {
  let url;
  try { url = new URL(env.TARGET_SUPABASE_URL); } catch { /* rejected below */ }
  ensure(
    url && url.href === "https://" + TARGET_PROJECT + ".supabase.co/",
    "TARGET_INVALID", "El destino debe ser exactamente el nuevo proyecto autorizado.",
  );
  ensure(
    env.TARGET_SUPABASE_PUBLISHABLE_KEY && env.TARGET_SUPABASE_SERVICE_ROLE_KEY,
    "TARGET_CREDENTIALS_MISSING", "Faltan las claves nuevas de destino.",
  );
  if (requireDatabase) {
    ensure(
      env.TARGET_SUPABASE_DB_PASSWORD &&
      env.TARGET_SUPABASE_DB_PASSWORD_ROTATED === "true",
      "ROTATED_PASSWORD_REQUIRED", "Se requiere confirmar una contraseña de base de datos nueva y rotada.",
    );
    ensure(
      env.TARGET_SUPABASE_DB_PORT === "5432" &&
      env.TARGET_SUPABASE_DB_NAME === "postgres",
      "DATABASE_MODE_INVALID", "Las migraciones requieren conexión directa o Session real; nunca Transaction 6543.",
    );
    const direct =
      env.TARGET_SUPABASE_DB_HOST === "db." + TARGET_PROJECT + ".supabase.co" &&
      env.TARGET_SUPABASE_DB_USER === "postgres";
    const session =
      /^[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(env.TARGET_SUPABASE_DB_HOST || "") &&
      env.TARGET_SUPABASE_DB_USER === "postgres." + TARGET_PROJECT &&
      env.TARGET_SUPABASE_DB_SESSION_CONFIRMED === "true";
    ensure(direct || session, "DATABASE_TARGET_INVALID",
      "Confirme host/usuario del destino y los parámetros reales de Session en el dashboard.");
  }
  return { projectRef: TARGET_PROJECT, origin: url.origin };
}

export function validateMigrationSource(payload, encryptedBytes) {
  ensure(sha256(encryptedBytes) === SOURCE_ARCHIVE_SHA256,
    "SOURCE_ARCHIVE_INVALID", "El archivo no coincide con el respaldo autorizado.");
  ensure(payload.manifest?.projectRef === SOURCE_PROJECT &&
    payload.manifest.bucket === BUCKET && payload.manifest.formatVersion === 1 &&
    payload.manifest.consistentDoubleRead &&
    payload.manifest.sourceBeforeSha256 === payload.manifest.sourceAfterSha256,
    "SOURCE_MANIFEST_INVALID", "El manifiesto de origen no coincide o no es estable.");
  ensure(digest(Object.keys(payload.tables).sort()) === digest(TABLES.map(([t]) => t).sort()),
    "SOURCE_TABLES_INVALID", "Las tablas del archivo no coinciden con el alcance revisado.");
  for (const [table, keys] of TABLES) {
    const rows = payload.tables[table];
    ensure(Array.isArray(rows) &&
      rows.length === payload.manifest.tableHashes[table]?.rows &&
      digest(rows) === payload.manifest.tableHashes[table]?.sha256 &&
      unique(rows, (row) => rowKey(row, keys)),
      "SOURCE_ROWS_INVALID", "Conteo, claves o hash de tabla incorrectos.");
  }
  ensure(payload.users.length === 4 &&
    digest(payload.users) === payload.manifest.authProfilesSha256 &&
    unique(payload.users, (u) => u.id) &&
    unique(payload.users, (u) => u.email?.toLowerCase()) &&
    payload.users.every((u) => uuid.test(u.id) && typeof u.email === "string" && u.email.includes("@")),
    "SOURCE_AUTH_INVALID", "Las cuatro identidades de origen no son válidas.");
  ensure(payload.bucket.public === false &&
    digest(payload.bucket) === payload.manifest.bucketSha256,
    "SOURCE_BUCKET_INVALID", "El bucket debe ser privado y coincidir con su hash.");
  ensure(payload.objects.length === payload.manifest.objectCount &&
    unique(payload.objects, (o) => o.path) &&
    digest(payload.objects.map(({path,id,bytes,sha256}) => ({path,id,bytes,sha256}))) ===
      payload.manifest.objectManifestSha256,
    "SOURCE_OBJECTS_INVALID", "El inventario de objetos no coincide.");
  for (const object of payload.objects) {
    const bytes = Buffer.from(object.dataBase64, "base64");
    ensure(bytes.length === object.bytes && sha256(bytes) === object.sha256 &&
      /^[0-9a-f-]{36}\/[0-9a-f-]{36}[.](jpg|jpeg|png|webp|avif)$/.test(object.path) &&
      Object.hasOwn(DEMO_KEYS, object.path.split("/")[0]),
      "SOURCE_OBJECT_INVALID", "Ruta o contenido de un objeto inválidos.");
  }
  ensure(payload.migrations.length === 2 &&
    payload.migrations.every((m, i, all) => /^\d+_[a-z0-9_]+[.]sql$/.test(m.file) &&
      (!i || all[i - 1].file < m.file)),
    "SOURCE_MIGRATIONS_INVALID", "Orden o número de migraciones inesperado.");
  for (const migration of payload.migrations) {
    const sql = readFileSync(resolve(ROOT, "supabase", "migrations", migration.file), "utf8")
      .replace(/^\uFEFF/, "");
    ensure(sha256(sql) === migration.sha256 && sha256(migration.sql) === migration.sha256,
      "SOURCE_MIGRATIONS_INVALID", "La migración no coincide con el archivo local revisado.");
  }
  const tables = payload.tables;
  ensure(tables.restaurants.length === 3 && tables.restaurant_memberships.length === 3 &&
    tables.platform_admins.length === 1,
    "SOURCE_DEMOS_INVALID", "El archivo debe contener tres DEMO y un administrador.");
  for (const restaurant of tables.restaurants) {
    const id = restaurant.id;
    const member = tables.restaurant_memberships.find((m) => m.restaurant_id === id);
    const owner = payload.users.find((u) => u.id === member?.user_id);
    const categories = tables.categories.filter((c) => c.restaurant_id === id);
    ensure(Object.hasOwn(DEMO_KEYS, id) && restaurant.is_demo &&
      uuid.test(restaurant.public_token) &&
      tables.products.filter((p) => p.restaurant_id === id).length === 24 &&
      categories.filter((c) => !c.parent_id).length === 6 &&
      categories.filter((c) => c.parent_id).length === 2 &&
      owner && owner.email === restaurant.owner_email && owner.email.endsWith(".test"),
      "SOURCE_DEMOS_INVALID", "Los DEMO, propietarios, categorías o productos no coinciden.");
  }
  const objectPaths = new Set(payload.objects.map((o) => o.path));
  for (const product of tables.products)
    ensure(!product.image_path || objectPaths.has(product.image_path),
      "MEDIA_REFERENCE_INVALID", "Falta un objeto referenciado por un producto.");
  for (const settings of tables.restaurant_settings)
    for (const appearance of [settings.appearance, settings.draft_appearance])
      for (const field of ["logo_path", "cover_path", "favicon_path"])
        ensure(!appearance[field] || objectPaths.has(appearance[field]),
          "MEDIA_REFERENCE_INVALID", "Falta un objeto referenciado por la apariencia.");
  return {
    sourceProjectRef: SOURCE_PROJECT, targetProjectRef: TARGET_PROJECT,
    archiveSha256: SOURCE_ARCHIVE_SHA256,
    rows: Object.fromEntries(TABLES.map(([t]) => [t, tables[t].length])),
    authUsers: payload.users.length, storageObjects: payload.objects.length,
    storageBytes: payload.manifest.objectBytes, migrations: payload.migrations.length,
  };
}

export function prepareApplicationTables(payload) {
  const tables = structuredClone(payload.tables);
  // Transaction IDs belong to one PostgreSQL cluster; carrying them across can
  // suppress a later menu invalidation if a new-cluster transaction collides.
  for (const restaurant of tables.restaurants) restaurant.menu_version_transaction = 0;
  return tables;
}

export function migrationMarker(userId, credentialId) {
  return {
    version: 1, sourceProjectRef: SOURCE_PROJECT, targetProjectRef: TARGET_PROJECT,
    archiveSha256: SOURCE_ARCHIVE_SHA256, sourceUserId: userId, credentialId,
  };
}

// Credentials remain in memory here. The eventual remote runner must persist them
// in a verified private directory BEFORE creating an Auth user.
export function newCredentialBundle(payload) {
  const accounts = {};
  for (const restaurant of payload.tables.restaurants) {
    const member = payload.tables.restaurant_memberships.find((m) => m.restaurant_id === restaurant.id);
    const user = payload.users.find((u) => u.id === member.user_id);
    const settings = payload.tables.restaurant_settings.find((s) => s.restaurant_id === restaurant.id);
    accounts[DEMO_KEYS[restaurant.id]] = {
      email: user.email, password: randomBytes(32).toString("base64url"), credentialId: randomUUID(),
      restaurantId: restaurant.id, userId: user.id,
      media: {
        logo: settings.appearance.logo_path, cover: settings.appearance.cover_path,
        favicon: settings.appearance.favicon_path,
      },
    };
  }
  const user = payload.users.find((u) => u.id === payload.tables.platform_admins[0].user_id);
  ensure(user, "ADMIN_IDENTITY_MISSING", "Falta la identidad original del administrador.");
  return {
    accounts,
    admin: { email: user.email, password: randomBytes(32).toString("base64url"), credentialId: randomUUID(), userId: user.id },
  };
}

export function planAuthUsers(payload, targetUsers, credentials) {
  const source = new Map(payload.users.map((u) => [u.id, u]));
  ensure(unique(targetUsers, (u) => u.id) &&
    targetUsers.every((u) => source.has(u.id)),
    "AUTH_CONFLICT", "El destino contiene cuentas no pertenecientes a esta migración.");
  const local = [...Object.values(credentials.accounts), credentials.admin];
  ensure(local.length === 4 && unique(local, (u) => u.userId),
    "CREDENTIAL_STATE_INVALID", "El estado local de las cuatro credenciales no es válido.");
  return payload.users.map((user) => {
    const credential = local.find((u) => u.userId === user.id);
    ensure(credential && credential.email === user.email &&
      typeof credential.password === "string" && credential.password.length >= 32 && uuid.test(credential.credentialId),
      "CREDENTIAL_STATE_INVALID", "Falta el secreto local nuevo de una identidad.");
    const existing = targetUsers.find((u) => u.id === user.id);
    if (existing) {
      ensure(existing.email === user.email && existing.app_metadata?.tolentino_migration &&
        digest(existing.app_metadata.tolentino_migration) === digest(migrationMarker(user.id, credential.credentialId)),
        "AUTH_CONFLICT", "No se reutilizan ni modifican cuentas ajenas o sin marcador de migración.");
      return { action: "reuse", id: user.id };
    }
    ensure(!targetUsers.some((u) => u.email?.toLowerCase() === user.email.toLowerCase()),
      "AUTH_CONFLICT", "Un correo pertenece a otra identidad en el destino.");
    return {
      action: "create",
      attributes: {
        id: user.id, email: user.email, password: credential.password,
        email_confirm: true,
        user_metadata: user.user_metadata || {},
        app_metadata: { tolentino_migration: migrationMarker(user.id, credential.credentialId) },
      },
    };
  });
}

export function planStorageObjects(sourceObjects, targetObjects) {
  const source = new Map(sourceObjects.map((o) => [o.path, o]));
  ensure(unique(sourceObjects, (o) => o.path) && unique(targetObjects, (o) => o.path) &&
    targetObjects.every((o) => source.has(o.path)),
    "STORAGE_CONFLICT", "El bucket contiene objetos ajenos o rutas duplicadas.");
  return sourceObjects.map((object) => {
    const existing = targetObjects.find((o) => o.path === object.path);
    if (existing)
      ensure(existing.sha256 === object.sha256 && existing.bytes === object.bytes &&
        existing.contentType === object.metadata.mimetype,
        "STORAGE_CONFLICT", "El contenido o tipo de un objeto existente difiere; no se sobrescribe.");
    return { action: existing ? "reuse" : "upload", path: object.path, sha256: object.sha256 };
  });
}

export function planTableRows(sourceRows, targetRows, keys, bootstrapRows) {
  if (bootstrapRows !== undefined) {
    const row = bootstrapRows[0];
    ensure(bootstrapRows.length === 1 && row && row.id === true &&
      row.contact_url === null && row.contact_label === "Contactar a Tolentino" &&
      row.suspension_message === "Este menú no está disponible temporalmente." &&
      typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) &&
      Object.keys(row).sort().join(",") ===
        "contact_label,contact_url,id,suspension_message,updated_at",
      "BOOTSTRAP_INVALID", "El singleton no coincide con los defaults SQL revisados; no se sustituye.");
  }
  ensure(unique(sourceRows, (r) => rowKey(r, keys)) && unique(targetRows, (r) => rowKey(r, keys)),
    "DATA_CONFLICT", "Existen claves duplicadas en la importación.");
  const source = new Map(sourceRows.map((r) => [rowKey(r, keys), r]));
  const target = new Map(targetRows.map((r) => [rowKey(r, keys), r]));
  ensure(targetRows.every((r) => source.has(rowKey(r, keys))),
    "DATA_CONFLICT", "El destino contiene filas ajenas; no se eliminarán.");
  const insert = [], replaceBootstrap = [];
  let reuse = 0;
  for (const row of sourceRows) {
    const current = target.get(rowKey(row, keys));
    if (!current) insert.push(row);
    else if (digest(current) === digest(row)) reuse++;
    else if (bootstrapRows && sameRows(targetRows, bootstrapRows, keys))
      replaceBootstrap.push(row);
    else ensure(false, "DATA_CONFLICT",
      "Una fila del destino difiere del respaldo; no se sobrescribirá.");
  }
  return { insert, replaceBootstrap, reuse };
}

// This transport-neutral SQL routine is exercised only with in-memory PGlite.
// A remote adapter must first verify destination, encrypted target backup, schema,
// Auth identities, object hashes and an exclusive maintenance window.
export async function importApplicationRows(db, tables, { bootstrapSettings } = {}) {
  await db.exec("begin");
  try {
    await db.exec("lock table " + TABLES.map(([t]) => 'public."' + t + '"').join(",") +
      " in access exclusive mode");
    const plans = {};
    for (const [table, keys] of TABLES) {
      const current = (await db.query('select to_jsonb(t) as row from public."' + table + '" t'))
        .rows.map((r) => r.row);
      plans[table] = planTableRows(tables[table], current, keys,
        table === "platform_settings" ? bootstrapSettings : undefined);
    }
    for (const [table] of TABLES)
      await db.exec('alter table public."' + table + '" disable trigger user');
    let inserted = 0, reused = 0, bootstrapReplaced = 0;
    for (const [table] of TABLES) {
      const plan = plans[table];
      reused += plan.reuse;
      const columns = (await db.query(
        "select column_name from information_schema.columns where table_schema='public' " +
        "and table_name=$1 and is_generated='NEVER' order by ordinal_position", [table],
      )).rows.map((r) => r.column_name);
      ensure(columns.length && columns.every((c) => /^[a-z_]+$/.test(c)),
        "SCHEMA_INVALID", "Columnas inesperadas en la tabla destino.");
      const names = columns.map((c) => '"' + c + '"').join(",");
      if (plan.insert.length) {
        await db.query('insert into public."' + table + '"(' + names + ") select " + names +
          ' from jsonb_populate_recordset(null::public."' + table + '",$1::jsonb)',
          [JSON.stringify(plan.insert)]);
        inserted += plan.insert.length;
      }
      if (plan.replaceBootstrap.length) {
        ensure(table === "platform_settings" && plan.replaceBootstrap.length === 1,
          "BOOTSTRAP_INVALID", "Sólo se permite sustituir el singleton inicial verificado.");
        const assignments = columns.filter((c) => c !== "id").map((c) => '"' + c + '"=v."' + c + '"');
        await db.query('update public.platform_settings t set ' + assignments.join(",") +
          " from jsonb_populate_record(null::public.platform_settings,$1::jsonb) v where t.id=v.id",
          [JSON.stringify(plan.replaceBootstrap[0])]);
        bootstrapReplaced++;
      }
    }
    for (const [table] of TABLES)
      await db.exec('alter table public."' + table + '" enable trigger user');
    for (const [table, keys] of TABLES) {
      const rows = (await db.query('select to_jsonb(t) as row from public."' + table + '" t'))
        .rows.map((r) => r.row);
      ensure(sameRows(rows, tables[table], keys), "IMPORT_HASH_MISMATCH",
        "La comprobación final no coincide; se revierte toda la transacción.");
    }
    await db.exec("commit");
    return { inserted, reused, bootstrapReplaced };
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
