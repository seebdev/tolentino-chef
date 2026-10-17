import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { context, sensitive } from "@/lib/access";
import {
  route,
  json,
  mutationOrigin,
  dbError,
  ApiError,
  boundedBytes,
} from "@/lib/api";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  return route(async () => {
    mutationOrigin(request);
    const { restaurantId } = await params;
    const c = await context(restaurantId);
    await sensitive(c.user.id, "upload");
    const max = 5 * 1024 * 1024;
    const bytes = await boundedBytes(request, max + 16384);
    const bounded = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    });
    const data = await bounded.formData();
    const file = data.get("file");
    if (
      !(file instanceof File) ||
      file.size > max ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw new ApiError(
        400,
        "Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.",
      );
    let buffer: Buffer;
    try {
      const source = sharp(Buffer.from(await file.arrayBuffer()), {
        limitInputPixels: 16000000,
        animated: false,
      });
      const meta = await source.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        throw new Error();
      buffer = await source
        .rotate()
        .resize({
          width: 1800,
          height: 1800,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new ApiError(
        400,
        "No se pudo leer la imagen. Usa un archivo válido de hasta 16 megapíxeles.",
      );
    }
    const path = `${restaurantId}/${randomUUID()}.webp`;
    const saved = await c.db.storage
      .from("restaurant-media")
      .upload(path, buffer, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "0",
      });
    dbError(saved.error);
    return json({ path, url: `/api/media/${restaurantId}/${path}` }, 201);
  });
}
