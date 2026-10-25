import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, dbError } from "./api";
import { appUrl } from "./config";
import { generateQr, qrInput, QR_LIMITS, type QrFormat } from "./qr";

export function permanentQrUrl(publicToken: string) {
  return `${appUrl()}/q/${publicToken}`;
}
export async function restaurantQrLogo(
  db: SupabaseClient,
  restaurantId: string,
  include: boolean,
) {
  if (!include) return undefined;
  const settings = await db
    .from("restaurant_settings")
    .select("appearance")
    .eq("restaurant_id", restaurantId)
    .single();
  dbError(settings.error);
  const path = settings.data?.appearance?.logo_path;
  if (
    typeof path !== "string" ||
    !path.startsWith(restaurantId + "/") ||
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(path)
  )
    throw new ApiError(
      400,
      "Publica un logo PNG, JPEG o WebP válido antes de incluirlo en el QR.",
    );
  const image = await db.storage.from("restaurant-media").download(path);
  dbError(image.error);
  if (!image.data || image.data.size > QR_LIMITS.maximumLogoBytes)
    throw new ApiError(400, "El logo QR supera el límite de 5 MB.");
  return Buffer.from(await image.data.arrayBuffer());
}
export async function saveQrConfiguration(
  db: SupabaseClient,
  restaurantId: string,
  publicToken: string,
  input: unknown,
) {
  const config = qrInput.parse(input);
  const logo = await restaurantQrLogo(db, restaurantId, config.include_logo);
  try {
    for (const format of ["png", "svg", "pdf"] as QrFormat[])
      await generateQr({
        ...config,
        url: permanentQrUrl(publicToken),
        logo,
        format,
      });
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof Error
        ? error.message
        : "El diseño QR no supera la validación automática.",
    );
  }
  const result = await db.rpc("save_qr_configuration", {
    p_restaurant_id: restaurantId,
    p_config: config,
    p_expected_version: config.config_version,
  });
  if (result.error?.code === "PT409")
    throw new ApiError(
      409,
      "Otra sesión cambió el QR. Recarga su configuración antes de guardar; tu borrador sigue visible.",
    );
  dbError(result.error);
  return result.data;
}
