"use client";
import {useEffect,useState,useCallback} from "react";
import {api,post,Button,Notice} from "./ui";
type Row={language:string;pending:number;processing:number;completed:number;failed:number;manual:number};
type State={enabled:boolean;reason:string|null;model:string;languages:Row[]};
export function TranslationStatus({restaurantId}:{restaurantId:string}) {
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const reload=useCallback(async()=>{try{setState(await api<State>("/api/workspace/"+restaurantId+"/translations"));setError("")}catch{setError("No se pudo consultar el estado de traducciones.")}},[restaurantId]);
 useEffect(()=>{let active=true;const tick=()=>{if(active)void reload()};tick();const timer=setInterval(tick,15000);return()=>{active=false;clearInterval(timer)}},[reload]);
 async function request(action:"enqueue"|"retry"|"regenerate") {
  const text=action==="regenerate"?"¿Regenerar traducciones automáticas? Se conservarán las ediciones manuales y se respetará el presupuesto de la plataforma.":"¿Programar traducciones pendientes? Se respetará el presupuesto de la plataforma.";
  if(busy||!window.confirm(text))return;setBusy(true);
  try{await post("/api/workspace/"+restaurantId+"/translations",{action,confirm:true});await reload()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const totals=state?.languages.reduce((sum,row)=>({pending:sum.pending+Number(row.pending),processing:sum.processing+Number(row.processing),completed:sum.completed+Number(row.completed),failed:sum.failed+Number(row.failed),manual:sum.manual+Number(row.manual)}),{pending:0,processing:0,completed:0,failed:0,manual:0});
 return <section className="panel form-stack" aria-label="Traducción automática">
  <h3>Traducción automática</h3><p>El menú muestra el texto original mientras falta una traducción. La importación y las traducciones se confirman por separado.</p>
  {error&&<Notice error message={error}/>}
  {state&&state.reason&&<Notice message={state.reason==="budget"?"El límite de traducciones de la plataforma se alcanzó. Los trabajos pendientes se conservan.":state.reason==="provider_unauthorized"?"El proveedor no está disponible; Tolentino debe revisar su configuración.":"Traducción pendiente: Tolentino debe habilitar la clave y el presupuesto del proveedor."}/>}
  {totals&&<p role="status" aria-live="polite">Pendientes: {totals.pending} · En proceso: {totals.processing} · Completas: {totals.completed} · Fallidas: {totals.failed} · Manuales: {totals.manual}</p>}
  {!!state?.languages.length&&<table><thead><tr><th>Idioma</th><th>Pendientes</th><th>En proceso</th><th>Completas</th><th>Fallidas</th><th>Manuales</th></tr></thead><tbody>{state.languages.map(row=><tr key={row.language}><th>{row.language.toUpperCase()}</th><td>{row.pending}</td><td>{row.processing}</td><td>{row.completed}</td><td>{row.failed}</td><td>{row.manual}</td></tr>)}</tbody></table>}
  <div className="actions"><Button variant="secondary" busy={busy} onClick={()=>void request("enqueue")}>Traducir pendientes</Button><Button variant="secondary" disabled={busy} onClick={()=>void request("retry")}>Reintentar fallidas</Button><Button variant="secondary" disabled={busy} onClick={()=>void request("regenerate")}>Regenerar automáticas</Button></div>
  <small>Una respuesta automática necesita revisión lingüística. Las correcciones manuales no se reemplazan. Un resultado completo cuenta entidades, no productos guardados.</small>
 </section>;
}
