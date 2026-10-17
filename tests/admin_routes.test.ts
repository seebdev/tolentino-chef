import { beforeEach, describe, expect, it, vi } from "vitest";

// Real handler/parser/error mapping; only Auth/database and the separately-tested
// superadmin boundary are mocked. SQL state transitions run in database.test.ts.
const fixture = vi.hoisted(() => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const existingOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const newOwner = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const lease = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const original = { id: tenant, name: "Original Restaurant", slug: "original-restaurant",
    owner_name: "Existing Owner", owner_email: "owner@example.com", phone: "+571234567",
    description: "Existing description", currency: "COP", default_language: "es",
    status: "active", created_at: "2026-10-01T12:00:00Z", is_demo: false };
  type Failure = { code?: string; status?: number; message?: string };
  type AuthUser = { id: string; email?: string; app_metadata?: Record<string, unknown> };
  type Attempt = { hash: string; state: string; response?: Record<string, unknown>; http_status?: number };
  const state = {
    authFailure: null as Failure | null,
    provisionFailure: null as Failure | null,
    cleanupFailure: false, emailFailure: false, networkAfterCommit: false, authNetworkAfterCreate: false,
    holdAuth: false, releaseAuth: null as (() => void) | null,
    existingError: null as Failure | null,
    users: new Map<string, AuthUser>([[admin, { id: admin }], [existingOwner, { id: existingOwner }]]),
    provisioned: new Set<string>(), existing: { ...original },
    attempts: new Map<string, Attempt>(),
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === "consume_rate_limit") return { data: true, error: null };
    const key = String(args.p_request_id);
    if (name === "claim_restaurant_creation") {
      const current = state.attempts.get(key);
      if (current && current.hash !== args.p_request_hash) return { data: { state: "mismatch" }, error: null };
      if (current && ["completed", "failed"].includes(current.state)) return { data: current, error: null };
      if (current && ["processing", "cleanup"].includes(current.state)) return { data: { state: "pending" }, error: null };
      const attempt = current || { hash: String(args.p_request_hash), state: "processing" };
      if (attempt.state === "retry") attempt.state = "processing";
      if (attempt.state === "cleanup_retry") attempt.state = "cleanup";
      state.attempts.set(key, attempt);
      return { data: { ...attempt, owner_id: newOwner, restaurant_id: tenant, lease_token: lease }, error: null };
    }
    const attempt = state.attempts.get(key);
    if (name === "complete_restaurant_creation") {
      if (state.provisionFailure) return { data: null, error: state.provisionFailure };
      if (!attempt) throw Error("No claim");
      state.provisioned.add(tenant);
      attempt.state = "completed";
      attempt.http_status = 201;
      const input = args.p_data as Record<string, unknown>;
      attempt.response = { ok: true, restaurantId: tenant, invitationSent: false,
        demo: input.demo, message: "Created; invitation unconfirmed." };
      if (state.networkAfterCommit) return { data: null, error: { code: "PGRST000", message: "Lost response" } };
      return { data: { committed: true, response: attempt.response }, error: null };
    }
    if (name === "settle_restaurant_creation") {
      if (!attempt) throw Error("No claim");
      if (attempt.state === "completed") {
        if (args.p_outcome === "invited") attempt.response = { ...attempt.response, invitationSent: true };
      } else if (args.p_outcome === "retry" && attempt.state === "processing") attempt.state = "retry";
      else if (["cleanup", "failed"].includes(String(args.p_outcome))) {
        attempt.state = String(args.p_outcome);
        attempt.response = args.p_response as Record<string, unknown>;
        attempt.http_status = Number(args.p_http_status);
      }
      return { data: { ...attempt }, error: null };
    }
    if (name === "update_restaurant") return { data: args.p_id, error: null };
    throw new Error("Unexpected RPC: " + name);
  });
  const getUserById = vi.fn(async (id: string) => {
    const user = state.users.get(id);
    return { data: { user: user || null }, error: user ? null : { code: "user_not_found", status: 404 } };
  });
  const createUser = vi.fn(async (input: { id: string; email: string; password: string;
    email_confirm: boolean; app_metadata: Record<string, unknown> }) => {
    if (state.holdAuth) await new Promise<void>((resolve) => { state.releaseAuth = resolve; });
    if (state.authFailure) return { data: { user: null }, error: state.authFailure };
    const user = { id: input.id, email: input.email, app_metadata: input.app_metadata };
    state.users.set(input.id, user);
    if (state.authNetworkAfterCreate) return { data: { user: null }, error: { code: "request_timeout", status: 503 } };
    return { data: { user }, error: null };
  });
  const deleteUser = vi.fn(async (id: string) => {
    if (state.cleanupFailure) return { data: null, error: { code: "unexpected_failure", status: 503 } };
    state.users.delete(id);
    return { data: null, error: null };
  });
  const resetPasswordForEmail = vi.fn(async (_email: string, _options: { redirectTo: string }) => ({
    data: {}, error: state.emailFailure ? { message: "SMTP unavailable", code: "email_address_not_authorized" } : null,
  }));
  const filters = vi.fn();
  const from = vi.fn((table: string) => {
    if (table !== "restaurants") throw new Error("Unexpected table write or query: " + table);
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters(column, value); return query; }),
      single: vi.fn(async () => ({ data: state.existingError ? null : { ...state.existing }, error: state.existingError })),
    };
    return query;
  });
  const db = { rpc, from, auth: { admin: { createUser, deleteUser, getUserById }, resetPasswordForEmail } };
  const audit = vi.fn(async (_user: string, _action: string, _tenant?: string, _metadata?: Record<string, unknown>) => {});
  const superadmin = vi.fn(async () => ({ db, user: { id: admin }, role: "superadmin" as const }));
  return { tenant, admin, existingOwner, newOwner, requestId, original, state, db, rpc,
    createUser, getUserById, deleteUser, resetPasswordForEmail, filters, from, audit, superadmin };
});
vi.mock("@/lib/access", () => ({ superadmin: fixture.superadmin, audit: fixture.audit }));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixture.db }));
vi.mock("@/lib/config", () => ({ configured: () => true, appUrl: () => "https://admin.example.test" }));
import { POST } from "../src/app/api/admin/restaurants/route";
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixture.state, { authFailure: null, provisionFailure: null, cleanupFailure: false,
    emailFailure: false, networkAfterCommit: false, authNetworkAfterCreate: false, existingError: null, holdAuth: false, releaseAuth: null });
  fixture.state.users = new Map([[fixture.admin, { id: fixture.admin }], [fixture.existingOwner, { id: fixture.existingOwner }]]);
  fixture.state.provisioned = new Set();
  fixture.state.attempts = new Map();
  fixture.state.existing = { ...fixture.original };
});
function request(action: string, data: Record<string, unknown>, restaurantId?: string, requestId: unknown = fixture.requestId) {
  return POST(new Request("https://admin.example.test/api/admin/restaurants", {
    method: "POST", headers: { origin: "https://admin.example.test", "content-type": "application/json" },
    body: JSON.stringify({ action, data, requestId, ...(restaurantId ? { restaurantId } : {}) }),
  }));
}
function createInput() {
  return { name: "New Restaurant", slug: "new-restaurant", owner_name: "New Owner",
    owner_email: "new-owner@example.com", currency: "COP", default_language: "es",
    sale_date: "2026-10-15", sale_amount: 75000, sale_currency: "COP", sale_notes: "Initial payment" };
}
function businessCall(name: string) {
  const call = fixture.rpc.mock.calls.find(([method]) => method === name);
  expect(call, "The expected business RPC was not called").toBeDefined();
  return call![1]!;
}
describe("admin creation, idempotency and commercial-data regressions", () => {
  it("updates metadata without protected email or an unintended sale overwrite", async () => {
    expect((await request("update", { name: "Renamed Restaurant" }, fixture.tenant)).status).toBe(200);
    expect(businessCall("update_restaurant")).toMatchObject({ p_id: fixture.tenant,
      p_data: { name: "Renamed Restaurant", owner_name: "Existing Owner", currency: "COP" }, p_sale: null });
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty("owner_email");
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty("id");
    expect(fixture.filters).toHaveBeenCalledWith("id", fixture.tenant);
    expect(fixture.createUser).not.toHaveBeenCalled();
  });
  it("maps partial sale aliases while preserving absent fields", async () => {
    expect((await request("update", { sale_amount: 98000, sale_date: "2026-10-16" }, fixture.tenant)).status).toBe(200);
    expect(businessCall("update_restaurant").p_sale).toEqual({ amount: 98000, sold_at: "2026-10-16T12:00:00Z" });
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty("sale_amount");
  });
  it("rejects email reassignment and malformed sales before writing", async () => {
    for (const input of [{ owner_email: "attacker@example.com" }, { sale_date: "bad" }, { sale_amount: -1 }])
      expect((await request("update", input, fixture.tenant)).status).toBe(400);
    expect(fixture.rpc.mock.calls.some(([name]) => name === "update_restaurant")).toBe(false);
  });
  it("returns a clear 404 when the requested restaurant does not exist", async () => {
    fixture.state.existingError = { code: "PGRST116" };
    expect((await request("update", { name: "Missing" }, fixture.tenant)).status).toBe(404);
  });
  it("requires an attempt UUID before creating Auth accounts", async () => {
    expect((await request("create", createInput(), undefined, null)).status).toBe(400);
    expect(fixture.createUser).not.toHaveBeenCalled();
  });
  it("maps validated aliases and replays the successful request without another Auth user or email", async () => {
    const first = await request("create", createInput());
    expect(first.status).toBe(201);
    const payload = await first.json();
    expect(businessCall("complete_restaurant_creation").p_data).toMatchObject({
      amount: 75000, notes: "Initial payment", sold_at: "2026-10-15T12:00:00Z", demo: false });
    const replay = await request("create", createInput());
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ ...payload, replayed: true });
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(fixture.state.provisioned.size).toBe(1);
  });
  it("allows only one creation while a concurrent second submit receives pending", async () => {
    fixture.state.holdAuth = true;
    const first = request("create", createInput());
    await vi.waitFor(() => expect(fixture.state.releaseAuth).not.toBeNull());
    const second = await request("create", createInput());
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ pending: true, code: "REQUEST_IN_PROGRESS" });
    fixture.state.releaseAuth!();
    expect((await first).status).toBe(201);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
    expect(fixture.state.provisioned.size).toBe(1);
  });
  it("rejects reusing an attempt key with changed data without creating another account", async () => {
    await request("create", createInput());
    const response = await request("create", { ...createInput(), slug: "other-slug" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
  });
  it("maps a genuine email conflict to 409 and never deletes the pre-existing account", async () => {
    fixture.state.authFailure = { code: "email_exists", status: 422 };
    const response = await request("create", createInput());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OWNER_EMAIL_EXISTS", fields: [{ field: "owner_email" }] });
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.state.users.size).toBe(2);
    expect(fixture.state.provisioned.size).toBe(0);
  });
  it.each([
    [{ code: "unexpected_failure", status: 500 }, 503, "AUTH_UNAVAILABLE"],
    [{ code: "not_admin", status: 403 }, 503, "AUTH_UNAVAILABLE"],
    [{ code: "over_request_rate_limit", status: 429 }, 429, "AUTH_RATE_LIMITED"],
    [{ code: "email_address_invalid", status: 422 }, 400, "OWNER_EMAIL_INVALID"],
    [{ message: "some unclassified internal error" }, 503, "AUTH_UNAVAILABLE"],
  ])("does not mislabel Auth failure %j as a conflict", async (error, status, code) => {
    fixture.state.authFailure = error;
    const response = await request("create", createInput());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });
  it("compensates only the reserved newly-created user after a true SQL slug conflict", async () => {
    fixture.state.provisionFailure = { code: "23505", message: 'duplicate constraint "restaurants_slug_key"' };
    const response = await request("create", createInput());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SLUG_TAKEN", fields: [{ field: "slug" }] });
    expect(fixture.deleteUser).toHaveBeenCalledExactlyOnceWith(fixture.newOwner);
    expect([...fixture.state.users.keys()]).toEqual([fixture.admin, fixture.existingOwner]);
    expect(fixture.state.provisioned.size).toBe(0);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("recovers an Auth account created before its response was lost", async () => {
    fixture.state.authNetworkAfterCreate = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(201);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
    expect(fixture.state.users.has(fixture.newOwner)).toBe(true);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });
  it("never adopts or deletes a pre-existing Auth user without the server-owned attempt marker", async () => {
    fixture.state.users.set(fixture.newOwner, { id: fixture.newOwner, email: createInput().owner_email, app_metadata: {} });
    expect((await request("create", createInput())).status).toBe(503);
    expect(fixture.createUser).not.toHaveBeenCalled();
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.state.provisioned.size).toBe(0);
  });
  it("recovers a committed SQL result after a lost response without deleting the owner", async () => {
    fixture.state.networkAfterCommit = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ restaurantId: fixture.tenant, replayed: true });
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.state.users.has(fixture.newOwner)).toBe(true);
  });
  it("resumes a transient SQL failure using the same Auth account and IDs", async () => {
    fixture.state.provisionFailure = { code: "PGRST000" };
    expect((await request("create", createInput())).status).toBe(503);
    fixture.state.provisionFailure = null;
    expect((await request("create", createInput())).status).toBe(201);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });
  it("records and resumes a failed cleanup, leaving all unrelated accounts untouched", async () => {
    fixture.state.provisionFailure = { code: "23514" };
    fixture.state.cleanupFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CREATION_CLEANUP_PENDING" });
    expect(fixture.audit).toHaveBeenCalledWith(fixture.admin, "provision_compensation_failed",
      undefined, { orphan_user_id: fixture.newOwner, request_id: fixture.requestId });
    fixture.state.cleanupFailure = false;
    fixture.state.attempts.get(fixture.requestId)!.state = "cleanup_retry";
    expect((await request("create", createInput())).status).toBe(400);
    expect(fixture.state.users.has(fixture.newOwner)).toBe(false);
    expect(fixture.state.users.has(fixture.existingOwner)).toBe(true);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
  });
  it("keeps successful creation when invitation fails and never sends again on replay", async () => {
    fixture.state.emailFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, invitationSent: false });
    expect(fixture.state.provisioned.has(payload.restaurantId)).toBe(true);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("SMTP");
    expect(JSON.stringify(payload)).not.toContain(fixture.createUser.mock.calls[0]![0].password);
    expect((await request("create", createInput())).status).toBe(201);
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });
  it("creates DEMO .test accounts silently and rejects real email addresses in DEMO mode", async () => {
    expect((await request("create", { ...createInput(), demo: true })).status).toBe(400);
    expect(fixture.createUser).not.toHaveBeenCalled();
    const response = await request("create", { ...createInput(), demo: true, owner_email: "aurora@tolentino.test" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ demo: true, invitationSent: false });
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("prevents later access-reset emails for DEMO accounts", async () => {
    fixture.state.existing.is_demo = true;
    expect((await request("reset_access", {}, fixture.tenant)).status).toBe(400);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
