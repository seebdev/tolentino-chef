import { beforeEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";

const fixtures = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    tables: {} as Record<string, Row[]>,
    calls: [] as {
      table: string;
      columns: string;
      filters: [string, unknown][];
      range: [number, number];
    }[],
    error: null as { code: string; message: string } | null,
    rateAllowed: true,
  };
  const context = vi.fn();
  const from = vi.fn((table: string) => {
    const call = {
      table,
      columns: "*",
      filters: [] as [string, unknown][],
      range: [0, 999] as [number, number],
    };
    state.calls.push(call);
    const query = {
      select(columns: string) {
        call.columns = columns;
        return query;
      },
      eq(key: string, value: unknown) {
        call.filters.push([key, value]);
        return query;
      },
      order() {
        return query;
      },
      async range(start: number, end: number) {
        call.range = [start, end];
        return {
          error: state.error,
          data: (state.tables[table] ?? [])
            .filter((row) =>
              call.filters.every(([key, value]) => row[key] === value),
            )
            .slice(start, end + 1)
            .map((row) =>
              Object.fromEntries(
                call.columns.split(",").map((key) => [key, row[key]]),
              ),
            ),
        };
      },
    };
    return query;
  });
  const db = {
    from,
    rpc: vi.fn(async () => ({ data: state.rateAllowed, error: null })),
  };
  return { state, context, db };
});

vi.mock("@/lib/access", () => ({ context: fixtures.context, audit: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixtures.db }));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.com",
}));

import { ApiError } from "../src/lib/api";
import { GET } from "../src/app/api/workspace/[restaurantId]/import/route";

const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const category = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const headers = ["nombre", "precio", "categoria", "descripcion", "sku"];
const request = (query = "?download=catalog") =>
  GET(
    new Request(
      `https://admin.example.com/api/workspace/${tenant}/import${query}`,
    ),
    {
      params: Promise.resolve({ restaurantId: tenant }),
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.state.calls = [];
  fixtures.state.error = null;
  fixtures.state.rateAllowed = true;
  fixtures.state.tables = {
    categories: [{ id: category, restaurant_id: tenant, name: "Bebidas" }],
    products: [],
  };
  fixtures.context.mockResolvedValue({
    restaurantId: tenant,
    db: fixtures.db,
    user: { id: "owner-fixture" },
  });
});

describe("CSV download handler with mocked authorized context and database", () => {
  it("preserves the default import template without reading catalog tables", async () => {
    const response = await request("");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "plantilla-productos.csv",
    );
    const csv = Papa.parse<Record<string, string>>(await response.text(), {
      header: true,
    });
    expect(csv.meta.fields).toEqual(headers);
    expect(csv.data[0].nombre).toBe("Sopa de temporada");
    expect(fixtures.context).toHaveBeenCalledWith(tenant);
    expect(fixtures.db.from).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "denies %i authorization before reading or exporting data",
    async (status) => {
      fixtures.context.mockRejectedValue(
        new ApiError(status, "Acceso denegado."),
      );
      const response = await request();
      expect(response.status).toBe(status);
      expect(fixtures.db.from).not.toHaveBeenCalled();
      expect(fixtures.db.rpc).not.toHaveBeenCalled();
    },
  );

  it("exports all 2505 authorized products across pages without tenant or internal-field leakage", async () => {
    fixtures.state.tables.products = Array.from(
      { length: 2505 },
      (_, index) => ({
        restaurant_id: tenant,
        category_id: category,
        name: `Café ${index}`,
        price: 12.5,
        description: "Descripción UTF-8",
        sku: `SKU-${index}`,
        private_note: "must-not-export",
      }),
    );
    fixtures.state.tables.products.push({
      restaurant_id: other,
      name: "Foreign product must not export",
    });
    fixtures.state.tables.categories.push({
      restaurant_id: other,
      id: "foreign-category",
      name: "Foreign category must not export",
    });
    const response = await request();
    const text = await response.text();
    const csv = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    expect(response.status).toBe(200);
    expect(csv.meta.fields).toEqual(headers);
    expect(csv.data).toHaveLength(2505);
    expect(csv.data.at(-1)).toMatchObject({
      nombre: "Café 2504",
      categoria: "Bebidas",
      sku: "SKU-2504",
    });
    expect(text).not.toContain("must-not-export");
    expect(text).not.toContain("Foreign");
    expect(
      fixtures.state.calls.every((call) =>
        call.filters.some(
          ([key, value]) => key === "restaurant_id" && value === tenant,
        ),
      ),
    ).toBe(true);
    expect(
      fixtures.state.calls
        .filter((call) => call.table === "products")
        .map((call) => call.range),
    ).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("escapes formulas while preserving quotes, commas, newlines, UTF-8 and decimal values", async () => {
    fixtures.state.tables.products = [
      {
        restaurant_id: tenant,
        category_id: category,
        name: "=1+1",
        price: 12.5,
        description: 'Café "especial", caliente\nHecho aquí',
        sku: "+DANGEROUS()",
      },
    ];
    const response = await request();
    const text = await response.text();
    const csv = Papa.parse<Record<string, string>>(text, { header: true });
    expect(csv.data[0]).toEqual({
      nombre: "'=1+1",
      precio: "12.5",
      categoria: "Bebidas",
      descripcion: 'Café "especial", caliente\nHecho aquí',
      sku: "'+DANGEROUS()",
    });
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain(
      "catalogo-productos.csv",
    );
  });

  it("returns usable headers and no invented products for an empty catalog", async () => {
    const response = await request();
    const csv = Papa.parse(await response.text(), {
      header: true,
      skipEmptyLines: true,
    });
    expect(response.status).toBe(200);
    expect(csv.meta.fields).toEqual(headers);
    expect(csv.data).toEqual([]);
  });

  it("rejects unknown download modes without reading the catalog", async () => {
    const response = await request("?download=private-sales");
    expect(response.status).toBe(400);
    expect(fixtures.db.from).not.toHaveBeenCalled();
  });

  it("fails closed on database errors without returning a partial CSV or internal message", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    fixtures.state.error = {
      code: "XX000",
      message: "private database detail",
    };
    const response = await request();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private database detail");
    logger.mockRestore();
  });

  it("limits repeated exports before querying catalog tables", async () => {
    fixtures.state.rateAllowed = false;
    const response = await request();
    expect(response.status).toBe(429);
    expect(fixtures.db.from).not.toHaveBeenCalled();
  });
});
