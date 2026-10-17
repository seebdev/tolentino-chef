import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CookieMethodsServer,
  CookieOptions,
  SetAllCookies,
} from "@supabase/ssr";
import { NextRequest } from "next/server";

const fixtures = vi.hoisted(() => {
  const state = {
    configured: true,
    writes: [] as {
      cookies: Parameters<SetAllCookies>[0];
      headers: Record<string, string>;
    }[],
    authError: null as Error | null,
    thrown: null as Error | null,
    clients: [] as {
      cookies: CookieMethodsServer;
      cookieOptions: CookieOptions;
    }[],
    filters: [] as [string, unknown][],
  };
  const getUser = vi.fn(async () => {
    const options = state.clients.at(-1)!;
    for (const write of state.writes)
      await options.cookies.setAll!(write.cookies, write.headers);
    if (state.thrown) throw state.thrown;
    return { data: { user: null }, error: state.authError };
  });
  const createServerClient = vi.fn(
    (_url: string, _key: string, options: (typeof state.clients)[number]) => {
      state.clients.push(options);
      return { auth: { getUser } };
    },
  );
  const from = vi.fn((table: string) => {
    let hostname = "";
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((name: string, value: unknown) => {
        state.filters.push([name, value]);
        if (name === "hostname") hostname = String(value);
        return query;
      }),
      maybeSingle: vi.fn(async () => ({
        data:
          table === "restaurant_domains" && hostname === "menu.example.com"
            ? { restaurant_id: "tenant-a" }
            : null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: { slug: "restaurant-a" },
        error: null,
      })),
    };
    return query;
  });
  return {
    state,
    createServerClient,
    getUser,
    from,
    serviceDb: vi.fn(() => ({ from })),
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: fixtures.createServerClient,
}));
vi.mock("@/lib/config", () => ({
  configured: () => fixtures.state.configured,
  platformHosts: () => new Set(["admin.example.com", "localhost"]),
}));
vi.mock("@/lib/supabase", () => ({ serviceDb: fixtures.serviceDb }));

import { proxy } from "../src/proxy";

const options: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
};
const cacheHeaders = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};
function request(
  path: string,
  host = "admin.example.com",
  headers: Record<string, string> = {},
) {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host, ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.state.configured = true;
  fixtures.state.writes = [];
  fixtures.state.authError = null;
  fixtures.state.thrown = null;
  fixtures.state.clients = [];
  fixtures.state.filters = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("SSR session refresh", () => {
  it("validates with Auth and forwards rotated chunks to both the route and browser", async () => {
    fixtures.state.writes = [
      {
        cookies: [
          { name: "sb-test-auth-token.0", value: "fresh-part-0", options },
          { name: "sb-test-auth-token.1", value: "fresh-part-1", options },
          {
            name: "sb-test-auth-token.2",
            value: "",
            options: { ...options, maxAge: 0 },
          },
        ],
        headers: cacheHeaders,
      },
    ];
    const req = request("/dashboard", "admin.example.com", {
      cookie:
        "sb-test-auth-token.0=expired; sb-test-auth-token.2=old-part; preference=es",
    });
    const response = await proxy(req);
    expect(fixtures.getUser).toHaveBeenCalledExactlyOnceWith();
    expect(fixtures.createServerClient).toHaveBeenCalledWith(
      "https://project.example.com",
      "test-publishable-key",
      expect.objectContaining({ cookieOptions: options }),
    );
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
    expect(req.cookies.get("sb-test-auth-token.0")?.value).toBe("fresh-part-0");
    expect(req.cookies.has("sb-test-auth-token.2")).toBe(false);
    expect(req.cookies.get("preference")?.value).toBe("es");
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-test-auth-token.1=fresh-part-1",
    );
    expect(response.headers.get("x-middleware-request-cookie")).not.toContain(
      "expired",
    );
    expect(response.headers.get("cookie")).toBeNull();
    expect(response.cookies.get("sb-test-auth-token.0")).toMatchObject({
      value: "fresh-part-0",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(response.cookies.get("sb-test-auth-token.2")).toMatchObject({
      value: "",
      maxAge: 0,
    });
    for (const [name, value] of Object.entries(cacheHeaders))
      expect(response.headers.get(name)).toBe(value);
  });

  it("retains cookies and anti-cache headers across multiple SDK writes", async () => {
    fixtures.state.writes = [
      {
        cookies: [
          { name: "sb-test-auth-token.0", value: "first", options },
          {
            name: "sb-test-auth-token.1",
            value: "",
            options: { ...options, maxAge: 0 },
          },
        ],
        headers: cacheHeaders,
      },
      {
        cookies: [{ name: "sb-test-auth-token.0", value: "last", options }],
        headers: {},
      },
    ];
    const response = await proxy(request("/api/session"));
    expect(response.cookies.get("sb-test-auth-token.0")?.value).toBe("last");
    expect(response.cookies.get("sb-test-auth-token.1")?.maxAge).toBe(0);
    for (const [name, value] of Object.entries(cacheHeaders))
      expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      "sb-test-auth-token.0=last",
    );
  });

  it("keeps unauthenticated requests available for the route's own authorization", async () => {
    fixtures.state.authError = new Error("Auth session missing");
    const response = await proxy(request("/login"));
    expect(fixtures.getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });

  it("propagates invalid-session cleanup even when Auth rejects the session", async () => {
    fixtures.state.authError = new Error("Refresh token invalid");
    fixtures.state.writes = [
      {
        cookies: [
          {
            name: "sb-test-auth-token",
            value: "",
            options: { ...options, maxAge: 0 },
          },
        ],
        headers: cacheHeaders,
      },
    ];
    const req = request("/api/admin/restaurants", "admin.example.com", {
      cookie: "sb-test-auth-token=rejected",
    });
    const response = await proxy(req);
    expect(req.cookies.has("sb-test-auth-token")).toBe(false);
    expect(response.cookies.get("sb-test-auth-token")?.maxAge).toBe(0);
    expect(response.headers.has("location")).toBe(false);
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });

  it("isolates clients, cookies and headers between independent requests", async () => {
    fixtures.state.writes = [
      {
        cookies: [
          { name: "sb-test-auth-token", value: "request-one", options },
        ],
        headers: cacheHeaders,
      },
    ];
    await proxy(request("/dashboard"));
    fixtures.state.writes = [];
    const second = await proxy(
      request("/dashboard", "admin.example.com", { cookie: "preference=en" }),
    );
    expect(fixtures.createServerClient).toHaveBeenCalledTimes(2);
    expect(fixtures.state.clients[0].cookies).not.toBe(
      fixtures.state.clients[1].cookies,
    );
    expect(await fixtures.state.clients[1].cookies.getAll()).toEqual([
      { name: "preference", value: "en" },
    ]);
    expect(second.cookies.getAll()).toEqual([]);
    expect(second.headers.get("x-middleware-request-cookie")).toBe(
      "preference=en",
    );
    expect(second.headers.get("expires")).toBeNull();
  });

  it("allows setup pages when credentials are absent without constructing a client", async () => {
    fixtures.state.configured = false;
    const response = await proxy(request("/login"));
    expect(response.status).toBe(200);
    expect(fixtures.createServerClient).not.toHaveBeenCalled();
  });

  it("does not silently turn unexpected Auth failures into a successful refresh", async () => {
    fixtures.state.thrown = new Error("Unexpected Auth failure");
    await expect(proxy(request("/dashboard"))).rejects.toThrow(
      "Unexpected Auth failure",
    );
  });

  it.each([
    "/login",
    "/login?mode=password",
    "/admin",
    "/admin/restaurants/tenant-a",
    "/dashboard",
    "/auth/callback?code=fixture",
    "/auth/confirm",
    "/api/session",
    "/api/auth",
    "/api/admin/restaurants",
    "/api/workspace/tenant-a/products",
    "/api/media/tenant-a/image.webp",
  ])("refreshes session routes on a platform host: %s", async (path) => {
    await proxy(request(path));
    expect(fixtures.getUser).toHaveBeenCalledOnce();
  });
});

describe("proxy hostname boundaries", () => {
  it.each([
    "/",
    "/menu/restaurant-a",
    "/api/public/menu/restaurant-a",
    "/q/fixture",
    "/_next/static/chunk.js",
    "/administrator",
    "/api/authentication",
    "/dashboard-other",
  ])(
    "does not attach session cookies to a public or unrelated route: %s",
    async (path) => {
      const response = await proxy(
        request(path, "admin.example.com", {
          cookie: "sb-test-auth-token=fixture",
        }),
      );
      expect(response.status).toBe(200);
      expect(fixtures.createServerClient).not.toHaveBeenCalled();
      expect(response.cookies.getAll()).toEqual([]);
      expect(fixtures.serviceDb).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown host even with a forged forwarded platform host", async () => {
    const response = await proxy(
      request("/admin", "untrusted.example.com", {
        "x-forwarded-host": "admin.example.com",
        cookie: "sb-test-auth-token=fixture",
      }),
    );
    expect(response.status).toBe(421);
    expect(fixtures.state.filters).toContainEqual([
      "hostname",
      "untrusted.example.com",
    ]);
    expect(fixtures.state.filters).toContainEqual(["status", "verified"]);
    expect(fixtures.createServerClient).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("preserves a verified restaurant's root rewrite without refreshing a session", async () => {
    const response = await proxy(request("/?lang=fr", "menu.example.com"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://menu.example.com/menu/restaurant-a?lang=fr",
    );
    expect(fixtures.state.filters).toContainEqual(["id", "tenant-a"]);
    expect(fixtures.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    "/menu/restaurant-a",
    "/api/public/menu/restaurant-a",
    "/api/media/tenant-a/image.webp",
  ])(
    "retains only the verified restaurant's public route: %s",
    async (path) => {
      const response = await proxy(request(path, "menu.example.com"));
      expect(response.status).toBe(200);
      expect(fixtures.createServerClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/login",
    "/admin",
    "/dashboard",
    "/auth/callback",
    "/api/session",
    "/api/auth",
    "/api/workspace/tenant-a",
    "/menu/restaurant-b",
    "/api/public/menu/restaurant-b",
    "/api/media/tenant-b/image.webp",
  ])(
    "denies private and other-tenant routes on a custom domain: %s",
    async (path) => {
      const response = await proxy(
        request(path, "menu.example.com", {
          cookie: "sb-test-auth-token=fixture",
          "x-forwarded-host": "admin.example.com",
        }),
      );
      expect(response.status).toBe(404);
      expect(fixtures.createServerClient).not.toHaveBeenCalled();
      expect(response.cookies.getAll()).toEqual([]);
    },
  );

  it("preserves health checks on any host without Auth or database calls", async () => {
    fixtures.state.configured = false;
    const response = await proxy(
      request("/api/health", "untrusted.example.com"),
    );
    expect(response.status).toBe(200);
    expect(fixtures.createServerClient).not.toHaveBeenCalled();
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });
});
