import { publishedMenu } from "@/lib/public-menu";
import { route, json, rateLimit, clientKey } from "@/lib/api";
import { serviceDb } from "@/lib/supabase";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return route(async () => {
    const result = await publishedMenu((await params).slug);
    if ("suspended" in result) return json(result, 410);
    try {
      await rateLimit(
        `visit:${result.restaurant.id}:${clientKey(request)}`,
        1,
        30,
      );
      await serviceDb().rpc("record_menu_visit", {
        p_restaurant_id: result.restaurant.id,
        p_is_qr: false,
      });
    } catch {
      /* Analytics must never prevent reading a menu. */
    }
    return json(result);
  });
}
