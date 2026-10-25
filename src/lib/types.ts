export type Restaurant = {
  id: string;
  public_token: string;
  menu_version?: number;
  name: string;
  slug: string;
  description: string;
  status: "active" | "suspended";
  owner_name: string;
  owner_email: string;
  phone: string;
  currency: string;
  default_language: string;
  created_at: string;
  logo_path?: string;
  product_count?: number;
  sale_date?: string;
  restaurant_domains?: { hostname: string; status: string }[];
};
export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  is_visible: boolean;
};
export type PriceOption = { name: string; price: number };
export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price: number;
  image_path: string;
  tags: string[];
  ingredients: string;
  variants: PriceOption[];
  extras: PriceOption[];
  is_published: boolean;
  is_available: boolean;
  is_featured: boolean;
  sort_order: number;
  sku: string;
};
export type Promotion = {
  id: string;
  title: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};
export type Appearance = {
  primary: string;
  secondary: string;
  font: string;
  logo_path: string;
  cover_path: string;
  favicon_path: string;
  background?: string;
  card?: string;
  text?: string;
  muted?: string;
  cover_overlay?: string;
  cover_overlay_opacity?: number;
  columns_mobile?: 1 | 2;
  columns_desktop?: 1 | 2;
};
export type Settings = {
  appearance: Appearance;
  draft_appearance: Appearance;
  appearance_revision?: number;
  draft_name?: string | null;
  draft_description?: string | null;
  enabled_languages: string[];
  suspension_message: string;
};
export type Hours = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
};
export type Translation = {
  entity_type: string;
  entity_id: string;
  language: string;
  fields: { name?: string; title?: string; description?: string; ingredients?: string; tags?: string[]; extras?: { name: string }[]; variants?: { name: string }[] };
  is_manual?: boolean;
  source_hash?: string;
};
export type QrConfig = {
  foreground: string;
  background: string;
  frame: string;
  label: string;
  include_logo: boolean;
  config_version?: number;
  logo_size?: number;
  font_family?: "sans" | "serif" | "mono";
  export_size?: 256 | 512 | 1024 | 2048;
  module_style?: "square" | "rounded";
};
export type Domain = {
  id: string;
  hostname: string;
  status: string;
  verification_token?: string;
  dns_instructions?: { type: string; name: string; value: string }[];
  instructions?: string;
  last_error?: string;
};
export type Session = {
  user: { id: string; email: string };
  role: "superadmin" | "owner";
  restaurantId: string | null;
};
export type WorkspaceData = {
  restaurant: Restaurant;
  settings: Settings;
  categories: Category[];
  products: Product[];
  promotions: Promotion[];
  hours: Hours[];
  translations: Translation[];
  qr: QrConfig;
  domains: Domain[];
  membership: { is_active: boolean; user_id: string } | null;
  sale: {
    sale_date?: string;
    sold_at?: string;
    amount: number;
    currency: string;
    notes: string;
  } | null;
  stats: Record<string, number>;
  role: "superadmin" | "owner";
  total: number;
  page: number;
};
export type PublicMenuData = {
  restaurant: Restaurant;
  settings: Settings;
  categories: Category[];
  products: Product[];
  promotions: Promotion[];
  hours: Hours[];
  translations: Translation[];
  contact: { url: string; label: string; brand?: string; phone?: string } | null;
};
export const DEFAULT_APPEARANCE: Appearance = {
  primary: "#264b3c",
  secondary: "#f5f1e8",
  font: "sans",
  logo_path: "",
  cover_path: "",
  favicon_path: "",
};
export function mediaUrl(restaurantId: string, path?: string) {
  return path
    ? "/api/media/" +
        encodeURIComponent(restaurantId) +
        "/" +
        path.split("/").map(encodeURIComponent).join("/")
    : "";
}
export function money(value: number, currency = "COP", language = "es") {
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "COP" ? 0 : 2,
    }).format(value);
  } catch {
    return value + " " + currency;
  }
}
