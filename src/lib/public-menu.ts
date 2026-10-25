import "server-only";
import { unstable_cache } from "next/cache";
import { serviceDb } from "./supabase";
import { ApiError, dbError } from "./api";
import { slug as slugSchema } from "./validation";
import { menuContent, creatorContact, currentPromotions } from "./menu-content";
export async function publicMenuIdentity(slug: string) {
 slugSchema.parse(slug);
 const found=await serviceDb().from("restaurants").select("id,name,slug,description,phone,currency,default_language,status,menu_version").eq("slug",slug).maybeSingle();
 dbError(found.error);
 if(!found.data)throw new ApiError(404,"No se encontró este menú.");
 return found.data;
}
class PublicationChanged extends Error {}
export async function publishedMenu(slug: string) {
 const db=serviceDb();
 for(let attempt=0;attempt<3;attempt++) {
  const restaurant=await publicMenuIdentity(slug);
  // Never cache status; a suspended restaurant stops serving immediately.
  if(restaurant.status!=="active") {
   const settings=await db.from("platform_settings").select("suspension_message").limit(1).maybeSingle(); dbError(settings.error);
   return {suspended:true as const,name:restaurant.name,message:settings.data?.suspension_message || "Este menú no está disponible temporalmente."};
  }
  try {
   // All enabled languages share this versioned payload. Recheck after reading all pages:
   // a concurrent publication must not combine an old title with new colors/products.
   const content=await unstable_cache(async()=>{
    const value=await menuContent(serviceDb(),restaurant.id);
    const latest=await publicMenuIdentity(slug);
    if(latest.id!==restaurant.id || latest.menu_version!==restaurant.menu_version || latest.status!==restaurant.status)throw new PublicationChanged();
    return value;
   },["public-menu-v2",restaurant.id,String(restaurant.menu_version)],{revalidate:300})();
   const latest=await publicMenuIdentity(slug);
   if(latest.id!==restaurant.id || latest.menu_version!==restaurant.menu_version || latest.status!==restaurant.status)continue;
   return {restaurant,...content,promotions:currentPromotions(content.promotions),contact:await creatorContact(db)};
  }catch(error){if(!(error instanceof PublicationChanged))throw error;}
 }
 throw new ApiError(503,"El menú está actualizándose. Vuelve a abrirlo en un momento.","PUBLICATION_IN_PROGRESS");
}
