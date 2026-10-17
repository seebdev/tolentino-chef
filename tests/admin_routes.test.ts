import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real request parser, validation schemas, error mapping and handler.
// Only Auth/database boundaries and the already-tested superadmin lookup are mocked.
const fixture = vi.hoisted(() => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const existingOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const newOwner = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const original = {
    id: tenant,
    name: "Original Restaurant",
    slug: "original-restaurant",
    owner_name: "Existing Owner",
    owner_email: "owner@example.test",
    phone: "+571234567",
    description: "Existing description",
    currency: "COP",
    default_language: "es",
    status: "active",
    created_at: "2026-10-01T12:00:00Z",
  };
  const state = {
    authFailure: false,
    provisionFailure: false,
    cleanupFailure: false,
    emailFailure: false,
    users: new Set([admin, existingOwner]),
    provisioned: new Set<string>(),
    existing: { ...original },
  };
  const rpc = vi.fn(
    async (name: string, args: Record<string, unknown> = {}) => {
      if (name === "consume_rate_limit") return { data: true, error: null };
      if (name === "provision_restaurant") {
        if (state.provisionFailure)
          return {
            data: null,
            error: { code: "23505", message: "slug conflict" },
          };
        state.provisioned.add(String(args.p_id));
        return { data: args.p_id, error: null };
      }
      if (name === "update_restaurant") return { data: args.p_id, error: null };
      throw new Error("Unexpected RPC: " + name);
    },
  );
  const createUser = vi.fn(
    async (input: {
      email: string;
      password: string;
      email_confirm: boolean;
    }) => {
      if (state.authFailure)
        return {
          data: { user: null },
          error: { message: "email already registered" },
        };
      state.users.add(newOwner);
      return {
        data: { user: { id: newOwner, email: input.email } },
        error: null,
      };
    },
  );
  const deleteUser = vi.fn(async (id: string) => {
    if (state.cleanupFailure)
      return { data: null, error: { message: "cleanup unavailable" } };
    state.users.delete(id);
    return { data: null, error: null };
  });
  const resetPasswordForEmail = vi.fn(
    async (_email: string, _options: { redirectTo: string }) => ({
      data: {},
      error: state.emailFailure ? { message: "SMTP unavailable" } : null,
    }),
  );
  const filters = vi.fn();
  const from = vi.fn((table: string) => {
    if (table !== "restaurants")
      throw new Error("Unexpected table write or query: " + table);
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => {
        filters(column, value);
        return query;
      }),
      single: vi.fn(async () => ({ data: { ...state.existing }, error: null })),
    };
    return query;
  });
  const db = {
    rpc,
    from,
    auth: { admin: { createUser, deleteUser }, resetPasswordForEmail },
  };
  const audit = vi.fn(
    async (
      _user: string,
      _action: string,
      _tenant?: string,
      _metadata?: Record<string, unknown>,
    ) => {},
  );
  const superadmin = vi.fn(async () => ({
    db,
    user: { id: admin },
    role: "superadmin" as const,
  }));
  return {
    tenant,
    admin,
    existingOwner,
    newOwner,
    original,
    state,
    db,
    rpc,
    createUser,
    deleteUser,
    resetPasswordForEmail,
    filters,
    from,
    audit,
    superadmin,
  };
});

vi.mock("@/lib/access", () => ({
  superadmin: fixture.superadmin,
  audit: fixture.audit,
}));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixture.db }));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.test",
}));

import { POST } from "../src/app/api/admin/restaurants/route";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixture.state, {
    authFailure: false,
    provisionFailure: false,
    cleanupFailure: false,
    emailFailure: false,
  });
  fixture.state.users = new Set([fixture.admin, fixture.existingOwner]);
  fixture.state.provisioned = new Set();
  fixture.state.existing = { ...fixture.original };
});

function request(
  action: string,
  data: Record<string, unknown>,
  restaurantId?: string,
) {
  return POST(
    new Request("https://admin.example.test/api/admin/restaurants", {
      method: "POST",
      headers: {
        origin: "https://admin.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action,
        data,
        ...(restaurantId ? { restaurantId } : {}),
      }),
    }),
  );
}
function createInput() {
  return {
    name: "New Restaurant",
    slug: "new-restaurant",
    owner_name: "New Owner",
    owner_email: "new-owner@example.test",
    currency: "COP",
    default_language: "es",
    sale_date: "2026-10-15",
    sale_amount: 75000,
    sale_currency: "COP",
    sale_notes: "Initial payment",
  };
}
function businessCall(name: string) {
  const call = fixture.rpc.mock.calls.find(([method]) => method === name);
  expect(call, "The expected business RPC was not called").toBeDefined();
  return call![1]!;
}

describe("admin handler provisioning and commercial-data regressions", () => {
  it("updates restaurant metadata without forwarding protected email or overwriting the existing sale", async () => {
    const response = await request(
      "update",
      { name: "Renamed Restaurant" },
      fixture.tenant,
    );
    expect(response.status).toBe(200);
    expect(businessCall("update_restaurant")).toMatchObject({
      p_id: fixture.tenant,
      p_data: {
        name: "Renamed Restaurant",
        owner_name: "Existing Owner",
        currency: "COP",
      },
      p_sale: null,
    });
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty(
      "owner_email",
    );
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty("id");
    expect(fixture.filters).toHaveBeenCalledWith("id", fixture.tenant);
    expect(fixture.createUser).not.toHaveBeenCalled();
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });

  it("maps sale aliases into one atomic RPC while preserving fields absent from a partial sale edit", async () => {
    const response = await request(
      "update",
      { sale_amount: 98000, sale_date: "2026-10-16" },
      fixture.tenant,
    );
    expect(response.status).toBe(200);
    expect(businessCall("update_restaurant").p_sale).toEqual({
      amount: 98000,
      sold_at: "2026-10-16T12:00:00Z",
    });
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty(
      "sale_amount",
    );
    expect(businessCall("update_restaurant").p_data).not.toHaveProperty(
      "owner_email",
    );
  });

  it("rejects an email reassignment and malformed commercial data before the write RPC", async () => {
    const reassignment = await request(
      "update",
      { owner_email: "attacker@example.test" },
      fixture.tenant,
    );
    expect(reassignment.status).toBe(400);
    const invalidDate = await request(
      "update",
      { sale_date: "not-a-date" },
      fixture.tenant,
    );
    expect(invalidDate.status).toBe(400);
    const negative = await request(
      "update",
      { sale_amount: -1 },
      fixture.tenant,
    );
    expect(negative.status).toBe(400);
    expect(
      fixture.rpc.mock.calls.some(([name]) => name === "update_restaurant"),
    ).toBe(false);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });

  it("compensates only the newly created Auth user when atomic SQL provisioning fails", async () => {
    fixture.state.provisionFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(409);
    const provision = businessCall("provision_restaurant");
    expect(provision).toMatchObject({
      p_owner_id: fixture.newOwner,
      p_name: "New Restaurant",
      p_owner_email: "new-owner@example.test",
      p_sale_amount: 75000,
      p_sale_currency: "COP",
      p_sale_notes: "Initial payment",
      p_sold_at: "2026-10-15T12:00:00Z",
    });
    expect(fixture.deleteUser).toHaveBeenCalledExactlyOnceWith(
      fixture.newOwner,
    );
    expect(fixture.state.users).toEqual(
      new Set([fixture.admin, fixture.existingOwner]),
    );
    expect(fixture.state.provisioned.size).toBe(0);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalled();
    expect(
      fixture.audit.mock.calls.some(
        ([, action]) => action === "restaurant_created",
      ),
    ).toBe(false);
  });

  it("never deletes an existing account when Auth rejects creation", async () => {
    fixture.state.authFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(409);
    expect(
      fixture.rpc.mock.calls.some(([name]) => name === "provision_restaurant"),
    ).toBe(false);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(fixture.state.users).toEqual(
      new Set([fixture.admin, fixture.existingOwner]),
    );
  });

  it("keeps the created restaurant and account when invitation delivery fails", async () => {
    fixture.state.emailFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, invitationSent: false });
    expect(payload.restaurantId).toBe(
      businessCall("provision_restaurant").p_id,
    );
    expect(fixture.state.provisioned.has(payload.restaurantId)).toBe(true);
    expect(fixture.state.users.has(fixture.newOwner)).toBe(true);
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.audit).toHaveBeenCalledWith(
      fixture.admin,
      "restaurant_created",
      payload.restaurantId,
    );
    expect(fixture.resetPasswordForEmail).toHaveBeenCalledWith(
      "new-owner@example.test",
      { redirectTo: "https://admin.example.test/auth/callback" },
    );
    expect(JSON.stringify(payload)).not.toContain("SMTP");
    expect(JSON.stringify(payload)).not.toContain(
      fixture.createUser.mock.calls[0][0].password,
    );
  });

  it("records a failed compensation for reconciliation without deleting any other Auth user", async () => {
    fixture.state.provisionFailure = true;
    fixture.state.cleanupFailure = true;
    const response = await request("create", createInput());
    expect(response.status).toBe(409);
    expect(fixture.deleteUser).toHaveBeenCalledExactlyOnceWith(
      fixture.newOwner,
    );
    expect(fixture.audit).toHaveBeenCalledWith(
      fixture.admin,
      "provision_compensation_failed",
      undefined,
      { orphan_user_id: fixture.newOwner },
    );
    expect(fixture.state.users.has(fixture.existingOwner)).toBe(true);
    expect(fixture.state.users.has(fixture.admin)).toBe(true);
    expect(fixture.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
