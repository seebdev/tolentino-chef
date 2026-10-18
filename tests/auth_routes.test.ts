import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const resetPasswordForEmail = vi.fn(
    async (
      _email: string,
      _options: unknown,
    ): Promise<{ data: object; error: unknown }> => ({ data: {}, error: null }),
  );
  const signOut = vi.fn(
    async (_options: unknown): Promise<{ error: unknown }> => ({ error: null }),
  );
  const signInWithPassword = vi.fn(async (_input: unknown) => ({
    error: null,
  }));
  const clearSessionCookies = vi.fn(async () => {});
  const actor = vi.fn();
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  return {
    resetPasswordForEmail,
    rpc,
    actor,
    signOut,
    signInWithPassword,
    clearSessionCookies,
    db: { auth: { resetPasswordForEmail, signOut, signInWithPassword }, rpc },
  };
});
vi.mock("@/lib/supabase", () => ({
  sessionDb: async () => fixture.db,
  serviceDb: () => fixture.db,
  clearSessionCookies: fixture.clearSessionCookies,
}));
vi.mock("@/lib/access", () => ({ actor: fixture.actor, audit: vi.fn() }));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.com",
}));
import { POST } from "../src/app/api/auth/route";
import { ApiError } from "../src/lib/api";
import { LOCAL_LOGOUT_WARNING } from "../src/lib/session-messages";
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
const request = (data: unknown) =>
  POST(
    new Request("https://admin.example.com/api/auth", {
      method: "POST",
      headers: {
        origin: "https://admin.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    }),
  );
const recover = (email: string) => request({ action: "recover", email });

describe("password recovery communication policy", () => {
  it("suppresses reserved .test mail with the same generic response and rate limiting as ordinary recovery", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const normal = await recover("owner@example.com");
    expect(normal.status).toBe(200);
    const expected = await normal.json();
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
      "owner@example.com",
      { redirectTo: "https://admin.example.com/auth/callback" },
    );
    fixture.resetPasswordForEmail.mockClear();
    for (const email of [
      "demo@tolentino.test",
      "DEMO@TOLENTINO.TEST",
      "owner@nested.demo.test",
    ]) {
      const response = await recover(email);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(8);
  });
  it("rejects an invalid recovery address without calling the email provider", async () => {
    expect((await recover("invalid-email")).status).toBe(400);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it.each(["returned", "thrown"])(
    "keeps recovery generic on %s provider failure and logs only fixed fields",
    async (mode) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const expected = await (await recover("owner@example.com")).json();
      const sensitive = {
        message: "private-token owner@example.com https://private.invalid",
        code: "private-code",
      };
      if (mode === "returned")
        fixture.resetPasswordForEmail.mockResolvedValueOnce({
          data: {},
          error: sensitive,
        });
      else fixture.resetPasswordForEmail.mockRejectedValueOnce(sensitive);
      const response = await recover("owner@example.com");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: "auth_recovery_failed",
          stage: "provider",
          code: "PROVIDER_FAILURE",
        }),
      );
    },
  );
});

describe("session logout scope and local cleanup", () => {
  it("logs out only the current session and clears local cookies", async () => {
    const response = await request({ action: "logout" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      localSessionCleared: true,
    });
    expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(fixture.clearSessionCookies).toHaveBeenCalledOnce();
  });
  it.each(["returned", "thrown"])(
    "clears cookies on %s Auth failure without claiming remote revocation",
    async (mode) => {
      const error = new Error("private-server-detail");
      if (mode === "returned") fixture.signOut.mockResolvedValueOnce({ error });
      else fixture.signOut.mockRejectedValueOnce(error);
      const response = await request({ action: "logout" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: "AUTH_REVOCATION_UNCONFIRMED",
        localSessionCleared: true,
        error: LOCAL_LOGOUT_WARNING,
      });
      expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({
        scope: "local",
      });
      expect(fixture.clearSessionCookies).toHaveBeenCalledOnce();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("does not claim local cleanup if writing cookies fails", async () => {
    fixture.clearSessionCookies.mockRejectedValueOnce(
      new Error("cookie write failure"),
    );
    const response = await request({ action: "logout" });
    expect(response.status).toBe(500);
    expect((await response.json()).localSessionCleared).toBeUndefined();
  });
  it.each([false, true])(
    "clears a denied login while preserving its authorization error (Auth failure %s)",
    async (failed) => {
      fixture.actor.mockRejectedValueOnce(
        new ApiError(403, "No restaurant assigned."),
      );
      if (failed)
        fixture.signOut.mockRejectedValueOnce(new Error("unavailable"));
      const response = await request({
        action: "login",
        email: "owner@example.com",
        password: "fixture-password",
      });
      expect(response.status).toBe(403);
      expect(fixture.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(fixture.signOut).toHaveBeenCalledExactlyOnceWith({
        scope: "local",
      });
      expect(fixture.clearSessionCookies).toHaveBeenCalledOnce();
    },
  );
});
