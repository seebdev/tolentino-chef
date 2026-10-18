import fs from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import {
  ROOT, BACKUP_DIR, protectBackupDirectory, loadBackupKey,
  encryptArchive, decryptArchive, safeLocalPath, sha256, digest,
} from "./backup-common.mjs";

const PROJECT = "hgntppemxwcxaxritnfq";
const TARGET = "https://" + PROJECT + ".supabase.co";
const MANAGEMENT = "https://api.supabase.com/v1/projects/" + PROJECT + "/config/auth";
const PUBLIC_SETTINGS = TARGET + "/auth/v1/settings";
// This is the entire authorized change. Do not add fields without new review.
const PATCH = Object.freeze({ disable_signup: true });
const BACKUP_FIELDS = [
  "disable_signup", "external_anonymous_users_enabled", "external_email_enabled",
  "external_phone_enabled", "mailer_autoconfirm", "sms_autoconfirm",
  "mailer_secure_email_change_enabled", "mailer_allow_unverified_email_sign_ins",
  "refresh_token_rotation_enabled", "security_captcha_enabled",
  "security_manual_linking_enabled",
  "security_update_password_require_current_password",
  "security_update_password_require_reauthentication", "password_hibp_enabled",
  "sessions_single_per_user", "mfa_totp_enroll_enabled", "mfa_totp_verify_enabled",
  "hook_send_email_enabled", "hook_before_user_created_enabled",
  "jwt_exp", "mailer_otp_exp", "mailer_otp_length", "password_min_length",
  "password_required_characters", "security_refresh_token_reuse_interval",
  "sessions_inactivity_timeout", "sessions_timebox", "rate_limit_email_sent",
  "rate_limit_token_refresh", "rate_limit_verify", "rate_limit_otp",
  "smtp_max_frequency", "site_url", "uri_allow_list", "smtp_host", "smtp_port",
  "smtp_user", "smtp_admin_email", "smtp_sender_name",
  "mailer_templates_recovery_content", "mailer_templates_invite_content",
];
const SAFE_CODES = new Set([
  "TARGET_PROJECT_MISMATCH", "CREDENTIAL_MISSING", "ENDPOINT_REJECTED",
  "PATCH_REJECTED", "NETWORK_ERROR", "HTTP_ERROR", "INVALID_RESPONSE",
  "BACKUP_FAILED", "CONFIG_CHANGED_BEFORE_PATCH", "MANAGEMENT_VERIFY_FAILED",
  "PUBLIC_VERIFY_FAILED", "OTHER_CONFIG_CHANGED", "PATCH_OUTCOME_UNCERTAIN",
]);
function fail(code) {
  const error = new Error("Auth configuration operation failed");
  error.safeCode = code;
  throw error;
}
function validEnvironment(env) {
  if (env.TARGET_SUPABASE_URL !== TARGET &&
      env.TARGET_SUPABASE_URL !== TARGET + "/") fail("TARGET_PROJECT_MISMATCH");
  if (!env.SUPABASE_ACCESS_TOKEN?.trim() ||
      !env.TARGET_SUPABASE_PUBLISHABLE_KEY?.trim()) fail("CREDENTIAL_MISSING");
}
function unchangedPart(settings) {
  return Object.fromEntries(Object.entries(settings)
    .filter(([name]) => name !== "disable_signup"));
}
function selectedBackup(settings) {
  return Object.fromEntries(BACKUP_FIELDS
    .filter((name) => Object.hasOwn(settings, name))
    .map((name) => [name, settings[name]]));
}
function writeDurable(file, bytes) {
  const handle = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
}
function saveEncryptedBackup(settings) {
  const protection = protectBackupDirectory();
  const loaded = loadBackupKey(true);
  try {
    const capturedAt = new Date().toISOString();
    const payload = {
      purpose: "target-auth-config-before-disable-signup",
      projectRef: PROJECT, capturedAt,
      changedFieldsAuthorized: ["disable_signup"],
      settings: selectedBackup(settings),
      excludedSecrets: ["SMTP password", "provider secrets", "API credentials"],
    };
    const bytes = encryptArchive(payload, loaded.key, loaded.mode);
    const filename = "migration-auth-" + PROJECT + "-" +
      capturedAt.replace(/[:.]/g, "") + ".enc";
    const file = safeLocalPath(resolve(BACKUP_DIR, filename));
    writeDurable(file, bytes);
    const saved = fs.readFileSync(file);
    const recovered = decryptArchive(saved, loaded.key);
    if (digest(recovered) !== digest(payload)) fail("BACKUP_FAILED");
    return {
      path: ".runtime/backups/" + filename,
      sha256: sha256(saved), cipher: "AES-256-GCM", keyMode: loaded.mode,
      verifiedRoundTrip: true, protectedDirectory: protection,
      fieldCount: Object.keys(payload.settings).length,
    };
  } finally { loaded.key.fill(0); }
}
export async function configure(env, {
  fetcher = fetch,
  saveBefore = saveEncryptedBackup,
} = {}) {
  const report = {
    checkedAt: new Date().toISOString(), projectRef: PROJECT,
    authorizedPatch: PATCH, result: "FAIL", stage: "target_validation",
    patchAttempted: false, patchAccepted: false,
    emailsSent: false, renderOperations: 0, requests: [],
  };
  async function request(label, url, method = "GET") {
    const management = url === MANAGEMENT;
    if ((!management && url !== PUBLIC_SETTINGS) ||
        (method !== "GET" && method !== "PATCH") ||
        (method === "PATCH" && !management)) fail("ENDPOINT_REJECTED");
    const body = method === "PATCH" ? JSON.stringify(PATCH) : undefined;
    if (method === "PATCH" && body !== '{"disable_signup":true}') fail("PATCH_REJECTED");
    let response;
    try {
      response = await fetcher(url, {
        method, redirect: "error", signal: AbortSignal.timeout(20000),
        headers: management
          ? { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN,
              Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }
          : { apikey: env.TARGET_SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" },
        ...(body ? { body } : {}),
      });
    } catch {
      report.requests.push({ endpoint: label, method, status: null });
      fail("NETWORK_ERROR");
    }
    report.requests.push({ endpoint: label, method, status: response.status });
    if (!response.ok) fail("HTTP_ERROR");
    let json;
    try { json = await response.json(); } catch { fail("INVALID_RESPONSE"); }
    if (!json || typeof json !== "object" || Array.isArray(json) ||
        typeof json.disable_signup !== "boolean") fail("INVALID_RESPONSE");
    return json;
  }
  try {
    validEnvironment(env);
    report.stage = "read_before";
    const before = await request("management_auth_before", MANAGEMENT);
    report.before = {
      signupDisabled: before.disable_signup,
      emailEnabled: before.external_email_enabled === true,
      anonymousEnabled: before.external_anonymous_users_enabled === true,
    };
    report.stage = "encrypted_backup";
    try { report.backup = await saveBefore(before); }
    catch { fail("BACKUP_FAILED"); }
    if (!report.backup?.verifiedRoundTrip) fail("BACKUP_FAILED");
    // Detect configuration edits during the backup before issuing any PATCH.
    report.stage = "freshness_check";
    const current = await request("management_auth_freshness", MANAGEMENT);
    if (digest(before) !== digest(current)) fail("CONFIG_CHANGED_BEFORE_PATCH");
    if (!before.disable_signup) {
      report.stage = "disable_signup";
      report.patchAttempted = true;
      try {
        await request("management_auth_patch", MANAGEMENT, "PATCH");
        report.patchAccepted = true;
      } catch {
        // No mutation retries or rollback. Read back after an ambiguous result.
        report.patchResultUncertain = true;
      }
    }
    report.stage = "verify_after";
    const [after, publicSettings] = await Promise.all([
      request("management_auth_after", MANAGEMENT),
      request("public_auth_after", PUBLIC_SETTINGS),
    ]);
    report.after = {
      signupDisabled: after.disable_signup,
      publicSignupDisabled: publicSettings.disable_signup,
      emailEnabled: after.external_email_enabled === true,
      anonymousEnabled: after.external_anonymous_users_enabled === true,
    };
    report.otherConfigUnchanged = digest(unchangedPart(before)) === digest(unchangedPart(after));
    if (!report.otherConfigUnchanged) fail("OTHER_CONFIG_CHANGED");
    if (!after.disable_signup) fail("MANAGEMENT_VERIFY_FAILED");
    if (!publicSettings.disable_signup) fail("PUBLIC_VERIFY_FAILED");
    if (report.patchResultUncertain) fail("PATCH_OUTCOME_UNCERTAIN");
    report.result = "PASS";
    report.stage = "complete";
    report.changedFields = before.disable_signup ? [] : ["disable_signup"];
    return report;
  } catch (error) {
    report.code = SAFE_CODES.has(error?.safeCode) ? error.safeCode : "OPERATION_FAILED";
    return report;
  }
}

async function selfTest() {
  let checks = 0;
  const env = {
    TARGET_SUPABASE_URL: TARGET,
    SUPABASE_ACCESS_TOKEN: "private-pat",
    TARGET_SUPABASE_PUBLISHABLE_KEY: "public-key",
  };
  function scenario(options = {}) {
    let settings = {
      disable_signup: Boolean(options.disabled),
      external_email_enabled: true, external_anonymous_users_enabled: false,
      smtp_pass: "private-smtp-password", password_min_length: 6,
    };
    const operations = [];
    let managementReads = 0;
    const fetcher = async (url, init) => {
      assert.equal(init.redirect, "error");
      operations.push(init.method);
      if (init.method === "PATCH") {
        assert.deepEqual(JSON.parse(init.body), { disable_signup: true });
        assert.equal(operations.includes("BACKUP"), true);
        settings = { ...settings, disable_signup: true };
        if (options.driftAfterPatch) settings.password_min_length = 9;
      } else if (url === MANAGEMENT) {
        managementReads++;
        if (options.driftBeforePatch && managementReads === 2)
          settings.password_min_length = 9;
      }
      return { status: 200, ok: true, json: async () => structuredClone(settings) };
    };
    const saveBefore = async () => {
      if (options.backupFails) throw new Error("sensitive error");
      operations.push("BACKUP");
      return { verifiedRoundTrip: true };
    };
    return { fetcher, saveBefore, operations };
  }
  const positive = scenario();
  let result = await configure(env, positive);
  assert.equal(result.result, "PASS");
  assert.deepEqual(result.changedFields, ["disable_signup"]);
  assert.equal(positive.operations.filter((op) => op === "PATCH").length, 1);
  assert.equal(JSON.stringify(result).includes("private-"), false);
  checks++;
  const already = scenario({ disabled: true });
  result = await configure(env, already);
  assert.equal(result.result, "PASS");
  assert.equal(already.operations.includes("PATCH"), false);
  checks++;
  const missingBackup = scenario({ backupFails: true });
  result = await configure(env, missingBackup);
  assert.equal(result.code, "BACKUP_FAILED");
  assert.equal(missingBackup.operations.includes("PATCH"), false);
  checks++;
  const wrong = scenario();
  result = await configure({ ...env, TARGET_SUPABASE_URL: "https://ylcnrfzosjzuljufwups.supabase.co" }, wrong);
  assert.equal(result.code, "TARGET_PROJECT_MISMATCH");
  assert.equal(wrong.operations.length, 0);
  checks++;
  const drift = scenario({ driftBeforePatch: true });
  result = await configure(env, drift);
  assert.equal(result.code, "CONFIG_CHANGED_BEFORE_PATCH");
  assert.equal(drift.operations.includes("PATCH"), false);
  checks++;
  const afterDrift = scenario({ driftAfterPatch: true });
  result = await configure(env, afterDrift);
  assert.equal(result.code, "OTHER_CONFIG_CHANGED");
  assert.equal(afterDrift.operations.filter((op) => op === "PATCH").length, 1);
  checks++;
  console.log(JSON.stringify({ result: "PASS", checks, remoteRequests: 0,
    scope: "exact target, backup ordering, idempotence, fixed patch, drift and redaction" }));
}
async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const env = parseEnv(fs.readFileSync(resolve(ROOT, ".env.migration.local"), "utf8"));
  const report = await configure(env);
  const runId = new Date().toISOString().replace(/[:.]/g, "");
  const relative = "docs/evidence/migrations/" + PROJECT + "/" + runId;
  fs.mkdirSync(resolve(ROOT, relative), { recursive: true });
  const evidence = relative + "/auth-signup-config.json";
  fs.writeFileSync(resolve(ROOT, evidence), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ evidence, ...report }, null, 2));
  if (report.result !== "PASS") process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    console.error(JSON.stringify({ result: "FAIL", code: "LOCAL_OPERATION_FAILED" }));
    process.exitCode = 1;
  });
}
