import fs from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT, BACKUP_DIR, protectBackupDirectory, loadBackupKey, encryptArchive,
  decryptArchive, safeLocalPath, sha256, digest,
} from "./backup-common.mjs";

export const PROJECT = "hgntppemxwcxaxritnfq";
const TARGET = "https://" + PROJECT + ".supabase.co";
const MANAGEMENT = "https://api.supabase.com/v1/projects/" + PROJECT + "/config/auth";
const PUBLIC_SETTINGS = TARGET + "/auth/v1/settings";
const FIELDS = ["site_url", "uri_allow_list"];
const fail = (code) => { const error = Error("Auth URL operation failed"); error.safeCode = code; throw error; };
const validCodes = new Set([
  "TARGET_INVALID", "CREDENTIAL_MISSING", "SITE_URL_INVALID", "ENDPOINT_BLOCKED",
  "NETWORK_ERROR", "HTTP_ERROR", "RESPONSE_INVALID", "UNSAFE_AUTH_BASELINE",
  "BACKUP_FAILED", "CONFIG_CHANGED", "READBACK_MISMATCH", "OTHER_CONFIG_CHANGED", "PUBLIC_CONFIG_CHANGED",
]);
export function urlPatch(origin) {
  let url;
  try { url = new URL(origin); } catch { fail("SITE_URL_INVALID"); }
  if (url.protocol !== "https:" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.]onrender[.]com$/.test(url.hostname) ||
    url.username || url.password || url.port || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    (origin !== url.origin && origin !== url.origin + "/")) fail("SITE_URL_INVALID");
  return { site_url: url.origin, uri_allow_list: url.origin + "/auth/callback" };
}
function validEnvironment(env) {
  if (![TARGET, TARGET + "/"].includes(env.TARGET_SUPABASE_URL)) fail("TARGET_INVALID");
  if (!env.SUPABASE_ACCESS_TOKEN?.trim() || !env.TARGET_SUPABASE_PUBLISHABLE_KEY?.trim()) fail("CREDENTIAL_MISSING");
}
const unchanged = (settings) => Object.fromEntries(Object.entries(settings).filter(([name]) => !FIELDS.includes(name)));
export function recoveryReview(settings) {
  const template = settings.mailer_templates_recovery_content;
  const text = typeof template === "string" ? template.trim() : "";
  return {
    templateContentReturned: text.length > 0,
    templateSource: text ? "management configuration content; customization history unknown" : "platform default not materialized",
    templateSha256: sha256(text),
    usesConfirmationUrl: /\{\{\s*[.]ConfirmationURL\s*\}\}/.test(text),
    usesTokenHash: /\{\{\s*[.]TokenHash\s*\}\}/.test(text),
    usesSiteUrl: /\{\{\s*[.]SiteURL\s*\}\}/.test(text),
    referencesServerConfirm: /\/auth\/confirm[?]/.test(text) && /type=recovery/.test(text),
    smtpHostConfigured: Boolean(settings.smtp_host),
    smtpUserConfigured: Boolean(settings.smtp_user),
    smtpSenderConfigured: Boolean(settings.smtp_admin_email),
    customSmtpConfigured: Boolean(settings.smtp_host && settings.smtp_user && settings.smtp_admin_email),
    recoveryDeliveryTested: false,
    templateModified: false,
  };
}
function saveEncryptedBefore(settings, patch) {
  const protection = protectBackupDirectory(), loaded = loadBackupKey(false);
  try {
    const at = new Date().toISOString();
    const payload = {
      purpose: "new-target-auth-url-config-before-change", projectRef: PROJECT, at,
      authorizedPatch: patch, originalFields: { site_url: settings.site_url, uri_allow_list: settings.uri_allow_list },
      completeConfigSha256: digest(settings),
      preservedSecurity: {
        disable_signup: settings.disable_signup, external_email_enabled: settings.external_email_enabled,
        external_anonymous_users_enabled: settings.external_anonymous_users_enabled,
      },
      recoveryTemplate: settings.mailer_templates_recovery_content ?? null,
      recoveryReview: recoveryReview(settings),
      excludedSecrets: ["PAT", "API keys", "SMTP credentials", "provider secrets"],
    };
    const encrypted = encryptArchive(payload, loaded.key, loaded.mode);
    const name = "auth-urls-" + PROJECT + "-" + at.replace(/[^0-9TZ]/g, "") + ".json.enc";
    const path = safeLocalPath(resolve(BACKUP_DIR, name));
    const handle = fs.openSync(path, "wx", 0o600);
    try { fs.writeFileSync(handle, encrypted); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    const disk = fs.readFileSync(path);
    if (sha256(disk) !== sha256(encrypted) || digest(decryptArchive(disk, loaded.key)) !== digest(payload)) fail("BACKUP_FAILED");
    return { path: ".runtime/backups/" + name, sha256: sha256(disk), verifiedRoundTrip: true,
      cipher: "AES-256-GCM", keyMode: loaded.mode, protectedDirectory: protection };
  } finally { loaded.key.fill(0); }
}
export async function configureAuthUrls(env, origin, {
  apply = false, fetcher = fetch, saveBefore = saveEncryptedBefore,
} = {}) {
  const report = {
    at: new Date().toISOString(), projectRef: PROJECT, mode: apply ? "apply" : "inspect",
    result: "FAIL", stage: "validate", patchAttempted: false, patchAcknowledged: false,
    remoteDataMutations: 0, emailsSent: 0, requests: [],
  };
  async function request(label, url, method = "GET", patch) {
    if (![MANAGEMENT, PUBLIC_SETTINGS].includes(url) || !["GET", "PATCH"].includes(method) ||
      (method === "PATCH" && (!apply || url !== MANAGEMENT ||
        digest(patch) !== digest(report.plannedPatch) || Object.keys(patch).sort().join() !== [...FIELDS].sort().join())))
      fail("ENDPOINT_BLOCKED");
    const body = method === "PATCH" ? JSON.stringify(patch) : undefined;
    let response;
    try {
      response = await fetcher(url, {
        method, redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: url === MANAGEMENT
          ? { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, Accept: "application/json",
              ...(body ? { "Content-Type": "application/json" } : {}) }
          : { apikey: env.TARGET_SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" },
        ...(body ? { body } : {}),
      });
    } catch {
      report.requests.push({ endpoint: label, method, status: null });
      fail("NETWORK_ERROR");
    }
    report.requests.push({ endpoint: label, method, status: response.status });
    if (!response.ok) fail("HTTP_ERROR");
    let data;
    try { data = await response.json(); } catch { fail("RESPONSE_INVALID"); }
    if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.disable_signup !== "boolean")
      fail("RESPONSE_INVALID");
    return data;
  }
  const secureManagement = (s) => s.disable_signup === true && s.external_email_enabled === true &&
    s.external_anonymous_users_enabled === false;
  const securePublic = (s) => s.disable_signup === true && s.external?.email === true &&
    s.external?.anonymous_users === false;
  try {
    validEnvironment(env);
    if (apply || origin) report.plannedPatch = urlPatch(origin);
    report.stage = "read-before";
    const before = await request("management-before", MANAGEMENT);
    const publicBefore = await request("public-before", PUBLIC_SETTINGS);
    if (!secureManagement(before) || !securePublic(publicBefore) ||
      typeof before.site_url !== "string" || typeof before.uri_allow_list !== "string") fail("UNSAFE_AUTH_BASELINE");
    report.before = { signupDisabled: true, emailEnabled: true, anonymousEnabled: false,
      siteUrlIsLocal: /^http:\/\/(?:localhost|127[.]0[.]0[.]1)(?::\d+)?\/?$/.test(before.site_url),
      redirectEntryCount: before.uri_allow_list.split(",").filter((entry) => entry.trim()).length };
    report.recovery = recoveryReview(before);
    if (!apply) {
      report.result = "PASS"; report.stage = "inspection-complete";
      return report;
    }
    report.stage = "encrypted-backup";
    try { report.backup = await saveBefore(before, report.plannedPatch); } catch { fail("BACKUP_FAILED"); }
    if (report.backup?.verifiedRoundTrip !== true) fail("BACKUP_FAILED");
    report.stage = "freshness-check";
    const current = await request("management-freshness", MANAGEMENT);
    if (digest(before) !== digest(current)) fail("CONFIG_CHANGED");
    report.changedFields = FIELDS.filter((name) => before[name] !== report.plannedPatch[name]);
    if (report.changedFields.length) {
      report.stage = "url-patch"; report.patchAttempted = true;
      try {
        await request("management-patch", MANAGEMENT, "PATCH", report.plannedPatch);
        report.patchAcknowledged = true;
      } catch {
        // A lost response may follow a successful commit. Never retry a PATCH automatically.
        report.patchOutcomeInitiallyUncertain = true;
      }
    }
    report.stage = "readback";
    const after = await request("management-after", MANAGEMENT);
    const publicAfter = await request("public-after", PUBLIC_SETTINGS);
    report.otherConfigUnchanged = digest(unchanged(before)) === digest(unchanged(after));
    if (!report.otherConfigUnchanged) fail("OTHER_CONFIG_CHANGED");
    if (!secureManagement(after) || FIELDS.some((name) => after[name] !== report.plannedPatch[name])) fail("READBACK_MISMATCH");
    if (!securePublic(publicAfter) || digest(publicBefore) !== digest(publicAfter)) fail("PUBLIC_CONFIG_CHANGED");
    report.after = { siteUrl: after.site_url, redirectAllowList: after.uri_allow_list,
      signupDisabled: true, emailEnabled: true, anonymousEnabled: false };
    report.patchVerifiedByReadback = true;
    report.result = "PASS"; report.stage = "complete";
  } catch (error) {
    report.code = validCodes.has(error?.safeCode) ? error.safeCode : "OPERATION_FAILED";
  }
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  const inspect = args.includes("--inspect"), apply = args.includes("--apply");
  const hasTarget = args[args.indexOf("--confirm-target") + 1] === PROJECT;
  const known = new Set(["--inspect", "--apply", "--site-url", "--confirm-target"]);
  for (let i = 0; i < args.length; i++) {
    if (!known.has(args[i])) throw Error("USAGE");
    if (args[i] === "--site-url" || args[i] === "--confirm-target") i++;
  }
  if (inspect === apply || !hasTarget) throw Error("USAGE");
  const origin = args.includes("--site-url") ? args[args.indexOf("--site-url") + 1] : undefined;
  const env = parseEnv(fs.readFileSync(resolve(ROOT, ".env.migration.local"), "utf8").replace(/^\uFEFF/, ""));
  const report = await configureAuthUrls(env, origin, { apply });
  const runId = new Date().toISOString().replace(/[^0-9TZ]/g, "");
  const folder = resolve(ROOT, "docs", "evidence", "migrations", PROJECT, runId);
  fs.mkdirSync(folder, { recursive: true });
  const filename = apply ? "auth-production-urls.json" : "auth-recovery-inspection.json";
  fs.writeFileSync(resolve(folder, filename), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, code: report.code, stage: report.stage,
    patchAttempted: report.patchAttempted, patchAcknowledged: report.patchAcknowledged,
    evidence: "docs/evidence/migrations/" + PROJECT + "/" + runId + "/" + filename }));
  if (report.result !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error(JSON.stringify({ result: "FAIL", code: "LOCAL_OPERATION_FAILED" })); process.exitCode = 1; });
