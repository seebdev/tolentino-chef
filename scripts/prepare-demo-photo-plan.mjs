import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {ROOT,loadBackupKey,decryptArchive,sha256,ensure,digest} from './backup-common.mjs';
import {demos,englishCatalog,artwork} from './demo-catalog.mjs';
const TARGET='hgntppemxwcxaxritnfq';
const identities={aurora:'1932e721-78ab-4320-9f84-f186a80fba48',bruma:'eca7481c-fc27-479c-b364-76274b0b4230',marea:'e2cda10d-2771-4056-8cf0-13e00f4b1bd8'};
export const sources=[
 {id:'margherita',title:'PizzaMargherita.jpg',skus:['DEMO-AURORA-01']},
 {id:'cappuccino',title:'Cappuccino in original.jpg',skus:['DEMO-BRUMA-02']},
 {id:'espresso',title:'Espresso Coffee 01.jpg',skus:['DEMO-AURORA-16','DEMO-BRUMA-01']},
 {id:'croissant',title:'Croissant bread.jpg',skus:['DEMO-BRUMA-09']},
 {id:'matcha-latte',title:'Matcha Latte - 17 GRAMS 2024-02-05.jpg',skus:['DEMO-BRUMA-21']},
 {id:'gyoza',title:'Gyōza 004.jpg',skus:['DEMO-MAREA-13']},
 {id:'edamame',title:'Edamame - Massachusetts.jpg',skus:['DEMO-MAREA-14']},
 {id:'california-roll',title:'California roll.jpg',skus:['DEMO-MAREA-02']},
 {id:'shoyu-ramen',title:'Shoyu Ramen.jpg',skus:['DEMO-MAREA-05']},
 {id:'tiramisu',title:'Tiramisu-simple.jpg',author:'Sebastian Kügler',skus:['DEMO-AURORA-17']},
 {id:'panna-cotta',title:'Panna cotta à Dole (Jura).JPG',skus:['DEMO-AURORA-18']},
 {id:'margherita-basil',title:'Pizza Margherita.jpg',skus:['DEMO-AURORA-01']},
 {id:'cappuccino-art',title:'Latte art on cappuccino (Unsplash).jpg',skus:['DEMO-BRUMA-02']},
 {id:'panna-cotta-berries',title:'Panna Cotta with fresh berries.jpg',skus:['DEMO-AURORA-18']},
 {id:'bruschetta',title:'Bruschetta.jpg',skus:['DEMO-AURORA-09']},
 {id:'pesto-spaghetti',title:'Pesto pasta - Stierch.jpg',author:'Sarah Stierch',skus:['DEMO-AURORA-08']},
 {id:'japanese-cheesecake',title:'Japanese cheesecake 1.jpg',skus:['DEMO-MAREA-22']},
 {id:'cinnamon-roll',title:'Cinnamon Roll 003.jpg',skus:['DEMO-BRUMA-10']},
 {id:'carrot-cake',title:'Carrot cake, Eppstein.jpg',skus:['DEMO-BRUMA-18']},
 {id:'carrot-cake-slice',title:'Carrot cake 4.jpg',skus:['DEMO-BRUMA-18']},
 {id:'tiramisu-glass',title:'001 Tiramisu.jpg',skus:['DEMO-AURORA-17']},
 {id:'margherita-overhead',title:'Margarita Pizza.jpg',skus:['DEMO-AURORA-01']},
 {id:'margherita-plate',title:'Margherita pizza.jpg',skus:['DEMO-AURORA-01']},
 {id:'croissant-flaky',title:'Croissant-Petr Kratochvil.jpg',skus:['DEMO-BRUMA-09']},
 {id:'burrata',title:'At New York City 2023 149.jpg',skus:['DEMO-AURORA-10']},
 {id:'focaccia',title:'Rosemary Focaccia.jpg',author:'Parkerman & Christie from San Diego, USA',skus:['DEMO-AURORA-12']},
 {id:'cannoli',title:'Cannoli with chocolate.jpg',skus:['DEMO-AURORA-20']},
 {id:'pistachio-gelato',title:'Gelato al Pistacchio.jpg',skus:['DEMO-AURORA-19']},
 {id:'cold-brew',title:'Iced cold brew coffee.jpg',skus:['DEMO-BRUMA-05']},
 {id:'iced-latte',title:'Iced Latte.jpg',skus:['DEMO-BRUMA-06']},
 {id:'iced-latte-glass',title:'Iced latte - BROR 2025-04-26.jpg',skus:['DEMO-BRUMA-06']},
 {id:'pain-chocolat',title:'Pain au Chocolat on a plate.jpg',skus:['DEMO-BRUMA-11']},
 {id:'granola',title:'Granola and yogurt - Bubbles + Brunch 2018 - Sarah Stierch 02 cropped.jpg',author:'Sarah Stierch',skus:['DEMO-BRUMA-15']},
 {id:'tempura',title:'Tempura 02.jpg',skus:['DEMO-MAREA-15']},
 {id:'wakame',title:'Wakame salad.jpg',skus:['DEMO-MAREA-16']},
 {id:'teriyaki',title:'Chicken teriyaki.jpg',skus:['DEMO-MAREA-10']},
 {id:'quattro-formaggi',title:'Four cheese pizza.jpg',skus:['DEMO-AURORA-04']},
 {id:'tagliatelle-ragu',title:'Tagliatelle al ragù.jpg',skus:['DEMO-AURORA-05']},
 {id:'ravioli',title:'Ravioli spinach .jpg',skus:['DEMO-AURORA-07']},
 {id:'blueberry-scone',title:'Blueberry scones.jpg',skus:['DEMO-BRUMA-12']},
 {id:'oat-cookie',title:'Chocolate Chip Oatmeal Cookies detail.jpg',skus:['DEMO-BRUMA-20']},
 {id:'jasmine-tea',title:'Jasmine tea in a glass (8658148091).jpg',skus:['DEMO-MAREA-17']},
 {id:'vegetable-tempura',title:'Vegetable Tempura - Siam Siam 2024-07-31.jpg',skus:['DEMO-MAREA-15']},
 {id:'chicken-rice',title:'Chicken and egg fried rice.jpg',skus:['DEMO-MAREA-09']},
 {id:'mushroom-rice',title:'"Mushroom Fried Rice".jpg',skus:['DEMO-MAREA-11']},
 {id:'vanilla-latte',title:'104th Behind Credo Vanilla Latte (4605982912).jpg',skus:['DEMO-BRUMA-03']},
 {id:'espresso-tonic',title:'Espresso Tonic.jpg',skus:['DEMO-BRUMA-07']},
 {id:'hot-chocolate',title:'Hot-chocolate-1058197.jpg',skus:['DEMO-BRUMA-23']},
 {id:'hot-chocolate-cup',title:'Hot chocolate (Unsplash).jpg',skus:['DEMO-BRUMA-23']},
 {id:'peach-tea',title:'Peach iced tea.jpg',skus:['DEMO-AURORA-15']},
 {id:'avocado-toast',title:'Colorful Avocado Toast with Onion, Tomato, and Lemon on Sourdough Bread.jpg',skus:['DEMO-BRUMA-13']},
 {id:'tantan-ramen',title:'Tantanmen, Opéra Ramen, Paris 001.jpg',skus:['DEMO-MAREA-07']},
 {id:'vegan-ramen',title:'At London 2023 045.jpg',skus:['DEMO-MAREA-08']},
 {id:'granola-bowl',title:'Granola and Yogurt.jpg',skus:['DEMO-BRUMA-15']},
 {id:'peach-tea-glass',title:'A peach ice tea.jpg',skus:['DEMO-AURORA-15']},
 {id:'cheesecake-berries',title:'Cheesecake mit Beeren.jpg',author:'© Alice Wiegand / CC BY-SA 4.0 (via Wikimedia Commons)',skus:['DEMO-BRUMA-17']},
 {id:'chai',title:'A cup of chai.JPG',skus:['DEMO-BRUMA-22']},
 {id:'spaghetti-genovese',title:'Spaghetti con pesto alla genovese.jpg',skus:['DEMO-AURORA-08']},
 {id:'bruschetta-fresh',title:'Bruschetta with Tomatoes-01.jpg',skus:['DEMO-AURORA-09']},
 {id:'bruschetta-tomato',title:'Tomato Bruschetta.jpg',skus:['DEMO-AURORA-09']},
 {id:'brownie',title:'Chocolatebrownie.JPG',skus:['DEMO-BRUMA-19']},
 {id:'pistachio-cup',title:'Homemade pistacchio Icecream in a cup (KETO, LCHF, Low Carb, Gluten free, FIT) - 52775014433.jpg',skus:['DEMO-AURORA-19']},
 {id:'diavola',title:'Pizza diavola 20250518 130356.jpg',skus:['DEMO-AURORA-02']},
 {id:'diavola-honey',title:'Kotipizza Diavola.jpg',skus:['DEMO-AURORA-02']},
 {id:'penne-primavera',title:'Penne primavera closeup (10614630485).jpg',skus:['DEMO-AURORA-06']},
 {id:'seaweed-salad',title:'Seaweed Salad.jpg',skus:['DEMO-MAREA-16']},
 {id:'wakame-sesame',title:'Wakame with sesame oil.jpg',skus:['DEMO-MAREA-16']},
 {id:'mochi-three',title:'Mochi Ice Cream.jpg',skus:['DEMO-MAREA-21']},
 {id:'matcha-icecream',title:'Matcha ice cream 001 (cropped).jpg',skus:['DEMO-MAREA-23']},
 {id:'diavola-clean',title:'DiavoloPizza.jpg',skus:['DEMO-AURORA-02']},
 {id:'ravioli-sage',title:'Ravioli in sage butter.jpg',skus:['DEMO-AURORA-07']},
 {id:'ravioli-burro',title:'Ravioli burro e salvia.jpg',skus:['DEMO-AURORA-07']},
 {id:'teriyaki-rice',title:'TeriyakiChickenWithRice.jpg',skus:['DEMO-MAREA-10']},
 {id:'mochi-decorated',title:'20251212 Mochi ice cream.jpg',skus:['DEMO-MAREA-21']},
];
export const visualReviews={
 'margherita':['REJECTED','Sin albahaca visible; se eligió una coincidencia mejor.'],
 'cappuccino':['REJECTED','Marca comercial de otra cafetería visible en el plato.'],
 'espresso':['SELECTED','Taza de espresso sin marca; sólo los dos SKU de espresso.'],
 'croissant':['REJECTED','Pan de media luna liso, sin hojaldre visible.'],
 'matcha-latte':['SELECTED','Matcha y leche visibles; sin marca legible.'],
 'gyoza':['SELECTED','Seis dumplings dorados visibles; foto de referencia, no evidencia de receta o alérgenos.'],
 'edamame':['SELECTED','Vainas de edamame cocidas: plato inequívoco sin contradicción visible. La foto no permite verificar aceite/sésamo ni alérgenos.'],
 'california-roll':['SELECTED','Detalle del roll con pepino y aguacate; no representa una cantidad de porciones.'],
 'shoyu-ramen':['REJECTED','Carnes y guarniciones adicionales no descritas en el producto.'],
 'tiramisu':['SELECTED','Bizcocho, crema y cacao visibles en detalle; menor nitidez que fotos modernas.'],
 'panna-cotta':['REJECTED','Guarnición de naranja, sin frutos rojos.'],
 'margherita-basil':['REJECTED','Personas y envoltorio de marca en cuadro; encuadre poco apropiado para catálogo.'],
 'cappuccino-art':['SELECTED','Taza sin marca con leche texturizada; Commons documenta CC0 anterior a junio de 2017.'],
 'panna-cotta-berries':['SELECTED','Crema con frutos rojos; corresponde a la descripción.'],
 'bruschetta':['REJECTED','Tomates parecen secos/asados; la receta promete tomate fresco.'],
 'pesto-spaghetti':['REJECTED','Pasta visible plana; el producto promete spaghetti.'],
 'japanese-cheesecake':['SELECTED','Bizcocho japonés ligero; encuadre no debe prometer el pastel completo como porción.'],
 'cinnamon-roll':['SELECTED','Un roll de canela con glaseado, sin marca visible.'],
 'carrot-cake':['REJECTED','Café junto al pastel sugiere un combo no incluido; cobertura no comprobable.'],
 'carrot-cake-slice':['REJECTED','No hay cobertura de queso visible.'],
 'tiramisu-glass':['REJECTED','Vino, café y otros alimentos en cuadro no incluidos en el producto.'],
 'margherita-overhead':['SELECTED','Tomate, mozzarella y albahaca; una pizza, sin marca visible.'],
 'margherita-plate':['REJECTED','Ingredientes adicionales y marca en tabla; no corresponde a la receta simple.'],
 'croissant-flaky':['SELECTED','Hojaldre individual sin marca. Conservar también enlace al sitio original solicitado en la página de fuente.'],
 'burrata':['SELECTED','Burrata con tomates y aceite; corresponde al plato, con sombra visible en el encuadre.'],
 'focaccia':['SELECTED','Pan con romero y sal visibles.'],
 'cannoli':['SELECTED','Cannoli rellenos de crema y chocolate; la descripción no fija cantidad.'],
 'pistachio-gelato':['REJECTED','Texto y firma incrustados; no se retirarán.'],
 'cold-brew':['SELECTED','Café negro frío con hielo, encuadre sin marca.'],
 'iced-latte':['SELECTED','Café con leche y hielo sin marca; aparece mano y vaso para llevar.'],
 'iced-latte-glass':['REJECTED','Personas reconocibles y local ajeno dominan el encuadre.'],
 'pain-chocolat':['SELECTED','Hojaldre y relleno de chocolate visibles, sin marca.'],
 'granola':['REJECTED','Cuatro vasos de yogur; no se aprecia granola y no representa un bowl.'],
 'tempura':['REJECTED','Incluye camarones; el producto es exclusivamente vegetal.'],
 'wakame':['REJECTED','Tomates, nueces y fruta adicional no corresponden a la receta sencilla.'],
 'teriyaki':['REJECTED','No aparecen arroz ni verduras del bowl descrito.'],
 'quattro-formaggi':['SELECTED','Pizza de cuatro quesos; no muestra ingredientes ajenos a los quesos.'],
 'tagliatelle-ragu':['SELECTED','Cintas de pasta con ragú; primer plano sin marca.'],
 'ravioli':['REJECTED','Salsa de crema abundante; la receta especifica mantequilla de salvia.'],
 'blueberry-scone':['SELECTED','Scone con arándanos; primer plano de una pieza, otras al fondo.'],
 'oat-cookie':['SELECTED','Detalle de galleta de avena con chocolate; conservar borde original.'],
 'jasmine-tea':['SELECTED','Té verde y flores de jazmín en vaso; detalle de la infusión.'],
 'vegetable-tempura':['REJECTED','Rebozado y salsa parecen panko/chile dulce; no corresponden claramente a tempura con tentsuyu.'],
 'chicken-rice':['SELECTED','Arroz salteado, pollo, huevo y verduras visibles; no es una fotografía de una cocina cliente.'],
 'mushroom-rice':['SELECTED','Arroz con hongos; no aparecen proteínas ajenas a la descripción.'],
 'vanilla-latte':['REJECTED','Taza desenfocada; calle y marcas ajenas dominan la foto.'],
 'espresso-tonic':['REJECTED','Guarnición de limón/lima en lugar de piel de naranja.'],
 'hot-chocolate':['SELECTED','Cacao con leche sin marca; fotografía de referencia, no certifica origen colombiano.'],
 'hot-chocolate-cup':['REJECTED','Composición editorial con libro visible; seleccionada alternativa centrada en bebida.'],
 'peach-tea':['REJECTED','Tres bebidas de distintos colores; no queda claro cuál representa durazno.'],
 'avocado-toast':['REJECTED','La imagen representa guacamole con cebolla y limón, no sólo aguacate y tomate.'],
 'tantan-ramen':['SELECTED','Caldo de sésamo con carne, fideos y aceite picante; encuadre sin marca.'],
 'vegan-ramen':['REJECTED','Nombre comercial de otro restaurante visible en el bowl.'],
 'granola-bowl':['REJECTED','Vaso de marca ajena, no bowl; granola apenas visible.'],
 'peach-tea-glass':['REJECTED','Publicidad de otro restaurante domina la mesa y hay personas al fondo.'],
 'cheesecake-berries':['SELECTED','Porción de cheesecake con frutos rojos y salsa; conservar crédito literal solicitado por la autora.'],
 'chai':['REJECTED','La foto muestra chai con leche; el producto describe una infusión sin leche.'],
 'spaghetti-genovese':['SELECTED','Spaghetti con pesto verde y parmesano visibles; sin marca.'],
 'bruschetta-fresh':['SELECTED','Pan tostado con tomate fresco y albahaca picada, sin marca.'],
 'bruschetta-tomato':['REJECTED','Cebolla abundante no descrita en el producto; hay una alternativa más fiel.'],
 'brownie':['SELECTED','Brownie de chocolate inequívoco. Nueces internas no visibles no prueban ausencia; la imagen representa el plato y no certifica receta o alérgenos.'],
 'pistachio-cup':['SELECTED','Helado de pistacho con pistachos troceados en copa, sin marca comercial visible.'],
 'diavola':['REJECTED','Pizza cortada y parcialmente consumida, marcas de cerveza y publicidad ajena visibles.'],
 'diavola-honey':['REJECTED','La fuente declara salchicha nduja adicional a salami; no se fuerza coincidencia con receta semilla.'],
 'penne-primavera':['REJECTED','Salsa clara y sin tomate visible; composición y marca de autor incrustada no son la mejor correspondencia.'],
 'seaweed-salad':['REJECTED','Se prefiere alternativa sin utensilios con texto que cubren el plato.'],
 'wakame-sesame':['SELECTED','Ensalada wakame con sésamo inequívoca; detalle representativo sin afirmar ingredientes internos o alérgenos.'],
 'mochi-three':['REJECTED','La fotografía muestra muchas piezas; el producto promete tres.'],
 'matcha-icecream':['SELECTED','Helado de té verde inequívoco; la foto no verifica sésamo ni alérgenos.'],
 'diavola-clean':['REJECTED','Pimientos y cebolla abundantes adicionales; no se fuerza correspondencia de receta.'],
 'ravioli-sage':['REJECTED','Plato pertinente pero imagen muy oscura y con ruido; no apta como foto final del catálogo.'],
 'ravioli-burro':['REJECTED','Encuadre oscuro y pasta desenfocada; calidad insuficiente para catálogo.'],
 'teriyaki-rice':['REJECTED','Primer plano oscuro y con ruido del pollo/arroz; se conserva como candidata, sin usar como imagen final.'],
 'mochi-decorated':['SELECTED','Tres mochis de colores diferentes en plato, sin marcas; decoración propia de la foto, no se certifica el sabor interno.'],
};
// Additional candidates inspected independently on 2026-10-25; recipe text is unchanged.
const extraCandidates=JSON.parse(readFileSync(resolve(ROOT,'scripts/closure-photo-extra-sources.json'),'utf8'));
for(const candidate of extraCandidates.sources.filter(s=>Object.values(extraCandidates.mapping).includes(s.id))){
 for(const prior of sources)if(prior.skus.some(sku=>candidate.skus.includes(sku))&&visualReviews[prior.id]?.[0]==='SELECTED')visualReviews[prior.id]=['REJECTED','Replaced by independently reviewed candidate '+candidate.id+'.'];
 sources.unshift(candidate);
 visualReviews[candidate.id]=extraCandidates.reviews[candidate.id];
}
const sourceForSku=sku=>sources.find(s=>s.skus.includes(sku)&&visualReviews[s.id]?.[0]==='SELECTED');
const plain=value=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
async function publicGet(url,limit){
 const target=new URL(url);ensure(target.protocol==='https:'&&['commons.wikimedia.org','upload.wikimedia.org','thumb.wikimedia.org'].includes(target.hostname),'PUBLIC_HOST_INVALID','Host público no permitido.');
 const response=await fetch(target,{method:'GET',redirect:'error',headers:{'User-Agent':'TolentinoDemoPhotoResearch/1.0 (local asset licensing review; no authentication)'},signal:AbortSignal.timeout(45000)});
 ensure(response.ok,'PUBLIC_FETCH_FAILED','No se pudo descargar un recurso público.');
 const length=Number(response.headers.get('content-length'));ensure(!length||length<=limit,'PUBLIC_FILE_LIMIT','Recurso demasiado grande.');
 const chunks=[];let total=0;for await(const chunk of response.body){total+=chunk.length;ensure(total<=limit,'PUBLIC_FILE_LIMIT','Recurso demasiado grande.');chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function prepareSource(source,out){
 ensure(/^[a-z0-9-]{1,80}$/.test(source.id),'ASSET_ID_INVALID','Identificador local no permitido.');
 const cachedFile=resolve(out,source.id+'.metadata.json');
 if(existsSync(cachedFile)){const cached=JSON.parse(readFileSync(cachedFile,'utf8'));if(cached.title===source.title&&cached.optimized&&existsSync(resolve(out,cached.optimized.file))&&sha256(readFileSync(resolve(out,cached.optimized.file)))===cached.optimized.sha256)return cached;}
 const api=new URL('https://commons.wikimedia.org/w/api.php');api.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',titles:'File:'+source.title,iiprop:'url|size|mime|extmetadata',iiurlwidth:'1200'});
 const metadata=JSON.parse((await publicGet(api,2_000_000)).toString('utf8'));const page=Object.values(metadata.query?.pages??{})[0],info=page?.imageinfo?.[0];ensure(info,'PHOTO_METADATA_MISSING','Falta metadata oficial de la fotografía.');
 const ext=info.extmetadata||{},license=plain(ext.LicenseShortName?.value),licenseUrl=plain(ext.LicenseUrl?.value);
 ensure(/^(CC0|CC BY(?:-SA)? [234]\.0|CC BY(?:-SA)? 2\.5|Public domain)$/i.test(license),'LICENSE_REVIEW_REQUIRED','Revisar licencia antes de descargar.');
 ensure(/image\/(jpeg|png|webp)/.test(info.mime),'RASTER_PHOTO_REQUIRED','Sólo fotografías raster.');
 const file=await publicGet(info.thumburl||info.url,12_000_000);
 const decoded=sharp(file,{limitInputPixels:40_000_000});const dimensions=await decoded.metadata();ensure(dimensions.width>=400&&dimensions.height>=300,'PHOTO_TOO_SMALL','Fotografía demasiado pequeña.');
 const optimized=await decoded.rotate().resize({width:1200,height:1000,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:6}).toBuffer();ensure(optimized.length<1_000_000,'PHOTO_NOT_OPTIMIZED','Fotografía optimizada demasiado grande.');
 writeFileSync(resolve(out,source.id+'.webp'),optimized);
 const record={...source,pageId:page.pageid,sourcePage:info.descriptionurl,originalUrl:info.url,downloadUrl:info.thumburl||info.url,author:source.author||plain(ext.Artist?.value)||'',credit:plain(ext.Credit?.value),license,licenseUrl,description:plain(ext.ImageDescription?.value),originalDimensions:{width:info.width,height:info.height},downloadSha256:sha256(file),optimized:{file:source.id+'.webp',bytes:optimized.length,sha256:sha256(optimized),changes:'Orientation normalized; resized inside 1200x1000 without upscaling; WebP quality 82; metadata stripped. No generative edits.'},visualReview:'PENDING',attributionRequired:license!=='CC0'&&license!=='Public domain',shareAlike:license.includes('SA')};
 writeFileSync(resolve(out,source.id+'.metadata.json'),JSON.stringify(record,null,2)+'\n');return record;
}
export function seedInventory(payload,originalImageHashes={}){
 ensure(payload.manifest.projectRef===TARGET,'TARGET_MISMATCH','Respaldo ajeno al destino autorizado.');
 const rows=[];let excluded=0;
 for(const demo of demos){
  const restaurant=payload.tables.restaurants.find(r=>r.id===identities[demo.key]);
  ensure(restaurant?.is_demo===true&&restaurant.owner_email===demo.email&&restaurant.owner_email.endsWith('.test'),'DEMO_GUARD','La muestra no conserva sus marcas privadas.');
  const products=payload.tables.products.filter(p=>p.restaurant_id===restaurant.id);let index=0;const seedSkus=new Set();
  for(const [categoryIndex,[, , ...items]] of demo.categories.entries())for(const item of items){
   const sku='DEMO-'+demo.key.toUpperCase()+'-'+String(++index).padStart(2,'0');seedSkus.add(sku);const found=products.filter(p=>p.sku===sku);ensure(found.length<=1,'DUPLICATE_SEED','SKU de muestra duplicado.');const product=found[0];const source=sourceForSku(sku);
   const unchanged=product&&product.name===item[0]&&product.description===item[2]+' Producto de demostración.';
   const object=product&&payload.objects.find(o=>o.path===product.image_path);
   const originalImageVerified=!!object&&object.sha256===originalImageHashes[demo.key+'-'+categoryIndex];
   rows.push({restaurantKey:demo.key,restaurantId:restaurant.id,productId:product?.id??null,sku,seedName:item[0],seedDescription:item[2],currentImagePath:product?.image_path??null,currentImageSha256:object?.sha256??null,originalImageVerified,seedTextUnchanged:!!unchanged,proposedSourceId:unchanged&&originalImageVerified?source?.id??null:null,status:!product?'MISSING_PRESERVE':!unchanged?'USER_EDIT_PRESERVE':!originalImageVerified?'IMAGE_UNVERIFIED_PRESERVE':source?'PHOTO_SELECTED_PENDING_COORDINATOR_APPLY':'NO_MATCH_NEUTRAL_PLACEHOLDER_REQUIRED',applyAllowed:false});
  }
  excluded+=products.filter(p=>!seedSkus.has(p.sku)).length;
 }
 ensure(rows.length===72,'SEED_COUNT','Inventario semilla inesperado.');return {rows,excludedNonSeedProducts:excluded};
}
export async function originalSeedImageHashes(){
 const hashes={};for(const demo of demos)for(const [index]of demo.categories.entries()){
  const file=resolve(ROOT,'artifacts/demo',demo.key+'-category-'+index+'.png');if(!existsSync(file))continue;
  const bytes=await sharp(readFileSync(file),{limitInputPixels:16000000,animated:false}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();hashes[demo.key+'-'+index]=sha256(bytes);
 }
 for(const demo of demos)for(const type of ['logo','cover']){const file=resolve(ROOT,'artifacts/demo',demo.key+'-'+type+'.png');if(!existsSync(file))continue;const bytes=await sharp(readFileSync(file),{limitInputPixels:16000000,animated:false}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();hashes[demo.key+'-'+type]=sha256(bytes);}
 return hashes;
}
export function brandingInventory(payload,hashes){
 return demos.map(demo=>{const row=payload.tables.restaurant_settings?.find(s=>s.restaurant_id===identities[demo.key]),appearance=row?.appearance??{},draft=row?.draft_appearance??{};const image=type=>{const path=appearance[type+'_path']??null,object=payload.objects.find(o=>o.path===path);return {currentPath:path,currentSha256:object?.sha256??null,originalVerified:!!object&&object.sha256===hashes[demo.key+'-'+type]};};return {restaurantKey:demo.key,restaurantId:identities[demo.key],logo:image('logo'),cover:image('cover'),faviconUsesLogo:appearance.favicon_path===appearance.logo_path,draftLogoMatchesPublished:draft.logo_path===appearance.logo_path,heroTextContainsDemo:/DEMO|demostraci|Demonstration/i.test(appearance.hero_text??''),draftHeroTextContainsDemo:/DEMO|demostraci|Demonstration/i.test(draft.hero_text??''),proposedLogoFile:demo.key+'-logo-clean.webp',coverAction:'PRESERVE_ALREADY_WITHOUT_TEXT',applyAllowed:false};});
}
export async function prepareCleanLogos(out){
 const result=[];for(const demo of demos){const svg=artwork(demo,'',0,true).replace(/<text\b[^>]*>DEMO<\/text>/,'');ensure(!svg.includes('DEMO'),'LOGO_CLEAN_FAILED','Texto de muestra todavía visible.');const bytes=await sharp(Buffer.from(svg)).webp({quality:90}).toBuffer();const file=demo.key+'-logo-clean.webp';writeFileSync(resolve(out,demo.key+'-logo-clean.svg'),svg+'\n');writeFileSync(resolve(out,file),bytes);result.push({restaurantKey:demo.key,file,bytes:bytes.length,sha256:sha256(bytes),source:'Original project SVG monogram; removed only DEMO text element. No third-party photo.',license:'Original project artwork'});}return result;
}
export function copyInventory(payload,inventory){
 const proposals=[],translations=[];
 for(const demo of demos){
  const id=identities[demo.key],restaurant=payload.tables.restaurants.find(r=>r.id===id);
  const add=(table,row,expected,changes)=>{if(row&&Object.entries(expected).every(([key,value])=>row[key]===value))proposals.push({table,id:row.id??null,restaurantId:id,expected,changes,applyAllowed:false});};
  add('restaurants',restaurant,{name:demo.name},{name:demo.name.replace(/ · DEMO$/,'')});
  for(const row of payload.tables.restaurant_qr_configs??[])if(row.restaurant_id===id)add('restaurant_qr_configs',row,{label:demo.name},{label:demo.name.replace(/ · DEMO$/,'')});
  for(const table of ['restaurants','restaurant_settings'])for(const row of payload.tables[table]??[])if(row.id===id||row.restaurant_id===id)add(table,row,{description:demo.description},{description:demo.description.replace(/^DEMO · /,'')});
  for(const row of payload.tables.promotions??[])if(row.restaurant_id===id)add('promotions',row,{title:demo.promo,description:demo.promoDescription},{title:demo.promo.replace(/ · DEMO$/,''),description:demo.promoDescription.replace(/ Productos y precios de demostración\.$/,'').replace(/ Contenido ficticio para probar la plataforma\.$/,'')});
  const seedRows=inventory.rows.filter(r=>r.restaurantId===id);
  for(const [index,seed]of seedRows.entries()){
   const product=payload.tables.products.find(p=>p.id===seed.productId);
   if(seed.seedTextUnchanged)add('products',product,{name:seed.seedName,description:seed.seedDescription+' Producto de demostración.'},{description:seed.seedDescription});
   const expected=englishCatalog[demo.key].products[index];
   const matches=(payload.tables.translations??[]).filter(t=>t.restaurant_id===id&&t.entity_type==='product'&&t.entity_id===seed.productId&&t.language==='en');
   ensure(matches.length<=1,'TRANSLATION_AMBIGUOUS','Traducción semilla duplicada.');const row=matches[0];
   const verified=seed.seedTextUnchanged&&row&&digest(row.fields)===digest(expected);
   translations.push({restaurantId:id,entityType:'product',entityId:seed.productId,language:'en',status:verified?'SEED_EXACT_DESCRIPTION_CLEANUP':'NOT_EXACT_PRESERVE',expectedFieldsSha256:row?digest(row.fields):null,fields:verified?{...row.fields,description:row.fields.description.replace(/ Demonstration product\.$/,'')}:null,applyAllowed:false});
  }
  for(const [sourceName,englishName]of Object.entries(englishCatalog[demo.key].categories)){
   const categories=(payload.tables.categories??[]).filter(c=>c.restaurant_id===id&&c.name===sourceName);
   ensure(categories.length<=1,'CATEGORY_AMBIGUOUS','Categoría semilla ambigua.');const category=categories[0];
   const matches=(payload.tables.translations??[]).filter(t=>t.restaurant_id===id&&t.entity_type==='category'&&t.entity_id===category?.id&&t.language==='en');
   ensure(matches.length<=1,'TRANSLATION_AMBIGUOUS','Traducción semilla duplicada.');const row=matches[0];
   const verified=row&&digest(row.fields)===digest({name:englishName});
   translations.push({restaurantId:id,entityType:'category',entityId:category?.id??null,language:'en',status:verified?'SEED_EXACT_NO_CHANGE':'NOT_EXACT_PRESERVE',expectedFieldsSha256:row?digest(row.fields):null,fields:null,applyAllowed:false});
  }
 }
 return {proposals,translations,translationRule:'Only exact original seeded English fields may be cleaned; is_manual alone is not authorization. Other languages, entities and edited fields are preserved.'};
}
async function main(){
 const arg=name=>{const i=process.argv.indexOf(name);ensure(i>=0&&process.argv[i+1],'ARGUMENT_REQUIRED','Falta un argumento local.');return process.argv[i+1];};
 ensure(!process.argv.includes('--apply'),'APPLY_NOT_SUPPORTED','Este script sólo prepara una propuesta local.');
 const archivePath=resolve(ROOT,arg('--archive')),expected=arg('--sha256');const rel=relative(resolve(ROOT,'.runtime/backups'),archivePath);ensure(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith('..')&&!rel.includes(':')&&archivePath.endsWith('.json.enc'),'ARCHIVE_PATH','Archivo fuera del directorio autorizado.');
 const archive=readFileSync(archivePath);ensure(sha256(archive)===expected,'ARCHIVE_SHA','El respaldo no coincide.');const originalImageHashes=await originalSeedImageHashes();let key;let inventory,copy,branding,variantsExtrasDemoCount;try{key=loadBackupKey(false).key;const payload=decryptArchive(archive,key);inventory=seedInventory(payload,originalImageHashes);copy=copyInventory(payload,inventory);branding=brandingInventory(payload,originalImageHashes);variantsExtrasDemoCount=payload.tables.products.filter(p=>Object.values(identities).includes(p.restaurant_id)&&/DEMO|demostraci|Demonstration/i.test(JSON.stringify([p.variants,p.extras]))).length;}finally{key?.fill(0);}
 const out=resolve(ROOT,'.runtime/assets-proposed');mkdirSync(out,{recursive:true});
 const logos=await prepareCleanLogos(out);
 const prepared=[];for(const source of sources){try{const record=process.argv.includes('--download')?await prepareSource(source,out):JSON.parse(readFileSync(resolve(out,source.id+'.metadata.json'),'utf8'));ensure(record.title===source.title&&record.optimized&&sha256(readFileSync(resolve(out,record.optimized.file)))===record.optimized.sha256,'LOCAL_ASSET_INVALID','Archivo local no coincide.');record.author=source.author||record.author;record.visualReview={status:visualReviews[source.id]?.[0]||'PENDING',note:visualReviews[source.id]?.[1]||'Not inspected yet.',method:'Static inspection of optimized WebP using view_image; no restaurant or recipe authentication.'};prepared.push(record);}catch(error){prepared.push({id:source.id,status:'FAILED',code:error.code||'PHOTO_PREPARATION_FAILED'});}}
 const evidence={at:new Date().toISOString(),mode:'DRY_RUN_ONLY',targetProjectRef:TARGET,archiveSha256:expected,remoteBusinessMutations:false,authRequests:false,storageWrites:false,seedCount:inventory.rows.length,excludedNonSeedProducts:inventory.excludedNonSeedProducts,inventorySha256:digest(inventory.rows),rows:inventory.rows,sources:prepared,copy,branding,logos,variantsExtrasDemoCount,requiredBeforeApply:['Review each photograph and match against the seed description.','Compare current image bytes with confirmed original illustrations; never replace a user photograph.','Keep IDs, owner, slug, public token, prices, variants, extras and every non-seed product unchanged.','Publish required attribution/license links and modified-file notices before any CC BY/SA image is displayed.','Recheck expected current image path/hash and row values immediately before a scoped owner-API update.','Upload only through authenticated media API after separate coordinator approval; no service-role bulk overwrite.']};
 const credits={items:inventory.rows.filter(row=>row.proposedSourceId).map(row=>{const source=prepared.find(s=>s.id===row.proposedSourceId);ensure(source?.optimized,'SELECTED_ASSET_MISSING','Fotografía seleccionada ausente.');return {restaurantId:row.restaurantId,productId:row.productId,productName:row.seedName,title:source.title,author:source.author,sourceUrl:source.id==='croissant-flaky'?'https://www.publicdomainpictures.net/view-image.php?image=12541&picture=croissant':source.sourcePage,license:source.license,licenseUrl:source.licenseUrl.replace(/^http:/,'https:')||source.sourcePage,changes:source.optimized.changes,imagePath:null};})};
 writeFileSync(resolve(out,'photo-credits.proposed.json'),JSON.stringify(credits,null,2)+'\n');
 if(process.argv.includes('--public-credits')){const creditsPath=resolve(ROOT,'public/photo-credits.json');if(existsSync(creditsPath))ensure(!JSON.parse(readFileSync(creditsPath,'utf8')).items?.some(item=>item.imagePath),'PUBLISHED_CREDITS_PRESERVE','No sobrescribir créditos que ya tienen imágenes publicadas.');writeFileSync(creditsPath,JSON.stringify(credits,null,2)+'\n');}
 writeFileSync(resolve(out,'plan.json'),JSON.stringify(evidence,null,2)+'\n');writeFileSync(resolve(ROOT,'docs/evidence/closure-demo-photo-plan.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({mode:evidence.mode,seeds:evidence.seedCount,nonSeedPreserved:evidence.excludedNonSeedProducts,prepared:prepared.filter(r=>r.optimized).length,remoteBusinessMutations:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('PHOTO_PLAN_FAILED: no private rows or credentials logged');process.exitCode=1;});
