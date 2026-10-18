import {
  existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, realpathSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { ROOT, ensure, digest, sha256, encryptArchive, decryptArchive } from "./backup-common.mjs";
import { TARGET_PROJECT, assertTargetEnvironment } from "./migration-data-common.mjs";

export const PRIVATE_DIR = resolve(ROOT, ".runtime", "migrations", TARGET_PROJECT);
export function protectMigrationDirectory() {
  ensure(process.platform === "win32", "WINDOWS_REQUIRED", "Se necesita verificar ACL en Windows.");
  for (const path of [resolve(ROOT, ".runtime"), resolve(ROOT, ".runtime", "migrations"), PRIVATE_DIR]) {
    mkdirSync(path, { recursive: true });
    ensure(!lstatSync(path).isSymbolicLink(), "PRIVATE_PATH_INVALID", "El directorio privado no puede ser un enlace.");
  }
  const ignored = spawnSync("git", ["check-ignore", "-q", ".runtime/migrations/" + TARGET_PROJECT + "/accounts.json"], {
    cwd: ROOT, windowsHide: true,
  });
  ensure(ignored.status === 0, "PRIVATE_PATH_NOT_IGNORED", "El estado privado debe estar ignorado por Git.");
  const script = "$ErrorActionPreference='Stop';" +
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;" +
    "$existing=Get-Acl -LiteralPath $env:TOLENTINO_MIGRATION_PRIVATE_DIR;" +
    "$allowed=@($existing.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'});" +
    "$other=@($allowed|Where-Object {$_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18')});" +
    "$mine=@($allowed|Where-Object {$_.IdentityReference.Value -eq $sid.Value -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl});" +
    "if($existing.AreAccessRulesProtected -and $other.Count -eq 0 -and $mine.Count -gt 0){[Console]::Out.Write('verified');return};" +
    "$acl=New-Object Security.AccessControl.DirectorySecurity;" +
    "$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);" +
    "foreach($id in @($sid.Value,'S-1-5-18')){" +
    "$identity=New-Object Security.Principal.SecurityIdentifier($id);" +
    "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};" +
    "Set-Acl -LiteralPath $env:TOLENTINO_MIGRATION_PRIVATE_DIR -AclObject $acl;" +
    "$actual=Get-Acl -LiteralPath $env:TOLENTINO_MIGRATION_PRIVATE_DIR;" +
    "$bad=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18')});" +
    "if(!$actual.AreAccessRulesProtected -or $bad.Count -ne 0){throw 'ACL validation failed'};" +
    "[Console]::Out.Write('verified')";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, TOLENTINO_MIGRATION_PRIVATE_DIR: PRIVATE_DIR },
    windowsHide: true, encoding: "utf8", timeout: 30_000,
  });
  ensure(result.status === 0 && result.stdout.trim() === "verified",
    "PRIVATE_ACL_FAILED", "No se pudo verificar la ACL privada de migración.");
  return { inheritedAccessDisabled: true, allowedPrincipals: "current Windows user and SYSTEM", ignoredByGit: true };
}
function privatePath(name) {
  ensure(["accounts.json", "admin-account.json", "journal.json.enc"].includes(name),
    "PRIVATE_FILE_INVALID", "Archivo privado no permitido.");
  const path = resolve(PRIVATE_DIR, name);
  ensure(realpathSync(dirname(path)) === realpathSync(PRIVATE_DIR) &&
    (!existsSync(path) || !lstatSync(path).isSymbolicLink()),
    "PRIVATE_PATH_INVALID", "Ruta privada inesperada.");
  return path;
}
export function loadCredentials() {
  const accounts = privatePath("accounts.json"), admin = privatePath("admin-account.json");
  ensure(existsSync(accounts) === existsSync(admin), "CREDENTIAL_STATE_INCOMPLETE",
    "Estado de credenciales parcial; no se generan contraseñas distintas ni se modifica Auth.");
  if (!existsSync(accounts)) return null;
  return {
    accounts: JSON.parse(readFileSync(accounts, "utf8")),
    admin: JSON.parse(readFileSync(admin, "utf8")),
  };
}
export function persistNewCredentials(bundle) {
  const accounts = privatePath("accounts.json"), admin = privatePath("admin-account.json");
  ensure(!existsSync(accounts) && !existsSync(admin), "CREDENTIAL_STATE_EXISTS",
    "No se sobrescriben credenciales previas.");
  writeFileSync(accounts, JSON.stringify(bundle.accounts, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(admin, JSON.stringify(bundle.admin, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  ensure(digest(loadCredentials()) === digest(bundle), "CREDENTIAL_WRITE_FAILED",
    "Las credenciales nuevas no se pudieron verificar antes de crear cuentas.");
}
export function readJournal(key) {
  const path = privatePath("journal.json.enc");
  return existsSync(path) ? decryptArchive(readFileSync(path), key) : null;
}
export function writeJournal(value, key, keyMode) {
  const path = privatePath("journal.json.enc"), temp = path + ".next";
  ensure(!existsSync(temp), "JOURNAL_TEMP_EXISTS", "Existe un diario temporal; revisar antes de reanudar.");
  const bytes = encryptArchive(value, key, keyMode);
  ensure(digest(decryptArchive(bytes, key)) === digest(value),
    "JOURNAL_ENCRYPTION_FAILED", "El diario no superó su verificación.");
  writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
  renameSync(temp, path);
}
export function migrationWriteFetch(env, payload, stats = { requests: 0, mutations: 0 }, delegate = fetch) {
  const { origin } = assertTargetEnvironment(env, { requireDatabase: true });
  const identities = new Map(payload.users.map((u) => [u.id, u.email]));
  const uploads = new Set(payload.objects.map((o) => "/storage/v1/object/restaurant-media/" + o.path));
  return async (input, options = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (options.method || request?.method || "GET").toUpperCase();
    ensure(url.origin === origin && !url.username && !url.password,
      "MIGRATION_TARGET_INVALID", "La solicitud no corresponde al destino autorizado.");
    let allowed = method === "GET" || method === "HEAD";
    let mutation = false;
    if (method === "POST" && url.pathname === "/auth/v1/admin/users") {
      ensure(typeof options.body === "string", "AUTH_REQUEST_INVALID", "Formato de creación Auth inesperado.");
      const attrs = JSON.parse(options.body);
      allowed = identities.get(attrs.id) === attrs.email && attrs.email_confirm === true &&
        attrs.app_metadata?.tolentino_migration?.targetProjectRef === TARGET_PROJECT;
      mutation = true;
    }
    if (method === "POST" && url.pathname === "/storage/v1/object/list/restaurant-media") allowed = true;
    if (method === "POST" && uploads.has(decodeURI(url.pathname))) {
      allowed = new Headers(options.headers || request?.headers).get("x-upsert") === "false";
      mutation = true;
    }
    ensure(allowed, "REMOTE_OPERATION_BLOCKED",
      "La migración bloqueó un método, ruta o reemplazo no autorizado.");
    stats.requests++;
    if (mutation) stats.mutations++;
    return delegate(input, {
      ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(60_000),
    });
  };
}
export function migrationApiClient(env, payload, stats) {
  return createClient(env.TARGET_SUPABASE_URL, env.TARGET_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: migrationWriteFetch(env, payload, stats) },
  });
}
export function progressCheckpoint(checkpoint) {
  return async ({ phase, ...counts }) => {
    ensure(typeof phase === "string" && /^[a-z][a-z0-9-]{1,80}$/.test(phase) &&
      Object.values(counts).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0),
      "JOURNAL_PROGRESS_INVALID", "El progreso del migrador debe contener fase textual y conteos.");
    return checkpoint(phase, counts);
  };
}
export async function connectTargetPg(env) {
  assertTargetEnvironment(env, { requireDatabase: true });
  const require = createRequire(resolve(ROOT, ".runtime", "migration-tools", "package.json"));
  ensure(require("pg/package.json").version === "8.23.1", "PG_DRIVER_VERSION_INVALID",
    "El driver pg debe coincidir con la versión revisada.");
  const { Client } = require("pg");
  const ca = readFileSync(resolve(ROOT, ".runtime", "supabase-ca.crt"), "utf8");
  const certificate = new X509Certificate(ca);
  ensure(sha256(certificate.raw) === "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa" &&
    certificate.ca && Date.parse(certificate.validTo) > Date.now(),
    "CA_CERTIFICATE_INVALID", "El certificado CA no coincide con la distribución oficial revisada.");
  const client = new Client({
    host: env.TARGET_SUPABASE_DB_HOST, port: Number(env.TARGET_SUPABASE_DB_PORT),
    user: env.TARGET_SUPABASE_DB_USER, password: env.TARGET_SUPABASE_DB_PASSWORD,
    database: env.TARGET_SUPABASE_DB_NAME,
    ssl: { ca, rejectUnauthorized: true, servername: env.TARGET_SUPABASE_DB_HOST },
    connectionTimeoutMillis: 15_000, query_timeout: 60_000, statement_timeout: 60_000,
    lock_timeout: 15_000, keepAlive: true, application_name: "tolentino-target-migration",
    options: "-c default_transaction_read_only=on",
  });
  client.on("error", () => { /* Query failures are reported through sanitized stage errors. */ });
  try {
    await client.connect();
    // Supavisor does not retain this startup option; enforce it on the verified session.
    await client.query('set default_transaction_read_only=on');
    const check = (await client.query(
      "select current_database() as database,session_user,current_setting('default_transaction_read_only') as readonly",
    )).rows[0];
    ensure(check.database === "postgres" && check.session_user === "postgres" && check.readonly === "on" &&
      client.connection.stream.encrypted && client.connection.stream.authorized,
      "PG_CONNECTION_INVALID", "No se verificó la conexión TLS/identidad/read-only del destino.");
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}
export function pgAdapter(client) {
  return { exec: (sql) => client.query(sql), query: (sql, params) => client.query(sql, params) };
}
