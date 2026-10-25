import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fixtures = vi.hoisted(() => {
  type Row = Record<string, unknown> | null;
  const state = {
    user: { id: "user-owner", user_metadata: {} } as {
      id: string;
      user_metadata: Record<string, unknown>;
    } | null,
    admin: null as Row,
    membership: {
      user_id: "user-owner",
      restaurant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      is_active: true,
    } as Row,
    restaurant: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "active",
    } as Row,
    authError: null as unknown,
    rpcAllowed: true,
    ownerState: { valid: true, requiresPasswordChange: false, generation: null as string | null },
    calls: [] as {
      client: string;
      table: string;
      filters: [string, unknown][];
    }[],
  };
  function client(kind: string) {
    return {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: state.user },
          error: state.authError,
        })),
      },
      from: vi.fn((table: string) => {
        const call = {
          client: kind,
          table,
          filters: [] as [string, unknown][],
        };
        state.calls.push(call);
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((key: string, value: unknown) => {
            call.filters.push([key, value]);
            return query;
          }),
          maybeSingle: vi.fn(async () => ({
            data:
              table === "platform_admins"
                ? state.admin
                : table === "restaurant_memberships"
                  ? state.membership
                  : state.restaurant,
            error: null,
          })),
        };
        return query;
      }),
      rpc: vi.fn(async (name: string) => ({ data: name === "owner_session_state" ? state.ownerState : state.rpcAllowed, error: null })),
    };
  }
  const session = client("session");
  const service = client("service");
  return {
    state,
    session,
    service,
    sessionDb: vi.fn(async () => session),
    serviceDb: vi.fn(() => service),
  };
});

vi.mock("@/lib/supabase", () => ({
  sessionDb: fixtures.sessionDb,
  serviceDb: fixtures.serviceDb,
}));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.com",
}));

import { actor, context, superadmin } from "../src/lib/access";
import {
  ApiError,
  body,
  boundedBytes,
  dbError,
  mutationOrigin,
  rateLimit,
  route,
} from "../src/lib/api";

const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.state.user = { id: "user-owner", user_metadata: {} };
  fixtures.state.admin = null;
  fixtures.state.membership = {
    user_id: "user-owner",
    restaurant_id: tenantA,
    is_active: true,
  };
  fixtures.state.restaurant = { id: tenantA, status: "active" };
  fixtures.state.authError = null;
  fixtures.state.rpcAllowed = true;
  fixtures.state.ownerState = { valid: true, requiresPasswordChange: false, generation: null };
  fixtures.state.calls = [];
});

describe("server authentication and tenant authorization", () => {
  it("denies an absent or rejected Supabase user before any privileged client is used", async () => {
    fixtures.state.user = null;
    await expect(actor()).rejects.toMatchObject({ status: 401 });
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
    fixtures.state.user = { id: "forged", user_metadata: {} };
    fixtures.state.authError = new Error("invalid token");
    await expect(actor()).rejects.toMatchObject({ status: 401 });
    expect(fixtures.state.calls).toHaveLength(0);
  });

  it("ignores self-editable role metadata and denies owner access to the platform admin", async () => {
    fixtures.state.user!.user_metadata = { role: "superadmin", is_admin: true };
    await expect(superadmin()).rejects.toMatchObject({ status: 403 });
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
    expect(fixtures.state.calls[0].filters).toContainEqual([
      "user_id",
      "user-owner",
    ]);
    expect(fixtures.state.calls[0].filters).toContainEqual(["is_active", true]);
  });

  it("denies an owner addressing another tenant before querying that restaurant", async () => {
    await expect(context(tenantB)).rejects.toMatchObject({ status: 403 });
    expect(
      fixtures.state.calls.some((call) => call.table === "restaurants"),
    ).toBe(false);
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });

  it("uses the user-scoped client and exact tenant filter for an allowed owner", async () => {
    const result = await context(tenantA);
    expect(result.role).toBe("owner");
    expect(result.db).toBe(fixtures.session);
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
    const restaurantCall = fixtures.state.calls.find(
      (call) => call.table === "restaurants",
    );
    expect(restaurantCall).toMatchObject({
      client: "session",
      filters: [["id", tenantA]],
    });
  });

  it("blocks disabled memberships, unassigned users and suspended restaurants", async () => {
    fixtures.state.membership!.is_active = false;
    await expect(actor()).rejects.toMatchObject({ status: 403 });
    fixtures.state.membership = null;
    await expect(actor()).rejects.toMatchObject({ status: 403 });
    fixtures.state.membership = { restaurant_id: tenantA, is_active: true };
    fixtures.state.restaurant!.status = "suspended";
    await expect(context(tenantA)).rejects.toMatchObject({ status: 403 });
    expect(fixtures.serviceDb).not.toHaveBeenCalled();
  });

  it("blocks business access until first change but permits the change screen", async () => {
    fixtures.state.ownerState.requiresPasswordChange = true;
    await expect(context(tenantA)).rejects.toMatchObject({ status: 403, code: "PASSWORD_CHANGE_REQUIRED" });
    expect(fixtures.state.calls.some((call) => call.table === "restaurants")).toBe(false);
    await expect(actor({ allowPasswordChange: true })).resolves.toMatchObject({ requiresPasswordChange: true, role: "owner" });
  });
  it("rejects revoked sessions even for the password-change screen", async () => {
    fixtures.state.ownerState.valid = false;
    await expect(actor({ allowPasswordChange: true })).rejects.toMatchObject({ status: 401, code: "OWNER_SESSION_REVOKED" });
  });
  it("permits a DB-authorized superadmin to support a suspended tenant", async () => {
    fixtures.state.admin = { user_id: "user-owner", is_active: true };
    fixtures.state.restaurant = { id: tenantB, status: "suspended" };
    const result = await context(tenantB);
    expect(result.role).toBe("superadmin");
    expect(result.db).toBe(fixtures.service);
    expect(
      fixtures.state.calls.find((call) => call.table === "restaurants"),
    ).toMatchObject({ client: "service", filters: [["id", tenantB]] });
  });

  it("rejects invalid IDs before performing auth calls and returns 404 for missing tenants", async () => {
    await expect(context("not-a-uuid")).rejects.toThrow();
    expect(fixtures.sessionDb).not.toHaveBeenCalled();
    fixtures.state.restaurant = null;
    await expect(context(tenantA)).rejects.toMatchObject({ status: 404 });
  });
});

describe("request boundary security", () => {
  it("requires the official origin and rejects explicit cross-site requests", () => {
    const request = (origin?: string, site?: string) =>
      new Request("https://admin.example.com/api/workspace", {
        headers: {
          ...(origin ? { origin } : {}),
          ...(site ? { "sec-fetch-site": site } : {}),
        },
      });
    expect(() =>
      mutationOrigin(request("https://admin.example.com", "same-origin")),
    ).not.toThrow();
    for (const invalid of [
      request(),
      request("https://evil.example"),
      request("https://admin.example.com.evil.example"),
      request("https://admin.example.com", "cross-site"),
    ]) {
      expect(() => mutationOrigin(invalid)).toThrow(ApiError);
    }
  });

  it("limits actual streamed bytes even when Content-Length is absent or incorrect", async () => {
    const request = new Request("https://admin.example.com/api/test", {
      method: "POST",
      headers: { "content-length": "1" },
      body: JSON.stringify({ name: "x".repeat(300) }),
    });
    await expect(body(request, 100)).rejects.toMatchObject({ status: 413 });
    const declaredLarge = new Request("https://admin.example.com/api/test", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    });
    await expect(body(declaredLarge, 100)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("cancels a real multipart upload stream once actual bytes exceed the limit despite a forged or absent length", async () => {
    for (const declaredLength of ["1", undefined]) {
      let producedChunks = 0;
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          producedChunks++;
          if (producedChunks === 1)
            controller.enqueue(
              new TextEncoder().encode(
                '--upload\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n',
              ),
            );
          else if (producedChunks < 130)
            controller.enqueue(new Uint8Array(64 * 1024));
          else controller.close();
        },
        cancel,
      });
      const request = new Request(
        "https://admin.example.com/api/workspace/upload",
        {
          method: "POST",
          body: stream,
          duplex: "half",
          headers: {
            "content-type": "multipart/form-data; boundary=upload",
            ...(declaredLength ? { "content-length": declaredLength } : {}),
          },
        } as RequestInit & { duplex: "half" },
      );
      await expect(boundedBytes(request, 96 * 1024)).rejects.toMatchObject({
        status: 413,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(producedChunks).toBeLessThan(10);
    }
  });

  it("preserves binary upload bytes exactly at the accepted boundary", async () => {
    const input = new Uint8Array([0, 255, 128, 1, 254, 13, 10, 0]);
    const request = new Request(
      "https://admin.example.com/api/workspace/upload",
      { method: "POST", headers: { "content-length": "1" }, body: input },
    );
    expect(await boundedBytes(request, input.length)).toEqual(
      Buffer.from(input),
    );
  });

  it("rejects malformed JSON, arrays and null payloads", async () => {
    for (const input of ["bad-json", "[]", "null", "1"]) {
      await expect(
        body(
          new Request("https://admin.example.com/api/test", {
            method: "POST",
            body: input,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(
      await body(
        new Request("https://admin.example.com/api/test", {
          method: "POST",
          body: '{"name":"Menu"}',
        }),
      ),
    ).toEqual({ name: "Menu" });
  });

  it("hashes rate-limit identities and fails closed when the database denies a request", async () => {
    const privateKey = "login:owner@example.com";
    await rateLimit(privateKey, 10, 300);
    expect(fixtures.service.rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({
        p_key: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_limit: 10,
        p_window_seconds: 300,
      }),
    );
    expect(JSON.stringify(fixtures.service.rpc.mock.calls)).not.toContain(
      privateKey,
    );
    fixtures.state.rpcAllowed = false;
    await expect(rateLimit(privateKey)).rejects.toMatchObject({ status: 429 });
  });

  it("returns safe errors and no-store responses without leaking database secrets", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "service-role-secret-that-must-not-leak";
    const internal = await route(async () => {
      throw new Error(secret);
    });
    expect(internal.status).toBe(500);
    expect(internal.headers.get("cache-control")).toBe("private, no-store");
    expect(await internal.text()).not.toContain(secret);
    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    logger.mockRestore();
    const invalid = await route(async () => {
      z.object({ amount: z.number().nonnegative() }).parse({ amount: -1 });
      return new Response();
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      fields: [{ field: "amount" }],
    });
    expect(() => dbError({ code: "42501", message: secret })).toThrow(
      "No tienes permiso",
    );
    expect(() => dbError({ code: "23505", message: secret })).toThrow(
      "ya existe",
    );
  });
});
