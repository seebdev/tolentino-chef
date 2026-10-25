import { createRestaurant } from "@/lib/create-restaurant";
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
      const creator_brand = z.string().trim().min(1).max(80).parse(raw.creator_brand || "Tolentino Chef");
      const creator_phone = z.string().regex(/^[0-9+() -]{7,24}$/).parse(raw.creator_phone || "3108853158");
      const creator_whatsapp = z.string().regex(/^https:\/\/wa[.]me\/[0-9]{7,15}([?]text=[^\s]*)?$/).max(1000).parse(raw.creator_whatsapp || "https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante");
      const existing = await db
        .from("platform_settings")
        .select("id")
        .limit(1)
        .single();
      dbError(existing.error);
      const saved = await db
        .from("platform_settings")
        .update({ contact_url, contact_label, suspension_message, creator_brand, creator_phone, creator_whatsapp })
        .eq("id", existing.data!.id);
      dbError(saved.error);
      await audit(user.id, "platform_updated");
      return json({ ok: true });
    }
    if (action === "create") return createRestaurant(db, user.id, input.requestId, raw);
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
      if (existing.data.is_demo || /@[^@]+\.test$/i.test(existing.data.owner_email))
        throw new ApiError(400, "Las cuentas DEMO no reciben correos de acceso.", "DEMO_EMAIL_DISABLED");
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
