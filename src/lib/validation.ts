import { z } from "zod";
export const uuid = z.uuid();
export const slug = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Usa letras minúsculas, números y guiones.",
  )
  .refine(
    (x) =>
      ![
        "admin",
        "api",
        "login",
        "dashboard",
        "auth",
        "q",
        "menu",
        "www",
      ].includes(x),
    "Este nombre está reservado.",
  );
export const languages = ["es", "en", "fr", "it", "zh", "ja", "hi"] as const;
export const language = z.enum(languages);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(999999999.99)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Máximo dos decimales.",
  );
export const mediaPath = z
  .string()
  .max(200)
  .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|png|jpg|jpeg)$/)
  .nullable()
  .optional();
export const restaurantInput = z.object({
  name: z.string().trim().min(2).max(100),
  slug,
  description: z.string().max(1200).default(""),
  owner_name: z.string().trim().min(2).max(100),
  owner_email: z.email().max(254),
  phone: z.string().max(40).default(""),
  currency: z
    .enum(["COP", "USD", "EUR", "MXN", "PEN", "CLP", "ARS", "BRL"])
    .default("COP"),
  default_language: language.default("es"),
  status: z.enum(["active", "suspended"]).default("active"),
  sold_at: z.string().date().nullable().optional(),
  amount: money.nullable().optional(),
  sale_currency: z
    .enum(["COP", "USD", "EUR", "MXN", "PEN", "CLP", "ARS", "BRL"])
    .default("COP"),
  notes: z.string().max(4000).default(""),
});
const option = z.object({
  name: z.string().trim().min(1).max(100),
  price: money,
});
export const productInput = z.object({
  id: uuid.optional(),
  category_id: uuid,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(3000).default(""),
  price: money,
  image_path: mediaPath,
  tags: z.array(z.string().max(40)).max(20).default([]),
  ingredients: z.string().max(1500).default(""),
  variants: z.array(option).max(30).default([]),
  extras: z.array(option).max(30).default([]),
  is_published: z.boolean().default(false),
  is_available: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
  sku: z.string().trim().min(1).max(80).nullable().optional(),
});
export const categoryInput = z.object({
  id: uuid.optional(),
  parent_id: uuid.nullable().optional(),
  name: z.string().trim().min(1).max(100),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
  is_visible: z.boolean().default(true),
});
export const appearanceInput = z.object({
  primary: color.default("#244b3b"),
  secondary: color.default("#efe8dc"),
  font: z.enum(["serif", "sans", "rounded"]).default("serif"),
  logo_path: mediaPath,
  cover_path: mediaPath,
  favicon_path: mediaPath,
});
export const promotionInput = z
  .object({
    id: uuid.optional(),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(1500).default(""),
    starts_at: z.iso.datetime().nullable().optional(),
    ends_at: z.iso.datetime().nullable().optional(),
    is_active: z.boolean().default(true),
  })
  .refine(
    (x) => !x.starts_at || !x.ends_at || x.ends_at >= x.starts_at,
    "La fecha final debe ser posterior al inicio.",
  );
export function safeHostname(raw: string) {
  const h = raw.trim().toLowerCase().replace(/\.$/, "");
  if (
    h.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ||
    /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(h)
  )
    throw new Error("Escribe un dominio público válido, sin https ni rutas.");
  return h;
}
export function safeContact(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("Usa un enlace HTTPS válido.");
  return u.toString();
}
export function assertMediaTenant(path: string | null | undefined, id: string) {
  if (path && !path.startsWith(`${id}/`))
    throw new Error("MEDIA_TENANT_MISMATCH");
}
