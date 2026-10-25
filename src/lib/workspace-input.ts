import { productInput } from "./validation";
// Updates validate only supplied keys. Zod defaults are for new rows, never a patch.
export function parseProductMutation(input: Record<string, unknown>) {
  const normalized = { ...input };
  for (const key of ["image_path", "sku"]) {
    if (Object.hasOwn(normalized, key) && normalized[key] === "") normalized[key] = null;
  }
  if (!normalized.id) return productInput.parse(normalized);
  const parsed = productInput.partial().parse(normalized);
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(normalized, key)));
}
