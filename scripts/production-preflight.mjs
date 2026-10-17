import fs from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";

// Read-only provider checks. This script never deploys, patches settings or creates resources.
const projectRef = "hgntppemxwcxaxritnfq";
const repository = "https://github.com/seebdev/tolentino-chef";
const expectedServiceName = "tolentino-restaurantes-admin";
function sameRepository(value) {
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/\/?$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return normalized === repository.toLowerCase();
}
// Migration credentials are separate; never fall back to the old .env.local.
const migration = {
  ...parseEnv(fs.readFileSync(".env.migration.local", "utf8")),
};
const env = {
  NEXT_PUBLIC_SUPABASE_URL: migration.TARGET_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    migration.TARGET_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: migration.TARGET_SUPABASE_SERVICE_ROLE_KEY,
  APP_URL: migration.TARGET_APP_URL || "http://localhost:3000",
  PLATFORM_HOSTNAMES:
    migration.TARGET_PLATFORM_HOSTNAMES || "localhost,127.0.0.1",
  RENDER_API_KEY: migration.TARGET_RENDER_API_KEY,
  RENDER_SERVICE_ID: migration.TARGET_RENDER_SERVICE_ID,
  RENDER_SERVICE_HOSTNAME: migration.TARGET_RENDER_SERVICE_HOSTNAME,
  SUPABASE_ACCESS_TOKEN: migration.SUPABASE_ACCESS_TOKEN,
};
const runId = new Date().toISOString().replace(/[:.]/g, "");
const outputDirectory = "docs/evidence/migrations/" + projectRef + "/" + runId;
fs.mkdirSync(outputDirectory, { recursive: true });
const output = outputDirectory + "/preflight.json";
const report = {
  checkedAt: new Date().toISOString(),
  externalMutations: false,
  blockers: [],
};
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "PLATFORM_HOSTNAMES",
];
report.variables = Object.fromEntries(
  [
    ...required,
    "RENDER_API_KEY",
    "RENDER_SERVICE_ID",
    "RENDER_SERVICE_HOSTNAME",
    "SUPABASE_ACCESS_TOKEN",
  ].map((key) => [key, { present: Boolean(env[key]) }]),
);
for (const key of required)
  if (!env[key]) report.blockers.push(`MISSING_${key}`);
report.git = {
  branch: git("branch", "--show-current"),
  commit: git("rev-parse", "HEAD"),
  expectedRepository: repository,
};
report.git.remoteMatches = sameRepository(git("remote", "get-url", "origin"));
if (report.git.branch !== "main" || !report.git.remoteMatches)
  report.blockers.push("GIT_TARGET_MISMATCH");
try {
  if (!report.git.remoteMatches) throw new Error("GIT_TARGET_MISMATCH");
  report.git.remoteMain = git("ls-remote", "origin", "refs/heads/main").split(
    /\s+/,
  )[0];
  report.git.mainSynchronized = report.git.remoteMain === report.git.commit;
  if (!report.git.mainSynchronized)
    report.blockers.push("MAIN_NOT_SYNCHRONIZED");
} catch {
  report.blockers.push("REMOTE_MAIN_UNVERIFIED");
}
try {
  const origin = new URL(env.APP_URL);
  report.origin = {
    value: origin.origin,
    https: origin.protocol === "https:",
    loopback: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      origin.hostname,
    ),
    exactOrigin: env.APP_URL === origin.origin,
  };
  if (
    !report.origin.https ||
    report.origin.loopback ||
    !report.origin.exactOrigin ||
    origin.username ||
    origin.password
  )
    report.blockers.push("APP_URL_NOT_PUBLIC_HTTPS_ORIGIN");
} catch {
  report.blockers.push("APP_URL_INVALID");
}
async function getJson(url, headers) {
  const response = await fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co`) {
  report.blockers.push("SUPABASE_PROJECT_MISMATCH");
} else if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  try {
    const settings = await getJson(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`,
      { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    );
    report.auth = {
      projectRef,
      signupDisabled: settings.disable_signup === true,
      anonymousEnabled: settings.external?.anonymous_users === true,
      emailEnabled: settings.external?.email === true,
      emailAutoconfirm: settings.mailer_autoconfirm === true,
      smtpVerified: false,
      managementSettingsVerified: false,
    };
    if (!report.auth.signupDisabled)
      report.blockers.push("PUBLIC_SIGNUP_ENABLED");
    if (report.auth.anonymousEnabled)
      report.blockers.push("ANONYMOUS_AUTH_ENABLED");
  } catch (error) {
    report.auth = {
      status: "unverified",
      reason: /^HTTP_\d+$/.test(error.message)
        ? error.message
        : "NETWORK_ERROR",
    };
    report.blockers.push("AUTH_SETTINGS_UNVERIFIED");
  }
}
if (!env.RENDER_API_KEY) {
  report.render = {
    status: "access_missing",
    inventoryVerified: false,
    accountVerified: false,
    matchingServices: [],
  };
  report.blockers.push("RENDER_ACCESS_MISSING");
} else {
  try {
    const services = [];
    let cursor = "";
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const url = new URL("https://api.render.com/v1/services");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const batch = await getJson(url, {
        Authorization: `Bearer ${env.RENDER_API_KEY}`,
        Accept: "application/json",
      });
      if (
        !Array.isArray(batch) ||
        batch.some(
          (item) => !item?.service || typeof item.service.id !== "string",
        )
      )
        throw new Error("UNEXPECTED_RESPONSE");
      services.push(...batch.map((item) => item.service));
      if (batch.length < 100) break;
      cursor = batch.at(-1)?.cursor;
      if (!cursor || seen.has(cursor) || page === 99)
        throw new Error("INCOMPLETE_INVENTORY");
      seen.add(cursor);
    }
    report.blockers.push("NEW_RENDER_WORKSPACE_REQUIRES_VERIFICATION");
    const matching = services.filter(
      (service) =>
        service &&
        (sameRepository(service.repo) ||
          service.name === expectedServiceName ||
          (env.RENDER_SERVICE_ID && service.id === env.RENDER_SERVICE_ID)),
    );
    report.render = {
      status: "read_only_inventory_complete",
      inventoryVerified: true,
      accountVerified: false,
      totalServices: services.length,
      matchingServices: matching.map((service) => ({
        id: service.id,
        name: service.name,
        type: service.type,
        repositoryMatches: sameRepository(service.repo),
        branch: service.branch,
        suspended: service.suspended,
        plan: service.serviceDetails?.plan,
        region: service.serviceDetails?.region,
        url: service.serviceDetails?.url,
      })),
    };
    if (matching.length > 1)
      report.blockers.push("MULTIPLE_RENDER_CANDIDATES_REQUIRES_SELECTION");
    if (matching.length === 0)
      report.blockers.push("NEW_RENDER_SERVICE_REQUIRES_APPROVAL");
    if (matching.length === 1)
      report.blockers.push(
        "RENDER_DEPLOY_CONFIGURATION_REQUIRES_REVIEW_AND_APPROVAL",
      );
  } catch (error) {
    report.render = {
      status: "unverified",
      inventoryVerified: false,
      accountVerified: false,
      reason: /^HTTP_\d+$/.test(error.message)
        ? error.message
        : "NETWORK_OR_INVENTORY_ERROR",
    };
    report.blockers.push("RENDER_INVENTORY_UNVERIFIED");
  }
}
report.readyToDeploy = false;
report.publicDeploymentVerified = false;
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
