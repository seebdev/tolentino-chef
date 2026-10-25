import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { configured, appUrl } from "./config";
import { serviceDb } from "./supabase";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: { field: string; message: string }[],
  ) {
    super(message);
  }
}
export function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "PGRST116")
    throw new ApiError(404, "No se encontró el recurso solicitado.", "NOT_FOUND");
  if (error.code === "PT409")
    throw new ApiError(409, "La operación entra en conflicto con cambios recientes. Recarga antes de reintentar.", "REVISION_CONFLICT");
  if (error.code === "23505")
    throw new ApiError(
      409,
      "Este identificador ya existe. Revisa el nombre, código o dominio.",
    );
  if (error.code === "23503")
    throw new ApiError(
      409,
      "Hay elementos vinculados. Revisa la categoría o mueve sus productos antes de eliminarla.",
    );
  if (error.code === "42501")
    throw new ApiError(403, "No tienes permiso para realizar esta operación.");
  if (
    error.code === "23514" ||
    error.code === "22023" ||
    error.code === "P0001"
  )
    throw new ApiError(
      400,
      "La operación contiene valores o relaciones no válidos.",
    );
  throw new Error(`Database error ${error.code || "unknown"}`);
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function route(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.fields ? { fields: error.fields } : {}) }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: "Revisa los campos indicados.",
          fields: error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    if (!configured())
      return json(
        {
          error:
            "La conexión de Tolentino con Supabase aún no está configurada.",
          code: "SETUP_REQUIRED",
        },
        503,
      );
    const eventId = randomUUID();
    console.error(
      JSON.stringify({
        event: "request_failed",
        eventId,
        type: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return json(
      {
        error: "No pudimos completar la operación. Intenta de nuevo.",
        eventId,
      },
      500,
    );
  }
}
export function mutationOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    throw new ApiError(
      403,
      "Solicitud no autorizada. Abre el panel desde la dirección oficial de Tolentino.",
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError(403, "Solicitud no autorizada.");
}
export async function boundedBytes(
  request: Request,
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes)
    throw new ApiError(
      413,
      "El archivo o formulario supera el límite permitido.",
    );
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "El formulario está vacío.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "El archivo supera el límite permitido.");
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export async function body(
  request: Request,
  maxBytes = 2_500_000,
): Promise<Record<string, unknown>> {
  const bytes = await boundedBytes(request, maxBytes);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new ApiError(400, "El formato enviado no es válido.");
  }
}
export async function rateLimit(key: string, limit = 60, window = 60) {
  const hashed = createHash("sha256").update(key).digest("hex");
  const { data, error } = await serviceDb().rpc("consume_rate_limit", {
    p_key: hashed,
    p_limit: limit,
    p_window_seconds: window,
  });
  dbError(error);
  if (data !== true)
    throw new ApiError(
      429,
      "Has realizado varios intentos. Espera un momento antes de continuar.",
    );
}
export function clientKey(request: Request) {
  // Only Render's appended rightmost proxy address is used; never trust arbitrary first XFF.
  return process.env.RENDER_SERVICE_ID
    ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "unknown"
    : "local";
}
