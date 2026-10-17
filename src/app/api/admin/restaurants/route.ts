import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { superadmin, audit } from "@/lib/access";
import {
  route,
  json,
  body,
  mutationOrigin,
  dbError,
  rateLimit,
  ApiError,
} from "@/lib/api";
import { restaurantInput, uuid, safeContact } from "@/lib/validation";
import { appUrl } from "@/lib/config";
export async function GET(request: Request) {
  return route(async () => {
    const { db } = await superadmin();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const status = url.searchParams.get("status");
    let query = db
      .from("restaurants")
      .select(
        "*,commercial_sales(*),restaurant_domains(hostname,status),restaurant_settings(appearance),products(count)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);
    if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
    if (status === "active" || status === "suspended")
      query = query.eq("status", status);
    const [list, stats, platform] = await Promise.all([
      query,
      db.rpc("admin_stats"),
      db.from("platform_settings").select("*").limit(1).maybeSingle(),
    ]);
    for (const r of [list, stats, platform]) dbError(r.error);
    return json({
      restaurants: list.data?.map((r) => ({
        ...r,
        sale_date: r.commercial_sales?.sold_at?.slice(0, 10),
        sale_amount: r.commercial_sales?.amount,
        sale_notes: r.commercial_sales?.notes,
        product_count: r.products?.[0]?.count || 0,
        logo_path: r.restaurant_settings?.appearance?.logo_path,
      })),
      total: list.count,
      page,
      configured: true,
      platform: platform.data,
      stats: { ...stats.data, qr: stats.data.qr_generated },
    });
  });
}
export async function POST(request: Request) {
  return route(async () => {
    mutationOrigin(request);
    const { db, user } = await superadmin();
    await rateLimit(`admin:${user.id}`, 40, 60);
    const input = await body(request);
    const action = z.string().parse(input.action);
    const raw = z.record(z.string(), z.unknown()).parse(input.data || {});
    if (action === "platform") {
      const contact_label = z
        .string()
        .max(100)
        .parse(raw.contact_label || "Menú digital por Tolentino");
      let contact_url: string | null = null;
      try {
        if (raw.contact_url) contact_url = safeContact(String(raw.contact_url));
      } catch {
        throw new ApiError(
          400,
          "El contacto comercial debe ser un enlace HTTPS válido.",
        );
      }
      const suspension_message = z
        .string()
        .trim()
        .min(1)
        .max(500)
        .parse(
          raw.suspension_message ||
            "Este menú no está disponible temporalmente.",
        );
      const existing = await db
        .from("platform_settings")
        .select("id")
        .limit(1)
        .single();
      dbError(existing.error);
      const saved = await db
        .from("platform_settings")
        .update({ contact_url, contact_label, suspension_message })
        .eq("id", existing.data!.id);
      dbError(saved.error);
      await audit(user.id, "platform_updated");
      return json({ ok: true });
    }
    if (action === "create") {
      const data = restaurantInput.parse({
        ...raw,
        sold_at: raw.sale_date || raw.sold_at || null,
        amount: raw.sale_amount ?? raw.amount ?? 0,
        notes: raw.sale_notes ?? raw.notes ?? "",
      });
      const { data: auth, error } = await db.auth.admin.createUser({
        email: data.owner_email,
        password: randomBytes(48).toString("base64url"),
        email_confirm: true,
      });
      if (error || !auth.user)
        throw new ApiError(
          409,
          "No se pudo crear el acceso. Comprueba que el correo no pertenezca a otra cuenta.",
        );
      const id = randomUUID();
      const created = await db.rpc("provision_restaurant", {
        p_id: id,
        p_owner_id: auth.user.id,
        p_name: data.name,
        p_slug: data.slug,
        p_owner_name: data.owner_name,
        p_owner_email: data.owner_email,
        p_phone: data.phone,
        p_currency: data.currency,
        p_default_language: data.default_language,
        p_sale_amount: data.amount ?? 0,
        p_sale_currency: data.sale_currency,
        p_sale_notes: data.notes,
        p_description: data.description,
        p_status: data.status,
        p_sold_at: data.sold_at
          ? `${data.sold_at}T12:00:00Z`
          : new Date().toISOString(),
      });
      if (created.error) {
        const cleanup = await db.auth.admin.deleteUser(auth.user.id);
        if (cleanup.error) {
          await audit(user.id, "provision_compensation_failed", undefined, {
            orphan_user_id: auth.user.id,
          });
        }
        dbError(created.error);
      }
      await audit(user.id, "restaurant_created", id);
      const invite = await db.auth.resetPasswordForEmail(data.owner_email, {
        redirectTo: `${appUrl()}/auth/callback`,
      });
      return json(
        {
          ok: true,
          restaurantId: id,
          invitationSent: !invite.error,
          message: invite.error
            ? "Restaurante creado. El correo de activación no se envió; usa Restablecer acceso para reintentarlo."
            : "Restaurante creado. El propietario recibirá un enlace para definir su contraseña.",
        },
        201,
      );
    }
    const id = uuid.parse(input.restaurantId);
    const existing = await db
      .from("restaurants")
      .select("*")
      .eq("id", id)
      .single();
    dbError(existing.error);
    if (!existing.data) throw new ApiError(404, "Restaurante no encontrado.");
    if (action === "update") {
      const data = restaurantInput.parse({
        ...existing.data,
        ...raw,
        sold_at: raw.sale_date || raw.sold_at || null,
        amount: raw.sale_amount ?? raw.amount ?? 0,
        notes: raw.sale_notes ?? raw.notes ?? "",
      });
      if (data.owner_email !== existing.data.owner_email)
        throw new ApiError(
          400,
          "El correo de acceso no se cambia desde los datos comerciales. Usa el procedimiento seguro de recuperación de cuenta.",
        );
      const {
        sold_at,
        amount,
        sale_currency,
        notes,
        owner_email: _email,
        ...restaurant
      } = data;
      const salePatch: Record<string, unknown> = {};
      if (sold_at) salePatch.sold_at = `${sold_at}T12:00:00Z`;
      if (raw.sale_amount !== undefined || raw.amount !== undefined)
        salePatch.amount = amount ?? 0;
      if (raw.sale_currency !== undefined) salePatch.currency = sale_currency;
      if (raw.sale_notes !== undefined || raw.notes !== undefined)
        salePatch.notes = notes;
      const saved = await db.rpc("update_restaurant", {
        p_id: id,
        p_data: restaurant,
        p_sale: Object.keys(salePatch).length ? salePatch : null,
      });
      dbError(saved.error);
    } else if (action === "status") {
      const status = z.enum(["active", "suspended"]).parse(raw.status);
      const r = await db.from("restaurants").update({ status }).eq("id", id);
      dbError(r.error);
    } else if (action === "owner_status") {
      const is_active = z.boolean().parse(raw.is_active);
      const r = await db
        .from("restaurant_memberships")
        .update({ is_active })
        .eq("restaurant_id", id);
      dbError(r.error);
    } else if (action === "reset_access") {
      await rateLimit(`reset:${id}`, 3, 900);
      const r = await db.auth.resetPasswordForEmail(existing.data.owner_email, {
        redirectTo: `${appUrl()}/auth/callback`,
      });
      if (r.error)
        throw new ApiError(
          502,
          "No se pudo enviar el correo. Revisa la configuración de correo de Supabase.",
        );
    } else if (action === "duplicate") {
      // Copy only appearance configuration into an existing, explicitly selected restaurant.
      const targetId = uuid.parse(raw.targetRestaurantId);
      if (targetId === id) throw new ApiError(400, "Elige otro restaurante.");
      const source = await db
        .from("restaurant_settings")
        .select("appearance,enabled_languages")
        .eq("restaurant_id", id)
        .single();
      dbError(source.error);
      const appearance = {
        ...source.data!.appearance,
        logo_path: null,
        cover_path: null,
        favicon_path: null,
      };
      const r = await db
        .from("restaurant_settings")
        .update({ draft_appearance: appearance })
        .eq("restaurant_id", targetId)
        .select("restaurant_id")
        .single();
      dbError(r.error);
    } else throw new ApiError(400, "Acción no disponible.");
    await audit(user.id, action, id);
    return json({ ok: true });
  });
}
