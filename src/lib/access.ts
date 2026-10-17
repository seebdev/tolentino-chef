import "server-only";
import { z } from "zod";
import { sessionDb, serviceDb } from "./supabase";
import { ApiError, dbError, rateLimit } from "./api";
export async function actor() {
  const db = await sessionDb();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new ApiError(401, "Inicia sesión para continuar.");
  const admin = await db
    .from("platform_admins")
    .select("user_id,is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  dbError(admin.error);
  const membership = await db
    .from("restaurant_memberships")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  dbError(membership.error);
  if (!admin.data && !membership.data)
    throw new ApiError(
      403,
      "Tu cuenta no tiene un restaurante asignado. Contacta con Tolentino.",
    );
  if (!admin.data && !membership.data?.is_active)
    throw new ApiError(
      403,
      "Tu acceso está suspendido. Contacta con Tolentino.",
    );
  return {
    db,
    user,
    role: admin.data ? ("superadmin" as const) : ("owner" as const),
    membership: membership.data,
  };
}
export async function superadmin() {
  const current = await actor();
  if (current.role !== "superadmin")
    throw new ApiError(403, "Esta sección está reservada a Tolentino.");
  return { ...current, db: serviceDb() };
}
export async function context(id: string) {
  z.uuid().parse(id);
  const current = await actor();
  if (current.role === "owner" && current.membership?.restaurant_id !== id)
    throw new ApiError(403, "No tienes acceso a este restaurante.");
  const db = current.role === "superadmin" ? serviceDb() : current.db;
  const result = await db
    .from("restaurants")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  dbError(result.error);
  if (!result.data) throw new ApiError(404, "No se encontró el restaurante.");
  if (current.role === "owner" && result.data.status !== "active")
    throw new ApiError(
      403,
      "El restaurante está suspendido. Contacta con Tolentino.",
    );
  return { ...current, db, restaurant: result.data, restaurantId: id };
}
export async function audit(
  userId: string,
  action: string,
  restaurantId?: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await serviceDb()
    .from("security_audit_events")
    .insert({
      actor_user_id: userId,
      action,
      restaurant_id: restaurantId || null,
      metadata,
    });
  dbError(error);
}
export async function sensitive(userId: string, action: string) {
  await rateLimit(`${action}:${userId}`, 60, 60);
}
