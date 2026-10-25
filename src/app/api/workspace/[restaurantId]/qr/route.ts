import { z } from "zod";
import { context, sensitive } from "@/lib/access";
import { route, dbError, ApiError, body, mutationOrigin } from "@/lib/api";
import { generateQr, qrInput, type QrFormat } from "@/lib/qr";
import { permanentQrUrl, restaurantQrLogo } from "@/lib/restaurant-qr";
type Params = { params: Promise<{ restaurantId: string }> };
const sizes = z.union([
  z.literal(256),
  z.literal(512),
  z.literal(1024),
  z.literal(2048),
]);
async function artifact(
  c: Awaited<ReturnType<typeof context>>,
  config: ReturnType<typeof qrInput.parse>,
  format: QrFormat,
  size?: number,
) {
  const logo = await restaurantQrLogo(
    c.db,
    c.restaurantId,
    config.include_logo,
  );
  let result: Buffer | string;
  try {
    result = await generateQr({
      ...config,
      url: permanentQrUrl(c.restaurant.public_token),
      logo,
      format,
      size,
    });
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof Error ? error.message : "El diseño QR no es legible.",
    );
  }
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
        "X-Content-Type-Options": "nosniff",
        "X-QR-Validated": "true",
        "X-QR-Config-Version": String(config.config_version),
        "X-QR-Permanent-URL": permanentQrUrl(c.restaurant.public_token),
      },
    },
  );
}
export async function GET(request: Request, { params }: Params) {
  return route(async () => {
    const c = await context((await params).restaurantId);
    await sensitive(c.user.id, "qr_export");
    const query = new URL(request.url).searchParams;
    const format = z
      .enum(["svg", "png", "pdf"])
      .parse(query.get("format") || "svg");
    const size = query.has("size")
      ? sizes.parse(Number(query.get("size")))
      : undefined;
    const saved = await c.db
      .from("restaurant_qr_configs")
      .select("*")
      .eq("restaurant_id", c.restaurantId)
      .single();
    dbError(saved.error);
    return artifact(c, qrInput.parse(saved.data), format, size);
  });
}
export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    mutationOrigin(request);
    const c = await context((await params).restaurantId);
    if (c.role !== "superadmin")
      throw new ApiError(403, "Solo Tolentino puede personalizar el QR.");
    await sensitive(c.user.id, "qr_preview");
    const config = qrInput.parse(await body(request, 16 * 1024));
    // Preview composes and validates an ephemeral artifact. It never saves settings or identity.
    return artifact(c, config, "svg");
  });
}
