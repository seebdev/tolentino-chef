import { z } from "zod";
import { context, sensitive } from "@/lib/access";
import { route, dbError, ApiError } from "@/lib/api";
import { appUrl } from "@/lib/config";
import { generateQr } from "@/lib/qr";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  return route(async () => {
    const c = await context((await params).restaurantId);
    await sensitive(c.user.id, "qr_export");
    const format = z
      .enum(["svg", "png", "pdf"])
      .parse(new URL(request.url).searchParams.get("format") || "svg");
    const qr = await c.db
      .from("restaurant_qr_configs")
      .select("*")
      .eq("restaurant_id", c.restaurantId)
      .single();
    dbError(qr.error);
    let logo: Buffer | undefined;
    if (qr.data!.include_logo) {
      const s = await c.db
        .from("restaurant_settings")
        .select("appearance")
        .eq("restaurant_id", c.restaurantId)
        .single();
      dbError(s.error);
      const path = s.data!.appearance.logo_path;
      if (path) {
        if (!path.startsWith(`${c.restaurantId}/`))
          throw new ApiError(400, "Logo inválido.");
        const image = await c.db.storage
          .from("restaurant-media")
          .download(path);
        dbError(image.error);
        if (image.data) logo = Buffer.from(await image.data.arrayBuffer());
      }
    }
    const result = await generateQr({
      ...qr.data,
      url: `${appUrl()}/q/${c.restaurant.public_token}`,
      logo,
      format,
    });
    return new Response(
      typeof result === "string" ? result : new Uint8Array(result),
      {
        headers: {
          "Content-Type": {
            svg: "image/svg+xml",
            png: "image/png",
            pdf: "application/pdf",
          }[format],
          "Content-Disposition": `${format === "svg" ? "inline" : "attachment"}; filename="menu-${c.restaurant.slug}.${format}"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  });
}
