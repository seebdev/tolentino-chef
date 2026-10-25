# Traducciones persistentes y presupuesto

## Configuración exclusiva del servidor

La aplicación utiliza OpenAI Responses con salida JSON estricta. Modelo inicial verificado el 18 de octubre de 2026: `gpt-4.1-mini-2025-04-14`. Se acepta también el alias `gpt-4.1-mini`; cambiar a otro modelo exige añadir precios y validar su compatibilidad primero. Referencias: [modelo](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [salidas estructuradas](https://developers.openai.com/api/docs/guides/structured-outputs), [precios](https://developers.openai.com/api/docs/pricing).

| Variable | Configuración |
| --- | --- |
| OPENAI_API_KEY | Secreto del servidor, recibido en `.env.translation.local` ignorado y protegido; configurar de forma segura en el servicio Render existente |
| OPENAI_TRANSLATION_MODEL | gpt-4.1-mini-2025-04-14 |
| TRANSLATION_ENABLED | true sólo con credencial y presupuesto autorizados; false deja la cola pendiente |
| TRANSLATION_BUDGET_USD | Límite acumulado de esta plataforma; 0: el usuario retiró la autorización de gasto el 25 de octubre de 2026 |
| TRANSLATION_MAX_OUTPUT_TOKENS | 2048 por trabajo; rango permitido 128–4096 |

Ningún secreto lleva prefijo NEXT_PUBLIC. No copiar valores a Git, consola, evidencias o capturas. El blueprint deja el proveedor deshabilitado y presupuesto 0 por defecto para evitar consumo accidental en una instalación nueva. El servicio existente recibe la configuración autorizada mediante variables seguras, conservando las demás variables y su APP_URL HTTPS.

## Qué se traduce y cuándo

Crear, editar o importar contenido encola trabajos dentro de la misma transacción SQL. Incluye categorías y subcategorías, productos, descripción, ingredientes, etiquetas, extras, variantes históricas, promociones y descripción del restaurante. Sólo se envían esos textos y la marca pública. No se envían precios, monedas, SKU, correos, contraseñas ni información administrativa. La interfaz utiliza diccionarios locales; abrir un menú no llama al proveedor.

Cada trabajo identifica restaurante, entidad, idioma y hash de la versión fuente. La cola y las traducciones viven en Supabase. Los trabajos anteriores no pueden reemplazar una fuente posterior. Las traducciones manuales anteriores se conservan; editar una traducción en el panel la marca manual y combina únicamente los campos enviados. Reintentar o regenerar requiere confirmación en Idiomas. Regenerar automáticamente tampoco reemplaza una edición manual.

Mientras falta una traducción, el menú muestra el texto fuente y el indicador de contenido pendiente. Una bandera distinta por sí sola no acredita una traducción. El panel muestra pendientes, en proceso, completas, fallidas y manuales por idioma; actualizar contenido puede cambiar los conteos.

## Ejecución y recuperación

`npm run start` inicia Next.js y un único proceso `scripts/translation-worker.mjs` dentro del servicio Render existente. No crea otro servicio. El proceso reclama un trabajo a la vez, con lease persistente de 3 minutos, un máximo de 3 intentos y espera creciente. Tras reiniciar, las tareas pendientes se recuperan; las tareas en proceso esperan que expire su lease. Una confirmación DB incierta se reintenta con el mismo resultado, sin repetir esa llamada pagada.

Render Free puede suspender el proceso por inactividad. La cola sigue en Supabase y continúa cuando el servicio vuelve a ejecutarse; no se promete procesamiento permanente mientras Free duerme. No se utilizan pings artificiales ni servicios de pago adicionales. [Comportamiento de Free](https://render.com/docs/free).

Ante 401/403 el proceso se detiene con estado de credencial rechazada. Tras corregir la clave segura, reiniciar el servicio y reintentar los trabajos fallidos. Ante 429 se aplica backoff; timeout o resultado desconocido mantiene una reserva conservadora de costo. Nunca se registran el cuerpo crudo del proveedor ni sus cabeceras de autorización.

## Control de gasto

Precios estándar verificados: US$0,40 por millón de tokens de entrada y US$1,60 por millón de salida. La estimación carga toda la entrada al precio normal aunque existan descuentos de caché. Antes de cada llamada, PostgreSQL reserva un máximo conservador usando el límite de entrada y salida. Al recibir uso válido, ajusta la reserva a los tokens reportados. Resultado desconocido conserva la reserva completa.

El contador es acumulado en `private.translation_budget`, sobrevive reinicios y no vuelve a cero al configurar el mismo límite. No reiniciar ni borrar ese contador para continuar el encargo. La concurrencia comparte el bloqueo del presupuesto; no puede reservar por encima del límite. El costo informado es una estimación de tokens/reservas, no una factura del proveedor. Cambiar el presupuesto requiere nueva autorización en todos los casos: la autorización anterior fue retirada.

## Validación y revisión humana

Se valida entidad, idioma, campos exactos, tipos, arrays, límites, números, URLs, marca, contenido activo y un conjunto de alertas sobre ingredientes/alérgenos y afirmaciones dietarias. El texto se trata como datos no confiables y no dispone de herramientas. Estas comprobaciones no demuestran fidelidad semántica completa; términos culinarios, ingredientes y alérgenos deben revisarse manualmente antes de uso comercial.

Las pruebas con fixtures cubren errores y volumen sin cargos. El lote pequeño real queda documentado por separado en `docs/evidence/functional-closure-20261018/translation-real-small-batch.json`, sólo si esa ejecución finaliza. No atribuir una prueba simulada al proveedor real.
## Estado verificado el 25 de octubre de 2026

El proveedor real rechazó la clave con HTTP 401 `invalid_api_key`. No se generaron traducciones. El usuario decidió continuar sin el gasto de US$2: `TRANSLATION_ENABLED=false` y presupuesto 0 tanto en el archivo privado como en Render y en el registro persistente. El registro acumulado confirmó `charged_micro_usd=0`; no se reinició ni borró. No se intentarán nuevas llamadas sin autorización. Las traducciones manuales existentes y la interfaz de siete idiomas continúan disponibles.

La migración `20261018063724_translation_manual_fields.sql` conserva los 96 textos manuales y registra qué campos son manuales. La automatización futura podrá completar campos faltantes sin reemplazarlos. El guard comprobó los textos y datos comerciales antes y después; sólo cambió metadatos de versión, procedencia y cola. Los campos vacíos no borran valores previos, y una lista manual incompleta se rechaza con un mensaje accionable.
