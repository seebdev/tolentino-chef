# Arquitectura

## Decisión principal

Next.js 16.4.2, React 19.3.1, TypeScript 6.0.3, Node 22 y CSS responsive propio. Se conserva la arquitectura App Router y la experiencia de categorías, búsqueda, favoritos y detalle de la referencia, mediante una implementación nueva. No se copió el almacenamiento local del administrador: todas las operaciones comerciales van a Supabase. No se añadieron bibliotecas de plantillas ni un editor visual genérico.

Supabase proporciona Auth, PostgreSQL y un bucket privado `restaurant-media`. Render ejecuta una sola aplicación Node, compartida por todos los restaurantes. La migración está versionada y no se aplica automáticamente al arrancar ni durante el build.

## Flujo de acceso

1. El servidor autentica con `auth.getUser()` y consulta la membresía o el rol persistido.
2. Un propietario usa el cliente ligado a su sesión; además de las comprobaciones del servidor, RLS limita cada tabla y objeto de Storage.
3. Un administrador global obtiene el cliente de servicio solo tras comprobar `platform_admins.is_active`. Para soporte se valida el restaurante explícito y se registra el acceso. No se copian sesiones ni contraseñas de propietarios.
4. El visitante recibe una proyección pública del menú; nunca consulta directamente tablas privadas mediante una clave de servicio.

El navegador no necesita claves de servicio ni llamadas directas a Supabase. Cookies HttpOnly, SameSite Lax y Secure en producción; orígenes de mutación deben coincidir exactamente con APP_URL. No existe formulario de registro público. Deshabilitar también el registro en Supabase alojado.

El proxy refresca y valida la sesión con `getUser()` en las rutas de acceso/administración del hostname de plataforma. Propaga las cookies renovadas tanto a la petición que recibe la ruta como a la respuesta del navegador, y conserva las cabeceras de no caché del SDK. Los dominios personalizados siguen limitados a su menú público; el refresco no otorga roles ni sustituye la autorización de cada API.

## Datos

Cada entidad tiene restaurant_id, clave propia impredecible y restricciones de pertenencia. Categorías y productos usan claves foráneas compuestas; un producto de A no puede apuntar a una categoría de B. El propietario inicial es único por restaurante y por usuario. Las ventas son internas y tienen una fila por alta comercial; no representan una suscripción.

Las variantes, tamaños y extras son arrays JSONB validados dentro del producto, siempre informativos. Una fotografía principal por producto se guarda como ruta de Storage. Esta versión no introduce una galería múltiple ni tablas independientes para cada variante; esta decisión reduce uniones sin permitir relaciones entre restaurantes.

La apariencia tiene un borrador y una versión publicada. Colores, fuente de una lista cerrada y rutas de logo/portada/favicon se validan en servidor y base. El catálogo comienza vacío. Las promociones tienen fechas opcionales; los horarios representan un intervalo por día. Los idiomas disponibles son es, en, fr, it, zh, ja, hi; contenido traducido manualmente con fallback al texto principal.

## Lectura pública y caché

El estado del restaurante se consulta antes de cada lectura, fuera de la caché. El contenido se cachea con una clave que incluye restaurant_id y menu_version. Los triggers de cambios incrementan la versión por transacción; una nueva lectura después del commit obtiene contenido vigente sin redeploy. No se cachean sesiones ni respuestas con información privada.

Las consultas públicas recuperan datos en bloques de 1.000, filtran categorías ocultas y sus descendientes, productos no publicados, traducciones de elementos privados y promociones fuera de vigencia. El menú usa imágenes lazy y búsqueda en cliente. El administrador pagina 25 productos y 20 restaurantes. Las estadísticas se agregan en PostgreSQL para no truncarse por el máximo de filas de PostgREST.

Un archivo CSV de hasta 1.000 productos se valida antes de enviarse a una transacción SQL. El servidor revalida al confirmar; una excepción revierte todo el lote. No se descargan URLs de imágenes incluidas en archivos.

## QR y dominios

Cada restaurante tiene un token público inmutable. El QR apunta siempre a APP_URL/q/token y resuelve el slug actual en el dominio de Tolentino. Se conserva la alternativa estándar incluso cuando el dominio personalizado falla. La URL del visitante no puede introducir destinos arbitrarios.

Hostnames distintos del dominio de plataforma requieren una correspondencia exacta y verificada en la base. No se acepta X-Forwarded-Host como autoridad. El dominio personalizado solo sirve las rutas públicas del restaurante asignado.

## Observabilidad y límites

Health endpoint sin secretos, logs con identificador de error, eventos de seguridad y conteos agregados de visitas/escaneos. Estos conteos representan solicitudes limitadas por intervalo; no prueban usuarios únicos ni escaneos físicos. La carga demostrada se limita al entorno local descrito en QA; no se afirma capacidad concurrente de miles de visitantes.
