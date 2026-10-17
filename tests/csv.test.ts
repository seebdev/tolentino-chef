import { describe, it, expect } from "vitest";
import { parseProductsCsv, parsePrice, exportCsv } from "../src/lib/csv";
describe("CSV real parsing and limits", () => {
  it.each([1, 100, 999, 1000])("accepts %i products with UTF-8", (count) => {
    const csv =
      "nombre;precio;categoria;descripcion;sku\n" +
      Array.from(
        { length: count },
        (_, i) => `Café ${i};12,50;Bebidas;Sabor de estación;C-${i}`,
      ).join("\n");
    const r = parseProductsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(count);
    expect(r.rows[0].price).toBe(12.5);
  });
  it("rejects 1001 products without partially returning rows", () => {
    const r = parseProductsCsv(
      "nombre,precio,categoria\n" +
        Array.from({ length: 1001 }, (_, i) => `Plato ${i},12,Comida`).join(
          "\n",
        ),
    );
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.rows).toEqual([]);
  });
  it("supports mapping, quoted commas and newlines", () => {
    const r = parseProductsCsv(
      'Dish,Cost,Group,Text\n"Soup, hot",10,Food,"hello\nworld"',
      { name: "Dish", price: "Cost", category: "Group", description: "Text" },
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0].description).toBe("hello\nworld");
  });
  it.each([
    "-1",
    "NaN",
    "Infinity",
    "1e4",
    "10.000",
    "1,000.00",
    "0xFF",
    "",
    "  ",
    "1.234",
    "9999999999",
  ])("rejects invalid or ambiguous price %s", (value) =>
    expect(() => parsePrice(value)).toThrow(),
  );
  it("validates row and category references", () => {
    const r = parseProductsCsv(
      "nombre,precio,categoria\n,abc,Unknown",
      {},
      ["Known"],
      false,
    );
    expect(r.errors.map((e) => e.column)).toEqual(
      expect.arrayContaining(["name", "price", "category"]),
    );
  });
  it("detects repeated CSV identities instead of overwriting", () => {
    const r = parseProductsCsv(
      "nombre,precio,categoria,sku\nCafé,10,Bebidas,C1\nOtro,12,Bebidas,C1",
    );
    expect(r.duplicates).toHaveLength(1);
    expect(r.errors.some((e) => e.column === "sku")).toBe(true);
  });
  it("neutralizes CSV formulas on export", () => {
    const csv = exportCsv([
      { name: '=HYPERLINK("x")', sku: "  @SUM(A1)", note: "+1" },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'  @SUM");
    expect(csv).toContain("'+1");
  });
  it("rejects duplicated headers, bad UTF-8 and malformed quotes", () => {
    expect(
      parseProductsCsv("nombre,nombre,precio\na,a,1").errors.length,
    ).toBeGreaterThan(0);
    expect(
      parseProductsCsv("nombre,precio,categoria\n\uFFFD,1,A").errors.length,
    ).toBeGreaterThan(0);
    expect(
      parseProductsCsv('nombre,precio,categoria\n"broken,1,A').errors.length,
    ).toBeGreaterThan(0);
  });
});
