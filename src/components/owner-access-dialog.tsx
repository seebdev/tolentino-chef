"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, post, Button, Field, Loading, Modal, Notice } from "./ui";
type Access = {email:string;alias:string|null;isActive:boolean;requiresPasswordChange:boolean;operationPending:boolean;pendingRequestId?:string|null;hasAccess:boolean};
export function OwnerAccessDialog({restaurantId,name,onClose}:{restaurantId:string;name:string;onClose:()=>void}) {
 const [access,setAccess]=useState<Access|null>(null);
 const [alias,setAlias]=useState("");
 const [password,setPassword]=useState("");
 const [manual,setManual]=useState(false);
 const [secret,setSecret]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const lock=useRef(false);
 const attempt=useRef<{signature:string;id:string}|null>(null);
 useEffect(()=>{let active=true;api<Access>("/api/admin/owner-access?restaurantId="+restaurantId).then(a=>{
  if(active){setAccess(a);setAlias(a.alias||"");}
 }).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[restaurantId]);
 async function load(){setAccess(await api<Access>("/api/admin/owner-access?restaurantId="+restaurantId));}
 async function save(event:FormEvent){
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError("");setMessage("");setSecret("");
  try{
   const data={restaurantId,action:"set_password",alias:alias.trim().toLowerCase()||null,...(manual?{password}: {})};
   const signature=JSON.stringify(data);
   if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
   const result=await post<{temporaryPassword?:string;message?:string}>("/api/admin/owner-access",{...data,requestId:access?.pendingRequestId || attempt.current.id});
   setSecret(result.temporaryPassword||"");setPassword("");attempt.current=null;
   setMessage(result.message||"Entrega esta contraseña por un canal privado. El propietario deberá cambiarla al entrar.");
   await load();
  }catch(e){const failure=e as Error & {status?:number};if([400,409,429].includes(failure.status||0))attempt.current=null;setError(failure.message);}finally{lock.current=false;setBusy(false);}
 }
 async function change(action:"alias"|"status"){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");setMessage("");setSecret("");
  try{
   await post("/api/admin/owner-access",{restaurantId,action,alias:alias.trim().toLowerCase()||null,
    ...(action==="status"?{isActive:!access?.isActive}:{})});
   await load();setMessage(action==="alias"?"Usuario de acceso guardado.":"Estado actualizado. Las sesiones anteriores quedan invalidadas.");
  }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 return <Modal preventClose={busy} title={"Acceso del propietario · "+name} onClose={()=>{setSecret("");setPassword("");onClose();}}>
  {error&&<Notice message={error} error/>}{message&&<Notice message={message}/>}
  {!access&&!error?<Loading/>:access&&<>
   <p><strong>Correo de acceso:</strong> {access.email}</p>
   <p>{!access.hasAccess?"Todavía no tiene acceso asignado.":!access.isActive?"Acceso suspendido.":access.requiresPasswordChange?"Cambio de contraseña obligatorio pendiente.":"Acceso activo."}</p>
   {access.operationPending&&<Notice message="Hay un establecimiento de acceso en proceso. Reintenta el mismo formulario para comprobar su resultado."/>}
   <form className="form-stack" onSubmit={save}>
    <Field label="Usuario de acceso (opcional)" hint="También podrá iniciar sesión con su correo. Usa de 3 a 32 letras, números, puntos, guiones o guiones bajos.">
     <input aria-label="Usuario de acceso" disabled={access.operationPending} value={alias} onChange={e=>setAlias(e.target.value)} maxLength={32} autoComplete="off" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"/>
    </Field>
    {access.hasAccess&&<Button type="button" variant="secondary" disabled={busy||access.operationPending} onClick={()=>void change("alias")}>Guardar usuario de acceso</Button>}
    <label className="check-label"><input type="checkbox" disabled={access.operationPending} checked={manual} onChange={e=>{setManual(e.target.checked);setPassword("");}}/>Escribir una contraseña temporal</label>
    {manual?<Field label="Contraseña temporal" hint="Al menos 12 caracteres. Se mostrará una vez al establecerla.">
     <input aria-label="Contraseña temporal" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128}/>
    </Field>:<p>Se generará una contraseña aleatoria segura y se mostrará una sola vez.</p>}
    <p>Esta acción invalida las sesiones anteriores. El propietario deberá cambiar la contraseña antes de administrar el restaurante. No se enviarán correos.</p>
    <Button type="submit" busy={busy} disabled={access.hasAccess&&!access.isActive}>
     {access.operationPending?"Comprobar operación pendiente":access.hasAccess?"Establecer nueva contraseña temporal":"Crear acceso del propietario"}
    </Button>
   </form>
   {secret&&<div className="panel" role="status"><strong>Contraseña temporal · copia antes de cerrar</strong>
    <p style={{overflowWrap:"anywhere",fontFamily:"monospace",fontSize:"1.1rem",userSelect:"all"}}>{secret}</p>
    <p>Esta contraseña no se conserva y no podrá volver a consultarse.</p>
   </div>}
   {access.hasAccess&&<div className="form-footer"><Button type="button" variant="secondary" disabled={busy||access.operationPending} onClick={()=>void change("status")}>
    {access.isActive?"Suspender acceso del propietario":"Reactivar acceso del propietario"}
   </Button></div>}
  </>}
 </Modal>;
}

export function OwnerAccessButton({restaurantId,name}:{restaurantId:string;name:string}) {
 const [open,setOpen]=useState(false);
 return <><Button type="button" variant="secondary" onClick={()=>setOpen(true)}>Acceso del propietario</Button>{open&&<OwnerAccessDialog restaurantId={restaurantId} name={name} onClose={()=>setOpen(false)}/>}</>;
}
