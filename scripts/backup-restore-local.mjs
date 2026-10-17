import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT,
  PROJECT,
  BUCKET,
  TABLES,
  ensure,
  failReport,
  sha256,
  digest,
  sortedRows,
  protectBackupDirectory,
  safeLocalPath,
  loadBackupKey,
  decryptArchive,
  writeEvidence,
} from "./backup-common.mjs";

let db, secretKey;
let stage = "read-encrypted-archive";
const checks = [];
function verified(name, condition) {
  ensure(
    condition,
    "RESTORE_CHECK_FAILED",
    "Falló la comprobación local: " + name + ".",
  );
  checks.push({ name, pass: true });
}
try {
  // No Supabase SDK, HTTP fetch, network connection, filesystem DB or remote write path exists here.
  protectBackupDirectory();
  ensure(
    process.argv.length === 3,
    "USAGE",
    "Uso: node scripts/backup-restore-local.mjs .runtime/backups/archivo.json.enc",
  );
  const file = safeLocalPath(resolve(ROOT, process.argv[2]));
  const encrypted = readFileSync(file);
  const { key } = loadBackupKey(false);
  secretKey = key;
  const payload = decryptArchive(encrypted, key);
  ensure(
    payload.manifest?.formatVersion === 1 &&
      payload.manifest.projectRef === PROJECT &&
      payload.manifest.bucket === BUCKET,
    "MANIFEST_INVALID",
    "El manifiesto no pertenece al formato/proyecto autorizado.",
  );
  ensure(
    digest(Object.keys(payload.tables).sort()) ===
      digest(TABLES.map(([name]) => name).sort()),
    "MANIFEST_INVALID",
    "Faltan tablas o hay tablas no admitidas en el respaldo.",
  );
  verified(
    "Source double-read manifest is consistent",
    payload.manifest.sourceBeforeSha256 === payload.manifest.sourceAfterSha256,
  );
  for (const [table] of TABLES) {
    verified(
      "Manifest hash: " + table,
      digest(payload.tables[table]) ===
        payload.manifest.tableHashes[table].sha256 &&
        payload.tables[table].length ===
          payload.manifest.tableHashes[table].rows,
    );
  }
  verified(
    "Auth profile manifest hash",
    digest(payload.users) === payload.manifest.authProfilesSha256,
  );
  verified(
    "Bucket manifest hash",
    digest(payload.bucket) === payload.manifest.bucketSha256 &&
      payload.bucket.public === false,
  );
  verified(
    "Storage object manifest hash",
    digest(
      payload.objects.map(({ path, id, bytes, sha256 }) => ({
        path,
        id,
        bytes,
        sha256,
      })),
    ) === payload.manifest.objectManifestSha256,
  );
  verified(
    "Object count",
    payload.objects.length === payload.manifest.objectCount,
  );
  for (const object of payload.objects) {
    const bytes = Buffer.from(object.dataBase64, "base64");
    ensure(
      bytes.length === object.bytes && sha256(bytes) === object.sha256,
      "OBJECT_HASH_INVALID",
      "El contenido de un objeto no coincide con el manifiesto.",
    );
  }
  verified("All object bytes match SHA256", true);
  for (const migration of payload.migrations) {
    ensure(
      /^\d+_[a-z0-9_]+[.]sql$/.test(migration.file),
      "MIGRATION_INVALID",
      "Nombre de migración no permitido.",
    );
    const local = readFileSync(
      resolve(ROOT, "supabase", "migrations", migration.file),
      "utf8",
    ).replace(/^\uFEFF/, "");
    ensure(
      sha256(migration.sql) === migration.sha256 &&
        sha256(local) === migration.sha256,
      "MIGRATION_INVALID",
      "La migración del archivo no coincide con la revisión local; no se ejecutó SQL no verificado.",
    );
  }
  verified("Archived migrations match local reviewed files", true);

  stage = "isolated-postgresql-schema";
  db = new PGlite(); // Memory-only, no TCP listener, directory, port or persistent plaintext DB.
  await db.exec(
    "create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;" +
      "create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;" +
      "create table auth.users(id uuid primary key);" +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
      "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));" +
      "alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;" +
      "create schema restore_artifacts;" +
      "create table restore_artifacts.auth_profiles(id uuid primary key references auth.users(id),profile jsonb not null);" +
      "create table restore_artifacts.bucket_metadata(id text primary key,metadata jsonb not null);" +
      "create table restore_artifacts.objects(bucket_id text,name text,object_id uuid,metadata jsonb not null,data bytea not null,sha256 text not null,primary key(bucket_id,name));" +
      "set timezone='UTC';",
  );
  for (const migration of payload.migrations) await db.exec(migration.sql);
  verified("Migrations apply in isolated PostgreSQL", true);

  stage = "transactional-data-restore";
  await db.exec("begin");
  try {
    for (const user of payload.users) {
      await db.query("insert into auth.users(id) values($1)", [user.id]);
      await db.query(
        "insert into restore_artifacts.auth_profiles(id,profile) values($1,$2::jsonb)",
        [user.id, JSON.stringify(user)],
      );
    }
    // Only user triggers are paused on this fresh local DB. Foreign keys/checks stay enforced.
    for (const [table] of TABLES)
      await db.exec('alter table public."' + table + '" disable trigger user');
    await db.exec("delete from public.platform_settings");
    for (const [table] of TABLES) {
      const rows = payload.tables[table];
      if (!rows.length) continue;
      const columns = (
        await db.query(
          "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position",
          [table],
        )
      ).rows.map((row) => row.column_name);
      ensure(
        columns.length && columns.every((column) => /^[a-z_]+$/.test(column)),
        "COLUMN_INVALID",
        "Las columnas restaurables no son válidas.",
      );
      const names = columns.map((column) => '"' + column + '"').join(",");
      await db.query(
        'insert into public."' +
          table +
          '"(' +
          names +
          ") select " +
          names +
          ' from jsonb_populate_recordset(null::public."' +
          table +
          '",$1::jsonb)',
        [JSON.stringify(rows)],
      );
    }
    for (const [table] of TABLES)
      await db.exec('alter table public."' + table + '" enable trigger user');
    await db.query(
      "update storage.buckets set name=$2,public=$3,file_size_limit=$4,allowed_mime_types=$5 where id=$1",
      [
        BUCKET,
        payload.bucket.name,
        payload.bucket.public,
        payload.bucket.file_size_limit,
        payload.bucket.allowed_mime_types,
      ],
    );
    await db.query(
      "insert into restore_artifacts.bucket_metadata(id,metadata) values($1,$2::jsonb)",
      [BUCKET, JSON.stringify(payload.bucket)],
    );
    for (const object of payload.objects) {
      const { dataBase64, ...metadata } = object;
      await db.query(
        "insert into storage.objects(id,bucket_id,name) values($1,$2,$3)",
        [object.id, BUCKET, object.path],
      );
      await db.query(
        "insert into restore_artifacts.objects(bucket_id,name,object_id,metadata,data,sha256) values($1,$2,$3,$4::jsonb,$5,$6)",
        [
          BUCKET,
          object.path,
          object.id,
          JSON.stringify(metadata),
          Buffer.from(dataBase64, "base64"),
          object.sha256,
        ],
      );
    }
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
  verified(
    "One transaction restores all application rows and objects with FK/check constraints",
    true,
  );

  stage = "exact-data-verification";
  const rowCounts = {};
  for (const [table, keys] of TABLES) {
    const rows = (
      await db.query('select to_jsonb(t) as data from public."' + table + '" t')
    ).rows.map((row) => row.data);
    rowCounts[table] = rows.length;
    verified(
      "Restored equality: " + table,
      digest(sortedRows(rows, keys)) ===
        digest(sortedRows(payload.tables[table], keys)),
    );
  }
  const authProfiles = (
    await db.query(
      "select profile from restore_artifacts.auth_profiles order by id",
    )
  ).rows.map((row) => row.profile);
  verified(
    "Auth IDs and selected profiles preserved",
    digest(sortedRows(authProfiles, ["id"])) ===
      digest(sortedRows(payload.users, ["id"])),
  );
  const objects = (
    await db.query(
      "select name,object_id,metadata,encode(data,'hex') as data_hex,sha256 from restore_artifacts.objects order by name",
    )
  ).rows;
  verified(
    "Every storage object restored",
    objects.length === payload.objects.length,
  );
  for (const object of objects) {
    const original = payload.objects.find(
      (candidate) => candidate.path === object.name,
    );
    ensure(
      original &&
        object.object_id === original.id &&
        sha256(Buffer.from(object.data_hex, "hex")) === original.sha256,
      "OBJECT_HASH_INVALID",
      "La identidad o el contenido de un objeto restaurado no coincide.",
    );
  }
  verified("Storage object identities and bytes preserved", true);
  const memberships = payload.tables.restaurant_memberships;
  const restaurants = payload.tables.restaurants;
  verified(
    "All owner memberships reference preserved identities",
    memberships.every(
      (member) =>
        payload.users.some((user) => user.id === member.user_id) &&
        restaurants.some(
          (restaurant) => restaurant.id === member.restaurant_id,
        ),
    ),
  );
  const qr = (
    await db.query("select id,public_token from public.restaurants order by id")
  ).rows;
  verified(
    "Permanent QR tokens remain unchanged",
    digest(qr) ===
      digest(
        sortedRows(
          restaurants.map(({ id, public_token }) => ({ id, public_token })),
          ["id"],
        ),
      ),
  );
  const policies = (
    await db.query(
      "select count(*)::int as n from pg_policies where schemaname in('public','private','storage')",
    )
  ).rows[0].n;
  const rls = (
    await db.query(
      "select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
    )
  ).rows[0].n;
  verified("All fifteen public tables retain RLS", rls === TABLES.length);
  const disabled = (
    await db.query(
      "select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'",
    )
  ).rows[0].n;
  verified("All application triggers re-enabled after restore", disabled === 0);
  const privateCounts = (
    await db.query(
      "select (select count(*) from private.rate_limits)::int as rate_limits,(select count(*) from private.restaurant_creation_requests)::int as creation_requests",
    )
  ).rows[0];
  verified(
    "Excluded private operational tables are explicitly empty",
    privateCounts.rate_limits === 0 && privateCounts.creation_requests === 0,
  );

  stage = "restored-security-probes";
  let directedPairs = 0;
  for (const member of memberships) {
    for (const target of restaurants.filter(
      (restaurant) => restaurant.id !== member.restaurant_id,
    )) {
      await db.exec("begin;set local role authenticated");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          member.user_id,
        ]);
        const products = (
          await db.query(
            "select count(*)::int as n from public.products where restaurant_id=$1",
            [target.id],
          )
        ).rows[0].n;
        const updates = (
          await db.query(
            "update public.products set price=price where restaurant_id=$1 returning id",
            [target.id],
          )
        ).rows.length;
        const files = (
          await db.query(
            "select count(*)::int as n from storage.objects where name like $1",
            [target.id + "/%"],
          )
        ).rows[0].n;
        ensure(
          products === 0 && updates === 0 && files === 0,
          "RLS_FAILED",
          "El aislamiento restaurado permitió datos de otro restaurante.",
        );
        directedPairs++;
      } finally {
        await db.exec("rollback");
      }
    }
  }
  verified(
    "Restored owner RLS denies cross-tenant reads/writes and private storage metadata",
    true,
  );

  async function expectedSqlFailure(sql, params, code) {
    await db.exec("begin");
    let failure;
    try {
      await db.query(sql, params);
    } catch (error) {
      failure = error;
    } finally {
      await db.exec("rollback");
    }
    return failure?.code === code;
  }
  const first = restaurants[0],
    foreign = restaurants[1];
  if (first && foreign) {
    const category = payload.tables.categories.find(
      (item) => item.restaurant_id === foreign.id,
    );
    if (category)
      verified(
        "Composite tenant FK rejects cross-tenant category",
        await expectedSqlFailure(
          "insert into public.products(restaurant_id,category_id,name,price) values($1,$2,'Local restore probe',1)",
          [first.id, category.id],
          "23503",
        ),
      );
    verified(
      "Permanent QR identity remains immutable",
      await expectedSqlFailure(
        "update public.restaurants set public_token=gen_random_uuid() where id=$1",
        [first.id],
        "23514",
      ),
    );
  }
  const activeMember = memberships.find(
    (member) =>
      member.is_active &&
      restaurants.some(
        (restaurant) =>
          restaurant.id === member.restaurant_id &&
          restaurant.status === "active",
      ),
  );
  if (activeMember) {
    const product = payload.tables.products.find(
      (item) =>
        item.restaurant_id === activeMember.restaurant_id &&
        Number(item.price) < 9999999999,
    );
    if (product) {
      await db.exec("begin;set local role authenticated");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          activeMember.user_id,
        ]);
        const changed = await db.query(
          "update public.products set price=price+1 where id=$1 returning id",
          [product.id],
        );
        verified(
          "Owner can edit own restored product with menu triggers active (rolled back)",
          changed.rows.length === 1,
        );
      } finally {
        await db.exec("rollback");
      }
    }
  }
  for (const [table, keys] of TABLES) {
    const rows = (
      await db.query('select to_jsonb(t) as data from public."' + table + '" t')
    ).rows.map((row) => row.data);
    ensure(
      digest(sortedRows(rows, keys)) ===
        digest(sortedRows(payload.tables[table], keys)),
      "PROBE_NOT_ROLLED_BACK",
      "Una comprobación alteró el contenido restaurado.",
    );
  }
  verified("Security probes leave restored data unchanged", true);

  // Corruption must fail before a new database is created or any row restored.
  const corrupted = Buffer.from(encrypted);
  const envelope = JSON.parse(corrupted);
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[Math.floor(ciphertext.length / 2)] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  let tamperRejected = false;
  try {
    decryptArchive(Buffer.from(JSON.stringify(envelope)), key);
  } catch (error) {
    tamperRejected = error.code === "ARCHIVE_INVALID";
  }
  verified(
    "Tampered encrypted archive rejected before restore",
    tamperRejected,
  );

  const evidence = {
    at: new Date().toISOString(),
    result: "PASS",
    scope:
      "Application logical restore in memory-only PostgreSQL PGlite; not complete Supabase/Auth restore",
    archiveSha256: sha256(encrypted),
    engine: "PGlite 0.5.10",
    node: process.version,
    tables: rowCounts,
    authIdentityProfiles: payload.users.length,
    storageObjects: objects.length,
    storageBytes: payload.manifest.objectBytes,
    migrations: payload.migrations.length,
    policies,
    preserved: [
      "All exported application fields including generated values",
      "Restaurant/user/membership IDs",
      "Permanent QR tokens",
      "Storage paths, listed IDs, metadata and exact bytes",
    ],
    applicationRowsEqual: true,
    objectHashesEqual: true,
    directedTenantPairs: directedPairs,
    passedChecks: checks.length,
    failedChecks: 0,
    checks,
    remoteRequests: 0,
    remoteMutations: 0,
    plaintextFilesWritten: 0,
    persistentLocalDatabase: false,
    authRuntimeTested: false,
    storageHttpServiceTested: false,
    completePostgresAuthRestore: false,
    excludedPrivateTables: privateCounts,
    limits: payload.manifest.excluded,
  };
  writeEvidence("backup-restore-local.json", evidence);
  console.log(
    JSON.stringify({
      result: evidence.result,
      passedChecks: checks.length,
      failedChecks: 0,
      tables: TABLES.length,
      authIdentityProfiles: payload.users.length,
      storageObjects: objects.length,
      storageBytes: evidence.storageBytes,
      directedTenantPairs: directedPairs,
      remoteRequests: 0,
      plaintextFilesWritten: 0,
      completePostgresAuthRestore: false,
    }),
  );
} catch (error) {
  failReport(error, stage);
} finally {
  secretKey?.fill(0);
  await db?.close();
}
