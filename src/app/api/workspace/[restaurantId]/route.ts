import { z } from "zod";
import { randomUUID } from "node:crypto";
import { context, audit, sensitive } from "@/lib/access";
import {
  route,
  json,
  body,
  mutationOrigin,
  dbError,
  ApiError,
} from "@/lib/api";
import {
  productInput,
  categoryInput,
  appearanceInput,
  promotionInput,
  language,
  uuid,
  color,
  assertMediaTenant,
  safeHostname,
} from "@/lib/validation";
import { dnsInstructions, verifyDomain, registerDomain } from "@/lib/domains";
import { platformHosts } from "@/lib/config";
import { allRows } from "@/lib/queries";
type Params = { params: Promise<{ restaurantId: string }> };
export async function GET(request: Request, { params }: Params) {
  return route(async () => {
    const { restaurantId } = await params;
    const c = await context(restaurantId);
    const { db, restaurant } = c;
    const url = new URL(request.url);
    const page = Math.max(
      1,
      Math.min(100000, Number(url.searchParams.get("page")) || 1),
    );
    const q = (url.searchParams.get("q") || "").slice(0, 100);
    const category = url.searchParams.get("category");
    let products = db
      .from("products")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId)
      .order("sort_order")
      .order("id")
      .range((page - 1) * 25, page * 25 - 1);
    if (q) products = products.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
    if (category && uuid.safeParse(category).success)
      products = products.eq("category_id", category);
    const results = await Promise.all([
      db
        .from("restaurant_settings")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .single(),
      allRows(db, "categories", restaurantId),
      products,
      allRows(db, "promotions", restaurantId),
      db
        .from("restaurant_hours")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("day_of_week"),
      allRows(db, "translations", restaurantId),
      db
        .from("restaurant_qr_configs")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .single(),
      db
        .from("restaurant_domains")
        .select("*")
        .eq("restaurant_id", restaurantId),
      db
        .from("restaurant_memberships")
        .select("user_id,is_active")
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
      c.role === "superadmin"
        ? db
            .from("commercial_sales")
            .select("*")
            .eq("restaurant_id", restaurantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.rpc("restaurant_stats", { p_restaurant_id: restaurantId }),
    ]);
    for (const r of results) dbError(r.error);
    const [
      settings,
      categories,
      list,
      promotions,
      hours,
      translations,
      qr,
      domains,
      membership,
      sale,
      stats,
    ] = results;
    categories.data.sort(
      (a, b) =>
        Number(a.sort_order) - Number(b.sort_order) ||
        String(a.id).localeCompare(String(b.id)),
    );
    if (c.role === "superadmin")
      await audit(c.user.id, "support_opened", restaurantId);
    return json({
      restaurant,
      settings: settings.data,
      categories: categories.data,
      products: list.data,
      promotions: promotions.data,
      hours: hours.data,
      translations: translations.data,
      qr: qr.data,
      domains: (domains.data || []).map((d) => ({
        ...d,
        dns_instructions: dnsInstructions(d.hostname, d.verification_token),
      })),
      membership: membership.data,
      sale: sale.data
        ? { ...sale.data, sale_date: sale.data.sold_at?.slice(0, 10) }
        : null,
      role: c.role,
      total: "count" in list ? list.count : 0,
      page,
      stats: stats.data,
    });
  });
}
export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    mutationOrigin(request);
    const { restaurantId } = await params;
    const c = await context(restaurantId);
    const { db } = c;
    await sensitive(c.user.id, "workspace");
    const input = await body(request);
    const action = z.string().parse(input.action);
    const data = z.record(z.string(), z.unknown()).parse(input.data || {});
    const save = async (table: string, value: Record<string, unknown>) => {
      const { id, ...fields } = value;
      const q = id
        ? db
            .from(table)
            .update(fields)
            .eq("restaurant_id", restaurantId)
            .eq("id", String(id))
        : db.from(table).insert({ ...fields, restaurant_id: restaurantId });
      const result = await q.select("*").single();
      dbError(result.error);
      if (!result.data) throw new ApiError(404, "El elemento ya no existe.");
      return result.data;
    };
    const remove = async (table: string, id: unknown) => {
      const result = await db
        .from(table)
        .delete()
        .eq("restaurant_id", restaurantId)
        .eq("id", uuid.parse(id))
        .select("id")
        .single();
      dbError(result.error);
      if (!result.data) throw new ApiError(404, "El elemento ya no existe.");
    };
    let result: unknown = { ok: true };
    if (action === "save_product") {
      const value = productInput.parse({
        ...data,
        image_path: data.image_path || null,
        sku: data.sku || null,
      });
      assertMediaTenant(value.image_path, restaurantId);
      result = await save("products", value);
    } else if (action === "delete_product") {
      await remove("products", data.id);
    } else if (action === "duplicate_product") {
      const found = await db
        .from("products")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("id", uuid.parse(data.id))
        .single();
      dbError(found.error);
      const copy = productInput.parse({
        ...found.data,
        id: undefined,
        sku: null,
        name: `${found.data!.name} (copia)`.slice(0, 160),
        is_published: false,
      });
      result = await save("products", copy);
    } else if (action === "save_category") {
      result = await save(
        "categories",
        categoryInput.parse({ ...data, parent_id: data.parent_id || null }),
      );
    } else if (action === "delete_category") {
      await remove("categories", data.id);
    } else if (action === "save_promotion") {
      const normalize = (x: unknown) => {
        if (!x) return null;
        const date = new Date(String(x));
        if (!Number.isFinite(date.getTime()))
          throw new ApiError(400, "Revisa las fechas de la promoción.");
        return date.toISOString();
      };
      result = await save(
        "promotions",
        promotionInput.parse({
          ...data,
          starts_at: normalize(data.starts_at),
          ends_at: normalize(data.ends_at),
        }),
      );
    } else if (action === "delete_promotion") {
      await remove("promotions", data.id);
    } else if (action === "save_appearance") {
      const appearance = appearanceInput.parse(
        Object.fromEntries(
          Object.entries(
            (data.appearance || data) as Record<string, unknown>,
          ).map(([k, v]) => [k, k.endsWith("_path") && !v ? null : v]),
        ),
      );
      for (const path of [
        appearance.logo_path,
        appearance.cover_path,
        appearance.favicon_path,
      ])
        assertMediaTenant(path, restaurantId);
      const r = await db
        .from("restaurant_settings")
        .update({ draft_appearance: appearance })
        .eq("restaurant_id", restaurantId);
      dbError(r.error);
      if (data.name || data.description !== undefined) {
        const info = z
          .object({
            name: z.string().min(2).max(100),
            description: z.string().max(1200),
          })
          .parse({
            name: data.name || c.restaurant.name,
            description: data.description ?? c.restaurant.description,
          });
        dbError(
          (await db.from("restaurants").update(info).eq("id", restaurantId))
            .error,
        );
      }
    } else if (action === "publish_appearance") {
      const settings = await db
        .from("restaurant_settings")
        .select("draft_appearance")
        .eq("restaurant_id", restaurantId)
        .single();
      dbError(settings.error);
      const r = await db
        .from("restaurant_settings")
        .update({ appearance: settings.data!.draft_appearance })
        .eq("restaurant_id", restaurantId);
      dbError(r.error);
    } else if (action === "save_hours") {
      const time = z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
        .nullable();
      const hours = z
        .array(
          z
            .object({
              day_of_week: z.number().int().min(0).max(6),
              opens_at: time,
              closes_at: time,
              is_closed: z.boolean(),
            })
            .refine(
              (h) =>
                h.is_closed ||
                Boolean(
                  h.opens_at && h.closes_at && h.opens_at !== h.closes_at,
                ),
              "Indica las horas de apertura y cierre.",
            ),
        )
        .length(7)
        .refine((a) => new Set(a.map((h) => h.day_of_week)).size === 7)
        .parse(data.hours);
      dbError(
        (
          await db.from("restaurant_hours").upsert(
            hours.map((h) => ({ ...h, restaurant_id: restaurantId })),
            { onConflict: "restaurant_id,day_of_week" },
          )
        ).error,
      );
    } else if (action === "save_languages") {
      const value = z
        .object({
          default_language: language,
          enabled_languages: z.array(language).min(1).max(7),
        })
        .refine((x) => x.enabled_languages.includes(x.default_language))
        .parse(data);
      dbError(
        (
          await db.rpc("save_restaurant_languages", {
            p_restaurant_id: restaurantId,
            p_default_language: value.default_language,
            p_enabled_languages: [...new Set(value.enabled_languages)],
          })
        ).error,
      );
    } else if (action === "save_translation") {
      const value = z
        .object({
          entity_type: z.enum(["product", "category"]),
          entity_id: uuid,
          language,
          fields: z.object({
            name: z.string().max(160).optional(),
            description: z.string().max(3000).optional(),
          }),
        })
        .parse(data);
      dbError(
        (
          await db
            .from("translations")
            .upsert(
              { ...value, restaurant_id: restaurantId },
              { onConflict: "restaurant_id,entity_type,entity_id,language" },
            )
        ).error,
      );
    } else if (
      [
        "save_qr",
        "save_domain",
        "verify_domain",
        "register_domain",
        "delete_domain",
      ].includes(action)
    ) {
      if (c.role !== "superadmin")
        throw new ApiError(
          403,
          "Solo Tolentino puede cambiar el QR o el dominio.",
        );
      if (action === "save_qr") {
        const value = z
          .object({
            foreground: color,
            background: color,
            frame: z.enum(["none", "simple", "rounded"]),
            label: z.string().max(80),
            include_logo: z.boolean(),
          })
          .parse(data);
        const { validateQrColors } = await import("@/lib/qr");
        try {
          validateQrColors(value.foreground, value.background);
        } catch {
          throw new ApiError(
            400,
            "Usa un color oscuro sobre fondo claro, con suficiente contraste para escanear el QR.",
          );
        }
        dbError(
          (
            await db
              .from("restaurant_qr_configs")
              .update(value)
              .eq("restaurant_id", restaurantId)
          ).error,
        );
      }
      if (action === "save_domain") {
        let hostname: string;
        try {
          hostname = safeHostname(String(data.hostname));
        } catch {
          throw new ApiError(
            400,
            "Escribe un dominio público válido, sin rutas ni https.",
          );
        }
        if (platformHosts().has(hostname))
          throw new ApiError(400, "Este es un dominio reservado de Tolentino.");
        result = await save("restaurant_domains", {
          hostname,
          verification_token: randomUUID(),
          status: "pending",
        });
      }
      if (action === "delete_domain") {
        await remove("restaurant_domains", data.id);
      }
      if (action === "register_domain") {
        const domain = await db
          .from("restaurant_domains")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("id", uuid.parse(data.id))
          .single();
        dbError(domain.error);
        result = await registerDomain(
          domain.data!.hostname,
          domain.data!.verification_token,
        );
      }
      if (action === "verify_domain") {
        const domain = await db
          .from("restaurant_domains")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("id", uuid.parse(data.id))
          .single();
        dbError(domain.error);
        try {
          await verifyDomain(
            domain.data!.hostname,
            domain.data!.verification_token,
          );
          dbError(
            (
              await db
                .from("restaurant_domains")
                .update({
                  status: "verified",
                  verified_at: new Date().toISOString(),
                })
                .eq("id", domain.data!.id)
            ).error,
          );
        } catch (error) {
          await db
            .from("restaurant_domains")
            .update({ status: "failed", verified_at: null })
            .eq("id", domain.data!.id);
          throw error;
        }
      }
    } else throw new ApiError(400, "Acción no disponible.");
    if (c.role === "superadmin")
      await audit(c.user.id, `support_${action}`, restaurantId);
    return json({ ok: true, data: result });
  });
}
