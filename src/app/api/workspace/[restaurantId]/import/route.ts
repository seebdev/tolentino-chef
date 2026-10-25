import { z } from "zod";
import { context } from "@/lib/access";
import { createHash } from "node:crypto";
import {
  route,
  json,
  body,
  mutationOrigin,
  dbError,
  rateLimit,
  ApiError,
} from "@/lib/api";
import { parseProductsCsv, exportCsv } from "@/lib/csv";
import { allRows } from "@/lib/queries";
type Params = { params: Promise<{ restaurantId: string }> };
function attemptResult(attempt: {
  attempt_id: string;
  status: string;
  replayed?: boolean;
  found?: boolean;
  result: Record<string, number>;
}) {
  const value = attempt.result;
  return {
    ok: attempt.status === "completed",
    found: true,
    attemptId: attempt.attempt_id,
    status: attempt.status,
    replayed: attempt.replayed === true,
    summary: {
      total: value.total,
      created: value.inserted,
      updated: value.updated,
      skipped: value.skipped,
      rejected: value.rejected,
    },
    message:
      attempt.status === "completed"
        ? "Importación completada y guardada en la base de datos."
        : "La importación no se guardó: el lote completo fue rechazado. Corrige el archivo y crea un nuevo intento.",
    ...value,
  };
}
export async function GET(request: Request, { params }: Params) {
  return route(async () => {
    const c = await context((await params).restaurantId);
    const attemptId = new URL(request.url).searchParams.get("attempt");
    if (attemptId) {
      z.uuid().parse(attemptId);
      await rateLimit(`import-status:${c.user.id}`, 60, 60);
      const result = await c.db.rpc("get_import_attempt", {
        p_restaurant_id: c.restaurantId,
        p_attempt_id: attemptId,
        p_actor_user_id: c.user.id,
      });
      dbError(result.error);
      return json(
        result.data?.found
          ? attemptResult(result.data)
          : {
              found: false,
              attemptId,
              status: "unconfirmed",
              message:
                "Todavía no hay confirmación. Esto no demuestra que una operación en curso se haya cancelado.",
            },
      );
    }
    const download = z
      .enum(["template", "catalog"])
      .parse(new URL(request.url).searchParams.get("download") || "template");
    if (download === "catalog") {
      await rateLimit(`csv-export:${c.user.id}`, 12, 60);
      const [products, categories] = await Promise.all([
        allRows(
          c.db,
          "products",
          c.restaurantId,
          "name,price,category_id,description,sku",
        ),
        allRows(c.db, "categories", c.restaurantId, "id,name"),
      ]);
      const names = new Map(categories.data.map((row) => [row.id, row.name]));
      const rows = products.data.map((product) => ({
        nombre: product.name,
        precio: product.price,
        categoria: names.get(product.category_id) ?? "",
        descripcion: product.description,
        sku: product.sku,
      }));
      return new Response(
        rows.length
          ? exportCsv(rows)
          : "\uFEFFnombre,precio,categoria,descripcion,sku\r\n",
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="catalogo-productos.csv"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    return new Response(
      exportCsv([
        {
          nombre: "Sopa de temporada",
          precio: "18000",
          categoria: "Entradas",
          descripcion: "Preparada con vegetales frescos",
          sku: "SOPA-01",
        },
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="plantilla-productos.csv"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  });
}
export async function POST(request: Request, { params }: Params) {
  return route(async () => {
    mutationOrigin(request);
    const c = await context((await params).restaurantId);
    await rateLimit(`import:${c.user.id}`, 12, 60);
    const input = z
      .object({
        action: z.enum(["preview", "commit"]),
        csv: z.string().max(5 * 1024 * 1024),
        mapping: z.record(z.string(), z.string()).default({}),
        mode: z.enum(["skip", "update"]).default("skip"),
        createCategories: z.boolean().default(false),
        attemptId: z.uuid().optional(),
      })
      .parse(await body(request, 11 * 1024 * 1024));
    if (input.action === "commit" && !input.attemptId)
      throw new ApiError(
        400,
        "La importación necesita un identificador de intento. Vuelve a validar el archivo.",
      );
    const categoryResult = await allRows(
      c.db,
      "categories",
      c.restaurantId,
      "id,name",
    );
    const categories = {
      data: categoryResult.data as { id: string; name: string }[],
    };
    const parsed = parseProductsCsv(
      input.csv,
      input.mapping,
      categories.data.map((c) => c.name),
      input.createCategories,
    );
    parsed.rows.forEach((row, i) => {
      if (
        categories.data.filter(
          (c) =>
            c.name.trim().toLowerCase() === row.category.trim().toLowerCase(),
        ).length > 1
      )
        parsed.errors.push({
          row: parsed.rowNumbers?.[i] ?? i + 2,
          column: "category",
          message:
            "Hay varias categorías con este nombre. Asigna un nombre inequívoco antes de importar.",
        });
    });
    const existing: {
      id: string;
      name: string;
      sku: string | null;
      category_id: string;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const list = await c.db
        .from("products")
        .select("id,name,sku,category_id")
        .eq("restaurant_id", c.restaurantId)
        .order("id")
        .range(offset, offset + 999);
      dbError(list.error);
      existing.push(...list.data!);
      if (list.data!.length < 1000) break;
    }
    const normalize = (s: string) => s.trim().toLowerCase();
    const duplicates = parsed.rows.flatMap((row, i) => {
      const categoryIds = categories
        .data!.filter((c) => normalize(c.name) === normalize(row.category))
        .map((c) => c.id);
      const matches = existing.filter((p) =>
        row.sku
          ? p.sku === row.sku
          : normalize(p.name) === normalize(row.name) &&
            categoryIds.includes(p.category_id),
      );
      if (matches.length > 1)
        parsed.errors.push({
          row: parsed.rowNumbers?.[i] ?? i + 2,
          column: "sku",
          message:
            "Hay varias coincidencias. Asigna un código único para identificar el producto.",
        });
      return matches.length
        ? [
            {
              row: parsed.rowNumbers?.[i] ?? i + 2,
              name: row.name,
              count: matches.length,
            },
          ]
        : [];
    });
    const summary = {
      total: parsed.total,
      valid: parsed.rows.length,
      invalid: new Set(parsed.errors.map((e) => e.row)).size,
      duplicates: duplicates.length,
    };
    if (input.action === "preview")
      return json({
        ...parsed,
        duplicates: [...parsed.duplicates, ...duplicates],
        summary,
      });
    if (parsed.errors.length)
      throw new ApiError(
        400,
        "Corrige los errores de la previsualización antes de confirmar. No se guardó ningún producto.",
        "IMPORT_VALIDATION_REJECTED",
      );
    const imported = await c.db.rpc("import_products_attempt", {
      p_restaurant_id: c.restaurantId,
      p_attempt_id: input.attemptId,
      p_request_hash: createHash("sha256")
        .update(
          JSON.stringify({
            rows: parsed.rows,
            mode: input.mode,
            createCategories: input.createCategories,
          }),
        )
        .digest("hex"),
      p_actor_user_id: c.user.id,
      p_rows: parsed.rows,
      p_mode: input.mode,
      p_create_categories: input.createCategories,
    });
    if (imported.error?.code === "PT409")
      throw new ApiError(
        409,
        "Este intento ya corresponde a otro archivo o configuración. Consulta su resultado antes de empezar otro.",
      );
    dbError(imported.error);
    // Counts, attempt journal, audit event and catalog commit share the DB transaction.
    return json(attemptResult(imported.data));
  });
}
