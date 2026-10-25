import { z } from "zod";
import { superadmin } from "@/lib/access";
import { body, json, mutationOrigin, rateLimit, route } from "@/lib/api";
import { uuid } from "@/lib/validation";
import { accessSqlError, aliasInput, establishOwnerPassword, ownerAccessState, temporaryPasswordInput } from "@/lib/owner-access";
export async function GET(request: Request) {
 return route(async()=>{
  const {db}=await superadmin();
  const id=uuid.parse(new URL(request.url).searchParams.get("restaurantId"));
  return json(await ownerAccessState(db,id));
 });
}
export async function POST(request: Request) {
 return route(async()=>{
  mutationOrigin(request);
  const {db,user}=await superadmin();
  await rateLimit(`owner-access-admin:${user.id}`,20,300);
  const input=z.object({restaurantId:uuid,requestId:uuid.optional(),action:z.enum(["set_password","alias","status"]),
    alias:aliasInput,password:temporaryPasswordInput.optional(),isActive:z.boolean().optional()}).parse(await body(request,10000));
  await rateLimit(`owner-access:${input.restaurantId}`,10,300);
  if (input.action==="set_password")
   return establishOwnerPassword(db,user.id,input.restaurantId,uuid.parse(input.requestId),input.alias,input.password);
  const result=await db.rpc("update_owner_access",{p_actor_id:user.id,p_restaurant_id:input.restaurantId,p_alias:input.alias,
    p_is_active:input.action==="status"?z.boolean().parse(input.isActive):null});
  accessSqlError(result.error);
  return json({ok:true,access:result.data});
 });
}
