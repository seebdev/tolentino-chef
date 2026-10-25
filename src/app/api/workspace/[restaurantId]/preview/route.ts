import { context } from "@/lib/access";
import { route,json } from "@/lib/api";
import { serviceDb } from "@/lib/supabase";
import { menuContent,creatorContact,currentPromotions } from "@/lib/menu-content";
export async function GET(_request:Request,{params}:{params:Promise<{restaurantId:string}>}) {
 return route(async()=>{
  const {restaurantId}=await params;
  const c=await context(restaurantId);
  const content=await menuContent(c.db,restaurantId,true);
  return json({restaurant:c.restaurant,...content,promotions:currentPromotions(content.promotions),contact:await creatorContact(serviceDb())});
 });
}
