import { z } from "zod";
import {serviceDb} from "@/lib/supabase";
import { context,sensitive,audit } from "@/lib/access";
import {route,json,body,mutationOrigin,dbError} from "@/lib/api";
import {translationConfig} from "../../../../../../scripts/translation-worker.mjs";
type Params={params:Promise<{restaurantId:string}>};
export async function GET(_request:Request,{params}:Params){return route(async()=>{
 const {restaurantId}=await params; const c=await context(restaurantId);
 const result=await c.db.rpc("translation_job_summary",{p_restaurant_id:restaurantId});dbError(result.error);
 const config=translationConfig();
 const worker=await serviceDb().rpc("translation_worker_state");dbError(worker.error);
 return json({enabled:config.enabled,reason:config.reason||worker.data?.reason||null,model:config.model,languages:result.data||[]});
})}
export async function POST(request:Request,{params}:Params){return route(async()=>{
 mutationOrigin(request);const {restaurantId}=await params;const c=await context(restaurantId);
 await sensitive(c.user.id,"translations");
 const value=z.object({action:z.enum(["enqueue","retry","regenerate"]),confirm:z.literal(true)}).parse(await body(request));
 const result=await c.db.rpc("request_menu_translations",{p_restaurant_id:restaurantId,p_action:value.action});dbError(result.error);
 if(c.role==="superadmin")await audit(c.user.id,"support_translation_"+value.action,restaurantId);
 return json({ok:true,...result.data});
})}
