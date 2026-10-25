import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const context = vi.fn(),
    allRows = vi.fn(),
    rpc = vi.fn();
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: async () => ({ data: [], error: null }),
  };
  return { context, allRows, rpc, db: { rpc, from: vi.fn(() => query) } };
});
vi.mock("@/lib/access", () => ({ context: fixture.context }));
vi.mock("@/lib/queries", () => ({ allRows: fixture.allRows }));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixture.db }));
vi.mock("@/lib/config", () => ({
  appUrl: () => "https://admin.example.test",
  configured: () => true,
}));
import {
  GET,
  POST,
} from "../src/app/api/workspace/[restaurantId]/import/route";
import { ApiError } from "../src/lib/api";
const tenant = "11111111-1111-4111-8111-111111111111",
  owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  attempt = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const params = { params: Promise.resolve({ restaurantId: tenant }) };
const payload = {
  action: "commit",
  csv: "nombre,precio,categoria,sku\nCafé,12,Bebidas,C-1",
  mapping: {},
  mode: "skip",
  createCategories: true,
  attemptId: attempt,
};
const request = (body: unknown) =>
  POST(
    new Request(`https://admin.example.test/api/workspace/${tenant}/import`, {
      method: "POST",
      headers: {
        Origin: "https://admin.example.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    params,
  );
const outcome = {
  found: true,
  attempt_id: attempt,
  status: "completed",
  result: { inserted: 1, updated: 0, skipped: 0, total: 1, rejected: 0 },
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.context.mockResolvedValue({
    restaurantId: tenant,
    user: { id: owner },
    db: fixture.db,
  });
  fixture.allRows.mockResolvedValue({ data: [] });
  fixture.rpc.mockImplementation(async (name: string) => ({
    data: name === "consume_rate_limit" ? true : outcome,
    error: null,
  }));
});
describe("CSV attempt HTTP protocol, mocked authorized database", () => {
  it("rejects commit without UUID before catalog reads or writes", async () => {
    const response = await request({ ...payload, attemptId: undefined });
    expect(response.status).toBe(400);
    expect(fixture.allRows).not.toHaveBeenCalled();
    expect(
      fixture.rpc.mock.calls.some(
        ([name]) => name === "import_products_attempt",
      ),
    ).toBe(false);
  });
  it("allows preview without attempt and makes no import RPC", async () => {
    const response = await request({
      ...payload,
      action: "preview",
      attemptId: undefined,
    });
    expect(response.status).toBe(200);
    expect(
      fixture.rpc.mock.calls.some(
        ([name]) => name === "import_products_attempt",
      ),
    ).toBe(false);
  });
  it("binds commit to server actor, hashes parsed content, and returns database counts", async () => {
    const response = await request({ ...payload, actorUserId: "forged" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "completed",
      attemptId: attempt,
      summary: { created: 1, rejected: 0 },
    });
    const call = fixture.rpc.mock.calls.find(
      ([name]) => name === "import_products_attempt",
    );
    expect(call?.[1]).toMatchObject({
      p_actor_user_id: owner,
      p_attempt_id: attempt,
      p_restaurant_id: tenant,
      p_rows: [{ name: "Café", price: 12 }],
    });
    expect(call?.[1].p_request_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("returns terminal failed attempt counts without claiming success", async () => {
    fixture.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "consume_rate_limit"
          ? true
          : {
              ...outcome,
              status: "failed",
              result: {
                inserted: 0,
                updated: 0,
                skipped: 0,
                total: 1,
                rejected: 1,
              },
            },
      error: null,
    }));
    const response = await GET(
      new Request(
        `https://admin.example.test/api/workspace/${tenant}/import?attempt=${attempt}`,
      ),
      params,
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      found: true,
      status: "failed",
      summary: { created: 0, rejected: 1 },
    });
  });
  it("absence is explicitly unconfirmed, not cancelled", async () => {
    fixture.rpc.mockImplementation(async (name: string) => ({
      data: name === "consume_rate_limit" ? true : { found: false },
      error: null,
    }));
    const response = await GET(
      new Request(
        `https://admin.example.test/api/workspace/${tenant}/import?attempt=${attempt}`,
      ),
      params,
    );
    expect(await response.json()).toMatchObject({
      found: false,
      status: "unconfirmed",
    });
  });
  it("reused UUID with different data becomes conflict", async () => {
    fixture.rpc.mockImplementation(async (name: string) =>
      name === "consume_rate_limit"
        ? { data: true, error: null }
        : { data: null, error: { code: "PT409" } },
    );
    expect((await request(payload)).status).toBe(409);
  });
  it("denies another tenant before attempt lookup", async () => {
    fixture.context.mockRejectedValue(new ApiError(403, "Acceso denegado."));
    expect(
      (
        await GET(
          new Request(
            `https://admin.example.test/api/workspace/${tenant}/import?attempt=${attempt}`,
          ),
          params,
        )
      ).status,
    ).toBe(403);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("invalid CSV never invokes a commit", async () => {
    expect(
      (
        await request({
          ...payload,
          csv: "nombre,precio,categoria\nCafé,-2,Bebidas",
        })
      ).status,
    ).toBe(400);
    expect(
      fixture.rpc.mock.calls.some(
        ([name]) => name === "import_products_attempt",
      ),
    ).toBe(false);
  });
});
