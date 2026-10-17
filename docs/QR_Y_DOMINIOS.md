# QR permanente y dominios

## Generación de QR

`src/lib/qr.ts` genera PNG, SVG y PDF mediante `generateQr({url, foreground, background, label, frame, logo, format, size})`. El destino se codifica literalmente. El generador no crea ni rota tokens, no decide el dominio y no cambia el destino al modificar colores, marco, texto o logo. La aplicación debe proporcionar la URL pública estable `/q/TOKEN_PUBLICO`; el resolvedor decide cuál es el menú vigente.

Las descargas son archivos reales. SVG contiene módulos vectoriales y, si se pide logo, una imagen raster saneada incrustada. PNG rasteriza esa composición completa. PDF incorpora exactamente la misma imagen completa, incluidos logo, texto y marco, en una página de 4 × 4 pulgadas. No necesita descargar fuentes, logos o recursos externos durante la lectura.

Medidas aplicadas:

- Corrección de errores H y margen libre mínimo de cuatro módulos por lado.
- Módulos cuadrados, cuadrícula de píxeles enteros y un mínimo de dos píxeles por módulo; se rechazan combinaciones demasiado densas para el tamaño solicitado.
- Fondo más claro que los módulos y contraste mínimo 7:1; colores opacos `#RRGGBB`.
- Tamaño entre 256 y 2048 píxeles, 1024 por defecto. Texto máximo de 80 caracteres, escapado para SVG, ajustado en líneas y fuera de la zona de silencio.
- Marcos `none`, `simple` y `rounded`, separados de la zona de silencio.
- Logo PNG/JPEG/WebP de hasta 5 MB y 16 megapíxeles; se decodifica y vuelve a codificar a PNG, descartando metadatos. No se aceptan SVG de entrada. Placa central de hasta el 14% del lado de la matriz; el logo es aún menor y mantiene la proporción.
- Solo destinos absolutos HTTP(S), sin credenciales, de hasta 512 caracteres. El endpoint debe construir el destino desde configuración del servidor y un token público validado, sin aceptar un destino arbitrario del cliente.

## Evidencia automática

`tests/qr.test.ts` usa `jsqr` como decodificador independiente del generador `qrcode`. Comprueba el destino exacto con y sin logo a 256, 512 y 1024 píxeles; verifica que cambiar la apariencia conserva el mismo token; rasteriza y decodifica SVG; extrae la imagen del PDF, compara todos sus píxeles con PNG y decodifica el resultado. También comprueba el espacio libre y los rechazos de entradas inválidas.

Estas son verificaciones digitales. No acreditan lectura por cámaras físicas, impresoras o condiciones reales. Antes de imprimir tiradas, realizar pruebas con iOS y Android, el material y tamaño final, iluminación variable, distancia prevista, desgaste y plastificado. Evitar reescalado no proporcional, recorte del margen y fondos transparentes. Un cambio del dominio que aloja el enlace impreso requiere mantener el dominio anterior o su redirección; la estabilidad del token no sustituye el control del dominio.

## Operación de dominios

`APP_URL` es el origen HTTPS estable controlado por Tolentino. El QR no usa el dominio personalizado ni el slug como identidad. `/q/[token]` consulta el slug actual y responde con una redirección 302 no cacheable a `APP_URL/menu/slug`. No admite un destino indicado por el visitante. Incluso un restaurante suspendido resuelve a su propio estado público. Mantener el dominio Tolentino y su servicio de resolución es necesario durante la vida del material impreso.

`PLATFORM_HOSTNAMES` contiene los nombres exactos del servicio/plataforma, separados por comas. No admite comodines. Un Host ajeno solo se acepta si figura como verificado en `restaurant_domains`; sus rutas quedan limitadas al menú e imágenes de ese restaurante. El servidor no confía en X-Forwarded-Host. La URL estándar siempre sigue disponible.

Desde soporte, agregar el hostname sin protocolo ni ruta. El servidor crea un token de verificación único y muestra un registro TXT `_tolentino.HOSTNAME` con valor `tolentino-verification=TOKEN`. Este valor se obtiene de la base, nunca de un ejemplo de DNS inventado. Si `RENDER_SERVICE_HOSTNAME` está configurado, también se indica el CNAME hacia ese hostname real.

La opción **Registrar en Render** requiere propiedad TXT y credenciales de servidor `RENDER_API_KEY`, `RENDER_SERVICE_ID` y `RENDER_SERVICE_HOSTNAME`. Consulta primero el dominio para evitar registros duplicados y usa la API oficial para registrarlo en ese servicio específico. Registrar no activa el dominio: la acción **Verificar** comprueba TXT, CNAME exacto y estado verificado en Render antes de persistir `status=verified`. Si falla, el dominio queda inactivo y el enlace estándar funciona.

La implementación acepta subdominios mediante CNAME, por ejemplo el patrón `menu.dominio-del-restaurante.com`. No valida dominios raíz que dependan de A/ALIAS/flattening ni configura DNS de proveedores externos. Esa ampliación queda pendiente. No se crean certificados localmente: TLS corresponde a Render. No se realizaron registros de dominio externos durante esta entrega.

Render puede cobrar por dominios adicionales según su plan. Revisar la tarifa al registrar; no se promete dominio gratuito ni se añaden suscripciones comerciales al restaurante. Fuentes verificadas: [dominios de Render](https://render.com/docs/custom-domains), [API para crear dominio](https://api-docs.render.com/reference/create-custom-domain) y [API para consultar dominios](https://api-docs.render.com/reference/list-custom-domains).

Muestras ilustrativas en `docs/evidence/qr-sample.png`, `.svg` y `.pdf`: codifican un dominio de ejemplo, **no una URL desplegada**. Nunca imprimir los QR de localhost o de una muestra como material comercial.
