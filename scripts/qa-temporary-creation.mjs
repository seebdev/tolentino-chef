import { randomUUID } from "node:crypto";
import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve, basename } from "node:path";
import {
  BACKUP_DIR,
  protectBackupDirectory,
  safeLocalPath,
  loadBackupKey,
  encryptArchive,
  decryptArchive,
  digest,
} from "./backup-common.mjs";
import {
  projectRef,
  runId,
  targetConfig,
  requireDemoMutations,
} from "./audit-target.mjs";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireState = (ok, code) => {
  if (!ok) throw Error("QA_CREATION_" + code);
};
const sortedIds = (rows) => rows.map((x) => x.id).sort();
const equal = (a, b) => digest(a) === digest(b);
const sameOwner = (actual, expected) =>
  actual?.id === expected.id &&
  actual.email?.toLowerCase() === expected.email?.toLowerCase() &&
  actual.app_metadata?.creation_request_id ===
    expected.app_metadata?.creation_request_id &&
  actual.app_metadata?.creation_actor_id ===
    expected.app_metadata?.creation_actor_id &&
  actual.app_metadata?.demo === true;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * A fresh task-owned DEMO only. Dependencies are injected for local regression tests.
 * Every mutation requires a durable checkpoint. Unknown in-flight creations are
 * retained for reconciliation instead of racing an active provider worker.
 */
export async function exerciseTemporaryCreation({
  request,
  store,
  checkpoint,
  actorId,
  originalIds,
  wait = sleep,
  newId = randomUUID,
}) {
  requireState(uuid.test(actorId), "ACTOR_INVALID");
  requireState(
    originalIds.length === 3 &&
      new Set(originalIds).size === 3 &&
      originalIds.every((id) => uuid.test(id)),
    "ORIGINALS_INVALID",
  );
  const originals = await store.restaurants();
  requireState(
    equal(sortedIds(originals), [...originalIds].sort()) &&
      originals.every((r) => r.is_demo === true),
    "BASELINE_RESTAURANTS",
  );
  const beforeUsers = await store.users();
  const baselineUserIds = sortedIds(beforeUsers);
  requireState(
    beforeUsers.some((u) => u.id === actorId),
    "ACTOR_NOT_IN_BASELINE",
  );
  const nonce = newId();
  requireState(uuid.test(nonce), "NONCE_INVALID");
  const data = {
    name: "QA temporal de idempotencia DEMO",
    slug: "qa-idempotency-" + nonce,
    owner_name: "QA temporal DEMO",
    owner_email: "qa-" + nonce + "@tolentino-demo.test",
    description: "Recurso temporal de esta ejecucion; sin correo.",
    demo: true,
  };
  const attempts = [
    { purpose: "create", requestId: newId(), data },
    {
      purpose: "email-conflict",
      requestId: newId(),
      data: { ...data, slug: "qa-email-" + nonce },
    },
    {
      purpose: "slug-conflict",
      requestId: newId(),
      data: {
        ...data,
        owner_email: "qa-slug-" + nonce + "@tolentino-demo.test",
      },
    },
  ];
  requireState(
    attempts.every((a) => uuid.test(a.requestId)) &&
      new Set(attempts.map((a) => a.requestId)).size === 3,
    "REQUEST_IDS_INVALID",
  );
  requireState(
    !originals.some((r) => attempts.some((a) => r.slug === a.data.slug)) &&
      !beforeUsers.some((u) =>
        attempts.some((a) => u.email?.toLowerCase() === a.data.owner_email),
      ),
    "IDENTITY_ALREADY_EXISTS",
  );
  const journal = {
    format: "tolentino-qa-temporary-creation-v1",
    projectRef,
    runId,
    actorId,
    createdAt: new Date().toISOString(),
    baselineRestaurantIds: sortedIds(originals),
    baselineUserIds,
    baselineRestaurantHash: digest(originals),
    attempts,
    phase: "prepared",
  };
  const save = async (phase) => {
    journal.phase = phase;
    journal.updatedAt = new Date().toISOString();
    await checkpoint(journal);
  };
  await save("prepared");

  const call = (attempt, body = attempt.data) =>
    request({
      action: "create",
      requestId: attempt.requestId,
      data: body,
    });
  async function settle(attempt) {
    attempt.sent = true;
    await save("before-" + attempt.purpose);
    for (let retry = 0; retry < 8; retry++) {
      let response;
      try {
        response = await call(attempt);
      } catch {
        /* No raw transport/provider errors in evidence. */
      }
      if (response && [201, 400, 409].includes(response.status)) {
        attempt.terminalStatus = response.status;
        attempt.responseRestaurantId = response.data?.restaurantId ?? null;
        attempt.responseCode = [
          "OWNER_EMAIL_EXISTS",
          "SLUG_TAKEN",
          "IDEMPOTENCY_KEY_REUSED",
        ].includes(response.data?.code)
          ? response.data.code
          : null;
        await save("settled-" + attempt.purpose);
        return response;
      }
      if (retry < 7) await wait(20_000); // Exceeds the two-minute lease without a long single sleep.
    }
    throw Error("QA_CREATION_TERMINAL_STATE_UNCONFIRMED");
  }

  let result;
  let primaryFailure;
  try {
    const created = await settle(attempts[0]);
    requireState(
      created.status === 201 &&
        uuid.test(created.data?.restaurantId) &&
        !originalIds.includes(created.data.restaurantId) &&
        created.data.demo === true &&
        created.data.invitationSent === false,
      "CREATE_RESULT",
    );
    const temporaryId = created.data.restaurantId;
    // Wait for both requests even if one transport rejects, before entering cleanup.
    await save("before-concurrent-replay");
    const both = await Promise.allSettled([
      call(attempts[0]),
      call(attempts[0]),
    ]);
    requireState(
      both.every(
        (r) =>
          r.status === "fulfilled" &&
          r.value.status === 201 &&
          r.value.data.restaurantId === temporaryId &&
          r.value.data.replayed === true &&
          r.value.data.invitationSent === false,
      ),
      "CONCURRENT_REPLAY",
    );
    await save("before-payload-mismatch");
    const mismatch = await call(attempts[0], {
      ...data,
      name: "Otro payload DEMO",
    });
    requireState(
      mismatch.status === 409 &&
        mismatch.data.code === "IDEMPOTENCY_KEY_REUSED",
      "PAYLOAD_MISMATCH",
    );
    const beforeConflicts = sortedIds(await store.users());
    const emailConflict = await settle(attempts[1]);
    requireState(
      emailConflict.status === 409 &&
        emailConflict.data.code === "OWNER_EMAIL_EXISTS",
      "EMAIL_CONFLICT",
    );
    const slugConflict = await settle(attempts[2]);
    requireState(
      slugConflict.status === 409 && slugConflict.data.code === "SLUG_TAKEN",
      "SLUG_CONFLICT",
    );
    requireState(
      equal(sortedIds(await store.users()), beforeConflicts),
      "CONFLICT_ORPHANS",
    );
    result = {
      freshDemoCreated: true,
      replayedRequests: 2,
      emailConflict: 409,
      slugConflict: 409,
      noInvitation: true,
      retainedRequestAudit: true,
    };
  } catch (error) {
    primaryFailure = error.message?.startsWith("QA_CREATION_")
      ? error
      : Error("QA_CREATION_SCENARIO_FAILED");
  } finally {
    try {
      // A timed-out/202 worker may still commit. Do not race it with deletion.
      requireState(
        attempts.filter((a) => a.sent).every((a) => a.terminalStatus),
        "CLEANUP_REQUIRES_TERMINAL_STATE",
      );
      const current = await store.restaurants();
      requireState(
        equal(
          current.filter((r) => originalIds.includes(r.id)),
          originals,
        ),
        "ORIGINALS_CHANGED",
      );
      const users = await store.users();
      const cleanup = [];
      for (const attempt of attempts.filter((a) => a.sent)) {
        const exact = users.filter(
          (u) =>
            u.app_metadata?.creation_request_id === attempt.requestId &&
            u.app_metadata?.creation_actor_id === actorId,
        );
        requireState(exact.length <= 1, "AMBIGUOUS_AUTH");
        const owner = exact[0];
        if (owner)
          requireState(
            !baselineUserIds.includes(owner.id) &&
              uuid.test(owner.id) &&
              owner.email?.toLowerCase() === attempt.data.owner_email &&
              owner.app_metadata?.demo === true,
            "AUTH_OWNERSHIP",
          );
        const candidates = current.filter(
          (r) =>
            r.slug === attempt.data.slug &&
            r.owner_email?.toLowerCase() === attempt.data.owner_email,
        );
        requireState(candidates.length <= 1, "AMBIGUOUS_RESTAURANT");
        const restaurant = candidates[0];
        if (restaurant) {
          requireState(
            owner &&
              !originalIds.includes(restaurant.id) &&
              restaurant.is_demo === true &&
              uuid.test(restaurant.id) &&
              (!attempt.responseRestaurantId ||
                attempt.responseRestaurantId === restaurant.id),
            "RESTAURANT_OWNERSHIP",
          );
          const members = await store.memberships(restaurant.id);
          requireState(
            members.length === 1 &&
              members[0].user_id === owner.id &&
              members[0].restaurant_id === restaurant.id,
            "MEMBERSHIP_OWNERSHIP",
          );
          requireState(
            equal(await store.membershipsForUser(owner.id), members),
            "OTHER_MEMBERSHIPS",
          );
        }
        if (owner) {
          if (!restaurant)
            requireState(
              (await store.membershipsForUser(owner.id)).length === 0,
              "ORPHAN_HAS_MEMBERSHIP",
            );
          attempt.ownerId = owner.id;
          attempt.restaurantId = restaurant?.id ?? null;
          cleanup.push({ attempt, owner, restaurant });
        } else requireState(!restaurant, "RESTAURANT_WITHOUT_OWNED_AUTH");
      }
      // The only extra restaurants must be the exact verified resources from this run.
      requireState(
        current.every(
          (r) =>
            originalIds.includes(r.id) ||
            cleanup.some((c) => c.restaurant?.id === r.id),
        ),
        "UNEXPECTED_RESTAURANT",
      );
      await save("cleanup-verified");
      for (const { attempt, owner, restaurant } of cleanup) {
        // Revalidate immediately before deletion. No email suffix or wildcard deletes.
        requireState(
          sameOwner(await store.user(owner.id), owner),
          "AUTH_CHANGED_BEFORE_DELETE",
        );
        if (restaurant) {
          requireState(
            equal(await store.restaurant(restaurant.id), restaurant),
            "RESTAURANT_CHANGED_BEFORE_DELETE",
          );
          const sales = await store.sales(restaurant.id);
          requireState(
            sales.every(
              (sale) =>
                uuid.test(sale.id) && sale.restaurant_id === restaurant.id,
            ),
            "SALE_OWNERSHIP",
          );
          attempt.saleIds = sales.map((sale) => sale.id);
          await save("before-delete-sales");
          for (const sale of sales)
            await store.deleteSale(sale.id, restaurant.id);
          await save("before-delete-restaurant");
          await store.deleteRestaurant(restaurant);
          requireState(
            (await store.restaurant(restaurant.id)) === null,
            "RESTAURANT_DELETE_UNCONFIRMED",
          );
        }
        requireState(
          (await store.membershipsForUser(owner.id)).length === 0,
          "AUTH_STILL_ASSIGNED",
        );
        requireState(
          sameOwner(await store.user(owner.id), owner),
          "AUTH_CHANGED_BEFORE_DELETE",
        );
        await save("before-delete-auth");
        await store.deleteUser(owner.id);
        requireState(
          (await store.user(owner.id)) === null,
          "AUTH_DELETE_UNCONFIRMED",
        );
      }
      requireState(
        equal(await store.restaurants(), originals),
        "FINAL_ORIGINALS_CHANGED",
      );
      requireState(
        equal(sortedIds(await store.users()), baselineUserIds),
        "FINAL_AUTH_CHANGED",
      );
      await save("cleaned");
      if (result)
        Object.assign(result, {
          restaurantCount: 3,
          orphanAccounts: 0,
          cleanupVerified: true,
        });
    } catch {
      await save("cleanup-pending").catch(() => {});
      throw Error("QA_CREATION_CLEANUP_PENDING_REVIEW_PRIVATE_JOURNAL");
    }
  }
  if (primaryFailure) throw primaryFailure;
  return result;
}

function checked(response, code) {
  requireState(!response.error, code);
  return response.data;
}
export function creationAuditStore(service) {
  const all = async (table, columns, configure = (q) => q) => {
    const rows = [];
    for (let start = 0; ; start += 200) {
      const page = checked(
        await configure(service.from(table).select(columns))
          .order("id")
          .range(start, start + 199),
        "READ_" + table.toUpperCase(),
      );
      requireState(Array.isArray(page), "READ_ROWS");
      rows.push(...page);
      requireState(rows.length <= 100_000, "ROW_LIMIT");
      if (page.length < 200) return rows;
    }
  };
  const users = async () => {
    const result = [];
    for (let page = 1; ; page++) {
      const batch = checked(
        await service.auth.admin.listUsers({ page, perPage: 200 }),
        "AUTH_LIST",
      );
      requireState(Array.isArray(batch?.users), "AUTH_LIST_SHAPE");
      result.push(...batch.users);
      requireState(result.length <= 100_000, "AUTH_LIST_LIMIT");
      if (batch.users.length < 200) {
        requireState(
          new Set(result.map((u) => u.id)).size === result.length,
          "AUTH_LIST_DUPLICATES",
        );
        return result;
      }
    }
  };
  const memberColumns = "restaurant_id,user_id,is_active";
  const memberships = async (field, id) =>
    checked(
      await service
        .from("restaurant_memberships")
        .select(memberColumns)
        .eq(field, id)
        .order("restaurant_id"),
      "MEMBERSHIPS",
    );
  return {
    restaurants: () => all("restaurants", "*"),
    restaurant: async (id) =>
      checked(
        await service
          .from("restaurants")
          .select("*")
          .eq("id", id)
          .maybeSingle(),
        "RESTAURANT_READ",
      ),
    users,
    user: async (id) => {
      const result = await service.auth.admin.getUserById(id);
      if (
        result.error?.status === 404 ||
        result.error?.code === "user_not_found"
      )
        return null;
      return checked(result, "AUTH_READ").user;
    },
    memberships: (id) => memberships("restaurant_id", id),
    membershipsForUser: (id) => memberships("user_id", id),
    sales: (id) =>
      all("commercial_sales", "id,restaurant_id", (q) =>
        q.eq("restaurant_id", id),
      ),
    deleteSale: async (id, restaurantId) => {
      const rows = checked(
        await service
          .from("commercial_sales")
          .delete()
          .eq("id", id)
          .eq("restaurant_id", restaurantId)
          .select("id"),
        "SALE_DELETE",
      );
      requireState(rows.length === 1 && rows[0].id === id, "SALE_DELETE_COUNT");
    },
    deleteRestaurant: async (r) => {
      const rows = checked(
        await service
          .from("restaurants")
          .delete()
          .eq("id", r.id)
          .eq("slug", r.slug)
          .eq("owner_email", r.owner_email)
          .eq("is_demo", true)
          .select("id"),
        "RESTAURANT_DELETE",
      );
      requireState(
        rows.length === 1 && rows[0].id === r.id,
        "RESTAURANT_DELETE_COUNT",
      );
    },
    deleteUser: async (id) => {
      checked(await service.auth.admin.deleteUser(id), "AUTH_DELETE");
    },
  };
}

export function assertPreviousCreationJournals(states) {
  for (const state of states) {
    requireState(
      state?.format === "tolentino-qa-temporary-creation-v1" &&
        state.projectRef === projectRef,
      "PRIOR_JOURNAL_INVALID",
    );
    requireState(state.phase === "cleaned", "PRIOR_JOURNAL_PENDING");
  }
}

export async function runTemporaryCreationAudit({
  service,
  admin,
  actorId,
  originalIds,
}) {
  targetConfig(process.env, { service: true });
  requireDemoMutations();
  protectBackupDirectory();
  const { key, mode } = loadBackupKey(false);
  const journalFile = safeLocalPath(
    resolve(
      BACKUP_DIR,
      "qa-creation-" + projectRef + "-" + runId + "-" + randomUUID() + ".enc",
    ),
  );
  let initialized = false;
  const checkpoint = async (state) => {
    const bytes = encryptArchive(state, key, mode);
    requireState(equal(decryptArchive(bytes, key), state), "JOURNAL_VERIFY");
    const destination = safeLocalPath(
      initialized ? journalFile + ".next" : journalFile,
    );
    requireState(!existsSync(destination), "JOURNAL_ALREADY_EXISTS");
    const fd = openSync(destination, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (initialized) renameSync(destination, journalFile);
    initialized = true;
  };
  try {
    const priorNames = readdirSync(BACKUP_DIR).filter(
      (name) =>
        name.startsWith("qa-creation-" + projectRef + "-") &&
        (name.endsWith(".enc") || name.endsWith(".enc.next")),
    );
    requireState(
      !priorNames.some((name) => name.endsWith(".next")),
      "PRIOR_JOURNAL_PENDING",
    );
    assertPreviousCreationJournals(
      priorNames.map((name) =>
        decryptArchive(
          readFileSync(safeLocalPath(resolve(BACKUP_DIR, name))),
          key,
        ),
      ),
    );
    return {
      ...(await exerciseTemporaryCreation({
        request: (data) =>
          admin.request("/api/admin/restaurants", {
            method: "POST",
            data,
            expected: [201, 202, 400, 409, 429, 500, 502, 503, 504],
          }),
        store: creationAuditStore(service),
        checkpoint,
        actorId,
        originalIds,
      })),
      privateJournal: basename(journalFile),
    };
  } catch (error) {
    const message = error.message?.startsWith("QA_CREATION_")
      ? error.message
      : "QA_CREATION_FAILED";
    throw Error(message + " (" + basename(journalFile) + ")");
  } finally {
    key.fill(0);
  }
}
