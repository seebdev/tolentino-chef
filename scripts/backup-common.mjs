import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BACKUP_DIR = resolve(ROOT, ".runtime", "backups");
export const PROJECT = "ylcnrfzosjzuljufwups";
export const BUCKET = "restaurant-media";
export const TABLES = [
  ["platform_admins", ["user_id"]],
  ["restaurants", ["id"]],
  ["restaurant_memberships", ["restaurant_id"]],
  ["restaurant_settings", ["restaurant_id"]],
  ["categories", ["id"]],
  ["products", ["id"]],
  ["promotions", ["id"]],
  ["restaurant_hours", ["id"]],
  ["translations", ["id"]],
  ["restaurant_qr_configs", ["restaurant_id"]],
  ["restaurant_domains", ["id"]],
  ["commercial_sales", ["id"]],
  ["security_audit_events", ["id"]],
  ["visit_events", ["restaurant_id", "day"]],
  ["platform_settings", ["id"]],
];
export const LIMITS = {
  rowsPerTable: 1_000_000,
  objects: 100_000,
  totalObjectBytes: 512 * 1024 * 1024,
};
const FORMAT = "tolentino-app-backup-v1";
const AAD = Buffer.from(FORMAT, "utf8");
export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export function ensure(value, code, message) {
  if (!value) throw new BackupError(code, message);
}
export function failReport(error, stage) {
  console.error(
    JSON.stringify({
      result: "FAIL",
      stage,
      code:
        error instanceof BackupError ? error.code : "BACKUP_OPERATION_FAILED",
      message:
        error instanceof BackupError
          ? error.message
          : "La operación falló; se omiten detalles que podrían contener datos privados.",
    }),
  );
  process.exitCode = 1;
}
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  if (typeof value === "number")
    ensure(
      !Number.isInteger(value) || Number.isSafeInteger(value),
      "UNSAFE_INTEGER",
      "Un entero excede la precisión segura del respaldo JSON.",
    );
  // PostgreSQL serializes UTC fractions with variable precision; preserve microseconds.
  if (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
  ) {
    return (
      value
        .replace(/(?:Z|\+00:00)$/, "")
        .replace(
          /(?:\.(\d+))?$/,
          (_, fraction) => "." + (fraction || "").padEnd(6, "0"),
        ) + "Z"
    );
  }
  return value;
}
export const digest = (value) => sha256(JSON.stringify(canonical(value)));
export function sortedRows(rows, keys) {
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const left = String(a[key]),
        right = String(b[key]);
      if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
  });
}
export function dataFingerprint(snapshot) {
  return digest({
    tables: Object.fromEntries(
      TABLES.map(([table, keys]) => [
        table,
        sortedRows(snapshot.tables[table], keys),
      ]),
    ),
    users: sortedRows(snapshot.users, ["id"]),
    bucket: snapshot.bucket,
    objects: sortedRows(
      snapshot.objects.map(
        ({ path, id, updated_at, created_at, metadata }) => ({
          path,
          id,
          updated_at,
          created_at,
          metadata,
        }),
      ),
      ["path"],
    ),
  });
}
export function safeLocalPath(file) {
  const target = resolve(file);
  const rel = relative(BACKUP_DIR, target);
  ensure(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "UNSAFE_PATH",
    "El archivo debe estar dentro de .runtime/backups.",
  );
  ensure(
    realpathSync(dirname(target)) === realpathSync(BACKUP_DIR),
    "UNSAFE_PATH",
    "No se admiten subdirectorios ni enlaces para el archivo de respaldo.",
  );
  if (existsSync(target))
    ensure(
      !lstatSync(target).isSymbolicLink(),
      "UNSAFE_PATH",
      "No se admiten enlaces simbólicos.",
    );
  return target;
}
function ps(script, input = "", env = {}) {
  const run = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, ...env },
    },
  );
  ensure(
    run.status === 0,
    "PRIVATE_STORAGE_FAILED",
    "No fue posible aplicar la protección local de archivos o DPAPI.",
  );
  return run.stdout.trim();
}
export function protectBackupDirectory() {
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  ensure(
    !lstatSync(BACKUP_DIR).isSymbolicLink(),
    "UNSAFE_PATH",
    "El directorio de respaldo no debe ser un enlace.",
  );
  const ignored = spawnSync(
    "git",
    ["check-ignore", "-q", ".runtime/backups/check.enc"],
    { cwd: ROOT, windowsHide: true },
  );
  ensure(
    ignored.status === 0,
    "NOT_IGNORED",
    "El directorio privado de respaldos no está ignorado por Git.",
  );
  ensure(
    process.platform === "win32",
    "WINDOWS_ACL_REQUIRED",
    "Este ensayo requiere Windows ACL; adapte y verifique permisos antes de usarlo en otro sistema.",
  );
  const result = ps(
    "$ErrorActionPreference='Stop';" +
      "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;" +
      "$existing=Get-Acl -LiteralPath $env:TOLENTINO_BACKUP_DIR;" +
      "$allowed=@($existing.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow'});" +
      "$other=@($allowed|Where-Object {$_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18')});" +
      "$mine=@($allowed|Where-Object {$_.IdentityReference.Value -eq $sid.Value -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl});" +
      "if($existing.AreAccessRulesProtected -and $other.Count -eq 0 -and $mine.Count -gt 0){[Console]::Out.Write('verified');return};" +
      "$acl=New-Object Security.AccessControl.DirectorySecurity;" +
      "$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);" +
      "foreach($id in @($sid.Value,'S-1-5-18')){" +
      "$identity=New-Object Security.Principal.SecurityIdentifier($id);" +
      "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};" +
      "Set-Acl -LiteralPath $env:TOLENTINO_BACKUP_DIR -AclObject $acl;" +
      "$actual=Get-Acl -LiteralPath $env:TOLENTINO_BACKUP_DIR;" +
      "$bad=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18') });" +
      "if(!$actual.AreAccessRulesProtected -or $bad.Count -ne 0){throw 'ACL validation failed'};" +
      "[Console]::Out.Write('verified')",
    "",
    { TOLENTINO_BACKUP_DIR: BACKUP_DIR },
  );
  ensure(
    result === "verified",
    "ACL_FAILED",
    "La ACL del directorio privado no se pudo verificar.",
  );
  return {
    inheritedAccessDisabled: true,
    allowedPrincipals: "current Windows user and SYSTEM",
    ignoredByGit: true,
  };
}
function dpapi(data, decrypt) {
  const output = ps(
    "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;" +
      "$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());" +
      "$entropy=[Text.Encoding]::UTF8.GetBytes('tolentino-app-backup-key-v1');" +
      "$result=[Security.Cryptography.ProtectedData]::" +
      (decrypt ? "Unprotect" : "Protect") +
      "($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
      "[Console]::Out.Write([Convert]::ToBase64String($result))",
    data.toString("base64"),
  );
  return Buffer.from(output, "base64");
}
export function loadBackupKey(create = false) {
  const supplied = process.env.TOLENTINO_BACKUP_KEY_BASE64;
  if (supplied) {
    const key = Buffer.from(supplied, "base64");
    ensure(
      key.length === 32 && key.toString("base64") === supplied,
      "KEY_INVALID",
      "La clave externa debe ser base64 canónico de 32 bytes.",
    );
    return { key, mode: "external-environment" };
  }
  const file = safeLocalPath(resolve(BACKUP_DIR, "backup-key.dpapi"));
  if (!existsSync(file)) {
    ensure(create, "KEY_MISSING", "Falta la clave DPAPI del respaldo.");
    const key = randomBytes(32);
    try {
      writeFileSync(file, dpapi(key, false), { flag: "wx", mode: 0o600 });
    } finally {
      key.fill(0);
    }
  }
  const key = dpapi(readFileSync(file), true);
  ensure(key.length === 32, "KEY_INVALID", "La clave DPAPI no es válida.");
  return { key, mode: "windows-dpapi-current-user" };
}
export function encryptArchive(payload, key, keyMode) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload)), {
    level: 9,
  });
  try {
    const encrypted = Buffer.concat([
      cipher.update(compressed),
      cipher.final(),
    ]);
    return Buffer.from(
      JSON.stringify({
        format: FORMAT,
        cipher: "AES-256-GCM",
        compression: "gzip",
        keyMode,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: encrypted.toString("base64"),
      }),
    );
  } finally {
    compressed.fill(0);
  }
}
export function decryptArchive(bytes, key) {
  try {
    const envelope = JSON.parse(bytes.toString("utf8"));
    ensure(
      envelope.format === FORMAT && envelope.cipher === "AES-256-GCM",
      "FORMAT_INVALID",
      "Formato de respaldo no compatible.",
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const compressed = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    try {
      return JSON.parse(
        gunzipSync(compressed, {
          maxOutputLength: 1024 * 1024 * 1024,
        }).toString("utf8"),
      );
    } finally {
      compressed.fill(0);
    }
  } catch {
    throw new BackupError(
      "ARCHIVE_INVALID",
      "No se pudo autenticar o descifrar el respaldo.",
    );
  }
}
export function guardedFetch(endpoint, delegate = fetch) {
  const origin = new URL(endpoint).origin;
  return async (input, options = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (options.method || request?.method || "GET").toUpperCase();
    const storageList =
      method === "POST" && url.pathname === "/storage/v1/object/list/" + BUCKET;
    ensure(
      url.origin === origin &&
        (method === "GET" || method === "HEAD" || storageList),
      "REMOTE_WRITE_BLOCKED",
      "El respaldo bloqueó una operación remota distinta de lectura.",
    );
    return delegate(input, {
      ...options,
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(60_000),
    });
  };
}
export async function collectPages(
  loadPage,
  { max = LIMITS.rowsPerTable, pageSize = 200 } = {},
) {
  const rows = [];
  let expected;
  while (true) {
    const page = await loadPage(rows.length, pageSize);
    ensure(
      Array.isArray(page.rows),
      "PAGE_INVALID",
      "La respuesta paginada no es válida.",
    );
    if (page.total !== undefined) {
      if (expected === undefined) expected = page.total;
      ensure(
        page.total === expected,
        "SOURCE_CHANGED",
        "El conteo cambió durante la lectura paginada.",
      );
    }
    if (!page.rows.length) {
      ensure(
        expected === undefined || rows.length === expected,
        "INCOMPLETE_PAGE",
        "La lectura paginada terminó antes del total declarado.",
      );
      break;
    }
    rows.push(...page.rows);
    ensure(
      rows.length <= max,
      "BACKUP_LIMIT",
      "El volumen excede el límite explícito del proceso; no se produjo un respaldo truncado.",
    );
    if (expected !== undefined && rows.length === expected) break;
    ensure(
      expected === undefined || rows.length < expected,
      "PAGE_INVALID",
      "La paginación superó el total declarado.",
    );
  }
  return rows;
}
export function writeEvidence(filename, evidence) {
  ensure(
    /^backup-[a-z0-9-]+[.]json$/.test(filename),
    "EVIDENCE_PATH",
    "Nombre de evidencia no permitido.",
  );
  writeFileSync(
    resolve(ROOT, "docs", "evidence", filename),
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
