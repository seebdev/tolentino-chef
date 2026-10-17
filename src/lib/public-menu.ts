import "server-only";
import { unstable_cache } from "next/cache";
import { serviceDb } from "./supabase";
import { ApiError, dbError } from "./api";
import { slug as slugSchema } from "./validation";
export async function publishedMenu(slug: string) {
  slugSchema.parse(slug);
  const db = serviceDb();
  const found = await db
    .from("restaurants")
    .select(
      "id,name,slug,description,phone,currency,default_language,status,menu_version",
    )
    .eq("slug", slug)
    .maybeSingle();
  dbError(found.error);
  if (!found.data) throw new ApiError(404, "No se encontró este menú.");
  const restaurant = found.data;
  // Status is deliberately read on every request, outside the menu cache.
  if (restaurant.status !== "active") {
    const s = await db
      .from("platform_settings")
      .select("suspension_message")
      .limit(1)
      .maybeSingle();
    dbError(s.error);
    return {
      suspended: true as const,
      name: restaurant.name,
      message:
        s.data?.suspension_message ||
        "Este menú no está disponible temporalmente.",
    };
  }
  const content = await unstable_cache(
    async () => {
      const database = serviceDb();
      const all = async (table: string, columns: string) => {
        const rows: Record<string, unknown>[] = [];
        for (let offset = 0; ; offset += 1000) {
          const r = await database
            .from(table)
            .select(columns)
            .eq("restaurant_id", restaurant.id)
            .order("id")
            .range(offset, offset + 999);
          dbError(r.error);
          const batch = r.data as unknown as Record<string, unknown>[];
          rows.push(...batch);
          if (batch.length < 1000) break;
        }
        return rows;
      };
      const [settings, categories, products, promotions, hours, translations] =
        await Promise.all([
          database
            .from("restaurant_settings")
            .select("appearance,enabled_languages")
            .eq("restaurant_id", restaurant.id)
            .single(),
          all("categories", "id,parent_id,name,sort_order,is_visible"),
          all(
            "products",
            "id,category_id,name,description,price,image_path,tags,ingredients,variants,extras,is_published,is_available,is_featured,sort_order",
          ),
          all("promotions", "id,title,description,starts_at,ends_at,is_active"),
          database
            .from("restaurant_hours")
            .select("day_of_week,opens_at,closes_at,is_closed")
            .eq("restaurant_id", restaurant.id)
            .order("day_of_week"),
          all("translations", "id,entity_type,entity_id,language,fields"),
        ]);
      dbError(settings.error);
      dbError(hours.error);
      const visible = (id: unknown, seen = new Set()): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        const c = categories.find((x) => x.id === id);
        return Boolean(
          c && c.is_visible && (!c.parent_id || visible(c.parent_id, seen)),
        );
      };
      const publicCategories = categories
        .filter((x) => visible(x.id))
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      const ids = new Set(publicCategories.map((x) => x.id));
      const publicProducts = products
        .filter((x) => x.is_published && ids.has(x.category_id))
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      const productIds = new Set(publicProducts.map((x) => x.id));
      return {
        settings: settings.data,
        categories: publicCategories,
        products: publicProducts,
        promotions,
        hours: hours.data,
        translations: translations.filter((x) =>
          x.entity_type === "product"
            ? productIds.has(x.entity_id)
            : ids.has(x.entity_id),
        ),
      };
    },
    ["public-menu", restaurant.id, String(restaurant.menu_version)],
    { revalidate: 300 },
  )();
  const platform = await db
    .from("platform_settings")
    .select("contact_url,contact_label")
    .limit(1)
    .maybeSingle();
  dbError(platform.error);
  const now = Date.now();
  return {
    restaurant,
    ...content,
    promotions: content.promotions.filter(
      (p) =>
        p.is_active &&
        (!p.starts_at || Date.parse(String(p.starts_at)) <= now) &&
        (!p.ends_at || Date.parse(String(p.ends_at)) >= now),
    ),
    contact: platform.data?.contact_url
      ? { url: platform.data.contact_url, label: platform.data.contact_label }
      : null,
  };
}
