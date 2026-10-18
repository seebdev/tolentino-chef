import fs from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const PROJECT = "hgntppemxwcxaxritnfq";
const TARGET_URL = "https://" + PROJECT + ".supabase.co";
const EXPECTED_REPO = "https://github.com/seebdev/tolentino-chef";

function failure(code) {
  const error = new Error("Read-only inspection failed");
  error.safeCode = code;
  return error;
}
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}
export function safeText(value) {
  if (typeof value !== "string") return null;
  return value
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email omitted]")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 240);
}
export function safeUrl(value) {
  if (!present(value)) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    // Configuration URLs are public destinations. Userinfo, query strings and
    // fragments can contain credentials or tokens and are never persisted.
    const path = url.pathname.split("/").map((part) =>
      part.length > 64 ? "[segment omitted]" : part,
    ).join("/");
    return safeText(url.origin + path);
  } catch {
    return null;
  }
}
export function validateTarget(value) {
  if (value !== TARGET_URL && value !== TARGET_URL + "/")
    throw failure("TARGET_PROJECT_MISMATCH");
}
export function isAllowedReadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    return false;
  if (url.origin === "https://api.render.com" &&
      ["/v1/owners", "/v1/services"].includes(url.pathname)) {
    return [...url.searchParams.keys()].every((key) =>
      ["limit", "cursor", "includePreviews"].includes(key),
    );
  }
  return !url.search &&
    ((url.origin === TARGET_URL && url.pathname === "/auth/v1/settings") ||
      (url.origin === "https://api.supabase.com" &&
        url.pathname === "/v1/projects/" + PROJECT + "/config/auth"));
}
function publicAuth(settings) {
  return {
    signupDisabled: settings.disable_signup === true,
    anonymousEnabled: settings.external?.anonymous_users === true,
    emailEnabled: settings.external?.email === true,
    emailAutoconfirm: settings.mailer_autoconfirm === true,
    smsAutoconfirm: settings.sms_autoconfirm === true,
  };
}
function configuration(settings) {
  const boolFields = [
    "disable_signup", "external_anonymous_users_enabled", "external_email_enabled",
    "external_phone_enabled", "mailer_autoconfirm", "sms_autoconfirm",
    "mailer_secure_email_change_enabled", "mailer_allow_unverified_email_sign_ins",
    "refresh_token_rotation_enabled", "security_captcha_enabled",
    "security_manual_linking_enabled",
    "security_update_password_require_current_password",
    "security_update_password_require_reauthentication", "password_hibp_enabled",
    "sessions_single_per_user", "mfa_totp_enroll_enabled", "mfa_totp_verify_enabled",
    "hook_send_email_enabled", "hook_before_user_created_enabled",
  ];
  const numberFields = [
    "jwt_exp", "mailer_otp_exp", "mailer_otp_length", "password_min_length",
    "security_refresh_token_reuse_interval", "sessions_inactivity_timeout",
    "sessions_timebox", "rate_limit_email_sent", "rate_limit_token_refresh",
    "rate_limit_verify", "rate_limit_otp", "smtp_max_frequency",
  ];
  const flags = Object.fromEntries(boolFields.map((field) =>
    [field, typeof settings[field] === "boolean" ? settings[field] : null],
  ));
  const policies = Object.fromEntries(numberFields.map((field) =>
    [field, Number.isFinite(settings[field]) ? settings[field] : null],
  ));
  const redirects = typeof settings.uri_allow_list === "string"
    ? settings.uri_allow_list.split(",").map((part) => part.trim()).filter(Boolean)
    : [];
  const templateSummary = (value) => ({
    contentConfigured: present(value),
    tokenHashMentioned: typeof value === "string" && value.includes(".TokenHash"),
    confirmationUrlMentioned: typeof value === "string" && value.includes(".ConfirmationURL"),
    siteUrlMentioned: typeof value === "string" && value.includes(".SiteURL"),
    confirmRouteMentioned: typeof value === "string" && value.includes("/auth/confirm"),
    // These are structural hints only, not a functional email validation.
  });
  return {
    flags, policies,
    passwordCharacterGroupsConfigured: present(settings.password_required_characters),
    siteUrl: safeUrl(settings.site_url),
    redirectUrls: redirects.map(safeUrl),
    redirectCount: redirects.length,
    wildcardRedirectsPresent: redirects.some((value) => /[*?[\]]/.test(value)),
    smtp: {
      hostConfigured: present(settings.smtp_host),
      portConfigured: present(settings.smtp_port) || Number.isFinite(settings.smtp_port),
      userConfigured: present(settings.smtp_user),
      passwordReturned: present(settings.smtp_pass),
      senderAddressConfigured: present(settings.smtp_admin_email),
      senderNameConfigured: present(settings.smtp_sender_name),
      deliveryTested: false,
    },
    templates: {
      recovery: templateSummary(settings.mailer_templates_recovery_content),
      invitation: templateSummary(settings.mailer_templates_invite_content),
    },
  };
}
export async function inspect(env, fetcher = fetch) {
  const report = {
    checkedAt: new Date().toISOString(),
    projectRef: PROJECT,
    expectedRepository: EXPECTED_REPO,
    externalMutations: false,
    emailsSent: false,
    deploymentsStarted: false,
    requests: [],
    blockers: [],
  };
  validateTarget(env.TARGET_SUPABASE_URL);
  async function getJson(tag, value, headers) {
    const url = new URL(value);
    if (!isAllowedReadUrl(url)) throw failure("READ_ENDPOINT_REJECTED");
    let response;
    try {
      response = await fetcher(url, {
        method: "GET", headers, redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      report.requests.push({ endpoint: tag, method: "GET", status: null });
      throw failure("NETWORK_ERROR");
    }
    report.requests.push({ endpoint: tag, method: "GET", status: response.status });
    if (!response.ok) throw failure("HTTP_" + response.status);
    try { return await response.json(); }
    catch { throw failure("INVALID_JSON"); }
  }
  async function listRender(resource, key) {
    const rows = [];
    const seenCursors = new Set();
    const seenIds = new Set();
    let cursor = "";
    for (let page = 0; page < 100; page++) {
      const url = new URL("https://api.render.com/v1/" + resource);
      url.searchParams.set("limit", "100");
      if (resource === "services") url.searchParams.set("includePreviews", "true");
      if (cursor) url.searchParams.set("cursor", cursor);
      const batch = await getJson("render_" + resource, url, {
        Authorization: "Bearer " + env.TARGET_RENDER_API_KEY,
        Accept: "application/json",
      });
      if (!Array.isArray(batch) || batch.some((entry) =>
        !entry?.[key] || typeof entry[key].id !== "string"))
        throw failure("INVALID_INVENTORY_SHAPE");
      if (!batch.length) return { rows, pages: page + 1 };
      for (const entry of batch) {
        if (seenIds.has(entry[key].id)) throw failure("DUPLICATE_RESOURCE");
        seenIds.add(entry[key].id);
        rows.push(entry[key]);
      }
      // Request the following page even after a short page, until an explicit
      // empty result proves exhaustion. Never silently accept a repeated cursor.
      cursor = batch.at(-1)?.cursor;
      if (!present(cursor) || seenCursors.has(cursor))
        throw failure("INCOMPLETE_INVENTORY");
      seenCursors.add(cursor);
    }
    throw failure("INVENTORY_PAGE_LIMIT");
  }
  const capture = async (key, work) => {
    try { report[key] = await work(); }
    catch (error) {
      report[key] = {
        status: "unverified",
        reason: typeof error?.safeCode === "string" &&
          /^(HTTP_\d{3}|NETWORK_ERROR|INVALID_JSON|INVALID_INVENTORY_SHAPE|DUPLICATE_RESOURCE|INCOMPLETE_INVENTORY|INVENTORY_PAGE_LIMIT|CREDENTIAL_MISSING)$/.test(error.safeCode)
          ? error.safeCode : "INSPECTION_FAILED",
      };
      report.blockers.push(key.toUpperCase() + "_UNVERIFIED");
    }
  };
  await Promise.all([
    capture("render", async () => {
      if (!present(env.TARGET_RENDER_API_KEY)) throw failure("CREDENTIAL_MISSING");
      const [owners, services] = await Promise.all([
        listRender("owners", "owner"), listRender("services", "service"),
      ]);
      const ownerIds = new Set(owners.rows.map((owner) => owner.id));
      const sanitizedOwners = owners.rows.map((owner) => ({
        id: safeText(owner.id), name: safeText(owner.name), type: safeText(owner.type),
        serviceCount: services.rows.filter((service) => service.ownerId === owner.id).length,
      }));
      return {
        status: "read_only_inventory_complete",
        ownersPages: owners.pages, servicesPages: services.pages,
        workspaceSelectionRequired: owners.rows.length > 1,
        accountVerified: false,
        ownerSelectionConfirmedByUser: false,
        owners: sanitizedOwners,
        services: services.rows.map((service) => ({
          id: safeText(service.id), ownerId: safeText(service.ownerId),
          ownerInInventory: ownerIds.has(service.ownerId),
          name: safeText(service.name), type: safeText(service.type),
          repository: safeUrl(service.repo), branch: safeText(service.branch),
          plan: safeText(service.serviceDetails?.plan),
          region: safeText(service.serviceDetails?.region),
          url: safeUrl(service.serviceDetails?.url),
          suspended: safeText(service.suspended),
          expectedRepository: safeUrl(service.repo)?.replace(/\.git$/, "") === EXPECTED_REPO,
        })),
      };
    }),
    capture("publicAuth", async () => {
      if (!present(env.TARGET_SUPABASE_PUBLISHABLE_KEY)) throw failure("CREDENTIAL_MISSING");
      const settings = await getJson("supabase_public_auth_settings",
        TARGET_URL + "/auth/v1/settings",
        { apikey: env.TARGET_SUPABASE_PUBLISHABLE_KEY, Accept: "application/json" });
      return { status: "verified", ...publicAuth(settings) };
    }),
    capture("managementAuth", async () => {
      if (!present(env.SUPABASE_ACCESS_TOKEN)) throw failure("CREDENTIAL_MISSING");
      const settings = await getJson("supabase_management_auth_config",
        "https://api.supabase.com/v1/projects/" + PROJECT + "/config/auth",
        { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, Accept: "application/json" });
      return { status: "verified", ...configuration(settings) };
    }),
  ]);
  if (report.publicAuth.signupDisabled === false) report.blockers.push("PUBLIC_SIGNUP_ENABLED");
  if (report.publicAuth.anonymousEnabled === true) report.blockers.push("ANONYMOUS_AUTH_ENABLED");
  if (report.render.workspaceSelectionRequired) report.blockers.push("WORKSPACE_SELECTION_REQUIRED");
  report.readyToDeploy = false;
  return report;
}

async function selfTest() {
  assert.throws(() => validateTarget("https://ylcnrfzosjzuljufwups.supabase.co"));
  validateTarget(TARGET_URL);
  assert.equal(isAllowedReadUrl("https://api.render.com/v1/services"), true);
  assert.equal(isAllowedReadUrl("https://api.render.com/v1/services/srv-x/deploys"), false);
  assert.equal(isAllowedReadUrl("https://api.render.com.evil.invalid/v1/services"), false);
  assert.equal(isAllowedReadUrl("https://api.supabase.com/v1/projects/ylcnrfzosjzuljufwups/config/auth"), false);
  assert.equal(safeUrl("https://user:password@example.com/path?token=secret#private"), "https://example.com/path");
  assert.equal(safeText("Workspace user@example.com"), "Workspace [email omitted]");
  const env = { TARGET_SUPABASE_URL: TARGET_URL, TARGET_RENDER_API_KEY: "private-render",
    TARGET_SUPABASE_PUBLISHABLE_KEY: "public-key", SUPABASE_ACCESS_TOKEN: "private-pat" };
  const fakeFetch = async (value, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    const url = new URL(value);
    let body;
    if (url.pathname.endsWith("/owners")) body = url.searchParams.has("cursor") ? [] :
      [{ owner: { id: "tea-example", name: "Example", email: "private@example.com", type: "team" }, cursor: "cursor-private" }];
    else if (url.pathname.endsWith("/services")) body = [];
    else if (url.pathname.endsWith("/settings")) body = { disable_signup: true, external: { email: true } };
    else body = { smtp_pass: "private-password", smtp_user: "private@example.com",
      smtp_admin_email: "sender@example.com", site_url: "http://localhost:3000",
      uri_allow_list: "https://example.com/auth/confirm?token=secret",
      mailer_templates_recovery_content: "secret-template" };
    return { ok: true, status: 200, json: async () => body };
  };
  const result = await inspect(env, fakeFetch);
  assert.equal(result.render.ownersPages, 2);
  assert.equal(result.render.services.length, 0);
  const output = JSON.stringify(result);
  for (const secret of ["private-render", "private-pat", "private-password",
    "private@example.com", "sender@example.com", "secret-template", "token=secret", "cursor-private"])
    assert.equal(output.includes(secret), false);
  console.log(JSON.stringify({ result: "PASS", scope: "target guards, GET-only, pagination and sanitized output", remoteRequests: 0 }));
}
async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  // No process.env or .env.local fallback: only the new migration credential file.
  const env = parseEnv(fs.readFileSync(".env.migration.local", "utf8"));
  const report = await inspect(env);
  const runId = new Date().toISOString().replace(/[:.]/g, "");
  const directory = "docs/evidence/migrations/" + PROJECT + "/" + runId;
  fs.mkdirSync(directory, { recursive: true });
  const evidence = directory + "/render-auth-inspection.json";
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ evidence, ...report }, null, 2));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    console.error(JSON.stringify({ status: "inspection_aborted", reason: "LOCAL_OR_TARGET_VALIDATION_FAILED" }));
    process.exitCode = 1;
  });
}
