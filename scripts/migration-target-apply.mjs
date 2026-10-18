import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import {
  ROOT, TABLES, ensure, failReport, digest, sha256, safeLocalPath, loadBackupKey, decryptArchive,
} from "./backup-common.mjs";
import {
  TARGET_PROJECT, SOURCE_ARCHIVE_SHA256, DEMO_KEYS, validateMigrationSource,
  prepareApplicationTables, newCredentialBundle, importApplicationRows, sameRows,
} from "./migration-data-common.mjs";
import {
  targetEnvironment, inspectTarget, initialTargetIsEmpty, readFetchForTarget, saveTargetEvidence,
} from "./migration-target-inspect.mjs";
import {
  protectMigrationDirectory, loadCredentials, persistNewCredentials, readJournal, writeJournal,
  migrationApiClient, connectTargetPg, pgAdapter, progressCheckpoint,
} from "./migration-target-runtime.mjs";
import { applyVersionedSchema, verifyTargetSecurity } from "./migration-target-schema.mjs";
import { migrateAuthStorage } from "./migration-auth-storage.mjs";

const TARGET_BACKUP_SHA256 = "2d085aeaf6d77886e367d81e44c9ddccf8ef04057f7bd1aa08e9ce524169749b";
let key, client;
let stage = "local-preconditions";
const stats = { requests: 0, mutations: 0 };
let journal;
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[^0-9TZ]/g, "");
function argument(name) {
  const index = process.argv.indexOf(name);
  ensure(index >= 0 && process.argv[index + 1], "USAGE", "Falta un argumento requerido del migrador.");
  return process.argv[index + 1];
}
function freshSourceEvidence(path) {
  const base = resolve(ROOT, "docs", "evidence", "migrations", TARGET_PROJECT);
  const file = resolve(ROOT, path), rel = relative(base, file);
  ensure(rel && !rel.startsWith("..") && !isAbsolute(rel) && !lstatSync(file).isSymbolicLink(),
    "SOURCE_EVIDENCE_PATH_INVALID", "La evidencia de vigencia debe estar dentro del directorio de migración.");
  const value = JSON.parse(readFileSync(file, "utf8"));
  const age = Date.now() - Date.parse(value.at);
  ensure(value.result === "PASS" && value.comparison === "UNCHANGED" &&
    value.comparisonOnly === true && value.baseline?.sha256 === SOURCE_ARCHIVE_SHA256 &&
    value.sourceDoubleRead?.equal === true && value.remoteMutations === 0 &&
    Number.isFinite(age) && age >= -60_000 && age <= 15 * 60_000,
    "SOURCE_CURRENTNESS_REQUIRED", "Se necesita una comparación reciente de sólo lectura que confirme el respaldo vigente.");
  return { file: relative(ROOT, file).replaceAll("\\", "/"), at: value.at, sha256: sha256(readFileSync(file)) };
}
async function assertSignupClosed(env) {
  const result = await readFetchForTarget(env, stats)(env.TARGET_SUPABASE_URL + "/auth/v1/settings", {
    headers: { apikey: env.TARGET_SUPABASE_PUBLISHABLE_KEY },
  });
  ensure(result.ok, "AUTH_SETTINGS_FAILED", "No se pudo comprobar la configuración de Auth.");
  const data = await result.json();
  ensure(data.disable_signup === true && data.external?.anonymous_users === false,
    "PUBLIC_SIGNUP_OPEN", "El registro público y el acceso anónimo deben estar cerrados antes de migrar.");
}
async function verifyRows(db, tables) {
  for (const [table, keys] of TABLES) {
    const rows = (await db.query('select to_jsonb(t) as row from public."' + table + '" t')).rows.map((r) => r.row);
    ensure(sameRows(rows, tables[table], keys), "FINAL_DATA_MISMATCH",
      "La tabla destino no coincide con los datos preparados.");
  }
}
try {
  ensure(process.argv.includes("--apply") &&
    argument("--confirm-target") === TARGET_PROJECT,
    "APPLY_CONFIRMATION_REQUIRED", "El comando requiere --apply y la referencia exacta del destino revisado.");
  const env = targetEnvironment();
  const sourcePath = safeLocalPath(resolve(ROOT, argument("--source")));
  const targetBackupPath = safeLocalPath(resolve(ROOT, argument("--target-backup")));
  const sourceEvidencePath = argument("--source-currentness");
  const sourceEvidence = freshSourceEvidence(sourceEvidencePath);
  const encryptedSource = readFileSync(sourcePath), encryptedTarget = readFileSync(targetBackupPath);
  const keyState = loadBackupKey(false);
  key = keyState.key;
  const payload = decryptArchive(encryptedSource, key);
  const inventory = validateMigrationSource(payload, encryptedSource);
  ensure(sha256(encryptedTarget) === TARGET_BACKUP_SHA256, "TARGET_BACKUP_MISMATCH",
    "El respaldo previo del destino no coincide con el archivo revisado.");
  const backup = decryptArchive(encryptedTarget, key);
  ensure(backup.manifest?.projectRef === TARGET_PROJECT &&
    backup.manifest.scope === "empty-target-pre-migration-logical-postgresql" &&
    backup.manifest.initialTargetIsEmpty === true &&
    backup.manifest.inventoryBeforeSha256 === backup.manifest.inventoryAfterSha256 &&
    digest(backup.before) === backup.manifest.inventoryBeforeSha256 &&
    initialTargetIsEmpty(backup.before) &&
    sha256(Buffer.from(backup.dumpBase64, "base64")) === backup.manifest.dump.sha256,
    "TARGET_BACKUP_INVALID", "El respaldo cifrado del destino no acredita el baseline revisado.");
  const prepared = prepareApplicationTables(payload);
  const acl = protectMigrationDirectory();
  journal = readJournal(key);
  const binding = { targetProjectRef: TARGET_PROJECT, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    targetBackupSha256: TARGET_BACKUP_SHA256,
    migrations: payload.migrations.map(({ file, sha256 }) => ({ file, sha256 })) };
  ensure(!journal || digest(journal.binding) === digest(binding),
    "JOURNAL_CONFLICT", "El diario existente pertenece a otra migración; no se sobrescribe.");
  stage = "destination-preflight";
  const before = await inspectTarget(env, stats);
  await assertSignupClosed(env);
  if (!journal) {
    ensure(initialTargetIsEmpty(before) && digest(before) === backup.manifest.inventoryBeforeSha256,
      "TARGET_CHANGED", "El destino ya no coincide con el backup vacío previo.");
  }
  client = await connectTargetPg(env);
  const db = pgAdapter(client);
  const lock = (await client.query(
    "select pg_try_advisory_lock(hashtextextended($1,0)) as acquired", ["tolentino-migration-" + TARGET_PROJECT],
  )).rows[0].acquired;
  ensure(lock, "MIGRATION_LOCKED", "Otra ejecución tiene el bloqueo del migrador.");
  // Recheck empty application state on this connection before durable local state or remote writes.
  if (!journal) {
    ensure((await client.query("select to_regclass('public.restaurants') is null as empty")).rows[0].empty,
      "TARGET_CHANGED", "Se detectaron tablas nuevas tras la inspección.");
  }
  let credentials = loadCredentials();
  if (!journal) {
    ensure(!credentials, "CREDENTIAL_STATE_EXISTS", "Hay credenciales sin diario; revisar antes de crear cuentas.");
    journal = { binding, startedAt, stage: "prepared", sourceEvidence, acl, checkpoints: [] };
    writeJournal(journal, key, keyState.mode);
  }
  if (!credentials) {
    ensure(journal.stage === "prepared", "CREDENTIAL_STATE_MISSING",
      "No se pueden regenerar secretos después de iniciar la migración remota.");
    credentials = newCredentialBundle(payload);
    persistNewCredentials(credentials);
  }
  const credentialFingerprint = digest(credentials);
  ensure(!journal.credentialFingerprint || journal.credentialFingerprint === credentialFingerprint,
    "CREDENTIAL_STATE_CHANGED", "El bundle privado no coincide con el diario; no se resetean cuentas.");
  journal.credentialFingerprint = credentialFingerprint;
  const checkpoint = async (phase, counts = {}) => {
    journal.stage = phase;
    journal.checkpoints.push({ at: new Date().toISOString(), phase, ...counts });
    writeJournal(journal, key, keyState.mode);
  };
  await checkpoint("credentials-persisted");
  stage = "versioned-schema-transaction";
  await client.query("set default_transaction_read_only=off");
  const schema = await applyVersionedSchema(db, payload.migrations);
  const restaurantCount = Number((await client.query("select count(*) as n from public.restaurants")).rows[0].n);
  let bootstrapSettings;
  if (restaurantCount === 0)
    bootstrapSettings = (await client.query("select to_jsonb(t) as row from public.platform_settings t")).rows.map((r) => r.row);
  await checkpoint("schema-ready", schema);
  console.log(JSON.stringify({ phase: "schema-ready", ...schema }));
  stage = "auth-and-private-storage";
  const api = migrationApiClient(env, payload, stats);
  const assets = await migrateAuthStorage({
    client: api, payload, credentials,
    onProgress: progressCheckpoint(checkpoint),
  });
  await checkpoint("auth-storage-ready", assets);
  console.log(JSON.stringify({ phase: "auth-storage-ready", ...assets }));
  stage = "application-data-transaction";
  const finalSourceEvidence = freshSourceEvidence(sourceEvidencePath);
  await assertSignupClosed(env);
  const imported = await importApplicationRows(db, prepared, { bootstrapSettings });
  await checkpoint("data-imported", imported);
  stage = "final-data-and-security-verification";
  await verifyRows(db, prepared);
  const security = await verifyTargetSecurity(db);
  const auth = (await client.query("select count(*)::int as n from auth.users")).rows[0].n;
  const memberships = (await client.query("select count(*)::int as n from public.restaurant_memberships")).rows[0].n;
  const objects = (await client.query("select count(*)::int as n from storage.objects where bucket_id='restaurant-media'")).rows[0].n;
  ensure(auth === 4 && memberships === 3 && objects === 27, "FINAL_COUNTS_INVALID",
    "Los conteos finales de identidades, membresías y objetos difieren.");
  const base = process.env.AUDIT_BASE_URL || "http://localhost:3000";
  ensure(/^https?:\/\//.test(base), "APP_BASE_INVALID", "La base de QA no es una URL válida.");
  const manifest = {
    at: new Date().toISOString(), target: TARGET_PROJECT + ".supabase.co",
    targetProjectRef: TARGET_PROJECT, base, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    publicDeploymentVerified: false, restaurants: prepared.restaurants.map((restaurant) => ({
      key: DEMO_KEYS[restaurant.id], name: restaurant.name, id: restaurant.id,
      owner: restaurant.owner_email, status: restaurant.status, isDemo: restaurant.is_demo,
      products: prepared.products.filter((p) => p.restaurant_id === restaurant.id).length,
      categories: prepared.categories.filter((c) => c.restaurant_id === restaurant.id).length,
      publicToken: restaurant.public_token, localMenu: base + "/menu/" + restaurant.slug,
      stableRoute: "/q/" + restaurant.public_token,
      logoPath: prepared.restaurant_settings.find((s) => s.restaurant_id === restaurant.id).appearance.logo_path,
      migratedFromEncryptedArchive: true,
    })),
  };
  const manifestFolder = resolve(ROOT, "artifacts", "migrations", TARGET_PROJECT);
  mkdirSync(manifestFolder, { recursive: true });
  const manifestPath = resolve(manifestFolder, "restaurants.json");
  if (existsSync(manifestPath)) {
    const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
    ensure(previous.targetProjectRef === TARGET_PROJECT && previous.sourceArchiveSha256 === SOURCE_ARCHIVE_SHA256,
      "MANIFEST_CONFLICT", "Existe un manifiesto de otro traslado; no se sobrescribe.");
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await checkpoint("complete", { auth, memberships, objects });
  const evidence = {
    at: new Date().toISOString(), result: "PASS", operation: "New target migration",
    targetProjectRef: TARGET_PROJECT, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    targetBackupSha256: TARGET_BACKUP_SHA256, sourceEvidence: finalSourceEvidence,
    inventory, schema, assets, imported, security, finalCounts: { auth, memberships, objects },
    clientTlsVerified: true, acl, credentialFiles: [
      ".runtime/migrations/" + TARGET_PROJECT + "/accounts.json",
      ".runtime/migrations/" + TARGET_PROJECT + "/admin-account.json",
    ],
    manifest: "artifacts/migrations/" + TARGET_PROJECT + "/restaurants.json",
    preserved: ["Restaurant/product/category/owner/admin UUIDs", "Permanent QR UUIDs", "All business data and object paths/bytes"],
    normalized: ["restaurants.menu_version_transaction=0", "Fresh Auth credentials and migration marker"],
    sourceRequestsByThisRunner: 0, sourceMutations: 0,
    targetHttpRequests: stats.requests, targetHttpMutationRequests: stats.mutations,
    applicationRowsEqual: true, storageObjectBytesEqual: true,
    passwordOrKeyValuesPrinted: false, emailMessagesSentByRunner: 0,
    authLoginTested: false, publicDeploymentVerified: false, publicQrVerified: false,
  };
  const evidencePath = saveTargetEvidence("target-migration.json", evidence, runId);
  console.log(JSON.stringify({
    result: "PASS", targetProjectRef: TARGET_PROJECT, schema, assets, imported,
    finalCounts: evidence.finalCounts, sourceMutations: 0, evidence: evidencePath,
  }));
} catch (error) {
  failReport(error, stage);
} finally {
  key?.fill(0);
  await client?.end().catch(() => {});
}
