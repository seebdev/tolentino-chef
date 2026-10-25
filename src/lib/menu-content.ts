import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "./api";
import type { Settings } from "./types";
import { allRows } from "./queries";

// Both the authorized preview and public endpoint project the complete publishable menu.
// Draft-only settings never enter the public cache.
export async function menuContent(db: SupabaseClient, restaurantId: string, preview = false) {
 const [settings, categories, products, promotions, hours, translations] = await Promise.all([
  db.from("restaurant_settings").select(preview ? "*" : "appearance,enabled_languages").eq("restaurant_id",restaurantId).single(),
  allRows(db,"categories",restaurantId,"id,parent_id,name,sort_order,is_visible"),
  allRows(db,"products",restaurantId,"id,category_id,name,description,price,image_path,tags,ingredients,variants,extras,is_published,is_available,is_featured,sort_order"),
  allRows(db,"promotions",restaurantId,"id,title,description,starts_at,ends_at,is_active"),
  db.from("restaurant_hours").select("day_of_week,opens_at,closes_at,is_closed").eq("restaurant_id",restaurantId).order("day_of_week"),
  allRows(db,"translations",restaurantId,"id,entity_type,entity_id,language,fields"),
 ]);
 dbError(settings.error); dbError(hours.error);
 const visible = (id: unknown, seen = new Set()): boolean => {
  if(seen.has(id))return false; seen.add(id);
  const c=categories.data.find(x=>x.id===id);
  return Boolean(c && c.is_visible && (!c.parent_id || visible(c.parent_id,seen)));
 };
 const publicCategories=categories.data.filter(x=>visible(x.id)).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
 const categoryIds=new Set(publicCategories.map(x=>x.id));
 const publicProducts=products.data.filter(x=>x.is_published && categoryIds.has(x.category_id)).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
 const productIds=new Set(publicProducts.map(x=>x.id));
 const promotionIds=new Set(promotions.data.filter(x=>x.is_active).map(x=>x.id));
 return {settings:settings.data as unknown as Settings,categories:publicCategories,products:publicProducts,promotions:promotions.data,hours:hours.data,
  translations:translations.data.filter(x=>x.entity_type==="product" ? productIds.has(x.entity_id) : x.entity_type==="category" ? categoryIds.has(x.entity_id) : x.entity_type==="promotion" ? promotionIds.has(x.entity_id) : x.entity_type==="restaurant" && x.entity_id===restaurantId),
 };
}
export function currentPromotions(promotions: Record<string,unknown>[], now=Date.now()) {
 return promotions.filter(p=>p.is_active && (!p.starts_at || Date.parse(String(p.starts_at))<=now) && (!p.ends_at || Date.parse(String(p.ends_at))>=now));
}
export async function creatorContact(db: SupabaseClient) {
 const platform=await db.from("platform_settings").select("creator_brand,creator_phone,creator_whatsapp").limit(1).maybeSingle();
 dbError(platform.error);
 const brand=platform.data?.creator_brand || "Tolentino Chef";
 const phone=platform.data?.creator_phone || "3108853158";
 return {brand,phone,label:"Creado por "+brand+" · "+phone,url:platform.data?.creator_whatsapp || "https://wa.me/573108853158?text="+encodeURIComponent("Hola, quiero información sobre un menú digital para mi restaurante")};
}
