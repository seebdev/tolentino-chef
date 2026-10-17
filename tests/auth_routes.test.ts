import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const resetPasswordForEmail = vi.fn(async (_email: string, _options: unknown) => ({ data: {}, error: null }));
  const signOut = vi.fn(async (_options: unknown) => ({ error: null }));
  const signInWithPassword = vi.fn(async (_input: unknown) => ({ error: null }));
  const actor = vi.fn();
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  return { resetPasswordForEmail, rpc, actor, signOut, signInWithPassword, db: { auth: { resetPasswordForEmail, signOut, signInWithPassword }, rpc } };
});
vi.mock("@/lib/supabase", () => ({ sessionDb: async () => fixture.db, serviceDb: () => fixture.db }));
vi.mock("@/lib/access", () => ({ actor: fixture.actor, audit: vi.fn() }));
vi.mock("@/lib/config", () => ({ configured: () => true, appUrl: () => "https://admin.example.com" }));
import { POST } from "../src/app/api/auth/route";
import { ApiError } from "../src/lib/api";
beforeEach(() => vi.clearAllMocks());
const recover = (email: string) => POST(new Request("https://admin.example.com/api/auth", {
  method: "POST", headers: { origin: "https://admin.example.com", "content-type": "application/json" },
  body: JSON.stringify({ action: "recover", email }),
}));
describe("password recovery communication policy", () => {
  it("suppresses reserved .test mail with the same generic response and rate limiting as ordinary recovery", async () => {
    const normal = await recover("owner@example.com");
    expect(normal.status).toBe(200);
    const expected = await normal.json();
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith("owner@example.com",
      { redirectTo: "https://admin.example.com/auth/callback" });
    fixture.resetPasswordForEmail.mockClear();
    for (const email of ["demo@tolentino.test", "DEMO@TOLENTINO.TEST", "owner@nested.demo.test"]) {
      const response = await recover(email);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(8);
  });
  it("rejects an invalid recovery address without calling the email provider", async () => {
    expect((await recover("invalid-email")).status).toBe(400);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("session logout scope", () => {
  const request = (data: unknown) => POST(new Request("https://admin.example.com/api/auth", {
    method: "POST", headers: { origin: "https://admin.example.com", "content-type": "application/json" },
    body: JSON.stringify(data),
  }));
  it("logs out only the current session without revoking other devices", async () => {
    expect((await request({ action: "logout" })).status).toBe(200);
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
  it("discards only this login session when restaurant authorization is denied", async () => {
    fixture.actor.mockRejectedValueOnce(new ApiError(403, "No restaurant assigned."));
    const response = await request({ action: "login", email: "owner@example.com", password: "fixture-password" });
    expect(response.status).toBe(403);
    expect(fixture.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
});
