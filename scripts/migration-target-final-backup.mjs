import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ROOT, BACKUP_DIR, TABLES, LIMITS, BUCKET, ensure, failReport, digest, sha256,
  protectBackupDirectory, loadBackupKey, encryptArchive, decryptArchive,
} from "./backup-common.mjs";
import { TARGET_PROJECT } from "./migration-data-common.mjs";
import {
  PG_BIN, targetEnvironment, readonlyPgTool, inspectTarget, readonlyTargetClient, saveTargetEvidence,
} from "./migration-target-inspect.mjs";
import { connectTargetPg } from "./migration-target-runtime.mjs";

const sqlHash = (bytes) => sha256(bytes.toString("utf8").replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm, ""));
export function decodeLocalArchive(dump, options = ["--file=-", "--no-owner", "--no-privileges"]) {
  ensure(dump.subarray(0, 5).toString("ascii") === "PGDMP", "DUMP_FORMAT_INVALID",
    "El archivo no tiene formato custom PostgreSQL.");
  ensure(options.every((option) => ["--file=-", "--no-owner", "--no-privileges", "--list"].includes(option)),
    "RESTORE_NETWORK_BLOCKED", "La validación sólo puede decodificar el archivo hacia memoria.");
  const result = spawnSync(resolve(PG_BIN, "pg_restore.exe"), options, {
    input: dump, windowsHide: true, timeout: 120_000, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: "1", PGDATABASE: "disabled",
      PGPASSWORD: "", PGOPTIONS: "-c default_transaction_read_only=on" },
  });
  ensure(result.status === 0, "DUMP_DECODE_FAILED",
    "No se pudo decodificar íntegramente el dump; no se acepta el respaldo.");
  return result.stdout;
}
export async function applicationCatalog(client) {
 const result=await client.query(`select n.nspname as schema,c.relname as name,
 coalesce((select json_agg(json_build_object('schema',rn.nspname,'name',rc.relname) order by rn.nspname,rc.relname)
  from pg_constraint fk join pg_class rc on rc.oid=fk.confrelid join pg_namespace rn on rn.oid=rc.relnamespace
  where fk.conrelid=c.oid and fk.contype='f' and rn.nspname in('public','private') and fk.confrelid<>c.oid),'[]'::json) as dependencies
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','private') and c.relkind='r' and not c.relispartition
 order by n.nspname,c.relname`);
 ensure(result.rows.length>0 && result.rows.every(r=>["public","private"].includes(r.schema) &&
  /^[a-z_][a-z0-9_]*$/.test(r.name)), "CATALOG_INVALID","El catálogo de tablas contiene nombres no admitidos.");
 const unsupported=await client.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and (c.relkind='p' or c.relispartition)");
 ensure(unsupported.rows[0].n===0,"PARTITIONS_UNSUPPORTED","El ensayo lógico requiere soporte explícito para particiones.");
 return result.rows;
}
export function capturedMigrations(history, directory=resolve(ROOT,"supabase","migrations")) {
 ensure(Array.isArray(history) && history.length>=2 && new Set(history.map(r=>r.version)).size===history.length,
  "MIGRATION_HISTORY_INVALID","Historial capturado incompleto o repetido.");
 const files=readdirSync(directory).filter(name=>/^\d+_.+[.]sql$/.test(name));
 return [...history].sort((a,b)=>a.version.localeCompare(b.version)).map(row=>{
  const matches=files.filter(file=>file.split("_")[0]===row.version);
  ensure(matches.length===1,"MIGRATION_MISSING","Falta una versión capturada o hay una versión ambigua.");
  const file=matches[0],sql=readFileSync(resolve(directory,file),"utf8");
  ensure(row.name===file.replace(/^\d+_/,"").replace(/[.]sql$/,"") &&
   row.statements?.length===1 && sha256(row.statements[0])===sha256(sql),
   "MIGRATION_HASH_MISMATCH","El SQL local de una versión capturada difiere del historial.");
  return {file,sql};
 });
}
export async function databaseRows(client) {
 await client.query("begin isolation level repeatable read read only");
 try {
  const catalog=await applicationCatalog(client);
  /** @type {Record<string, Record<string, unknown>[]>} */
  const tables={};
  /** @type {Record<string, Record<string, unknown>[]>} */
  const privateTables={};
  for(const entry of catalog){
   const rows=(await client.query('select to_jsonb(t) as row from "'+entry.schema+'"."'+entry.name+'" t limit $1',
    [LIMITS.rowsPerTable+1])).rows.map(r=>r.row);
   ensure(rows.length<=LIMITS.rowsPerTable,"TABLE_LIMIT","Una tabla supera el límite explícito; no se acepta un respaldo parcial.");
   (entry.schema==="public"?tables:privateTables)[entry.name]=rows.sort((a,b)=>digest(a).localeCompare(digest(b)));
  }
  const authUsers=(await client.query("select to_jsonb(t) as row from auth.users t order by id limit $1",
   [LIMITS.rowsPerTable+1])).rows.map(r=>r.row);
  ensure(authUsers.length<=LIMITS.rowsPerTable,"AUTH_LIMIT","El inventario Auth supera el límite.");
  await client.query("commit");
  return {catalog,tables,privateTables,authUsers};
 }catch(error){await client.query("rollback");throw error;}
}

async function readObjects(client, inventory) {
  ensure(inventory.api.buckets.length === 1 && inventory.api.buckets[0].id === BUCKET &&
    inventory.api.buckets[0].public === false, "BUCKET_UNEXPECTED", "Se requiere el bucket privado de aplicación.");
  const objects = [];
  let totalBytes = 0;
  for (const object of inventory.api.objects) {
    ensure(object.bucket === BUCKET && object.path.split("/").every((part) =>
      /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== ".."),
    "STORAGE_PATH_INVALID", "El inventario contiene una ruta inesperada.");
    const { data, error } = await client.storage.from(BUCKET).download(object.path);
    ensure(!error && data, "STORAGE_DOWNLOAD_FAILED", "Falló la lectura de un objeto privado.");
    const bytes = Buffer.from(await data.arrayBuffer());
    totalBytes += bytes.length;
    ensure(bytes.length === Number(object.metadata?.size) && data.type === object.metadata?.mimetype &&
      totalBytes <= LIMITS.totalObjectBytes, "STORAGE_CHANGED", "Objeto inconsistente o límite de bytes excedido.");
    objects.push({ path: object.path, bytes: bytes.length, sha256: sha256(bytes),
      contentType: data.type, dataBase64: bytes.toString("base64") });
  }
  ensure(objects.length <= LIMITS.objects, "STORAGE_LIMIT", "Demasiados objetos.");
  return objects;
}
function objectInventory(objects) {
  return objects.map(({ path, bytes, sha256, contentType }) => ({ path, bytes, sha256, contentType }));
}
export async function captureFinalTarget() {
  let key, connection, stage = "target-preconditions";
  try {
    ensure(process.argv.includes("--capture") && process.argv[process.argv.indexOf("--confirm-target") + 1] === TARGET_PROJECT,
      "USAGE", "Se requieren --capture --confirm-target y la referencia exacta del destino.");
    const env = targetEnvironment(), stats = { requests: 0 };
    const startedAt = new Date().toISOString(), runId = startedAt.replace(/[^0-9TZ]/g, "");
    const acl = protectBackupDirectory();
    connection = await connectTargetPg(env);
    stage = "readonly-baseline";
    const before = await inspectTarget(env, stats);
    ensure(before.sql.serverVersionNum.startsWith("17") && before.sql.migrations.length >= 2 &&
      TABLES.every(([name]) => before.sql.applicationRelations.some(r => r.schema === "public" && r.name === name && r.kind === "r")),
    "TARGET_STATE_INVALID", "El destino no coincide con un traslado ya completado.");
    capturedMigrations(before.sql.migrations);
    const rowsBefore = await databaseRows(connection);
    const api = readonlyTargetClient(env, stats);
    const objects = await readObjects(api, before);
    stage = "readonly-postgresql-dump";
    const dumpResult = readonlyPgTool("pg_dump", ["--format=custom", "--no-publications",
      "--no-subscriptions", "--lock-wait-timeout=15000", "-w"], env, undefined, 180_000);
    const rolesResult = readonlyPgTool("pg_dumpall", ["--roles-only", "--no-role-passwords", "-w"], env);
    ensure(dumpResult.warningBytes === 0 && rolesResult.warningBytes === 0,
      "DUMP_WARNING", "El backup emitió advertencias y requiere revisión.");
    const dump = dumpResult.bytes;
    stage = "readonly-consistency";
    const after = await inspectTarget(env, stats);
    const rowsAfter = await databaseRows(connection);
    const objectsAfter = await readObjects(api, after);
    ensure(digest(before) === digest(after) && digest(rowsBefore) === digest(rowsAfter) &&
      digest(objectInventory(objects)) === digest(objectInventory(objectsAfter)),
    "TARGET_CHANGED", "Cambió el destino durante la captura; repetir en una ventana sin escrituras.");
    stage = "local-validation-and-encryption";
    const toc = decodeLocalArchive(dump, ["--list"]).toString("utf8");
    const decoded = decodeLocalArchive(dump);
    ensure(toc.includes("auth users") && toc.includes("storage objects") && toc.includes("public restaurants"),
      "DUMP_CONTENT_INVALID", "El archivo no incluye los componentes requeridos.");
    const manifest = {
      formatVersion: 2, scope: "populated-target-logical-postgresql-and-storage",
      projectRef: TARGET_PROJECT, startedAt, completedAt: new Date().toISOString(),
      serverVersion: before.sql.serverVersion, toolVersion: "PostgreSQL 17.11",
      inventorySha256: digest(before), catalogSha256: digest(rowsBefore.catalog), schemaHistorySha256: digest(before.sql.migrations), applicationDataSha256: digest(rowsBefore.tables),
      privateDataSha256: digest(rowsBefore.privateTables), authUsersSha256: digest(rowsBefore.authUsers),
      objectInventorySha256: digest(objectInventory(objects)),
      dump: { bytes: dump.length, sha256: sha256(dump), format: "custom" },
      roles: { bytes: rolesResult.bytes.length, sha256: sha256(rolesResult.bytes), passwordsIncluded: false },
      counts: { tables: Object.keys(rowsBefore.tables).length, privateTables: Object.keys(rowsBefore.privateTables).length, rows: Object.values(rowsBefore.tables).reduce((n, rows) => n + rows.length, 0),
        authUsers: rowsBefore.authUsers.length, objects: objects.length,
        objectBytes: objects.reduce((n, object) => n + object.bytes, 0) },
    };
    const payload = { manifest, before, after, ...rowsBefore, objects,
      dumpBase64: dump.toString("base64"), rolesSql: rolesResult.bytes.toString("utf8") };
    const keyState = loadBackupKey(false);
    key = keyState.key;
    const encrypted = encryptArchive(payload, key, keyState.mode);
    const verified = decryptArchive(encrypted, key);
    ensure(digest(verified) === digest(payload) &&
      sqlHash(decodeLocalArchive(Buffer.from(verified.dumpBase64, "base64"))) === sqlHash(decoded),
    "ENCRYPTION_VERIFY_FAILED", "El archivo cifrado no conserva los datos o el dump íntegro.");
    for (const object of verified.objects)
      ensure(sha256(Buffer.from(object.dataBase64, "base64")) === object.sha256,
        "OBJECT_VERIFY_FAILED", "Un objeto cifrado no conserva sus bytes.");
    const name = "target-final-" + TARGET_PROJECT + "-" + runId + ".json.enc";
    const file = resolve(BACKUP_DIR, name);
    writeFileSync(file, encrypted, { flag: "wx", mode: 0o600 });
    const disk = readFileSync(file);
    ensure(sha256(disk) === sha256(encrypted) && digest(decryptArchive(disk, key)) === digest(payload),
      "DISK_VERIFY_FAILED", "No se verificó el respaldo cifrado escrito.");
    const evidence = {
      at: new Date().toISOString(), result: "PASS", targetProjectRef: TARGET_PROJECT,
      operation: "Read-only final target logical database and storage backup",
      archive: ".runtime/backups/" + name, encryptedArchiveSha256: sha256(disk),
      encryptedArchiveBytes: disk.length, counts: manifest.counts, postgresDump: manifest.dump,
      cipher: "AES-256-GCM", keyProtection: keyState.mode, acl,
      fullArchiveDecoded: true, encryptedMemoryAndDiskRoundtrip: true, allObjectBytesVerified: true,
      catalogCaptured: true, migrationVersions: before.sql.migrations.map(row => row.version), privateRows: Object.fromEntries(Object.entries(rowsBefore.privateTables).map(([name,rows]) => [name,rows.length])),
      beforeAfterStable: true, readOnlyRequests: stats.requests, remoteMutations: 0,
      plaintextFilesWritten: 0, clientTlsHostnameAndCaVerified: true,
      fullManagedSupabaseRestoreExecuted: false, physicalBackupOrPitr: false,
      limitations: [
        "pg_dump is a consistent database snapshot; comparison of API/Storage before and after detects stability but is not a distributed transaction.",
        "Complete archive decode validates compressed entries, not a full managed Supabase restoration.",
        "Includes current Auth tables in the encrypted dump, not Auth/SMTP/provider/JWT settings or signing keys.",
        "Storage bytes are included separately; role passwords, publications, subscriptions, other databases and physical WAL/PITR are excluded.",
        "DPAPI CurrentUser requires this Windows profile/machine; independent portable disaster recovery is not established.",
      ],
    };
    const evidencePath = saveTargetEvidence("target-final-backup.json", evidence, runId);
    console.log(JSON.stringify({ result: "PASS", counts: manifest.counts, archive: evidence.archive,
      encryptedArchiveSha256: evidence.encryptedArchiveSha256, remoteMutations: 0, evidence: evidencePath }));
    return evidence;
  } catch (error) {
    failReport(error, stage);
  } finally {
    key?.fill(0);
    await connection?.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await captureFinalTarget();
