import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  exerciseTemporaryCreation,
  creationAuditStore,
  assertPreviousCreationJournals,
} from "./qa-temporary-creation.mjs";

globalThis.fetch = async () => { throw Error("NETWORK_FORBIDDEN_IN_LOCAL_SELFTEST"); };

const clone = (value) => structuredClone(value);
function fixture(options = {}) {
  const actorId = randomUUID();
  const originalIds = [randomUUID(), randomUUID(), randomUUID()];
  const state = {
    restaurants: originalIds.map((id, i) => ({
      id,
      is_demo: true,
      slug: "original-" + i,
      name: "Original " + i,
      owner_email: "original-" + i + "@fixture.test",
      public_token: randomUUID(),
    })),
    users: [{ id: actorId, email: "admin@fixture.test", app_metadata: {} }],
    members: [],
    sales: [],
    journal: [],
    events: [],
    requests: [],
    waits: [],
  };
  for (const r of state.restaurants) {
    const owner = { id: randomUUID(), email: r.owner_email, app_metadata: {} };
    state.users.push(owner);
    state.members.push({
      restaurant_id: r.id,
      user_id: owner.id,
      is_active: true,
    });
  }
  const originals = clone(state.restaurants);
  const baselineUsers = clone(state.users);
  const records = new Map();
  const owned = () =>
    state.users.find((u) => u.app_metadata.creation_request_id);
  const store = {
    restaurants: async () =>
      clone(state.restaurants.sort((a, b) => a.id.localeCompare(b.id))),
    restaurant: async (id) =>
      clone(state.restaurants.find((r) => r.id === id) || null),
    users: async () => clone(state.users),
    user: async (id) => {
      const user = state.users.find((u) => u.id === id);
      return user ? { ...clone(user), identities: [] } : null;
    },
    memberships: async (id) =>
      clone(state.members.filter((m) => m.restaurant_id === id)),
    membershipsForUser: async (id) =>
      clone(state.members.filter((m) => m.user_id === id)),
    sales: async (id) =>
      clone(state.sales.filter((s) => s.restaurant_id === id)),
    deleteSale: async (id, restaurantId) => {
      state.events.push("delete-sale");
      assert.equal(state.journal.at(-1).phase, "before-delete-sales");
      assert.ok(
        state.journal.at(-1).attempts.some((a) => a.saleIds?.includes(id)),
      );
      if (options.failSale) throw Error("private failure must not be printed");
      const index = state.sales.findIndex(
        (s) => s.id === id && s.restaurant_id === restaurantId,
      );
      assert.notEqual(index, -1);
      state.sales.splice(index, 1);
    },
    deleteRestaurant: async (r) => {
      state.events.push("delete-restaurant");
      assert.equal(state.journal.at(-1).phase, "before-delete-restaurant");
      assert.ok(!originalIds.includes(r.id));
      assert.equal(
        state.sales.filter((s) => s.restaurant_id === r.id).length,
        0,
      );
      state.restaurants = state.restaurants.filter((x) => x.id !== r.id);
      state.members = state.members.filter((m) => m.restaurant_id !== r.id);
    },
    deleteUser: async (id) => {
      state.events.push("delete-user");
      assert.equal(state.journal.at(-1).phase, "before-delete-auth");
      assert.ok(!baselineUsers.some((u) => u.id === id));
      if (options.failAuthDelete)
        throw Error("private failure must not be printed");
      assert.equal(state.members.filter((m) => m.user_id === id).length, 0);
      state.users = state.users.filter((u) => u.id !== id);
    },
  };
  const checkpoint = async (journal) => {
    if (options.failJournal) throw Error("private disk failure");
    state.journal.push(clone(journal));
    state.events.push("journal-" + journal.phase);
  };
  let replayActive = 0,
    replayPeak = 0;
  const request = async (body) => {
    assert.ok(state.journal.at(-1), "checkpoint precedes the first request");
    assert.ok(
      state.journal.at(-1).attempts.some((a) => a.requestId === body.requestId),
    );
    assert.equal(body.data.demo, true);
    assert.match(body.data.owner_email, /@tolentino-demo\.test$/);
    state.requests.push(clone(body));
    const old = records.get(body.requestId);
    if (old) {
      if (JSON.stringify(old.body.data) !== JSON.stringify(body.data))
        return {
          status: 409,
          data: {
            code: options.badMismatch ? "OTHER" : "IDEMPOTENCY_KEY_REUSED",
          },
        };
      if (options.neverTerminal)
        return { status: 202, data: { pending: true } };
      replayActive++;
      replayPeak = Math.max(replayPeak, replayActive);
      await Promise.resolve();
      replayActive--;
      return { status: 201, data: { ...old.response.data, replayed: true } };
    }
    if (options.pendingFirst && state.requests.length <= 2)
      return { status: 202, data: { pending: true } };
    if (state.users.some((u) => u.email === body.data.owner_email))
      return { status: 409, data: { code: "OWNER_EMAIL_EXISTS" } };
    if (state.restaurants.some((r) => r.slug === body.data.slug)) {
      if (options.tamperOwner)
        owned().app_metadata.creation_actor_id = randomUUID();
      return { status: 409, data: { code: "SLUG_TAKEN" } };
    }
    const owner = {
      id: randomUUID(),
      email: body.data.owner_email,
      app_metadata: {
        creation_request_id: body.requestId,
        creation_actor_id: actorId,
        demo: true,
      },
    };
    const restaurant = {
      id: randomUUID(),
      is_demo: true,
      slug: body.data.slug,
      name: body.data.name,
      owner_email: owner.email,
      public_token: randomUUID(),
    };
    state.users.push(owner);
    state.restaurants.push(restaurant);
    state.members.push({
      restaurant_id: restaurant.id,
      user_id: owner.id,
      is_active: true,
    });
    state.sales.push({ id: randomUUID(), restaurant_id: restaurant.id });
    const response = {
      status: 201,
      data: { restaurantId: restaurant.id, demo: true, invitationSent: false },
    };
    records.set(body.requestId, { body: clone(body), response });
    if (options.loseFirstResponse) throw Error("private transport failure");
    if (options.neverTerminal) return { status: 202, data: { pending: true } };
    return clone(response);
  };
  const run = () =>
    exerciseTemporaryCreation({
      request,
      store,
      checkpoint,
      actorId,
      originalIds,
      wait: async (ms) => {
        state.waits.push(ms);
      },
    });
  return {
    state,
    store,
    run,
    originals,
    baselineUsers,
    originalIds,
    owned,
    replayPeak: () => replayPeak,
  };
}

test("fresh DEMO replays concurrently, conflicts are genuine, cleanup preserves the original three and Auth", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.restaurantCount, 3);
  assert.equal(result.noInvitation, true);
  assert.equal(result.retainedRequestAudit, true);
  assert.equal(f.replayPeak(), 2);
  assert.equal(f.state.journal.at(-1).phase, "cleaned");
  assert.deepEqual(
    f.state.events.filter((e) => e.startsWith("delete-")),
    ["delete-sale", "delete-restaurant", "delete-user"],
  );
  assert.deepEqual(
    f.state.restaurants,
    f.originals.sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(f.state.users, f.baselineUsers);
  assert.equal(new Set(f.state.requests.map((r) => r.requestId)).size, 3);
});

test("a lost creation response is retried with the same request ID and cleaned once", async () => {
  const f = fixture({ loseFirstResponse: true });
  await f.run();
  assert.equal(f.state.requests[0].requestId, f.state.requests[1].requestId);
  assert.deepEqual(f.state.requests[0].data, f.state.requests[1].data);
  assert.equal(f.state.events.filter((e) => e === "delete-user").length, 1);
});

test("pending responses reuse the same request until a terminal result", async () => {
  const f = fixture({ pendingFirst: true });
  await f.run();
  assert.equal(f.state.waits.length, 2);
  assert.equal(
    new Set(f.state.requests.slice(0, 3).map((r) => r.requestId)).size,
    1,
  );
});

test("an unconfirmed active worker keeps the journal and forbids cleanup races", async () => {
  const f = fixture({ neverTerminal: true });
  await assert.rejects(
    f.run(),
    /QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL/,
  );
  assert.equal(f.state.requests.length, 8);
  assert.equal(
    f.state.waits.reduce((a, b) => a + b, 0),
    140_000,
  );
  assert.equal(f.state.events.filter((e) => e.startsWith("delete-")).length, 0);
  assert.equal(f.state.journal.at(-1).phase, "cleanup-pending");
  assert.equal(f.state.restaurants.length, 4);
});

test("a failed assertion still cleans the completed temporary restaurant", async () => {
  const f = fixture({ badMismatch: true });
  await assert.rejects(f.run(), /QA_CREATION_PAYLOAD_MISMATCH/);
  assert.equal(f.state.restaurants.length, 3);
  assert.deepEqual(f.state.users, f.baselineUsers);
  assert.equal(f.state.journal.at(-1).phase, "cleaned");
});

test("an Auth marker changed by another actor prevents every delete", async () => {
  const f = fixture({ tamperOwner: true });
  await assert.rejects(
    f.run(),
    /QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL/,
  );
  assert.equal(f.state.events.filter((e) => e.startsWith("delete-")).length, 0);
  assert.equal(f.state.journal.at(-1).phase, "cleanup-pending");
});

test("an additional owner membership prevents deletion of that account or restaurant", async () => {
  const f = fixture();
  const original = f.store.membershipsForUser;
  f.store.membershipsForUser = async (id) => {
    const rows = await original(id);
    return id === f.owned()?.id
      ? [...rows, { restaurant_id: f.originalIds[0], user_id: id }]
      : rows;
  };
  await assert.rejects(
    f.run(),
    /QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL/,
  );
  assert.equal(f.state.events.filter((e) => e.startsWith("delete-")).length, 0);
});

test("failure deleting a restricted sale prevents restaurant and Auth deletion", async () => {
  const f = fixture({ failSale: true });
  await assert.rejects(
    f.run(),
    /QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL/,
  );
  assert.deepEqual(
    f.state.events.filter((e) => e.startsWith("delete-")),
    ["delete-sale"],
  );
  assert.ok(f.state.journal.at(-1).attempts[0].saleIds.length === 1);
});

test("Auth delete failure retains exact recovery identifiers after restaurant cleanup", async () => {
  const f = fixture({ failAuthDelete: true });
  await assert.rejects(
    f.run(),
    /QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL/,
  );
  assert.equal(f.state.restaurants.length, 3);
  assert.ok(f.state.journal.at(-1).attempts[0].ownerId);
  assert.equal(f.state.journal.at(-1).phase, "cleanup-pending");
});

test("a fourth pre-existing restaurant fails before mutation", async () => {
  const f = fixture();
  f.state.restaurants.push({ id: randomUUID(), is_demo: true });
  await assert.rejects(f.run(), /QA_CREATION_BASELINE_RESTAURANTS/);
  assert.equal(f.state.requests.length, 0);
});

test("journal durability failure prevents the first network mutation", async () => {
  const f = fixture({ failJournal: true });
  await assert.rejects(f.run(), /private disk failure/);
  assert.equal(f.state.requests.length, 0);
});

test("Auth pagination reads beyond 200 users without truncating or leaking records", async () => {
  const all = Array.from({ length: 401 }, () => ({ id: randomUUID() }));
  const pages = [];
  const service = {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }) => {
          pages.push(page);
          return {
            data: { users: all.slice((page - 1) * perPage, page * perPage) },
            error: null,
          };
        },
      },
    },
  };
  assert.equal((await creationAuditStore(service).users()).length, 401);
  assert.deepEqual(pages, [1, 2, 3]);
});

test("service deletion predicates require exact sale, tenant and owner identifiers", async () => {
  const calls = [];
  const service = {
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = {
        delete() {
          call.delete = true;
          return query;
        },
        eq(key, value) {
          call.filters.push([key, value]);
          return query;
        },
        select() {
          return Promise.resolve({
            error: null,
            data: [{ id: call.filters.find(([k]) => k === "id")[1] }],
          });
        },
      };
      return query;
    },
    auth: { admin: {} },
  };
  const store = creationAuditStore(service);
  const restaurant = {
    id: randomUUID(),
    slug: "task-owned",
    owner_email: "qa@fixture.test",
  };
  const saleId = randomUUID();
  await store.deleteSale(saleId, restaurant.id);
  await store.deleteRestaurant(restaurant);
  assert.deepEqual(calls[0].filters, [
    ["id", saleId],
    ["restaurant_id", restaurant.id],
  ]);
  assert.deepEqual(calls[1].filters, [
    ["id", restaurant.id],
    ["slug", restaurant.slug],
    ["owner_email", restaurant.owner_email],
    ["is_demo", true],
  ]);
});

test("a prior pending journal prevents treating an orphan account as a fresh baseline", () => {
  assert.throws(
    () =>
      assertPreviousCreationJournals([
        {
          format: "tolentino-qa-temporary-creation-v1",
          projectRef: "hgntppemxwcxaxritnfq",
          phase: "cleanup-pending",
        },
      ]),
    /QA_CREATION_PRIOR_JOURNAL_PENDING/,
  );
  assert.doesNotThrow(() =>
    assertPreviousCreationJournals([
      {
        format: "tolentino-qa-temporary-creation-v1",
        projectRef: "hgntppemxwcxaxritnfq",
        phase: "cleaned",
      },
    ]),
  );
});
test("a journal with another target or format cannot authorize a new audit", () => {
  assert.throws(
    () =>
      assertPreviousCreationJournals([
        {
          format: "tolentino-qa-temporary-creation-v1",
          projectRef: "another-target",
          phase: "cleaned",
        },
      ]),
    /QA_CREATION_PRIOR_JOURNAL_INVALID/,
  );
});
