# Seguridad

Este documento distingue garantías de base de datos de validación de un despliegue real.

## Aislamiento

Todas las tablas públicas tienen RLS y permisos explícitos. Se usa auth.uid() más membresía activa almacenada en base, nunca user_metadata. Suspensión y membresía se consultan al operar. FKs compuestas y triggers impiden relaciones entre restaurantes, ciclos de categorías y cambio de identidad del tenant.

El dueño no puede modificar rol, propietario, estado, slug o token QR. QR/domains son de lectura para dueño; ventas y auditoría solo servidor. platform_admins no otorga bypass global en políticas. La clave service_role sí evita RLS por diseño de Supabase: verificar usuario, rol y contexto del restaurante antes de utilizarla.

Funciones SECURITY DEFINER: solo helpers internos en private, search_path vacío y privilegios limitados. RPC de negocio: SECURITY INVOKER.

## Superficie pública

Anon no tiene acceso directo a tablas. El servidor verifica estado fresco y proyecta únicamente campos públicos. Excluir correo del dueño, membresías, ventas, metadatos internos y tokens DNS; no enviar filas completas de select('*').

Consultar estado antes de usar caché y antes de servir imágenes. El token QR es estable e inmutable incluso para servicio. Las URLs firmadas preexistentes pueden funcionar hasta vencer: usar proxy backend sin caché pública persistente para suspensión inmediata.

## Archivos

Bucket privado restaurant-media; RLS exige dueño activo, negocio activo y ruta propia. El bucket admite JPEG, PNG, WebP y AVIF, máximo 5 MiB. La carga desde el panel acepta JPEG, PNG y WebP; verifica bytes y dimensiones y recodifica a WebP. No confía solo en extensión o MIME declarado. Logos y fondos también requieren prefijo del restaurante.

## Claves y sesiones

- Públicas: URL Supabase y clave publicable.
- Secretas: clave de servicio solo en módulos de servidor; nunca NEXT_PUBLIC_, localStorage, URLs o respuestas.
- Mutaciones: sesión validada, verificación de origen y autorización del recurso.
- Configuración local declarada: altas públicas y sesiones anónimas desactivadas, JWT 15 minutos y contraseña mínima 12. Esto no demuestra la configuración del Auth alojado: la última lectura remota devuelve `disable_signup: false`; desactivar el registro público y verificar las demás opciones antes de operar.
- La clave de servicio está configurada en `.env.local`, ignorado por Git. No se publica su valor ni se incluye en las evidencias.
- Borrar usuarios no invalida automáticamente access tokens. Desactivar membresía y revocar sesiones antes de una baja.

## Transacciones y auditoría

Importación revierte el lote completo ante error. Aprovisionamiento SQL y edición negocio/venta son transaccionales. Auth es un servicio separado: compensar el usuario creado si falla la provisión.

Rate limiting usa contador compartido y atómico; el servidor guarda hashes de los identificadores antes de construir claves. Purgar contadores vencidos. Auditoría solo servidor, con actor, tenant, acción y metadatos mínimos. No registrar contraseñas, tokens, claves, cookies, CSV completo o datos personales innecesarios. Visitas son agregados diarios.

## Verificación

npm run test:database aplica la migración real en PostgreSQL PGlite y prueba roles efectivos anon, authenticated y service_role. Casos: dos tenants aislados, administrador sin bypass, CRUD ajeno denegado, FKs, escalada, token inmutable, Storage, suspensión, rollback e importación idempotente, provisión, versión de menú, límites y visitas.

En esas pruebas locales, Auth y Storage son esquemas mínimos sustitutos. La migración `20261017021301_initial_tenant_security` ya se aplicó al proyecto autorizado `ylcnrfzosjzuljufwups`. La verificación remota del 16 de octubre de 2026 a las 22:49 (America/Bogota) está en `evidence/db-migration-verification.json`: 15 tablas públicas y una privada con RLS, cero grants de SELECT anónimo de negocio, ocho RPC con permisos verificados, cuatro FKs compuestas de tenant y diez triggers de protección de identidad. El bucket `restaurant-media` es privado, limita objetos a 5 MiB y tiene cuatro políticas de tenant. Se ejecutó la RPC de estadísticas de servicio y un rol autenticado sin membresía obtuvo cero restaurantes y productos.

Estas comprobaciones acreditan DDL, RLS, grants, RPC y configuración de Storage, no el aislamiento remoto completo con dos identidades Auth. No se crearon usuarios, restaurantes ni objetos ni se enviaron correos durante esta verificación. Siguen pendientes SMTP, correo del primer administrador y bootstrap, sesiones y recuperación reales, REST y uploads/downloads entre A y B, suspensión/reactivación desde dos navegadores, advisors de Supabase, DNS y HTTPS en Render. El registro público sigue habilitado según la última lectura (`disable_signup: false`) y debe desactivarse antes de admitir clientes.

La comprobación conectada posterior (`evidence/connected-supabase-smoke.json`) confirma acceso de servicio a REST/Auth/Storage, health local 200 y rechazo 401 en `/api/admin/restaurants` y `/api/session` sin sesión. La primera página de Auth no contiene usuarios y la RPC informa cero restaurantes; no es una prueba de login ni de aislamiento entre propietarios. La conexión PostgreSQL y la clave de servicio están disponibles para el proyecto autorizado. No se modificó el proyecto original ni se usó infraestructura ajena como destino de la migración.

La base también valida appearance y draft_appearance cuando se editan por REST directo: solo campos conocidos, colores hexadecimales, familia tipográfica permitida y rutas de imagen del restaurante. No depende únicamente de validación del formulario.

Revisión local completada: 35 pruebas PostgreSQL aprobadas, incluida importación de 1000 filas y rechazo de 1001, nombres con acentos, SKU sensible a mayúsculas, imágenes cruzadas y estadísticas de 1500 días. Las funciones agregadas de plataforma son de servicio; las del dueño comprueban tenant. La invalidación utiliza un trigger SECURITY DEFINER privado y no concede permiso al dueño para escribir menu_version ni menu_version_transaction.

Además, siete pruebas del handler administrativo ejercitan parser y validaciones reales con mocks explícitos: omisión de owner_email en edición, preservación de ventas no enviadas, actualización parcial comercial, compensación limitada al usuario Auth recién creado, cuenta preexistente intacta, restaurante persistente si falla correo y auditoría ante compensación fallida. No son pruebas de SMTP ni Auth remoto.
