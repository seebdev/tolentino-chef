import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  auditBase,
  targetConfig,
  validateManifest,
  assertAppTarget,
  projectRef,
  sourceProjectRef,
  requireDemoMutations,
} from "../scripts/audit-target.mjs";
import { Session } from "../scripts/live-client.mjs";

const destination = "https://" + projectRef + ".supabase.co";
const env = {
  TARGET_SUPABASE_URL: destination,
  TARGET_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_offline_fixture",
};
const source = {
  target: sourceProjectRef + ".supabase.co",
  restaurants: ["aurora", "bruma", "marea"].map((key, i) => ({
    key,
    id: `10000000-0000-4000-8000-00000000000${i}`,
    publicToken: `20000000-0000-4000-8000-00000000000${i}`,
    stableRoute: `/q/20000000-0000-4000-8000-00000000000${i}`,
    localMenu: "http://localhost:3000/menu/" + key,
    isDemo: true,
    status: "active",
    products: 24,
    categories: 8,
  })),
};
const manifest = () => ({
  ...structuredClone(source),
  target: projectRef + ".supabase.co",
});

describe("migration verification guards (offline fixtures only)", () => {
  beforeEach(() => {
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "AUDIT_ALLOW_DEMO_MUTATIONS",
      "AUDIT_BASE_URL",
      "LIVE_AUDIT_BASE_URL",
    ])
      vi.stubEnv(key, "");
    vi.stubEnv("TARGET_SUPABASE_URL", destination);
    vi.stubEnv(
      "TARGET_SUPABASE_PUBLISHABLE_KEY",
      env.TARGET_SUPABASE_PUBLISHABLE_KEY,
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only the authorized destination", () => {
    expect(targetConfig(env).url).toBe(destination);
    expect(() =>
      targetConfig({
        ...env,
        TARGET_SUPABASE_URL: "https://" + sourceProjectRef + ".supabase.co",
      }),
    ).toThrow("MIGRATION_TARGET_URL_REQUIRED");
  });
  it("rejects empty credentials before any connection", () => {
    expect(() => targetConfig({})).toThrow("MIGRATION_TARGET_URL_REQUIRED");
    expect(() => targetConfig({ TARGET_SUPABASE_URL: destination })).toThrow(
      "MIGRATION_TARGET_PUBLIC_KEY_REQUIRED",
    );
    expect(() => targetConfig(env, { service: true })).toThrow(
      "MIGRATION_TARGET_SERVICE_KEY_REQUIRED",
    );
  });
  it.each([
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://" + sourceProjectRef + ".supabase.co",
    ],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "legacy-fixture-public-key"],
    ["SUPABASE_SERVICE_ROLE_KEY", "legacy-fixture-service-key"],
  ])(
    "rejects inherited conflicting %s instead of trusting env-file precedence",
    (name, value) => {
      expect(() => targetConfig({ ...env, [name]: value })).toThrow(
        "LEGACY_ENV_CONFLICT_" + name,
      );
    },
  );
  it("allows matching application variables after the explicit cutover", () => {
    expect(
      targetConfig({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: destination,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          env.TARGET_SUPABASE_PUBLISHABLE_KEY,
      }).projectRef,
    ).toBe(projectRef);
  });
  it("requires HTTPS outside loopback and rejects URL credentials and paths", () => {
    expect(auditBase({})).toBe("http://localhost:3000");
    expect(auditBase({ AUDIT_BASE_URL: "https://destination.example" })).toBe(
      "https://destination.example",
    );
    expect(() =>
      auditBase({ AUDIT_BASE_URL: "http://destination.example" }),
    ).toThrow("HTTPS_REQUIRED_OUTSIDE_LOOPBACK");
    expect(() =>
      auditBase({ AUDIT_BASE_URL: "https://user:fake@destination.example" }),
    ).toThrow("AUDIT_BASE_ORIGIN_REQUIRED");
    expect(() =>
      auditBase({ AUDIT_BASE_URL: "https://destination.example/login" }),
    ).toThrow("AUDIT_BASE_ORIGIN_REQUIRED");
  });
  it("rejects two inconsistent audit origins", () => {
    expect(() =>
      auditBase({
        AUDIT_BASE_URL: "https://one.example",
        LIVE_AUDIT_BASE_URL: "https://two.example",
      }),
    ).toThrow("AUDIT_ORIGIN_CONFLICT");
  });
  it("accepts destination DEMOs with preserved identities", () => {
    expect(validateManifest(manifest(), source).restaurants).toHaveLength(3);
  });
  it("rejects source manifests and incomplete or duplicate DEMOs", () => {
    expect(() => validateManifest(source, source)).toThrow(
      "MIGRATION_MANIFEST_TARGET_MISMATCH",
    );
    const missing = manifest();
    missing.restaurants.pop();
    expect(() => validateManifest(missing, source)).toThrow(
      "THREE_TARGET_DEMOS_REQUIRED",
    );
    const duplicate = manifest();
    duplicate.restaurants[1] = duplicate.restaurants[0];
    expect(() => validateManifest(duplicate, source)).toThrow(
      "TARGET_DEMO_KEYS_MISMATCH",
    );
  });
  it("rejects changed permanent QR tokens and restaurant identifiers", () => {
    const qr = manifest();
    qr.restaurants[0].publicToken = "30000000-0000-4000-8000-000000000000";
    qr.restaurants[0].stableRoute = "/q/" + qr.restaurants[0].publicToken;
    expect(() => validateManifest(qr, source)).toThrow(
      "MIGRATION_PERMANENT_IDENTITY_CHANGED",
    );
    const id = manifest();
    id.restaurants[0].id = "40000000-0000-4000-8000-000000000000";
    expect(() => validateManifest(id, source)).toThrow(
      "MIGRATION_PERMANENT_IDENTITY_CHANGED",
    );
  });
  it("rejects non-demo content and mismatched QR routes", () => {
    const real = manifest();
    real.restaurants[0].isDemo = false;
    expect(() => validateManifest(real, source)).toThrow(
      "TARGET_DEMO_CONTENT_NOT_READY",
    );
    const route = manifest();
    route.restaurants[0].stableRoute = "/q/other";
    expect(() => validateManifest(route, source)).toThrow(
      "TARGET_QR_ROUTE_MISMATCH",
    );
  });
  it("requires an explicit destination mutation flag", () => {
    expect(() => requireDemoMutations(env)).toThrow(
      "TARGET_DEMO_MUTATIONS_NOT_ENABLED",
    );
    expect(() =>
      requireDemoMutations({
        ...env,
        AUDIT_ALLOW_DEMO_MUTATIONS: sourceProjectRef,
      }),
    ).toThrow("TARGET_DEMO_MUTATIONS_NOT_ENABLED");
    expect(() =>
      requireDemoMutations({ ...env, AUDIT_ALLOW_DEMO_MUTATIONS: projectRef }),
    ).not.toThrow();
  });
  it.each([undefined, sourceProjectRef])(
    "rejects a healthy server with a missing/source project marker %s",
    async (ref) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json({
            status: "ok",
            configured: true,
            supabaseProjectRef: ref,
          }),
        );
      await expect(
        assertAppTarget("http://localhost:3000", { fresh: true, env, fetcher }),
      ).rejects.toThrow("MIGRATION_APP_PROJECT_MISMATCH");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe("http://localhost:3000/api/health");
      expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    },
  );
  it("rejects a degraded destination health check", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ supabaseProjectRef: projectRef }, { status: 503 }),
      );
    await expect(
      assertAppTarget("http://localhost:3000", { fresh: true, env, fetcher }),
    ).rejects.toThrow("MIGRATION_APP_HEALTH_FAILED");
  });
  it("accepts exact healthy destination and sends no credentials in health request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          status: "ok",
          configured: true,
          supabaseProjectRef: projectRef,
        }),
      );
    await expect(
      assertAppTarget("http://localhost:3000", { fresh: true, env, fetcher }),
    ).resolves.toEqual({ status: 200, supabaseProjectRef: projectRef });
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });
  it("shared login cannot POST credentials to a server still using the source", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          status: "ok",
          configured: true,
          supabaseProjectRef: sourceProjectRef,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new Session().login("owner@fixture.test", "fake-offline-password"),
    ).rejects.toThrow("MIGRATION_APP_PROJECT_MISMATCH");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/health$/);
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
  it("shared session blocks business writes before network without the flag", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new Session().request("/api/workspace/fixture", {
        method: "POST",
        data: { action: "save_product" },
      }),
    ).rejects.toThrow("TARGET_DEMO_MUTATIONS_NOT_ENABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
