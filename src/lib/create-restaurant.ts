import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, json } from "./api";
import { restaurantInput, uuid } from "./validation";
import { audit } from "./access";

type Failure = { code?: string; status?: number; message?: string };
type Attempt = {
  state: string;
  restaurant_id: string;
  owner_id: string;
  lease_token: string;
  response?: Record<string, unknown>;
  http_status?: number;
};
const createdResponse = (response: Record<string, unknown> | undefined, replayed = false) => json({
  ...response, ...(replayed ? { replayed: true } : {}),
  ...(response?.invitationSent === false ? { message: "Restaurante creado. Abre Acceso del propietario para entregar una contraseña temporal. No se enviaron correos." } : {}),
}, 201);
const pending = () => json({
  ok: false, pending: true, code: "REQUEST_IN_PROGRESS",
  error: "La creación sigue en proceso. Reintenta con la misma solicitud.",
}, 202);
const unavailable = () => new ApiError(503,
  "No pudimos confirmar la creación. Reintenta con el mismo formulario; la solicitud está guardada.",
  "CREATION_UNAVAILABLE");

export function creationAuthError(error: Failure): ApiError {
  if (["email_exists", "user_already_exists"].includes(error.code || ""))
    return new ApiError(409,
      "Ese correo ya pertenece a una cuenta. Usa otro correo para el propietario.",
      "OWNER_EMAIL_EXISTS", [{ field: "owner_email", message: "El correo ya está registrado." }]);
  if (["email_address_invalid", "validation_failed"].includes(error.code || ""))
    return new ApiError(400, "Auth no acepta el correo indicado. Revisa el correo del propietario.",
      "OWNER_EMAIL_INVALID", [{ field: "owner_email", message: "Revisa el formato y el dominio del correo." }]);
  if (error.status === 429 || error.code === "over_request_rate_limit")
    return new ApiError(429, "El servicio de acceso recibió varios intentos. Espera y reintenta.",
      "AUTH_RATE_LIMITED");
  return new ApiError(503,
    "El servicio de acceso no está disponible. Reintenta con el mismo formulario.",
    "AUTH_UNAVAILABLE");
}
function creationSqlError(error: Failure): ApiError | null {
  if (error.code === "23505") {
    if (error.message?.includes("restaurants_slug_key"))
      return new ApiError(409, "Ese slug ya pertenece a otro restaurante. Elige uno diferente.",
        "SLUG_TAKEN", [{ field: "slug", message: "Este slug ya está en uso." }]);
    if (error.message?.includes("restaurant_memberships_user_id_key"))
      return new ApiError(409, "El propietario ya tiene un restaurante asignado.", "OWNER_ALREADY_ASSIGNED");
    return new ApiError(409, "Un identificador de este restaurante ya existe.", "RESTAURANT_CONFLICT");
  }
  if (["23503", "23514", "22023", "22P02", "P0001"].includes(error.code || ""))
    return new ApiError(400, "Los datos del restaurante no cumplen las reglas. Revisa los campos.",
      "RESTAURANT_INVALID");
  return null;
}
function errorPayload(error: ApiError) {
  return { error: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) };
}
function matchesAttempt(user: User, attempt: Attempt, actorId: string, requestId: string, email: string) {
  return user.id === attempt.owner_id && user.email?.toLowerCase() === email &&
    user.app_metadata?.creation_request_id === requestId &&
    user.app_metadata?.creation_actor_id === actorId;
}
function safeLog(requestId: string, phase: string, error: Failure) {
  console.error(JSON.stringify({ event: "restaurant_create_failed", requestId, phase,
    code: error.code || "unknown", status: error.status || null }));
}

export async function createRestaurant(
  db: SupabaseClient, actorId: string, requestIdInput: unknown, raw: Record<string, unknown>,
) {
  const requestId = uuid.parse(requestIdInput);
  const demo = z.boolean().default(false).parse(raw.demo);
  const data = {
    ...restaurantInput.parse({
      ...raw, owner_email: typeof raw.owner_email === "string" ? raw.owner_email.trim().toLowerCase() : raw.owner_email,
      sold_at: raw.sale_date || raw.sold_at || null,
      amount: raw.sale_amount ?? raw.amount ?? 0,
      notes: raw.sale_notes ?? raw.notes ?? "",
    }), demo,
  };
  if (demo && !/@[^@]+\.test$/i.test(data.owner_email))
    throw new ApiError(400, "Las cuentas DEMO deben usar un correo con dominio .test.",
      "DEMO_EMAIL_REQUIRED", [{ field: "owner_email", message: "Usa un dominio reservado .test." }]);
  // Owner access is delivered manually from its dedicated action; creation never sends mail.

  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const claimArgs = { p_actor_id: actorId, p_request_id: requestId, p_request_hash: hash };
  const claim = await db.rpc("claim_restaurant_creation", claimArgs);
  if (claim.error || !claim.data) {
    safeLog(requestId, "claim", claim.error || {});
    throw unavailable();
  }
  const attempt = claim.data as Attempt;
  if (attempt.state === "mismatch")
    throw new ApiError(409, "Esta solicitud ya se usó con otros datos. Inicia un nuevo intento.",
      "IDEMPOTENCY_KEY_REUSED");
  if (attempt.state === "completed")
    return createdResponse(attempt.response, true);
  if (attempt.state === "failed")
    return json(attempt.response, attempt.http_status || 400);
  if (attempt.state === "pending") return pending();

  const attemptArgs = { p_actor_id: actorId, p_request_id: requestId, p_lease_token: attempt.lease_token };
  async function settle(outcome: string, response?: Record<string, unknown>, status?: number) {
    return db.rpc("settle_restaurant_creation", {
      ...attemptArgs, p_outcome: outcome, p_response: response ?? null, p_http_status: status ?? null,
    });
  }
  async function retry(phase: string, error: Failure): Promise<Response> {
    safeLog(requestId, phase, error);
    // A timed-out RPC may have committed. The locked request row is authoritative.
    const result = await settle("retry");
    if (!result.error && result.data?.state === "completed")
      return createdResponse(result.data.response, true);
    throw unavailable();
  }
  async function finishFailure(error: ApiError) {
    const result = await settle("failed", errorPayload(error), error.status);
    if (result.error) throw unavailable();
    if (result.data?.state === "completed") return createdResponse(result.data.response);
    if (result.data?.state !== "failed") return pending();
    throw error;
  }
  async function compensate(payload: Record<string, unknown>, status: number) {
    // Persist the rollback decision before deleting Auth. A stale worker cannot
    // delete an account after another worker committed the restaurant.
    const marked = await settle("cleanup", payload, status);
    if (marked.error) throw unavailable();
    if (marked.data?.state === "completed") return createdResponse(marked.data.response);
    if (marked.data?.state !== "cleanup") return pending();
    const lookup = await db.auth.admin.getUserById(attempt.owner_id);
    if (lookup.error && lookup.error.code !== "user_not_found" && lookup.error.status !== 404)
      return retry("cleanup_lookup", lookup.error);
    if (lookup.data.user) {
      if (!matchesAttempt(lookup.data.user, attempt, actorId, requestId, data.owner_email))
        throw unavailable();
      const deleted = await db.auth.admin.deleteUser(attempt.owner_id);
      if (deleted.error && deleted.error.code !== "user_not_found" && deleted.error.status !== 404) {
        safeLog(requestId, "compensation", deleted.error);
        try {
          await audit(actorId, "provision_compensation_failed", undefined,
            { orphan_user_id: attempt.owner_id, request_id: requestId });
        } catch { /* The durable cleanup record still allows safe reconciliation. */ }
        throw new ApiError(503,
          "La creación no terminó. La limpieza del acceso está pendiente; reintenta la misma solicitud.",
          "CREATION_CLEANUP_PENDING");
      }
    }
    const finished = await settle("failed", payload, status);
    if (finished.error) throw unavailable();
    return json(payload, status);
  }
  if (attempt.state === "cleanup")
    return compensate(attempt.response || { error: "No se pudo crear el restaurante." }, attempt.http_status || 400);

  // IDs are reserved before Auth. A lost response can be recovered without listing
  // users, adopting a pre-existing email, or creating a second account.
  const lookup = await db.auth.admin.getUserById(attempt.owner_id);
  let owner = lookup.data.user;
  if (lookup.error && lookup.error.code !== "user_not_found" && lookup.error.status !== 404)
    return retry("auth_lookup", lookup.error);
  if (!owner) {
    const created = await db.auth.admin.createUser({
      id: attempt.owner_id, email: data.owner_email,
      password: randomBytes(48).toString("base64url"), email_confirm: true,
      app_metadata: { creation_request_id: requestId, creation_actor_id: actorId, demo },
    });
    owner = created.data.user;
    if (created.error || !owner) {
      // Auth may have committed before a network timeout. Only our reserved ID
      // with our server-owned marker is eligible for recovery.
      const recovered = await db.auth.admin.getUserById(attempt.owner_id);
      if (recovered.data.user) owner = recovered.data.user;
      else {
        const mapped = creationAuthError(created.error || {});
        safeLog(requestId, "auth_create", created.error || {});
        if (mapped.status === 400 || mapped.status === 409) return finishFailure(mapped);
        await settle("retry");
        throw mapped;
      }
    }
  }
  if (!owner || !matchesAttempt(owner, attempt, actorId, requestId, data.owner_email))
    return retry("auth_identity", { code: "reserved_identity_mismatch" });

  const completed = await db.rpc("complete_restaurant_creation", {
    ...attemptArgs,
    p_data: { ...data, sold_at: data.sold_at ? data.sold_at + "T12:00:00Z" : null },
  });
  if (completed.error || !completed.data) {
    const mapped = creationSqlError(completed.error || {});
    if (mapped) return compensate(errorPayload(mapped), mapped.status);
    return retry("provision", completed.error || {});
  }
  const result = completed.data as { committed: boolean; response: Record<string, unknown> };
  if (!result.committed) return createdResponse(result.response, true);
  return createdResponse(result.response);
}
