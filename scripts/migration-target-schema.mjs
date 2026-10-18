import { ensure, sha256 } from "./backup-common.mjs";

// The caller supplies one connected Client/adapter for the complete transaction.
export async function applyVersionedSchema(db, migrations) {
  await db.exec("begin");
  try {
    const exists = (await db.query(
      "select to_regclass('supabase_migrations.schema_migrations') is not null as present",
    )).rows[0].present;
    if (exists) {
      const rows = (await db.query(
        "select version,name,statements from supabase_migrations.schema_migrations order by version",
      )).rows;
      ensure(rows.length === migrations.length && rows.every((r, i) => {
        const source = migrations[i];
        return r.version === source.file.split("_")[0] &&
          r.name === source.file.replace(/^\d+_/, "").replace(/[.]sql$/, "") &&
          r.statements?.length === 1 && sha256(r.statements[0]) === source.sha256;
      }), "MIGRATION_HISTORY_CONFLICT", "El historial de migraciones no coincide exactamente con los SQL revisados.");
      await db.exec("commit");
      return { applied: 0, reused: rows.length };
    }
    const empty = (await db.query(
      "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace " +
      "where n.nspname in('public','private'))::int as relations," +
      "exists(select from pg_namespace where nspname='private') as private_schema," +
      "(select count(*) from auth.users)::int as auth_users," +
      "(select count(*) from storage.buckets)::int as buckets",
    )).rows[0];
    ensure(empty.relations === 0 && !empty.private_schema && empty.auth_users === 0 && empty.buckets === 0,
      "TARGET_NOT_EMPTY", "No se aplica el esquema inicial sobre contenido preexistente.");
    await db.exec(
      "create schema supabase_migrations;" +
      "revoke all on schema supabase_migrations from public,anon,authenticated;" +
      "create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);" +
      "revoke all on supabase_migrations.schema_migrations from public,anon,authenticated;",
    );
    for (const migration of migrations) {
      ensure(sha256(migration.sql) === migration.sha256, "MIGRATION_HASH_INVALID",
        "No coincide el hash de una migración.");
      await db.exec(migration.sql);
      await db.query(
        "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)",
        [migration.file.split("_")[0], [migration.sql],
          migration.file.replace(/^\d+_/, "").replace(/[.]sql$/, "")],
      );
    }
    await db.exec("commit");
    return { applied: migrations.length, reused: 0 };
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
export async function verifyTargetSecurity(db) {
  const values = (await db.query(
    "select " +
    "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r')::int as public_tables," +
    "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as public_rls," +
    "(select count(*) from pg_policies where schemaname in('public','private','storage'))::int as policies," +
    "(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D')::int as disabled_triggers," +
    "has_table_privilege('anon','public.products','select') as anon_product_select," +
    "has_column_privilege('authenticated','public.restaurants','status','update') as owner_status_update," +
    "has_column_privilege('authenticated','public.restaurants','public_token','update') as owner_qr_update," +
    "(select public from storage.buckets where id='restaurant-media') as bucket_public",
  )).rows[0];
  ensure(values.public_tables === 15 && values.public_rls === 15 && values.policies > 0 &&
    values.disabled_triggers === 0 && values.anon_product_select === false &&
    values.owner_status_update === false && values.owner_qr_update === false &&
    values.bucket_public === false,
    "TARGET_SECURITY_INVALID", "La verificación de RLS, permisos, triggers o bucket privado falló.");
  return values;
}
