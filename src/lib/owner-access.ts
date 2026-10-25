import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, dbError, json } from "./api";

export const aliasInput = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() || null : value,
  z.string().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "Usa de 3 a 32 letras, números, puntos, guiones o guiones bajos.").nullable().default(null),
);
export const temporaryPasswordInput = z.string().min(12, "Usa al menos 12 caracteres.").max(128)
  .refine((value) => !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && value.trim().length >= 12,
    "La contraseña debe tener al menos 12 caracteres y no contener caracteres de control.");
export const OWNER_PASSWORD_MESSAGE = "Debes cambiar tu contraseña temporal antes de continuar.";
export type OwnerSessionState = { valid: boolean; requiresPasswordChange: boolean; generation: string | null };
export type OwnerAccessState = {
 restaurantId: string; email: string; userId: string | null; alias: string | null;
 isActive: boolean; requiresPasswordChange: boolean; operationPending: boolean; pendingRequestId?: string | null; hasAccess: boolean;
};
type Claim = { state: string; ownerId: string; email: string; newUser: boolean; leaseToken: string; code?: string };
type ProviderError = { code?: string; status?: number };
const unavailable = () => new ApiError(503,
  "No pudimos confirmar el cambio. Reintenta la misma solicitud: no se repetirá una operación de acceso incierta.",
  "OWNER_ACCESS_UNCONFIRMED");
const pending = () => json({ok:false,pending:true,code:"OWNER_ACCESS_PENDING",
 error:"El acceso sigue en proceso. Reintenta la misma solicitud para comprobarlo."},202);
function matches(user: User, claim: Claim, actorId: string, requestId: string) {
 return user.id===claim.ownerId && user.email?.toLowerCase()===claim.email.toLowerCase() &&
  user.app_metadata?.owner_access_request_id===requestId && user.app_metadata?.owner_access_actor_id===actorId;
}
function definiteError(error: ProviderError | null): ApiError | null {
 if (["email_exists","user_already_exists"].includes(error?.code || ""))
  return new ApiError(409,"Ese correo ya pertenece a otra cuenta. No se ha adoptado ni modificado.","OWNER_EMAIL_EXISTS");
 if (["email_address_invalid","validation_failed"].includes(error?.code || ""))
  return new ApiError(400,"Revisa el correo del propietario.","OWNER_EMAIL_INVALID");
 if (["weak_password","same_password"].includes(error?.code || ""))
  return new ApiError(400,"Elige otra contraseña de al menos 12 caracteres.","PASSWORD_REJECTED");
 if (error?.status===429) return new ApiError(429,"Espera unos minutos antes de volver a establecer el acceso.","AUTH_RATE_LIMITED");
 return null;
}
export function accessSqlError(error: {code?: string;message?: string} | null) {
 if (error?.code==="23505") throw new ApiError(409,"Ese usuario de acceso ya está asignado. Elige otro.","OWNER_ALIAS_TAKEN");
 if (error?.code==="P0002") throw new ApiError(404,"No se encontró el acceso del restaurante.","OWNER_ACCESS_NOT_FOUND");
 if (error?.code==="22023") throw new ApiError(409,"El acceso está suspendido o tiene otra operación en curso. Revisa su estado.","OWNER_ACCESS_STATE");
 dbError(error);
}
export async function ownerAccessState(db: SupabaseClient, restaurantId: string) {
 const result=await db.rpc("owner_admin_state",{p_restaurant_id:restaurantId});
 accessSqlError(result.error);
 if (!result.data) throw new ApiError(404,"Restaurante no encontrado.");
 return result.data as OwnerAccessState;
}
export async function establishOwnerPassword(
 db: SupabaseClient, actorId: string, restaurantId: string, requestId: string, alias: string | null, suppliedPassword?: string,
) {
 // Passwords are never part of persisted request fingerprints, audit metadata or RPC arguments.
 const proposedPassword=suppliedPassword===undefined ? randomBytes(24).toString("base64url") : temporaryPasswordInput.parse(suppliedPassword);
 const claimed=await db.rpc("claim_owner_access",{p_actor_id:actorId,p_request_id:requestId,p_restaurant_id:restaurantId,p_alias:alias});
 accessSqlError(claimed.error);
 if (!claimed.data) throw unavailable();
 const claim=claimed.data as Claim;
 if (claim.state==="mismatch") throw new ApiError(409,"La solicitud ya se usó con otros datos. Inicia un nuevo intento.","IDEMPOTENCY_KEY_REUSED");
 if (claim.state==="completed") return json({ok:true,replayed:true,secretAvailable:false,
  message:"El acceso ya se estableció. La contraseña no se guarda; si no la recibiste, establece una nueva."});
 if (claim.state==="failed") throw new ApiError(claim.code==="OWNER_EMAIL_EXISTS"?409:400,
  "El intento anterior fue rechazado. Corrige los datos e inicia una nueva solicitud.",claim.code);
 if (claim.state==="pending") return pending();
 const lookup=await db.auth.admin.getUserById(claim.ownerId);
 if (lookup.error && lookup.error.code!=="user_not_found" && lookup.error.status!==404) throw unavailable();
 let user=lookup.data.user;
 let establishedHere=false;
 if (claim.state==="reserved") {
  if (user && ((claim.newUser && !matches(user,claim,actorId,requestId)) ||
    user.email?.toLowerCase()!==claim.email.toLowerCase()))
   throw new ApiError(409,"La identidad de acceso no coincide. No se modificó ninguna cuenta.","OWNER_IDENTITY_CONFLICT");
  // A fenced, durable transition happens BEFORE Auth. Once started, retries only
  // reconcile its server-owned marker; they never repeat an uncertain password write.
  const started=await db.rpc("begin_owner_auth",{p_actor_id:actorId,p_request_id:requestId,p_lease_token:claim.leaseToken});
  if (started.error) throw unavailable();
  if (!started.data) return pending();
  if (!user || !matches(user,claim,actorId,requestId)) {
   let providerError: ProviderError | null=null;
   try {
    const app_metadata={...user?.app_metadata,owner_access_request_id:requestId,owner_access_actor_id:actorId};
    const result=user
     ? await db.auth.admin.updateUserById(claim.ownerId,{password:proposedPassword,app_metadata})
     : await db.auth.admin.createUser({id:claim.ownerId,email:claim.email,password:proposedPassword,email_confirm:true,app_metadata});
    providerError=result.error;
    user=result.data.user;
   } catch { /* Re-read the reserved identity. Never log the provider payload. */ }
   if (!user || !matches(user,claim,actorId,requestId)) {
    const recovered=await db.auth.admin.getUserById(claim.ownerId);
    if (recovered.error && recovered.error.code!=="user_not_found" && recovered.error.status!==404) throw unavailable();
    user=recovered.data.user;
   }
   if (!user || !matches(user,claim,actorId,requestId)) {
    const failure=definiteError(providerError);
    if (failure) {
     const failed=await db.rpc("fail_owner_access",{p_actor_id:actorId,p_request_id:requestId,p_code:failure.code});
     if (failed.error || !failed.data) throw unavailable();
     throw failure;
    }
    throw unavailable();
   }
   establishedHere=true;
  }
 }
 if (!user || !matches(user,claim,actorId,requestId)) return pending();
 const completed=await db.rpc("complete_owner_access",{p_actor_id:actorId,p_request_id:requestId});
 if (completed.error) throw unavailable();
 // A completed/reconciled operation never re-displays a credential. It was not stored.
 const reveal=establishedHere && completed.data===true;
 return json({ok:true,secretAvailable:reveal,requiresPasswordChange:true,
  ...(reveal ? {temporaryPassword:proposedPassword} : {message:"Acceso confirmado. La contraseña no se conserva; establece otra si no la recibiste."})});
}
