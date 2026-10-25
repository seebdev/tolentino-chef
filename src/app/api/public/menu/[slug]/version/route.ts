import { publicMenuIdentity } from "@/lib/public-menu";
import { route,json } from "@/lib/api";
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}) {
 return route(async()=>{
  const r=await publicMenuIdentity((await params).slug);
  return json({restaurantId:r.id,menu_version:r.menu_version,status:r.status,name:r.name});
 });
}
