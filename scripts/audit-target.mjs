import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Verification is intentionally pinned to the user-authorized migration target.
// The old project is evidence only; no runtime override can select it.
export const projectRef = "hgntppemxwcxaxritnfq";
export const sourceProjectRef = "ylcnrfzosjzuljufwups";
export const targetHost = projectRef + ".supabase.co";
export const repository = "https://github.com/seebdev/tolentino-chef";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const manifestPath = path.join(
  root,
  "artifacts/migrations",
  projectRef,
  "restaurants.json",
);
export const accountsPath = path.join(
  root,
  ".runtime/migrations",
  projectRef,
  "accounts.json",
);
export const runId =
  process.env.AUDIT_RUN_ID ||
  new Date().toISOString().replace(/[-:.]/g, "") +
    "-" +
    randomUUID().slice(0, 8);
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(runId))
  throw Error("INVALID_AUDIT_RUN_ID");
export const evidenceDirectory = path.join(
  root,
  "docs/evidence/migrations",
  projectRef,
  runId,
);
export const artifactsDirectory = path.join(
  root,
  "artifacts/migrations",
  projectRef,
  runId,
);
export const privateDirectory = path.join(
  root,
  ".runtime/migrations",
  projectRef,
);
const ensure = (condition, code) => {
  if (!condition) throw Error(code);
};
const jsonFile = (file) =>
  JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {Record<string, string | undefined>} [env] */
export function auditBase(env = process.env) {
  const raw =
    env.AUDIT_BASE_URL || env.LIVE_AUDIT_BASE_URL || "http://localhost:3000";
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  ensure(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "AUDIT_BASE_ORIGIN_REQUIRED",
  );
  ensure(
    url.protocol === "https:" || (loopback && url.protocol === "http:"),
    "HTTPS_REQUIRED_OUTSIDE_LOOPBACK",
  );
  if (env.AUDIT_BASE_URL && env.LIVE_AUDIT_BASE_URL)
    ensure(
      new URL(env.AUDIT_BASE_URL).origin ===
        new URL(env.LIVE_AUDIT_BASE_URL).origin,
      "AUDIT_ORIGIN_CONFLICT",
    );
  return url.origin;
}

/** @param {Record<string, string | undefined>} [env] */
export function targetConfig(env = process.env, { service = false } = {}) {
  ensure(
    env.TARGET_SUPABASE_URL === "https://" + targetHost,
    "MIGRATION_TARGET_URL_REQUIRED",
  );
  ensure(
    Boolean(env.TARGET_SUPABASE_PUBLISHABLE_KEY),
    "MIGRATION_TARGET_PUBLIC_KEY_REQUIRED",
  );
  if (service)
    ensure(
      Boolean(env.TARGET_SUPABASE_SERVICE_ROLE_KEY),
      "MIGRATION_TARGET_SERVICE_KEY_REQUIRED",
    );
  // --env-file does not replace inherited process variables: fail instead of
  // allowing legacy scripts or subprocesses to silently use the source project.
  for (const [legacy, current] of [
    ["NEXT_PUBLIC_SUPABASE_URL", "TARGET_SUPABASE_URL"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "TARGET_SUPABASE_PUBLISHABLE_KEY"],
    ["SUPABASE_SERVICE_ROLE_KEY", "TARGET_SUPABASE_SERVICE_ROLE_KEY"],
  ])
    if (env[legacy])
      ensure(env[legacy] === env[current], "LEGACY_ENV_CONFLICT_" + legacy);
  return {
    projectRef,
    url: env.TARGET_SUPABASE_URL,
    publicKey: env.TARGET_SUPABASE_PUBLISHABLE_KEY,
    serviceKey: env.TARGET_SUPABASE_SERVICE_ROLE_KEY,
    base: auditBase(env),
  };
}

export function validateManifest(manifest, source) {
  ensure(manifest?.target === targetHost, "MIGRATION_MANIFEST_TARGET_MISMATCH");
  ensure(manifest.restaurants?.length === 3, "THREE_TARGET_DEMOS_REQUIRED");
  const keys = manifest.restaurants.map((x) => x.key).sort();
  ensure(keys.join(",") === "aurora,bruma,marea", "TARGET_DEMO_KEYS_MISMATCH");
  ensure(
    new Set(manifest.restaurants.map((x) => x.id)).size === 3,
    "TARGET_DEMO_IDS_NOT_UNIQUE",
  );
  ensure(
    new Set(manifest.restaurants.map((x) => x.publicToken)).size === 3,
    "TARGET_QR_TOKENS_NOT_UNIQUE",
  );
  ensure(
    source?.target === sourceProjectRef + ".supabase.co",
    "SOURCE_MANIFEST_REFERENCE_REQUIRED",
  );
  for (const item of manifest.restaurants) {
    ensure(
      uuid.test(item.id) && uuid.test(item.publicToken),
      "INVALID_TARGET_DEMO_IDENTITY",
    );
    ensure(
      item.isDemo === true &&
        item.status === "active" &&
        item.products === 24 &&
        item.categories === 8,
      "TARGET_DEMO_CONTENT_NOT_READY",
    );
    ensure(
      item.stableRoute === "/q/" + item.publicToken,
      "TARGET_QR_ROUTE_MISMATCH",
    );
    ensure(
      /^\/menu\/[a-z0-9-]+$/.test(new URL(item.localMenu).pathname),
      "INVALID_TARGET_MENU_PATH",
    );
    const previous = source.restaurants?.find((x) => x.key === item.key);
    ensure(
      previous?.id === item.id && previous.publicToken === item.publicToken,
      "MIGRATION_PERMANENT_IDENTITY_CHANGED",
    );
  }
  return manifest;
}

export function loadTargetDemos({ accounts = true } = {}) {
  const manifest = validateManifest(
    jsonFile(manifestPath),
    jsonFile(path.join(root, "artifacts/demo/restaurants.json")),
  );
  if (!accounts) return { manifest };
  const credentials = jsonFile(accountsPath);
  for (const item of manifest.restaurants) {
    const a = credentials[item.key];
    ensure(
      a?.restaurantId === item.id &&
        uuid.test(a.userId) &&
        typeof a.password === "string" &&
        a.password.length >= 12 &&
        /@tolentino-demo\.test$/.test(a.email || ""),
      "TARGET_DEMO_ACCOUNT_MISMATCH",
    );
  }
  ensure(
    new Set(manifest.restaurants.map((x) => credentials[x.key].userId)).size ===
      3,
    "TARGET_OWNERS_NOT_UNIQUE",
  );
  return { manifest, accounts: credentials };
}

export function loadTargetAdmin() {
  const account = jsonFile(path.join(privateDirectory, "admin-account.json"));
  ensure(
    uuid.test(account?.userId) &&
      typeof account.email === "string" &&
      account.email.includes("@") &&
      typeof account.password === "string" &&
      account.password.length >= 12,
    "TARGET_ADMIN_ACCOUNT_REQUIRED",
  );
  return account;
}

const healthChecks = new Map();
/** @param {string} [base] @param {{fresh?: boolean, env?: Record<string, string | undefined>, fetcher?: typeof fetch}} [options] */
export async function assertAppTarget(
  base = auditBase(),
  { fresh = false, env = process.env, fetcher = fetch } = {},
) {
  targetConfig(env);
  ensure(base === auditBase(env), "AUDIT_HEALTH_ORIGIN_MISMATCH");
  if (!fresh && healthChecks.has(base)) return healthChecks.get(base);
  const promise = (async () => {
    const response = await fetcher(base + "/api/health", {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    ensure(response.status === 200, "MIGRATION_APP_HEALTH_FAILED");
    const data = await response.json();
    ensure(
      data.status === "ok" &&
        data.configured === true &&
        data.supabaseProjectRef === projectRef,
      "MIGRATION_APP_PROJECT_MISMATCH",
    );
    return {
      status: response.status,
      supabaseProjectRef: data.supabaseProjectRef,
    };
  })();
  healthChecks.set(base, promise);
  try {
    return await promise;
  } catch (error) {
    healthChecks.delete(base);
    throw error;
  }
}

export function evidencePath(name) {
  ensure(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(json|txt)$/.test(name),
    "INVALID_EVIDENCE_FILENAME",
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  return path.join(evidenceDirectory, name);
}
export function artifactPath(directory, name = "") {
  ensure(
    ["screenshots", "qr"].includes(directory),
    "INVALID_ARTIFACT_DIRECTORY",
  );
  ensure(
    name === "" || /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name),
    "INVALID_ARTIFACT_FILENAME",
  );
  const folder = path.join(artifactsDirectory, directory);
  mkdirSync(folder, { recursive: true });
  return name ? path.join(folder, name) : folder;
}
export const relativePath = (file) =>
  path.relative(root, file).split(path.sep).join("/");
export const targetMenuUrl = (item, base = auditBase()) =>
  base + new URL(item.localMenu).pathname;
/** @param {Record<string, string | undefined>} [env] */
export function requireDemoMutations(env = process.env) {
  targetConfig(env);
  ensure(
    env.AUDIT_ALLOW_DEMO_MUTATIONS === projectRef,
    "TARGET_DEMO_MUTATIONS_NOT_ENABLED",
  );
}
