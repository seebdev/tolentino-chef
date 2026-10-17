import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level tests: the database is mocked. SQL token immutability is covered separately by database.test.ts.
const fixtures = vi.hoisted(() => {
  const state = {
    restaurant: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "original-menu",
      status: "active",
      public_token: "4bd972ac-3fca-4b78-a57d-b26d760f331e",
      custom_domain: "external-restaurant.example",
    } as Record<string, string> | null,
    rateAllowed: true,
    metricThrows: false,
  };
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn(async () => ({
    data: state.restaurant,
    error: null,
  }));
  const query = { select, eq, maybeSingle };
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  const rpc = vi.fn(async (name: string) => {
    if (name === "record_menu_visit" && state.metricThrows)
      throw new Error("Metrics temporarily unavailable");
    return {
      data: name === "consume_rate_limit" ? state.rateAllowed : null,
      error: null,
    };
  });
  const from = vi.fn((table: string) => {
    if (table !== "restaurants")
      throw new Error(`Unexpected resolver query: ${table}`);
    return query;
  });
  const serviceDb = vi.fn(() => ({ from, rpc }));
  return { state, select, eq, from, rpc, serviceDb };
});

vi.mock("@/lib/supabase", () => ({ serviceDb: fixtures.serviceDb }));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.com",
}));

import { GET } from "../src/app/q/[token]/route";

const token = "4bd972ac-3fca-4b78-a57d-b26d760f331e";
const printedUrl = `https://admin.example.com/q/${token}`;

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.state.restaurant = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug: "original-menu",
    status: "active",
    public_token: token,
    custom_domain: "external-restaurant.example",
  };
  fixtures.state.rateAllowed = true;
  fixtures.state.metricThrows = false;
});

function resolveToken(value = token, url = printedUrl) {
  return GET(
    new Request(url, {
      headers: {
        host: "untrusted.example",
        "x-forwarded-host": "untrusted.example",
        "x-forwarded-proto": "http",
      },
    }),
    { params: Promise.resolve({ token: value }) },
  );
}

describe("permanent QR resolver — handler with mocked database", () => {
  it("resolves the same printed token to the current slug after a rename", async () => {
    const before = await resolveToken();
    expect(before.status).toBe(302);
    expect(before.headers.get("location")).toBe(
      "https://admin.example.com/menu/original-menu",
    );
    fixtures.state.restaurant!.slug = "renamed-menu";
    const after = await resolveToken();
    expect(after.status).toBe(302);
    expect(after.headers.get("location")).toBe(
      "https://admin.example.com/menu/renamed-menu",
    );
    expect(fixtures.state.restaurant!.public_token).toBe(token);
    expect(fixtures.eq.mock.calls).toEqual([
      ["public_token", token],
      ["public_token", token],
    ]);
    expect(
      fixtures.from.mock.calls.every(([table]) => table === "restaurants"),
    ).toBe(true);
    expect(after.headers.get("cache-control")).toBe("no-store");
    expect(after.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("redirects only to APP_URL regardless of request host, redirect parameters or a custom domain", async () => {
    const response = await resolveToken(
      token,
      `https://attacker.example/q/${token}?next=https://other.example&domain=external-restaurant.example`,
    );
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://admin.example.com");
    expect(target.pathname).toBe("/menu/original-menu");
    expect(target.search).toBe("");
    expect(fixtures.select).toHaveBeenCalledWith("id,slug,status");
    expect(fixtures.from).not.toHaveBeenCalledWith("restaurant_domains");
  });

  it("encodes unexpected slug characters without creating an external redirect", async () => {
    // Defense in depth: the DB schema prevents these values, but URL construction remains controlled.
    fixtures.state.restaurant!.slug =
      "//external.example/path?next=https://other.example";
    const response = await resolveToken();
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe("https://admin.example.com");
    expect(target.pathname).toBe(
      `/menu/${encodeURIComponent(fixtures.state.restaurant!.slug)}`,
    );
    expect(target.search).toBe("");
  });

  it("rejects malformed UUIDs before contacting the database", async () => {
    for (const invalid of [
      "not-a-token",
      "../secret",
      "https://external.example",
    ]) {
      const response = await resolveToken(invalid);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });

  it("returns a safe 404 for unknown tokens and records no metrics", async () => {
    fixtures.state.restaurant = null;
    const response = await resolveToken();
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(fixtures.rpc).not.toHaveBeenCalled();
  });

  it("keeps suspended restaurants resolvable to their current state page without metrics", async () => {
    fixtures.state.restaurant!.status = "suspended";
    fixtures.state.restaurant!.slug = "renamed-suspended-menu";
    const response = await resolveToken();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.com/menu/renamed-suspended-menu",
    );
    expect(fixtures.rpc).not.toHaveBeenCalled();
  });

  it("records an allowed active scan, but metrics failures never break the menu redirect", async () => {
    await resolveToken();
    expect(fixtures.rpc).toHaveBeenCalledWith("record_menu_visit", {
      p_restaurant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_is_qr: true,
    });
    fixtures.rpc.mockClear();
    fixtures.state.rateAllowed = false;
    expect((await resolveToken()).status).toBe(302);
    expect(fixtures.rpc).not.toHaveBeenCalledWith(
      "record_menu_visit",
      expect.anything(),
    );
    fixtures.state.rateAllowed = true;
    fixtures.state.metricThrows = true;
    expect((await resolveToken()).headers.get("location")).toBe(
      "https://admin.example.com/menu/original-menu",
    );
  });
});
