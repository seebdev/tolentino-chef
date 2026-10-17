import Papa from "papaparse";
export type CsvRow = {
  name: string;
  price: number;
  category: string;
  description: string;
  sku: string | null;
};
export type CsvIssue = { row: number; column: string; message: string };
export const CSV_LIMIT = 1000;
const fields = ["name", "price", "category", "description", "sku"] as const;
const normalized = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const identity = (s: string) => s.trim().toLowerCase();
const aliases: Record<string, string[]> = {
  name: ["name", "nombre", "producto"],
  price: ["price", "precio"],
  category: ["category", "categoria"],
  description: ["description", "descripcion"],
  sku: ["sku", "codigo"],
};
export function parsePrice(value: string) {
  const s = value.trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?$/.test(s))
    throw new Error(
      "Usa un precio positivo sin separadores de miles y con hasta dos decimales.",
    );
  const price = Number(s.replace(",", "."));
  if (price > 999999999.99) throw new Error("El precio supera el límite.");
  return price;
}
export function safeCsvCell(value: unknown) {
  const s = String(value ?? "");
  return /^[\s]*[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
}
export function exportCsv(rows: Record<string, unknown>[]) {
  return (
    "\uFEFF" +
    Papa.unparse(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            safeCsvCell(key),
            safeCsvCell(value),
          ]),
        ),
      ),
      { newline: "\r\n" },
    )
  );
}
export function parseProductsCsv(
  csv: string,
  mapping: Record<string, string> = {},
  categories: string[] = [],
  createCategories = true,
) {
  const errors: CsvIssue[] = [];
  const rows: CsvRow[] = [];
  const duplicates: { row: number; message: string }[] = [];
  if (Buffer.byteLength(csv, "utf8") > 5 * 1024 * 1024)
    return {
      headers: [],
      rows,
      errors: [
        { row: 0, column: "archivo", message: "El archivo supera 5 MB." },
      ],
      duplicates,
      total: 0,
      mapping,
    };
  if (csv.includes("\uFFFD"))
    errors.push({
      row: 0,
      column: "archivo",
      message: "El archivo no es UTF-8 válido. Guárdalo como CSV UTF-8.",
    });
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const headers = (parsed.data.shift() || []).map((s) => s.trim());
  const selected = { ...mapping };
  for (const field of fields)
    if (!Object.keys(mapping).length)
      selected[field] =
        headers.find((h) => aliases[field].includes(normalized(h))) || "";
  if (new Set(headers.map(normalized)).size !== headers.length)
    errors.push({
      row: 1,
      column: "columnas",
      message: "Hay columnas repetidas. Usa nombres únicos.",
    });
  if (headers.some((h) => !h))
    errors.push({
      row: 1,
      column: "columnas",
      message: "Todas las columnas necesitan un título.",
    });
  if (parsed.data.length < 1 || parsed.data.length > CSV_LIMIT)
    errors.push({
      row: 0,
      column: "archivo",
      message: "El archivo debe contener entre 1 y 1.000 productos.",
    });
  for (const e of parsed.errors)
    errors.push({
      row: (e.row ?? 0) + 2,
      column: "formato",
      message:
        e.code === "MissingQuotes"
          ? "Hay comillas sin cerrar."
          : "No se pudo interpretar una fila del CSV.",
    });
  for (const field of ["name", "price", "category"])
    if (!selected[field] || !headers.includes(selected[field]))
      errors.push({
        row: 1,
        column: field,
        message: "Asigna una columna para este campo obligatorio.",
      });
  const names = new Set(categories.map(identity));
  const seen = new Set<string>();
  const rowNumbers: number[] = [];
  if (parsed.data.length <= CSV_LIMIT)
    parsed.data.forEach((values, index) => {
      const row = index + 2;
      if (values.length !== headers.length) {
        errors.push({
          row,
          column: "formato",
          message: "El número de valores no coincide con las columnas.",
        });
        return;
      }
      const read = (field: string) =>
        values[headers.indexOf(selected[field])]?.trim() || "";
      const name = read("name"),
        category = read("category"),
        description = read("description"),
        sku = read("sku") || null;
      const before = errors.length;
      let price = 0;
      if (!name || name.length > 160)
        errors.push({
          row,
          column: "name",
          message:
            "El nombre es obligatorio y debe tener hasta 160 caracteres.",
        });
      if (!category || category.length > 100)
        errors.push({
          row,
          column: "category",
          message:
            "La categoría es obligatoria y debe tener hasta 100 caracteres.",
        });
      if (!createCategories && !names.has(identity(category)))
        errors.push({
          row,
          column: "category",
          message:
            "Esta categoría no existe. Activa la creación de categorías o corrige el nombre.",
        });
      if (description.length > 3000)
        errors.push({
          row,
          column: "description",
          message: "La descripción supera 3.000 caracteres.",
        });
      if (sku && sku.length > 80)
        errors.push({
          row,
          column: "sku",
          message: "El código supera 80 caracteres.",
        });
      try {
        price = parsePrice(read("price"));
      } catch (error) {
        errors.push({
          row,
          column: "price",
          message: (error as Error).message,
        });
      }
      const key = sku
        ? `sku:${sku}`
        : `name:${identity(category)}:${identity(name)}`;
      if (seen.has(key)) {
        duplicates.push({ row, message: "Producto repetido en este archivo." });
        errors.push({
          row,
          column: sku ? "sku" : "name",
          message:
            "El archivo repite este producto. Conserva una sola fila para evitar sobrescrituras.",
        });
      }
      seen.add(key);
      if (errors.length === before) {
        rows.push({ name, price, category, description, sku });
        rowNumbers.push(row);
      }
    });
  return {
    headers,
    rows,
    rowNumbers,
    errors,
    duplicates,
    total: parsed.data.length,
    mapping: selected,
  };
}
