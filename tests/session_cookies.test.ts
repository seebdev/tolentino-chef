import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const values = new Map<string, string>();
  const set = vi.fn((name: string, value: string, _options: unknown) => {
    values.set(name, value);
  });
  return {
    values,
    set,
    jar: {
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      set,
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => fixture.jar }));
import { clearSessionCookies, sessionDb } from "../src/lib/supabase";
const base = "sb-hgntppemxwcxaxritnfq-auth-token";
beforeEach(() => {
  fixture.values.clear();
  fixture.set.mockClear();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://hgntppemxwcxaxritnfq.supabase.co",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "offline-public-fixture");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "offline-server-fixture");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("local Supabase cookie cleanup", () => {
  it("expires exact session chunks and PKCE keys while retaining unrelated and other-project cookies", async () => {
    const owned = [
      base,
      base + ".0",
      base + ".12",
      base + "-code-verifier",
      base + "-code-verifier.0",
      base + "-flows-code-verifier",
      base + "-flow-Abc_1234-code-verifier",
      base + "-flow-Abc_1234-code-verifier.1",
    ];
    const retained = [
      "theme",
      "sb-ylcnrfzosjzuljufwups-auth-token",
      base + "-other",
      base + "-backup.0",
      base + ".other",
      base + "-flow-short-code-verifier",
    ];
    for (const name of [...owned, ...retained])
      fixture.values.set(name, "fixture-cookie");
    await clearSessionCookies();
    expect(fixture.set).toHaveBeenCalledTimes(owned.length);
    for (const name of owned)
      expect(fixture.set).toHaveBeenCalledWith(name, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      });
    for (const name of retained)
      expect(fixture.values.get(name)).toBe("fixture-cookie");
  });
  it("uses the development emission scope for a local nonproduction cookie", async () => {
    vi.stubEnv("NODE_ENV", "development");
    fixture.values.set(base, "fixture-cookie");
    await clearSessionCookies();
    expect(fixture.set.mock.calls[0][2]).toMatchObject({
      secure: false,
      path: "/",
      maxAge: 0,
    });
  });
  it("does not suppress cookie store failures", async () => {
    fixture.values.set(base, "fixture-cookie");
    fixture.set.mockImplementationOnce(() => {
      throw new Error("unwritable");
    });
    await expect(clearSessionCookies()).rejects.toThrow("unwritable");
  });
  it("clears an expired session left by the actual SDK after an intercepted refresh 503", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          exp: now - 60,
          sub: "11111111-1111-4111-8111-111111111111",
          role: "authenticated",
        }),
      ).toString("base64url"),
      "synthetic-signature",
    ].join(".");
    fixture.values.set(
      base,
      "base64-" +
        Buffer.from(
          JSON.stringify({
            access_token: token,
            refresh_token: "offline-refresh-fixture",
            expires_at: now - 60,
            expires_in: 3600,
            token_type: "bearer",
            user: {
              id: "11111111-1111-4111-8111-111111111111",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {},
              created_at: "2026-01-01T00:00:00Z",
            },
          }),
        ).toString("base64url"),
    );
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: "offline-unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const db = await sessionDb();
    const { error } = await db.auth.signOut({ scope: "local" });
    expect(error).toBeTruthy();
    expect(fetcher).toHaveBeenCalled();
    expect(fixture.values.get(base)).toContain("base64-");
    await clearSessionCookies();
    expect(fixture.values.get(base)).toBe("");
    expect(
      fetcher.mock.calls.every(
        ([input]) =>
          new URL(input instanceof Request ? input.url : String(input))
            .hostname === "hgntppemxwcxaxritnfq.supabase.co",
      ),
    ).toBe(true);
  });
});
