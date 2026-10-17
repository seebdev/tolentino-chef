import { context } from "@/lib/access";
import { serviceDb } from "@/lib/supabase";
import { publishedMenu } from "@/lib/public-menu";
import { route, dbError, ApiError } from "@/lib/api";
import { uuid, mediaPath } from "@/lib/validation";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string; path: string[] }> },
) {
  return route(async () => {
    const { restaurantId, path: parts } = await params;
    uuid.parse(restaurantId);
    const path =
      parts[0] === restaurantId
        ? parts.join("/")
        : `${restaurantId}/${parts.join("/")}`;
    mediaPath.parse(path);
    if (!path.startsWith(`${restaurantId}/`))
      throw new ApiError(404, "Imagen no disponible.");
    const db = serviceDb();
    const restaurant = await db
      .from("restaurants")
      .select("slug,status")
      .eq("id", restaurantId)
      .maybeSingle();
    dbError(restaurant.error);
    if (!restaurant.data) throw new ApiError(404, "Imagen no disponible.");
    let isPublic = false;
    if (restaurant.data.status === "active") {
      const menu = await publishedMenu(restaurant.data.slug);
      if (!("suspended" in menu)) {
        const appearance = menu.settings?.appearance || {};
        isPublic =
          [
            appearance.logo_path,
            appearance.cover_path,
            appearance.favicon_path,
          ].includes(path) || menu.products.some((p) => p.image_path === path);
      }
    }
    if (!isPublic) await context(restaurantId);
    const download = await db.storage.from("restaurant-media").download(path);
    if (download.error || !download.data)
      throw new ApiError(404, "Imagen no disponible.");
    return new Response(await download.data.arrayBuffer(), {
      headers: {
        "Content-Type": download.data.type || "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
