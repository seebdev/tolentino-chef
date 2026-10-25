import type { Metadata } from "next";
import Image from "next/image";
import credits from "../../../public/photo-credits.json";

export const metadata: Metadata = {
  title: "Créditos de fotografías · Tolentino Chef",
  description: "Autoría, fuentes y licencias de las fotografías de los menús de muestra.",
};
type PhotoCredit = {
  restaurantId: string; productId: string; productName: string; title: string;
  author: string; sourceUrl: string; license: string; licenseUrl: string;
  changes: string; imagePath: string | null;
};
export default async function PhotoCreditsPage({searchParams}: {
  searchParams: Promise<{restaurant?: string | string[]}>;
}) {
  const selected = (await searchParams).restaurant;
  const items: PhotoCredit[] = credits.items;
  const shown = items.filter(item => item.imagePath &&
    (typeof selected !== "string" || item.restaurantId === selected));
  return <main style={{maxWidth: 1000, margin: "0 auto", padding: "40px 20px 64px"}}>
    <header style={{display:"grid", gap:16, marginBottom:32}}>
      <p style={{fontWeight:700}}>Tolentino Chef</p>
      <h1>Créditos de fotografías</h1>
      <p>Estos menús son ejemplos de diseño. Las fotografías conservan la autoría y la licencia indicadas a continuación.</p>
      <p>El ajuste de tamaño, orientación y formato de las imágenes no implica el respaldo de sus autores a Tolentino Chef.</p>
    </header>
    {shown.length === 0 ? <p>No hay fotografías de terceros registradas para este menú.</p> :
      <ul style={{listStyle:"none", padding:0, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,280px),1fr))", gap:24}}>
        {shown.map(item => <li key={item.productId} style={{border:"1px solid #dce3d8", borderRadius:16, padding:20, background:"#fff", display:"grid", gap:12, alignContent:"start", overflowWrap:"anywhere"}}>
          <Image src={`/api/media/${item.imagePath}`} alt={item.productName} width={320} height={220} unoptimized loading="lazy" style={{width:"100%",height:220,objectFit:"contain",borderRadius:8}} />
          <h2 style={{fontSize:20}}>{item.productName}</h2>
          <p><strong>{item.title}</strong> — {item.author}</p>
          <p><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" style={{textDecoration:"underline",display:"inline-block",padding:"8px 0"}}>Fuente original</a>{" · "}<a href={item.licenseUrl} target="_blank" rel="noopener noreferrer" style={{textDecoration:"underline",display:"inline-block",padding:"8px 0"}}>{item.license}</a></p>
          <p style={{fontSize:13,lineHeight:1.5}}>Modificaciones: orientación y tamaño ajustados; conversión a WebP y eliminación de metadatos. Sin ediciones generativas.</p>
          <p style={{fontSize:13,lineHeight:1.5}}>La licencia indicada se aplica a esta fotografía y a su versión adaptada.</p>
        </li>)}
      </ul>}
  </main>;
}