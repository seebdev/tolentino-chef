import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const limit = vi.fn();
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { limit, from, db: { from } };
});
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixture.db }));
import { GET } from "../src/app/api/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://hgntppemxwcxaxritnfq.supabase.co",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-private-key-never-return");
  fixture.limit.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("migration health identity", () => {
  it.each(["hgntppemxwcxaxritnfq", "ylcnrfzosjzuljufwups"])(
    "identifies configured project %s without exposing keys",
    async (ref) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
        configured: true,
        supabaseProjectRef: ref,
      });
      expect(fixture.from).toHaveBeenCalledWith("platform_settings");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("does not consider missing server credentials a healthy destination", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "setup_required",
      configured: false,
      supabaseProjectRef: "hgntppemxwcxaxritnfq",
    });
    expect(fixture.from).not.toHaveBeenCalled();
  });
  it("does not invent a project identity for an unrelated hostname", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://hgntppemxwcxaxritnfq.supabase.co.example.invalid",
    );
    expect((await (await GET()).json()).supabaseProjectRef).toBeNull();
  });
  it("keeps database errors private and prevents readiness when the query fails", async () => {
    fixture.limit.mockResolvedValueOnce({
      error: { message: "fixture-private-key-never-return" },
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      configured: true,
      supabaseProjectRef: "hgntppemxwcxaxritnfq",
    });
  });
  it("returns a safe degraded response for a thrown database error", async () => {
    fixture.limit.mockRejectedValueOnce(
      new Error("fixture-private-key-never-return"),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("fixture-private-key");
  });
});
