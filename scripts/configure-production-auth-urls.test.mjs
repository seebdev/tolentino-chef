import test from "node:test";
import assert from "node:assert/strict";
import { PROJECT, configureAuthUrls, urlPatch, recoveryReview } from "./configure-production-auth-urls.mjs";

const env = { TARGET_SUPABASE_URL: "https://" + PROJECT + ".supabase.co",
  TARGET_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_ACCESS_TOKEN: "synthetic-secret-pat" };
const origin = "https://tolentino-test.onrender.com";
function scenario(options = {}) {
  const operations = [];
  const baseline = { disable_signup: !options.signupOpen, external_email_enabled: true,
    external_anonymous_users_enabled: false, site_url: "http://localhost:3000", uri_allow_list: "",
    smtp_host: "", smtp_user: "", smtp_admin_email: "", smtp_pass: "synthetic-private-smtp",
    mailer_templates_recovery_content: "", password_min_length: 8 };
  let config = { ...baseline, ...(options.already ? urlPatch(origin) : {}) };
  let reads = 0, publicReads = 0;
  const fetcher = async (url, init) => {
    assert.equal(init.redirect, "error");
    assert.ok(url === "https://api.supabase.com/v1/projects/" + PROJECT + "/config/auth" ||
      url === env.TARGET_SUPABASE_URL + "/auth/v1/settings");
    operations.push(init.method);
    if (url.includes("/auth/v1/settings")) {
      publicReads++;
      return { ok: true, status: 200, json: async () => ({ disable_signup: true,
        external: { email: true, anonymous_users: false },
        ...(options.publicDrift && publicReads > 1 ? { unexpected_change: true } : {}) }) };
    }
    if (init.method === "PATCH") {
      assert.deepEqual(JSON.parse(init.body), urlPatch(origin));
      assert.ok(operations.includes("BACKUP"));
      if (!options.patchNotCommitted) config = { ...config, ...JSON.parse(init.body) };
      if (options.afterDrift) config.password_min_length = 12;
      if (options.lostResponse || options.patchNotCommitted) throw Error("synthetic-private-transport-error");
    } else {
      reads++;
      if (options.beforeDrift && reads === 2) config.password_min_length = 12;
    }
    return { ok: true, status: 200, json: async () => structuredClone(config) };
  };
  const saveBefore = async (settings, patch) => {
    if (options.backupFails) throw Error("synthetic-private-file-error");
    operations.push("BACKUP");
    assert.equal(settings.site_url, options.already ? origin : baseline.site_url);
    assert.deepEqual(patch, urlPatch(origin));
    return { verifiedRoundTrip: !options.backupUnverified };
  };
  return { fetcher, saveBefore, operations };
}
test("applies only exact two URLs after verified backup; preserves security, SMTP, template and redacts", async () => {
  const state = scenario(), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.result, "PASS");
  assert.deepEqual(report.changedFields, ["site_url", "uri_allow_list"]);
  assert.equal(report.otherConfigUnchanged, true);
  assert.equal(state.operations.filter((op) => op === "PATCH").length, 1);
  assert.ok(!JSON.stringify(report).includes("synthetic-private"));
  assert.ok(!JSON.stringify(report).includes("synthetic-secret"));
});
test("inspect does not back up or mutate", async () => {
  const state = scenario(), report = await configureAuthUrls(env, undefined, state);
  assert.equal(report.result, "PASS");
  assert.deepEqual(state.operations, ["GET", "GET"]);
  assert.equal(report.patchAttempted, false);
});
test("same URL settings are idempotent with no PATCH", async () => {
  const state = scenario({ already: true }), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.result, "PASS");
  assert.deepEqual(report.changedFields, []);
  assert.ok(!state.operations.includes("PATCH"));
});
test("old target rejected before network", async () => {
  const state = scenario(), report = await configureAuthUrls({ ...env,
    TARGET_SUPABASE_URL: "https://ylcnrfzosjzuljufwups.supabase.co" }, origin, { apply: true, ...state });
  assert.equal(report.code, "TARGET_INVALID");
  assert.equal(state.operations.length, 0);
});
test("URL guard rejects HTTP, localhost, wildcard, path, credentials, query and lookalike host", () => {
  for (const bad of ["http://tolentino-test.onrender.com", "https://localhost", "https://*.onrender.com",
    origin + "/auth/callback", "https://user@tolentino-test.onrender.com", origin + "?x=1",
    origin + ".attacker.test", origin + ":8443", origin + "/#fragment"])
    assert.throws(() => urlPatch(bad));
  assert.deepEqual(urlPatch(origin + "/"), urlPatch(origin));
});
test("open public signup aborts without attempting to fix unrelated configuration", async () => {
  const state = scenario({ signupOpen: true }), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.code, "UNSAFE_AUTH_BASELINE");
  assert.ok(!state.operations.includes("PATCH"));
});
test("backup failure or missing roundtrip verification prevents PATCH", async () => {
  for (const option of [{ backupFails: true }, { backupUnverified: true }]) {
    const state = scenario(option), report = await configureAuthUrls(env, origin, { apply: true, ...state });
    assert.equal(report.code, "BACKUP_FAILED");
    assert.ok(!state.operations.includes("PATCH"));
  }
});
test("configuration drift during backup prevents PATCH", async () => {
  const state = scenario({ beforeDrift: true }), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.code, "CONFIG_CHANGED");
  assert.ok(!state.operations.includes("PATCH"));
});
test("unrelated configuration drift after PATCH fails without rollback or extra mutation", async () => {
  const state = scenario({ afterDrift: true }), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.code, "OTHER_CONFIG_CHANGED");
  assert.equal(state.operations.filter((op) => op === "PATCH").length, 1);
});
test("lost PATCH response is reconciled by readback without repeating mutation", async () => {
  const state = scenario({ lostResponse: true }), report = await configureAuthUrls(env, origin, { apply: true, ...state });
  assert.equal(report.result, "PASS");
  assert.equal(report.patchAcknowledged, false);
  assert.equal(report.patchVerifiedByReadback, true);
  assert.equal(state.operations.filter((op) => op === "PATCH").length, 1);
});
test("noncommitted PATCH and public settings drift are not accepted", async () => {
  for (const [option, code] of [[{ patchNotCommitted: true }, "READBACK_MISMATCH"],
    [{ publicDrift: true }, "PUBLIC_CONFIG_CHANGED"]]) {
    const state = scenario(option), report = await configureAuthUrls(env, origin, { apply: true, ...state });
    assert.equal(report.code, code);
    assert.equal(state.operations.filter((op) => op === "PATCH").length, 1);
  }
});
test("recovery inspection reports only structure and never changes template or sends mail", () => {
  const result = recoveryReview({ mailer_templates_recovery_content:
    '<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset</a>',
    smtp_host: "synthetic-private-host", smtp_user: "synthetic-private-user", smtp_admin_email: "synthetic-private-email" });
  assert.equal(result.referencesServerConfirm, true);
  assert.equal(result.usesTokenHash, true);
  assert.equal(result.customSmtpConfigured, true);
  assert.equal(result.recoveryDeliveryTested, false);
  assert.equal(result.templateModified, false);
  assert.ok(!JSON.stringify(result).includes("synthetic-private"));
});
