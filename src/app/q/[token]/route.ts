import { serviceDb } from "@/lib/supabase";
import { route, dbError, ApiError, rateLimit, clientKey } from "@/lib/api";
import { appUrl } from "@/lib/config";
import { uuid } from "@/lib/validation";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return route(async () => {
    const token = uuid.parse((await params).token);
    const db = serviceDb();
    const r = await db
      .from("restaurants")
      .select("id,slug,status")
      .eq("public_token", token)
      .maybeSingle();
    dbError(r.error);
    if (!r.data)
      throw new ApiError(404, "Este código no está asociado a un menú.");
    if (r.data.status === "active")
      try {
        await rateLimit(`scan:${r.data.id}:${clientKey(request)}`, 1, 30);
        await db.rpc("record_menu_visit", {
          p_restaurant_id: r.data.id,
          p_is_qr: true,
        });
      } catch {
        /* Noncritical metrics. */
      }
    // Always resolve to the controlled platform. Slug fallback survives custom DNS failures.
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${appUrl()}/menu/${encodeURIComponent(r.data.slug)}`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
