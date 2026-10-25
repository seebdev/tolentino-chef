# Cierre de menú, apariencia e idiomas

Fecha: 2026-10-18. Rama de reparación: `repair/functional-closure-20261018`. Este informe corresponde a cambios locales posteriores a `ae0f7cb`; no acredita por sí mismo un despliegue.

## Reproducción y causas

Antes de cambiar la interfaz se ejecutaron cuatro regresiones con respuestas API controladas. Las cuatro fallaron: no existían las siete banderas, elegir una categoría retiraba Recomendados, el móvil ignoraba dos columnas y la vista previa no contenía el menú completo. Evidencia: [closure-menu-before.json](evidence/closure-menu-before.json) y capturas/contextos conservados en `docs/evidence/closure-before/`.

La vista previa anterior era una representación parcial con estilos distintos. Los colores de página y tarjetas eran constantes independientes, y las recomendaciones dependían del filtro del catálogo. La comparación posterior encontró además un borde de iframe que reducía el viewport en 2 px; se sustituyó por un contorno que no ocupa ancho. La clave de React derivada del JSON del borrador desmontaba el editor al guardar y eliminaba su confirmación; se cambió por la identidad del restaurante.

La primera pasada ampliada registró cinco aprobaciones y tres fallos en [closure-menu-regression.json](evidence/closure-menu-regression.json): el borde citado, el desmontaje citado y una referencia `session` indefinida durante una edición paralela de Workspace. Se conserva ese intento; no representa el resultado final.

## Renderer y publicación

`MenuRenderer` en `src/components/public-menu.tsx` es el árbol completo utilizado por el menú público y `MenuPreview`. El preview recibe el catálogo publicable completo desde el endpoint autenticado `/api/workspace/[id]/preview`, sin depender de los 25 productos de la página del editor. Se monta con un portal React en un iframe local con `srcDoc` estático y `<!doctype html>` que utiliza las mismas hojas CSS. Los anchos 320, 390, 768 y 1440 son viewports reales; no hay transformación de escala.

La vista previa incluye portada, logo, idiomas, búsquedas, categorías/subcategorías, promociones, recomendados, tarjetas, favoritos, detalles, horarios y footer. Los controles de color, fuente y columnas cambian ese mismo renderer en cuanto se editan. Las imágenes de marca permanecen en borrador hasta publicar. El favicon público cambia con la apariencia publicada; el preview no reemplaza el favicon del panel administrativo.

Guardar envía una única acción `save_appearance` con apariencia, nombre, descripción y `expectedRevision`. Publicar envía una única `publish_appearance` con el mismo payload completo. El servidor implementa la comparación de revisión y publicación atómica; un 409 mantiene los campos locales y explica cómo recargar el borrador. La revisión sólo avanza en el editor después de respuesta confirmada. Productos, categorías, promociones e idiomas tienen sus propias operaciones y pueden ser públicos al guardar, según sus indicadores de visibilidad; el editor lo indica expresamente.

Las regresiones amplias de interfaz usan una API simulada explícita. La privacidad y concurrencia de Supabase se comprobaron además contra el restaurante temporal alpha, con APIs reales y navegador anónimo; esa evidencia independiente se describe al final.

## Tokens y compatibilidad

El mismo `menuAppearance()` completa valores antiguos ausentes. `themeStyle()` suministra las variables CSS del menú público y de la vista previa.

| Campo                 | Aplicación                                   | Predeterminado para registros antiguos |
| --------------------- | -------------------------------------------- | -------------------------------------- |
| primary               | Títulos, precios, enlaces y categoría activa | Conserva el primario anterior          |
| secondary             | Promociones y pie del menú                   | Conserva el secundario anterior        |
| background            | Página y barra de categorías                 | #fcfcf8                                |
| card                  | Tarjetas, búsqueda y diálogos                | #ffffff                                |
| text                  | Nombres y contenido principal                | #253026                                |
| muted                 | Descripciones y textos auxiliares            | #596a4c                                |
| cover_overlay         | Velo en degradado sobre portada              | #132417                                |
| cover_overlay_opacity | Intensidad máxima del velo                   | 0.7                                    |
| columns_mobile        | Tarjetas por fila bajo 700 px                | 1                                      |
| columns_desktop       | Tarjetas por fila desde 700 px               | 2                                      |

La tableta de 768 px utiliza la selección de escritorio. Una y dos columnas son independientes en cada intervalo; Recomendados conserva su carrusel/disposición propia y permanece visible al filtrar categoría, buscar, mostrar favoritos o cambiar idioma. No se ocultan productos por cambiar columnas.

El editor advierte contrastes calculados inferiores a 4.5:1 para pares de texto y superficie relevantes. Conserva los colores elegidos sin corregirlos silenciosamente. El texto blanco sobre una fotografía exige revisión visual de la fotografía concreta: el cálculo entre dos colores no prueba su contraste.

## Idiomas y recursos

La referencia local se consultó sólo para confirmar comportamiento y la correspondencia de idiomas/banderas. También se abrió su menú público en lectura. No se copiaron marca, fotografías ni catálogo.

Correspondencia confirmada: español/Colombia, inglés/Reino Unido, francés/Francia, italiano/Italia, chino/China, japonés/Japón, hindi/India. Los siete SVG están servidos localmente desde `public/flags`, obtenidos de [flag-icons](https://github.com/lipis/flag-icons) bajo licencia MIT, autor Panayiotis Lipiridis, commit `ac7e0eb3259eb62aa6100c435607e2fe03896a97`. `LICENSE.txt` conserva la licencia y `SOURCES.json` registra URL y SHA-256 por archivo.

Los botones muestran nombres nativos y estado seleccionado, aceptan teclado y cuentan con un selector nativo accesible. La selección y los favoritos se almacenan únicamente como preferencias locales separadas por UUID del restaurante; los datos del negocio se leen de la API. Los diccionarios locales cubren la interfaz de los siete idiomas. El renderer consume traducciones de productos, categorías, promociones, descripción del restaurante, ingredientes, etiquetas, extras y variantes históricas; mantiene precios, moneda e identidad de marca originales. Cuando falta texto se conserva el fuente.

El panel Idiomas incorpora `TranslationStatus` del ejecutor persistente y permite corrección manual de los campos citados. Las traducciones de extras y variantes contienen sólo nombres, sin modificar precios. La lista de productos mantiene búsqueda/paginación y cancela respuestas obsoletas.

El footer usa la configuración global autorizada por superadmin. Traduce sólo la introducción; conserva «Tolentino Chef · 3108853158» y la URL WhatsApp con mensaje codificado. Las pruebas inspeccionan el enlace sin enviar mensajes. El enlace adicional de créditos fotográficos conserva el restaurante en la URL y tiene etiqueta traducida en los siete idiomas.

## Actualizaciones y caché

Al recuperar foco o visibilidad, el cliente consulta la versión del menú. Sólo descarga el catálogo si cambió la versión/estado. Al actualizar datos del mismo restaurante conserva la instancia del renderer y sus filtros, idioma, favoritos y posición de desplazamiento. La suspensión o un 404 reemplazan el catálogo anterior; una identidad distinta bajo el mismo slug no se muestra como si fuera el restaurante original. Los fallos transitorios conservan la versión disponible con aviso. No se deshabilita globalmente la caché del servidor.

## Verificación local

- Unitarios de tema y traducción parcial: 8/8 aprobados; valores heredados, colores exactos sin corrección automática, fórmula de contraste, campos parciales y pendientes en extras/categorías/promociones/restaurante.
- Lint focal de renderer, apariencia, idiomas, helpers y pruebas: aprobado.
- Primera comparación exacta de estilos/geometría entre preview y público: 1/1 aprobada, cuatro anchos, sin tolerancias aumentadas; [closure-parity-after.json](evidence/closure-parity-after.json).
- Suite inicial ampliada: 32/32 aprobados (ocho escenarios por configuración de navegador), [closure-browsers.json](evidence/closure-browsers.json).
- La inspección visual detectó una diferencia vertical de 12 px que aquella aserción de anchuras no cubría. Se añadió comparación de `compatMode`, altura y posición; falló por `BackCompat` en el iframe frente a `CSS1Compat` en el público. [Antes](evidence/closure-parity-height-before.json). Un `srcDoc` estático con DOCTYPE corrigió el modo; la prueba estricta pasó en los cuatro anchos, [después](evidence/closure-parity-height-after.json). No se aumentaron tolerancias ni timeout.
- Suite final: **48/48 aprobados**, doce escenarios por configuración de navegador (Chrome, Edge, Firefox y WebKit; tres familias de motor), [closure-browsers-final.json](evidence/closure-browsers-final.json). Incluye las cuatro combinaciones móvil/escritorio 1/2 en 320/390/768/1440, precio largo y permanencia de recomendaciones con categoría, búsqueda, favoritos e idioma.
- Tras añadir el enlace de créditos, se repitieron idioma completo y paridad en las cuatro configuraciones: **8/8 aprobados**, [closure-footer-parity-final.json](evidence/closure-footer-parity-final.json). Son repeticiones focalizadas, no ocho escenarios distintos adicionales.
- Regresión del panel exterior con logo/portada/favicon: **1/1 aprobada**, con 1440/820/390 píxeles y comprobación de ancho de documento; [closure-owner-appearance-final.json](evidence/closure-owner-appearance-final.json). Sus capturas nuevas usan el prefijo `closure-owner-appearance-` y conservan las históricas.
- Typecheck, lint global, suite unitaria global y build: coordinados por el agente principal; no se infieren de estos resultados focales.

Comandos principales, usando Node 22 del proyecto:

```powershell
$env:E2E_BASE_URL='http://localhost:3002'
node node_modules/@playwright/test/cli.js test --config=playwright.menu.config.ts
node node_modules/vitest/vitest.mjs run tests/menu-theme.test.ts tests/menu-translations.test.ts
```

Las pruebas Playwright de esta sección interceptan las APIs exclusivamente desde el harness. El servidor de desarrollo conserva su comportamiento real, utilizado por separado en la integración siguiente. La ronda previa interrumpida se conserva en `docs/evidence/closure-iframe-navigation/`; otra ronda agotó el tiempo durante cinco navegaciones sucesivas, y su traza quedó en `test-results/menu-parity-stable`. La comparación final carga cada página una vez y redimensiona ambos viewports, manteniendo todas las aserciones.

Los artefactos sintéticos son evidencia de interfaz y contratos; no acreditan persistencia remota, calidad lingüística de un proveedor ni catálogos reales.

## Integración real temporal

La primera ronda real, sin interceptar ninguna API, aprobó cinco comprobaciones: identidad/propiedad del temporal alpha, tres productos de prueba, borrador persistido y privado, recarga del borrador y publicación visible en navegador anónimo. La edición concurrente agotó 30 segundos sin respuesta; el agente principal reprodujo el uso incorrecto de SQLSTATE `40001` para un conflicto de negocio y aplicó una migración incremental que lo sustituye por `PT409`. No se afirma que la concurrencia real pasara en ese intento. [Evidencia anterior preservada](evidence/migrations/hgntppemxwcxaxritnfq/closure-appearance-real-20261018/appearance-live-audit-before.json).

La limpieza del intento terminó aprobada: eliminó sólo los tres productos y la categoría creados por esa ejecución, restauró nombre, descripción, apariencia e idiomas y comprobó token/slug sin cambios. Los contadores de revisión aumentaron normalmente; campos de apariencia y borradores ausentes pueden quedar normalizados a valores efectivos equivalentes. El restaurante temporal y su cuenta quedan a cargo del protocolo de eliminación final del agente de base de datos. Las tres muestras originales no formaron parte del alcance de escritura.

La ronda posterior a esa corrección terminó **12/12 aprobada**, sin interceptar APIs, en Chrome real contra el servidor local y el proyecto nuevo de Supabase. El 409 del editor obsoleto respondió en **1182 ms**, por debajo de la aserción de 10000 ms, sin aumentar el timeout; conservó los cambios locales y la versión pública correcta. La comparación entre preview y público fue exacta en 320, 390, 768 y 1440 píxeles para modo estándar, ancho de documento, colores, tipografía, columnas, altura y posición. También pasaron los siete controles de idioma y sus SVG locales, y token/slug permanecieron iguales. [Informe final real](evidence/migrations/hgntppemxwcxaxritnfq/closure-appearance-real-after-pt409-20261018/appearance-live-audit.json).

El `finally` terminó **CLEANUP PASS** y cerró todos los contextos/navegadores. Eliminó únicamente los IDs creados y verificó catálogo vacío y restauración efectiva. No se ejecutó proveedor de traducción ni se enviaron correos. La prueba acredita persistencia del flujo de apariencia sobre el temporal, no una modificación de las tres muestras originales ni un despliegue del nuevo código.

Se inspeccionaron las capturas reales de 320 y 1440 píxeles y sus previews; una [segunda revisión independiente](evidence/migrations/hgntppemxwcxaxritnfq/closure-appearance-real-after-pt409-20261018/appearance-static-review.json) confirmó las cuatro imágenes sin estados de carga/error ni desbordamiento del contenido. Los tres precios son visibles, con dos columnas móviles y una de escritorio deliberadamente seleccionadas. Los previews capturados tienen 820 píxeles de alto y se desplazan. El indicador `N` de Next en desarrollo se superpone parcialmente a una pestaña en la captura móvil pública; no forma parte del renderer y deberá comprobarse ausente en el build de producción. La revisión de imágenes no certifica WCAG ni dispositivo físico.

También se inspeccionaron capturas sintéticas de WebKit a 320/1440, Firefox a 768 y la matriz móvil de una/dos columnas: nombres largos y precios permanecen dentro de las tarjetas. El recorte por desplazamiento bajo la barra pegajosa o en carruseles es intencional.

## Comprobaciones manuales pendientes

En iPhone/Safari y Android/Chrome físicos: abrir un QR del restaurante, comprobar banderas, desplazamiento, columnas y precios, cambiar idioma, abrir/cerrar detalle y horarios, rotar la pantalla y volver del segundo plano tras una publicación. Comparar el editor con una visita anónima tras publicar. La emulación de WebKit no acredita un iPhone físico. La lectura con cámara y PDF impreso pertenece al protocolo QR y sólo puede marcarse aprobada con ejecución efectiva.
