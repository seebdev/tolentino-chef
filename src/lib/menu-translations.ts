import type { PublicMenuData } from "./types";
// Empty translations use source text; completeness must reflect every visible textual field.
export function hasPendingMenuTranslation(
  data: PublicMenuData,
  language: string,
) {
  if (language === data.restaurant.default_language) return false;
  const translated = new Map(
    data.translations
      .filter((t) => t.language === language)
      .map((t) => [t.entity_type + ":" + t.entity_id, t.fields]),
  );
  const present = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  const missing = (type: string, id: string, field: string, source: unknown) =>
    present(source) &&
    !present(
      (
        translated.get(type + ":" + id) as Record<string, unknown> | undefined
      )?.[field],
    );
  if (
    missing(
      "restaurant",
      data.restaurant.id,
      "description",
      data.restaurant.description,
    )
  )
    return true;
  if (
    data.categories.some(
      (c) => c.is_visible && missing("category", c.id, "name", c.name),
    )
  )
    return true;
  if (
    data.promotions.some(
      (p) =>
        p.is_active &&
        ((missing("promotion", p.id, "title", p.title) &&
          missing("promotion", p.id, "name", p.title)) ||
          missing("promotion", p.id, "description", p.description)),
    )
  )
    return true;
  return data.products.some((p) => {
    if (!p.is_published) return false;
    if (
      ["name", "description", "ingredients"].some((field) =>
        missing(
          "product",
          p.id,
          field,
          p[field as "name" | "description" | "ingredients"],
        ),
      )
    )
      return true;
    const fields = translated.get("product:" + p.id);
    return (
      p.tags.some((tag, i) => present(tag) && !present(fields?.tags?.[i])) ||
      (["extras", "variants"] as const).some((field) =>
        p[field].some(
          (option, i) =>
            present(option.name) && !present(fields?.[field]?.[i]?.name),
        ),
      )
    );
  });
}
