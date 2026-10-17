# Despliegue en Render y Supabase

## Estado actual

Render sigue pendiente. Supabase `ylcnrfzosjzuljufwups` es el destino autorizado y el repositorio ya publicado es `https://github.com/tolentinosftw-dotcom/tolentino-chef.git`. URL, clave publicable y clave de servicio están configuradas en `.env.local`, ignorado por Git. La migración `20261017021301_initial_tenant_security` ya está aplicada y verificada mediante conexión PostgreSQL al proyecto elegido.

La evidencia `evidence/db-migration-verification.json` registra el 16 de octubre de 2026 a las 22:49 (America/Bogota): 15 tablas públicas y una privada con RLS, grants y ocho RPC de negocio comprobados, bucket privado `restaurant-media` de 5 MiB y cuatro políticas de tenant. No se crearon usuarios, restaurantes ni objetos Storage, ni se enviaron correos. SMTP, primer administrador y recorridos remotos con Auth/Storage siguen pendientes; la última lectura de Auth indica `disable_signup: false`.

La comprobación posterior `evidence/connected-supabase-smoke.json` confirmó REST, lectura de la configuración del bucket y acceso administrativo a Auth; no hay restaurantes ni usuarios en la primera página consultada. El servidor local de producción respondió health 200 (`status:ok`, `configured:true`), login 200 y APIs privadas 401 sin sesión. Esto confirma conexión y rechazo de acceso anónimo, no una sesión real de propietario.

La compilación es local y reproducible. `render.yaml` describe una aplicación Node única; no crea un servicio por restaurante. No ejecutar la migración contra el proyecto de referencia ni contra el proyecto existente de otra aplicación.

## 1. Proyecto y migración verificados

El destino autorizado ya es `ylcnrfzosjzuljufwups`; no crear otro proyecto ni volver a aplicar la migración inicial. La verificación remota confirmó que la migración está vigente, que no existen grants de SELECT anónimo sobre las tablas de negocio y que un rol autenticado sin membresía no puede ver restaurantes ni productos. Esta comprobación SQL no sustituye dos sesiones reales de propietarios.

Para futuras migraciones, revisar primero destino, cambios y copia de seguridad, y usar el SQL Editor o una CLI autorizada para este proyecto. No ejecutar reset contra un proyecto alojado. Mantener URL y claves únicamente en `.env.local` y en las variables secretas de Render; no copiarlas en mensajes, capturas ni el repositorio. El bucket ya es privado: no convertirlo en público para facilitar las pruebas.

Quedan pendientes los advisors de Supabase y la aceptación con dos usuarios reales A y B antes de habilitar clientes.

## 2. Configurar Auth y correo

La última lectura remota indica `disable_signup: false`: deshabilitar Sign up antes de operar y comprobar que el acceso anónimo también esté desactivado. Establecer longitud mínima de contraseña de 12 caracteres y tokens de acceso breves (la configuración local usa 15 minutos). Configurar un proveedor SMTP válido y probar entrega real; no asumir que el envío de pruebas de Supabase sirve para todos los clientes.

**Site URL** debe coincidir con `APP_URL`. Autorizar la ruta exacta `APP_URL/auth/callback` para el flujo PKCE. En la plantilla **Reset password**, usar un enlace a:

```html
<a
  href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery"
  >Definir mi contraseña</a
>
```

Esta plantilla es necesaria también para el alta de clientes: el servidor crea una cuenta con contraseña aleatoria desconocida y solicita recuperación después de confirmar restaurante y membresía. No usa la plantilla Invite. El enlace estándar con un token en el fragmento no puede ser procesado por un endpoint de servidor. `verifyOtp` permite establecer la sesión y lleva a `/login?mode=password`. Callback y confirmación no se cachean y usan política de referencia restrictiva. Los enlaces de un solo uso pueden ser consumidos por sistemas de análisis de correo; probar el proveedor real y solicitar otro enlace si se consume antes de abrirlo. [Guía oficial de plantillas y endpoints de servidor](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

Después de configurar Auth, SMTP y la plantilla, elegir el correo real del primer administrador y ejecutar el bootstrap (aún pendiente; la migración ya está aplicada):

```powershell
node --env-file=.env.local scripts/bootstrap-admin.mjs TU_CORREO_REAL
```

El script crea exclusivamente una cuenta nueva y una asignación global persistida. No eleva una cuenta existente por email. No imprime contraseñas ni claves.

## 3. Variables

| Variable                             | Necesidad                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | URL del nuevo proyecto                                                  |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Clave publicable del nuevo proyecto                                     |
| SUPABASE_SERVICE_ROLE_KEY            | Secreto de servidor; nunca cliente                                      |
| APP_URL                              | Origen HTTPS permanente de Tolentino; localhost solo para trabajo local |
| PLATFORM_HOSTNAMES                   | Hostnames exactos confiables de plataforma, sin protocolo ni comodines  |
| RENDER_API_KEY                       | Opcional, solo servidor, para registro/validación de dominios           |
| RENDER_SERVICE_ID                    | ID real del servicio Tolentino, normalmente srv-…                       |
| RENDER_SERVICE_HOSTNAME              | Host real del servicio terminado en onrender.com; no inventarlo         |

Mantener proyectos distintos para pruebas y producción. No cargar datos ficticios de las pruebas en producción. Las imágenes viven en Storage; el disco de Render no contiene datos comerciales persistentes.

## 4. Publicar Render

1. Conectar con Render el repositorio ya publicado `tolentinosftw-dotcom/tolentino-chef`. No subir `.env.local`, `.runtime`, `node_modules` ni `.next`.
2. Crear un Web Service desde `render.yaml`, o usar Node 22.23.3, build `npm ci --include=dev && npm run typecheck && npm run lint && npm run test && npm run build`, inicio `npm run start` y health `/api/health`.
3. Completar las variables antes de arrancar. Render proporciona PORT; Next lo respeta y escucha en 0.0.0.0.
4. Esperar build/deploy y comprobar health 200 con `status:ok`, login real, persistencia, carga/lectura de imagen, cambio de precio y QR escaneable.
5. Configurar un dominio permanente controlado por Tolentino antes de imprimir códigos. Registrar/verificar dominios de clientes según `QR_Y_DOMINIOS.md`.

El blueprint propone **free para validación inicial**, no una disponibilidad comercial garantizada. Render indica que Free duerme tras inactividad y no debe usarse para producción. Elegir y aprobar un servicio siempre activo antes de vender disponibilidad del QR; revisar límites de transferencia, dominios y Supabase. No se contrató ningún plan de pago. [Límites oficiales de Render Free](https://render.com/docs/free). La forma de desplegar Next como servicio Node y el blueprint se contrastaron con [Next.js en Render](https://render.com/docs/deploy-nextjs-app) y [Blueprint specification](https://render.com/docs/blueprint-spec).

## 5. Backup y recuperación

Definir la retención según el plan real de Supabase, hacer exportaciones cifradas fuera del servicio y mantener copia de objetos Storage además de Postgres. Un backup SQL no conserva por sí solo los archivos de imágenes. Guardar migraciones y configuración sin secretos en el repositorio.

Ensayar restauración primero en un proyecto de recuperación aislado: esquema, datos, objetos, membresías y tokens QR. Verificar aislamiento y checksums antes de cambiar configuración de producción. Nunca recrear tokens públicos al restaurar; mantener APP_URL y el dominio anterior para conservar material impreso. No se ejecutó restauración remota en esta entrega.
