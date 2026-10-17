import {
  targetConfig,
  targetHost,
  loadTargetDemos,
  assertAppTarget,
  evidencePath,
  projectRef,
  runId,
} from "./audit-target.mjs";
// Read-only tenant-content audit. Login/logout create ordinary Auth/audit activity.
// Run from the project root with Node 22 --env-file=.env.migration.local. Credentials stay
// in .runtime/migrations/<target>/accounts.json (ignored). AUDIT_BASE_URL defaults to localhost;
// any non-loopback origin must use HTTPS. This does not deploy or alter data.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TARGET = targetHost;
const TABLES = [
  ["restaurants", "id", "id", "restaurant"],
  ["restaurant_memberships", "restaurant_id", "user_id", "membership"],
  ["restaurant_settings", "restaurant_id", "restaurant_id", "settings"],
  ["categories", "restaurant_id", "id", "categories"],
  ["products", "restaurant_id", "id", "products"],
  ["promotions", "restaurant_id", "id", "promotions"],
  ["restaurant_hours", "restaurant_id", "day_of_week", "hours"],
  ["translations", "restaurant_id", "id", "translations"],
  ["restaurant_qr_configs", "restaurant_id", "restaurant_id", "qr"],
];
const CONTENT_FIELDS = [
  "restaurant",
  "membership",
  "settings",
  "categories",
  "products",
  "promotions",
  "hours",
  "translations",
  "qr",
  "domains",
  "total",
];
function ensure(condition, code) {
  if (!condition) throw new Error(code);
}
function errorCode(error) {
  return /^[A-Z0-9_:-]{1,110}$/.test(error?.message || "")
    ? error.message
    : "UNEXPECTED_ERROR_DETAILS_REDACTED";
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const hash = (value) =>
  createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value)))
    .digest("hex");
function contentSnapshot(workspace) {
  const result = Object.fromEntries(
    CONTENT_FIELDS.map((k) => [k, workspace[k]]),
  );
  for (const key of [
    "categories",
    "products",
    "promotions",
    "translations",
    "domains",
  ])
    result[key] = [...result[key]].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
  result.hours = [...result.hours].sort(
    (a, b) => a.day_of_week - b.day_of_week,
  );
  return result;
}

async function main() {
  const config = targetConfig();
  const base = config.base;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(base).hostname,
  );
  const supabaseUrl = new URL(config.url);
  const key = config.publicKey;
  let publicKey = /^sb_publishable_[\w-]+$/.test(key || "");
  if (!publicKey && typeof key === "string") {
    try {
      publicKey =
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role === "anon";
    } catch {
      /* fail closed */
    }
  }
  ensure(publicKey, "PUBLIC_KEY_REQUIRED_NO_SERVICE_ROLE");
  const { manifest, accounts } = loadTargetDemos();

  const evidence = {
    startedAt: new Date().toISOString(),
    projectRef,
    runId,
    base,
    environment: loopback
      ? "local production server; hosted Supabase"
      : "remote HTTPS application; hosted Supabase",
    target: TARGET,
    scriptSha256: hash(readFileSync(new URL(import.meta.url))),
    realData: true,
    mocks: false,
    serviceRoleUsed: false,
    scope:
      "Three fixed DEMOs; six directed pairs; authenticated API GET, RLS SELECT and private Storage download. No catalog, configuration or object mutations.",
    businessContentMutations: false,
    authSessionLifecycle: true,
    publicMenuRequests: false,
    authSideEffects:
      "Creates up to six temporary sessions (API and direct Supabase per owner), ordinary login audit/rate counters and Auth last-sign-in metadata; closes only those sessions with local scope. No emails or global revocations. No public menu requests or visit metrics from this runner.",
    persistenceScope:
      "Exact SHA256 before/after for owner-visible restaurant, membership, settings, categories, products, promotions, hours, translations, QR, domains and total; all rows in nine tenant tables; sampled existing private image bytes. Excludes Auth, audit, visits, rate counters and service-only commercial data.",
    limitations: [
      "SELECT/download isolation only; does not exercise blocked INSERT/UPDATE/DELETE or suspended accounts in this run.",
      "One confirmed existing image per tenant is sampled; not an enumeration of all Storage objects.",
      "Successful local checks do not establish Render/public deployment, SMTP, physical QR scanning or device compatibility.",
    ],
    officialReferences: [
      "https://supabase.com/docs/reference/javascript/auth-signinwithpassword",
      "https://supabase.com/docs/reference/javascript/auth-signout",
      "https://supabase.com/docs/reference/javascript/storage-from-download",
    ],
    checks: [],
    pairs: [],
    before: [],
    after: [],
    cleanup: [],
    traffic: [],
  };
  const runTag = evidence.startedAt.replace(/[-:.]/g, "");
  const output = evidencePath("production-isolation-" + runTag + ".json");
  const owners = [];
  async function check(name, fn) {
    try {
      const detail = await fn();
      evidence.checks.push({ name, pass: true, detail: detail ?? null });
      console.log("PASS " + name);
      return detail;
    } catch (error) {
      evidence.checks.push({ name, pass: false, error: errorCode(error) });
      console.log("FAIL " + name + " " + errorCode(error));
      return null;
    }
  }
  class ApiSession {
    jar = new Map();
    async request(path, action) {
      const target = new URL(path, base);
      ensure(
        target.origin === base && !target.search && !target.hash,
        "UNSAFE_API_DESTINATION",
      );
      // Public menu GET records visits, so it is deliberately outside the allowlist.
      const safeRead =
        /^\/api\/(health|session)$/.test(path) ||
        /^\/api\/workspace\/[0-9a-f-]{36}$/.test(path);
      ensure(
        action
          ? path === "/api/auth" && ["login", "logout"].includes(action.action)
          : safeRead,
        "API_OPERATION_NOT_ALLOWED",
      );
      if (action) await assertAppTarget(base, { fresh: true });
      const response = await fetch(target, {
        method: action ? "POST" : "GET",
        headers: {
          origin: base,
          cookie: [...this.jar].map(([k, v]) => k + "=" + v).join("; "),
          ...(action ? { "content-type": "application/json" } : {}),
        },
        ...(action ? { body: JSON.stringify(action) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0];
        const equal = pair.indexOf("=");
        if (equal > 0)
          this.jar.set(pair.slice(0, equal), pair.slice(equal + 1));
      }
      evidence.traffic.push({
        service: "application",
        method: action ? "POST" : "GET",
        path: target.pathname,
        ...(action ? { action: action.action } : {}),
        status: response.status,
      });
      const data = response.headers
        .get("content-type")
        ?.includes("application/json")
        ? await response.json()
        : null;
      return { status: response.status, data };
    }
  }
  async function guardedSupabaseFetch(input, init = {}) {
    const target = new URL(
      typeof input === "string" ? input : input.url || input.toString(),
    );
    const method = (init.method || input.method || "GET").toUpperCase();
    const authLogin =
      method === "POST" &&
      target.pathname === "/auth/v1/token" &&
      target.search === "?grant_type=password";
    const authLogout =
      method === "POST" &&
      target.pathname === "/auth/v1/logout" &&
      target.search === "?scope=local";
    const readTable =
      method === "GET" &&
      TABLES.some(([table]) => target.pathname === "/rest/v1/" + table);
    const readUser =
      method === "GET" && target.pathname === "/auth/v1/user" && !target.search;
    const readImage =
      method === "GET" &&
      /^\/storage\/v1\/object\/restaurant-media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$/.test(
        target.pathname,
      ) &&
      !target.search;
    ensure(
      target.origin === supabaseUrl.origin &&
        (authLogin || authLogout || readTable || readUser || readImage),
      "SUPABASE_OPERATION_NOT_ALLOWED",
    );
    const response = await fetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    evidence.traffic.push({
      service: "supabase",
      method,
      path: target.pathname,
      status: response.status,
      ...(authLogout ? { scope: "local" } : {}),
    });
    return response;
  }
  async function rows(owner, definition, restaurantId) {
    const [table, filter, order] = definition;
    const all = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const result = await owner.client
        .from(table)
        .select("*")
        .eq(filter, restaurantId)
        .order(order)
        .range(offset, offset + 999);
      ensure(
        !result.error &&
          [200, 206].includes(result.status) &&
          Array.isArray(result.data),
        "RLS_QUERY_FAILED_" + table.toUpperCase(),
      );
      all.push(...result.data);
      if (result.data.length < 1000) return all;
    }
    throw new Error("RLS_ROW_BOUND_EXCEEDED");
  }
  async function snapshot(owner) {
    const { item } = owner;
    const workspace = await owner.api.request("/api/workspace/" + item.id);
    ensure(workspace.status === 200, "OWN_WORKSPACE_HTTP_" + workspace.status);
    const w = workspace.data;
    ensure(
      w.role === "owner" &&
        w.restaurant.id === item.id &&
        w.restaurant.is_demo === true &&
        w.restaurant.status === "active",
      "WRONG_OWNER_OR_DEMO",
    );
    ensure(
      w.products?.length === 24 && w.total === 24 && w.categories?.length === 8,
      "DEMO_COUNTS_CHANGED",
    );
    const tables = [];
    for (const definition of TABLES) {
      const selected = await rows(owner, definition, item.id);
      const expected = Array.isArray(w[definition[3]])
        ? w[definition[3]].length
        : 1;
      ensure(
        selected.length === expected && selected.length > 0,
        "OWN_RLS_CONTROL_FAILED_" + definition[0].toUpperCase(),
      );
      tables.push({
        table: definition[0],
        rows: selected.length,
        sha256: hash(selected),
      });
    }
    owner.mediaPath ||= w.products.find(
      (p) =>
        typeof p.image_path === "string" &&
        p.image_path.startsWith(item.id + "/"),
    )?.image_path;
    ensure(
      typeof owner.mediaPath === "string" &&
        new RegExp(
          "^" + item.id + "/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp|avif)$",
        ).test(owner.mediaPath),
      "OWN_IMAGE_PATH_REQUIRED",
    );
    const image = await owner.client.storage
      .from("restaurant-media")
      .download(owner.mediaPath);
    ensure(!image.error && image.data?.size > 0, "OWN_STORAGE_CONTROL_FAILED");
    return {
      key: item.key,
      id: item.id,
      products: w.total,
      categories: w.categories.length,
      contentSha256: hash(contentSnapshot(w)),
      tables,
      sampledImage: {
        path: owner.mediaPath,
        bytes: image.data.size,
        sha256: hash(Buffer.from(await image.data.arrayBuffer())),
      },
    };
  }
  try {
    const verifiedTarget = await assertAppTarget(base, { fresh: true });
    evidence.verifiedApplicationTarget = verifiedTarget;
    const health = await new ApiSession().request("/api/health");
    ensure(
      health.status === 200 &&
        health.data?.status === "ok" &&
        health.data?.configured === true,
      "APPLICATION_HEALTH_FAILED",
    );
    for (const item of manifest.restaurants) {
      const owner = {
        item,
        api: new ApiSession(),
        client: createClient(supabaseUrl.origin, key, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: { fetch: guardedSupabaseFetch },
        }),
      };
      owners.push(owner);
      const a = accounts[item.key];
      const login = await owner.api.request("/api/auth", {
        action: "login",
        email: a.email,
        password: a.password,
      });
      ensure(
        login.status === 200 && login.data?.role === "owner",
        "API_LOGIN_FAILED_" + login.status,
      );
      const auth = await owner.client.auth.signInWithPassword({
        email: a.email,
        password: a.password,
      });
      ensure(
        !auth.error && auth.data?.session && auth.data.user.id === a.userId,
        "DIRECT_LOGIN_FAILED",
      );
      await check(item.key + " authenticated owner identities", async () => {
        const apiIdentity = await owner.api.request("/api/session");
        const directIdentity = await owner.client.auth.getUser();
        ensure(
          apiIdentity.status === 200 &&
            apiIdentity.data?.role === "owner" &&
            apiIdentity.data.restaurantId === item.id &&
            apiIdentity.data.user?.id === a.userId,
          "API_IDENTITY_MISMATCH",
        );
        ensure(
          !directIdentity.error && directIdentity.data.user?.id === a.userId,
          "DIRECT_IDENTITY_MISMATCH",
        );
        return {
          apiStatus: 200,
          role: "owner",
          assignedRestaurant: item.id,
          directIdentityMatches: true,
        };
      });
      const before = await check(
        item.key + " positive controls and baseline",
        () => snapshot(owner),
      );
      ensure(before, "POSITIVE_CONTROL_FAILED");
      evidence.before.push(before);
    }
    for (const from of owners)
      for (const to of owners) {
        if (from === to) continue;
        const pair = {
          from: from.item.key,
          to: to.item.key,
          api: null,
          rls: [],
          storage: null,
        };
        evidence.pairs.push(pair);
        await check(
          pair.from + " -> " + pair.to + " API isolation",
          async () => {
            const result = await from.api.request(
              "/api/workspace/" + to.item.id,
            );
            pair.api = {
              status: result.status,
              containsTenantPayload: Boolean(
                result.data?.restaurant || result.data?.products,
              ),
            };
            ensure(
              result.status === 403 && !pair.api.containsTenantPayload,
              "CROSS_API_NOT_DENIED",
            );
            return pair.api;
          },
        );
        await check(
          pair.from + " -> " + pair.to + " RLS isolation",
          async () => {
            for (const table of TABLES) {
              const selected = await rows(from, table, to.item.id);
              pair.rls.push({ table: table[0], rows: selected.length });
            }
            ensure(
              pair.rls.every((x) => x.rows === 0),
              "CROSS_RLS_ROWS_EXPOSED",
            );
            return {
              tables: pair.rls.length,
              rows: 0,
              targetPositiveControlsVerified: true,
            };
          },
        );
        await check(
          pair.from + " -> " + pair.to + " private Storage isolation",
          async () => {
            const downloaded = await from.client.storage
              .from("restaurant-media")
              .download(to.mediaPath);
            const status = Number(
              downloaded.error?.status || downloaded.error?.statusCode || 0,
            );
            pair.storage = {
              denied: Boolean(downloaded.error) && !downloaded.data,
              errorStatus: status,
              returnedBytes: downloaded.data?.size ?? 0,
              targetImagePreviouslyReadByOwner: true,
            };
            ensure(
              pair.storage.denied && [400, 401, 403, 404].includes(status),
              "CROSS_STORAGE_NOT_DENIED",
            );
            return pair.storage;
          },
        );
      }
  } catch (error) {
    evidence.checks.push({
      name: "audit preconditions and execution",
      pass: false,
      error: errorCode(error),
    });
  } finally {
    for (const owner of owners) {
      const before = evidence.before.find((x) => x.id === owner.item.id);
      if (before)
        await check(
          owner.item.key + " content unchanged after read-only audit",
          async () => {
            const after = await snapshot(owner);
            evidence.after.push(after);
            ensure(
              hash(after) === hash(before),
              "CONTENT_CHANGED_DURING_AUDIT",
            );
            return {
              exactHashEquality: true,
              beforeSha256: hash(before),
              afterSha256: hash(after),
            };
          },
        );
    }
    for (const owner of owners) {
      await check(
        owner.item.key + " close audit sessions locally",
        async () => {
          // Both attempts execute even if one fails; never use global/default signOut.
          const results = await Promise.allSettled([
            owner.api.request("/api/auth", { action: "logout" }),
            owner.client.auth.signOut({ scope: "local" }),
          ]);
          const apiClosed =
            results[0].status === "fulfilled" &&
            results[0].value.status === 200;
          const directClosed =
            results[1].status === "fulfilled" && !results[1].value.error;
          evidence.cleanup.push({
            owner: owner.item.key,
            scope: "local",
            apiClosed,
            directClosed,
          });
          owner.api.jar.clear();
          ensure(apiClosed && directClosed, "LOCAL_SESSION_CLEANUP_FAILED");
          return { scope: "local", apiClosed, directClosed };
        },
      );
    }
    evidence.completedAt = new Date().toISOString();
    evidence.passed = evidence.checks.filter((x) => x.pass).length;
    evidence.failed = evidence.checks.filter((x) => !x.pass).length;
    evidence.result =
      evidence.failed === 0 &&
      evidence.pairs.length === 6 &&
      evidence.before.length === 3 &&
      evidence.after.length === 3
        ? "PASS"
        : "FAIL";
    writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify({
        result: evidence.result,
        passed: evidence.passed,
        failed: evidence.failed,
        directedPairs: evidence.pairs.length,
        output,
      }),
    );
    process.exitCode = evidence.result === "PASS" ? 0 : 1;
  }
}
main().catch((error) => {
  console.error(errorCode(error));
  process.exitCode = 1;
});
