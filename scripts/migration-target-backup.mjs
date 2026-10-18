import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import {
  ROOT, BACKUP_DIR, ensure, failReport, digest, sha256, protectBackupDirectory,
  loadBackupKey, encryptArchive, decryptArchive,
} from "./backup-common.mjs";
import { TARGET_PROJECT } from "./migration-data-common.mjs";
import {
  PG_BIN, targetEnvironment, readonlyPgTool, inspectTarget, initialTargetIsEmpty,
  publicInspection, saveTargetEvidence,
} from "./migration-target-inspect.mjs";

let key, localDb;
let stage = "initial-readonly-inspection";
const sqlDigest = (bytes) => sha256(bytes.toString("utf8").replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?\n/gm, ""));
function decodeDump(dump, args) {
  // No --dbname is accepted here: pg_restore parses stdin and emits stdout only.
  const result = spawnSync(resolve(PG_BIN, "pg_restore.exe"), args, {
    input: dump, windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: "1", PGDATABASE: "disabled",
      PGPASSWORD: "", PGOPTIONS: "-c default_transaction_read_only=on" },
  });
  ensure(result.status === 0, "DUMP_DECODE_FAILED",
    "No se pudo leer completamente el dump local; no se registra como verificado.");
  return result.stdout;
}
try {
  ensure(process.argv.length === 2, "USAGE", "Uso: node scripts/migration-target-backup.mjs");
  const env = targetEnvironment();
  const stats = { requests: 0 };
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[^0-9TZ]/g, "");
  const acl = protectBackupDirectory();
  const before = await inspectTarget(env, stats);
  ensure(initialTargetIsEmpty(before), "TARGET_NOT_EMPTY",
    "Este procedimiento está aprobado para el destino vacío inspeccionado; un estado distinto requiere revisión.");
  ensure(before.sql.serverVersionNum.startsWith("17"), "PG_VERSION_MISMATCH",
    "Revisar compatibilidad antes de respaldar una versión distinta de PostgreSQL17.");
  stage = "read-only-postgresql-dump";
  const dumpResult = readonlyPgTool("pg_dump", [
    "--format=custom", "--no-publications", "--no-subscriptions",
    "--lock-wait-timeout=15000", "-w",
  ], env, undefined, 180_000);
  ensure(dumpResult.warningBytes === 0, "DUMP_WARNING",
    "pg_dump emitió advertencias; revisar antes de aceptar un respaldo parcial.");
  const dump = dumpResult.bytes;
  ensure(dump.subarray(0, 5).toString("ascii") === "PGDMP",
    "DUMP_FORMAT_INVALID", "El respaldo no tiene formato custom PostgreSQL.");
  const rolesResult = readonlyPgTool("pg_dumpall", [
    "--roles-only", "--no-role-passwords", "-w",
  ], env, undefined, 120_000);
  ensure(rolesResult.warningBytes === 0, "ROLE_DUMP_WARNING",
    "El respaldo de roles emitió advertencias y requiere revisión.");
  const roles = rolesResult.bytes;
  stage = "read-only-after-snapshot";
  const after = await inspectTarget(env, stats);
  ensure(initialTargetIsEmpty(after) && digest(before) === digest(after), "TARGET_CHANGED",
    "Cambió el inventario del destino durante el respaldo; no se acepta como baseline.");
  stage = "local-archive-verification";
  const toc = decodeDump(dump, ["--list"]).toString("utf8");
  const decodedSql = decodeDump(dump, ["--file=-", "--no-owner", "--no-privileges"]);
  ensure(toc.includes("auth users") && toc.includes("storage objects") &&
    decodedSql.includes(Buffer.from("CREATE TABLE auth.users")) &&
    decodedSql.includes(Buffer.from("CREATE TABLE storage.objects")),
    "DUMP_CONTENT_INVALID", "Faltan estructuras Auth o Storage en el dump.");
  const publicSql = decodeDump(dump, [
    "--file=-", "--schema=public", "--no-owner", "--no-privileges", "--no-comments",
  ]).toString("utf8");
  const metaLines = publicSql.split(/\r?\n/).filter((line) => line.startsWith("\\"));
  ensure(metaLines.every((line) => /^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line)),
    "DUMP_META_INVALID", "El extracto de esquema incluye un metacomando inesperado.");
  const replaySql = publicSql.split(/\r?\n/).filter((line) => !line.startsWith("\\")).join("\n");
  localDb = new PGlite();
  // PGlite starts from the same empty public-schema baseline as a fresh PostgreSQL database.
  await localDb.exec(replaySql);
  const restored = (await localDb.query(
    "select exists(select from pg_namespace where nspname='public') as has_public," +
    "(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')::int as relations",
  )).rows[0];
  ensure(restored.has_public && restored.relations === 0, "PUBLIC_RESTORE_FAILED",
    "El esquema público inicial no se restauró como se esperaba.");
  const manifest = {
    formatVersion: 1, scope: "empty-target-pre-migration-logical-postgresql",
    projectRef: TARGET_PROJECT, startedAt, completedAt: new Date().toISOString(),
    initialTargetIsEmpty: true, serverVersion: before.sql.serverVersion,
    toolVersion: "PostgreSQL 17.11 portable Windows x64",
    inventoryBeforeSha256: digest(before), inventoryAfterSha256: digest(after),
    dump: { format: "custom", bytes: dump.length, sha256: sha256(dump) },
    roles: { format: "SQL without role passwords", bytes: roles.length, sha256: sha256(roles) },
    storageObjects: 0, authUsers: 0,
    included: [
      "Logical postgres database custom dump, including managed Auth/Storage schema and current table data",
      "Role definitions without password hashes",
      "SQL catalog plus paginated Auth and Storage API inventory",
    ],
    excluded: [
      "PostgreSQL physical backup, WAL and PITR",
      "Role password hashes, other databases, host filesystem and extension binaries",
      "Project API/Auth/SMTP/provider configuration and signing keys (separate configuration backup)",
      "Publications and subscriptions",
    ],
  };
  const payload = {
    manifest, before, after, dumpBase64: dump.toString("base64"),
    rolesSql: roles.toString("utf8"),
  };
  const keyState = loadBackupKey(false);
  key = keyState.key;
  const encrypted = encryptArchive(payload, key, keyState.mode);
  const decrypted = decryptArchive(encrypted, key);
  ensure(digest(decrypted) === digest(payload) &&
    sha256(Buffer.from(decrypted.dumpBase64, "base64")) === manifest.dump.sha256,
    "ENCRYPTION_VERIFY_FAILED", "El roundtrip cifrado no conserva el contenido.");
  // Read every compressed archive segment again from the decrypted payload.
  ensure(sqlDigest(decodeDump(Buffer.from(decrypted.dumpBase64, "base64"),
    ["--file=-", "--no-owner", "--no-privileges"])) === sqlDigest(decodedSql),
    "DECRYPTED_DUMP_INVALID", "El dump descifrado no coincide al decodificarlo.");
  const name = "target-" + TARGET_PROJECT + "-" + runId + ".json.enc";
  const path = resolve(BACKUP_DIR, name);
  writeFileSync(path, encrypted, { flag: "wx", mode: 0o600 });
  const disk = readFileSync(path);
  ensure(sha256(disk) === sha256(encrypted) &&
    digest(decryptArchive(disk, key)) === digest(payload),
    "DISK_VERIFY_FAILED", "Falló la lectura y autenticación del archivo cifrado guardado.");
  const evidence = {
    ...publicInspection(before, stats), completedAt: new Date().toISOString(),
    operation: "Read-only encrypted backup before target migration",
    archive: ".runtime/backups/" + name, encryptedArchiveBytes: disk.length,
    encryptedArchiveSha256: sha256(disk),
    cipher: "AES-256-GCM", keyProtection: keyState.mode, acl,
    postgresDump: manifest.dump, rolesDump: manifest.roles,
    tool: { version: "17.11", distribution: "EDB portable zip linked by postgresql.org",
      zipSha256: sha256(readFileSync(resolve(ROOT, ".runtime", "postgresql-17.11-windows-x64.zip"))) },
    verification: {
      beforeAfterInventoryEqual: true, encryptedRoundtripEqual: true,
      encryptedDiskReadEqual: true, fullCustomArchiveDecoded: true,
      authAndStorageTablesPresentInArchive: true,
      emptyPublicApplicationFootprintReplayedInMemory: true,
      fullManagedSupabaseRestoreExecuted: false,
      postgresPhysicalBackup: false,
    },
    plaintextBackupFilesWritten: 0, remoteMutations: 0,
    targetMutationAuthorizedByThisScript: false,
    limitations: manifest.excluded,
    configurationBackup: "Auth Management configuration is handled separately; this script never changes it.",
  };
  const file = saveTargetEvidence("target-backup.json", evidence, runId);
  console.log(JSON.stringify({
    result: "PASS", targetProjectRef: TARGET_PROJECT, initialTargetIsEmpty: true,
    archive: evidence.archive, encryptedArchiveSha256: evidence.encryptedArchiveSha256,
    dumpBytes: dump.length, rolesBytes: roles.length,
    fullArchiveDecode: true, emptyPublicApplicationFootprintLocalReplay: true,
    fullManagedSupabaseRestore: false, plaintextBackupFilesWritten: 0,
    remoteMutations: 0, evidence: file,
  }));
} catch (error) {
  failReport(error, stage);
} finally {
  key?.fill(0);
  await localDb?.close();
}
