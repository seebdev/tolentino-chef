# Despliegue en Render y Supabase

## Estado actual — 17 de octubre de 2026

**Supabase está conectado y probado; Render todavía no está publicado.** El destino autorizado es `ylcnrfzosjzuljufwups` y el repositorio es [tolentinosftw-dotcom/tolentino-chef](https://github.com/tolentinosftw-dotcom/tolentino-chef). URL y claves están en `.env.local`, ignorado por Git; esta guía no contiene sus valores.

Existen **tres restaurantes DEMO y cuatro cuentas Auth**: el administrador ya configurado y un propietario por DEMO. Aurora, Bruma y Marea tienen 24 productos y ocho categorías cada uno, imágenes propias, horarios y traducciones al inglés. Sus cuentas reservadas `.test` no reciben invitaciones ni recuperación por correo. Véanse [provisión de las DEMO](evidence/demo-provisioning.json) y [traducciones verificadas](evidence/demo-english-translations.json).

Están aplicadas las migraciones `20261017021301_initial_tenant_security` y `20261017165549_restaurant_creation_requests`. La primera estableció RLS y Storage privado; la segunda añadió solicitudes de creación idempotentes y su acceso exclusivo de servidor. Las verificaciones están en [esquema inicial](evidence/db-migration-verification.json) y [migración de creación](evidence/creation-migration-verification.json).

La aceptación remota registra **84/84 comprobaciones de API, Auth, RLS, Storage, CSV y aislamiento entre los seis pares dirigidos de propietarios**, más **10/10 comprobaciones administrativas** y **19/19 complementarias**, todas aprobadas. Son pruebas contra Supabase real a través del servidor local; no acreditan un despliegue público. La prueba inicial administrativa con un selector incorrecto se conserva y su repetición corregida pasó. Véanse [auditoría real](evidence/live-audit.json) y [auditoría administrativa](evidence/live-admin-audit.json) y [recorridos complementarios](evidence/live-gap-audit.json).

Los nueve archivos QR se decodificaron correctamente, pero contienen URLs locales. No hay URL de Render confirmada, dominio público validado ni escaneo físico. No imprimirlos para clientes. [Validación local de QR](evidence/demo-qr-decoding.json).

El recorrido real de navegador pasó 24/24 escenarios y 372/372 comprobaciones en Chrome/Edge. Después de las portadas finales y del reinicio, pasaron 18 capturas/54 comprobaciones; la revisión visual de esas capturas por dos agentes de IA tampoco encontró defectos. Los hashes privados y públicos de las tres DEMO permanecieron iguales tras arrancar un proceso nuevo. Evidencias: [navegador real](evidence/live-browser-audit.json), [capturas finales](evidence/live-browser-screenshots.json), [revisión visual](evidence/live-browser-visual-review.json), [reinicio](evidence/restart-persistence.json) y [smoke final local](evidence/production-local-smoke.json).

El build de producción local, typecheck (next typegen y tsc) y lint pasaron. El servidor next start local responde health 200 y sirve el favicon de plataforma. El escaneo revisó 251 archivos candidatos, 251 archivos del índice Git, 44 archivos del bundle cliente y 110 blobs del historial alcanzable, sin encontrar los secretos buscados; los archivos locales de credenciales permanecen ignorados. Estas comprobaciones no equivalen a un despliegue en Render. Evidencias: [build actual](evidence/production-build-20261017.txt) y [escaneo de secretos](evidence/security-final-scan.json).

## 1. Proyecto y migraciones

No crear otro proyecto, repetir el bootstrap del administrador ni volver a aplicar las migraciones existentes para publicar esta instalación. Tampoco ejecutar un reset ni operar sobre los proyectos de referencia. La aplicación utiliza un servicio web para todos los restaurantes y conserva sus datos en Supabase.

Para futuras migraciones, comprobar primero destino y estado del historial, revisar el SQL y ejecutarlo en un entorno de prueba antes del proyecto autorizado. La CLI o conexión PostgreSQL debe señalar explícitamente el destino correcto. Mantener las credenciales solo en variables secretas o archivos locales ignorados. El bucket `restaurant-media` permanece privado: no cambiarlo a público.

Las pruebas reales de aislamiento entre propietarios ya están realizadas. La consulta de advisors de seguridad sigue bloqueada por falta de permiso de la integración de Supabase; no fue un rechazo de aprobación automática y no se presenta como una auditoría aprobada. [Evidencia del bloqueo](evidence/advisors-access.json).

## 2. Auth, correo y administrador existente

El administrador **ya existe y funciona**. No ejecutar de nuevo `scripts/bootstrap-admin.mjs` para este proyecto. El bootstrap queda reservado para una instalación nueva y separada que lo necesite explícitamente.

La lectura remota de Auth confirmó `public_signup_enabled: true`, proveedor de correo habilitado y autoconfirmación de correo desactivada. La interfaz no ofrece registro público, pero el ajuste alojado todavía debe cerrarse antes de operar con clientes. SMTP, acceso anónimo, política alojada de contraseñas y duración de sesiones requieren verificación en el Dashboard o Management API con permiso suficiente; el endpoint público no expone toda esa configuración. No se enviaron correos reales durante estas pruebas. [Lectura de Auth y sus límites](evidence/auth-settings-readonly.json).

Al configurar el entorno público, establecer **Site URL** igual a `APP_URL` y autorizar la ruta exacta `APP_URL/auth/callback` para PKCE. En la plantilla **Reset password**, usar:

```html
<a
  href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery"
  >Definir mi contraseña</a
>
```

La creación de un cliente confirma primero restaurante y membresía, y después solicita recuperación para definir la contraseña. No utiliza la plantilla Invite. El endpoint de servidor procesa `token_hash` mediante `verifyOtp` y redirige a `/login?mode=password`. Configurar y comprobar esa plantilla con el SMTP y dominio definitivos; una DEMO `.test` no sirve para validar entrega de correo. [Plantillas de Supabase con endpoint de servidor](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

## 3. Variables del servicio

| Variable | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase autorizado |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del mismo proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Secreto exclusivo del servidor; nunca variable pública |
| `APP_URL` | Origen HTTPS permanente de Tolentino; localhost solo para trabajo local |
| `PLATFORM_HOSTNAMES` | Hostnames exactos confiables, sin protocolo ni comodines |
| `RENDER_API_KEY` | Opcional, solo servidor, para registro y validación de dominios |
| `RENDER_SERVICE_ID` | Identificador real del servicio Tolentino, cuando exista |
| `RENDER_SERVICE_HOSTNAME` | Host real `onrender.com`; no inventarlo |

Cargar los valores en Render antes del arranque. No subir `.env.local`, `.runtime`, contraseñas DEMO, `node_modules` ni `.next`. Las imágenes y datos comerciales viven en Supabase; el disco del servicio web no es su almacenamiento persistente. Las DEMO actuales están identificadas mediante `is_demo` y cuentas `.test`; las futuras pruebas destructivas deben usar un entorno aislado.

## 4. Publicar en Render

El blueprint usa **`autoDeployTrigger: commit`**. La consulta de GitHub encontró cero check runs y cero statuses en la rama principal; con `checksPass`, Render no dispara un despliegue cuando no detecta checks. El modo por commit evita ese bloqueo, y el comando de build sigue ejecutando los controles del repositorio. Para los despliegues automáticos hay que conectar el proveedor Git; pegar solo una URL pública requiere despliegues manuales. [Preflight del repositorio](evidence/render-preflight.json), [integración oficial de Render con CI](https://render.com/docs/deploys#integrating-with-ci).

1. Conectar el repositorio `tolentinosftw-dotcom/tolentino-chef` mediante la integración Git de Render y seleccionar la rama que se va a publicar.
2. Crear un único Web Service con `render.yaml`: Node 22.23.3, inicio `npm run start` y health `/api/health`.
3. Configurar las variables anteriores con los valores reales del entorno y revisar el origen público antes de generar QR definitivos.
4. Ejecutar el build y esperar un despliegue saludable. Su comando es:

   ```sh
   npm ci --include=dev && npm run typecheck && npm run lint && npm run test && npm run build
   ```

   `typecheck` ejecuta `next typegen && tsc --noEmit` para generar los tipos de rutas antes de comprobar TypeScript en una instalación limpia. [Referencia oficial de `next typegen`](https://nextjs.org/docs/app/api-reference/cli/next#next-typegen-options).
5. Comprobar desde el origen HTTPS publicado: health, login de los roles previstos, rechazo anónimo de APIs privadas, persistencia, carga y lectura de imágenes, cambios de precio, suspensión/reactivación y QR. Render proporciona `PORT`; Next escucha en la interfaz del servicio.
6. Configurar un dominio permanente controlado por Tolentino, actualizar `APP_URL`, callbacks y hostnames confiables, regenerar las descargas QR para ese origen y realizar un escaneo físico. Seguir [QR y dominios](QR_Y_DOMINIOS.md) para dominios de clientes.

Un fallo en cualquier comando del build impide completar el despliegue. Este procedimiento todavía no se ejecutó en Render; la comprobación de un build local no lo sustituye. [Proceso de despliegue de Render](https://render.com/docs/deploys#deploy-steps).

El blueprint propone el plan gratuito para validación inicial. Render documenta que sus servicios gratuitos se suspenden por inactividad y no los recomienda para producción. La elección de disponibilidad y plan comercial sigue pendiente; no se contrató ningún plan de pago. [Límites oficiales de Render Free](https://render.com/docs/free).

## 5. Backup y recuperación

Definir retención y exportaciones cifradas según el plan real de Supabase. Respaldar los objetos de Storage además de PostgreSQL: una copia SQL no contiene por sí sola los archivos de imágenes. Conservar migraciones y configuración sin secretos en Git.

Ensayar la restauración en un proyecto aislado: esquema, datos, objetos, membresías y tokens QR. Comprobar aislamiento y contenido antes de cambiar configuración de operación. Conservar los tokens públicos, `APP_URL` y el dominio permanente para mantener el material impreso. No se ejecutó un ensayo completo de restauración en esta entrega.

## 6. Pendientes externos antes de operar

| Pendiente | Evidencia o límite actual |
| --- | --- |
| Publicar Render y comprobar su health y reinicio | No hay servicio público confirmado; solo ejecución local |
| Dominio, DNS, HTTPS y callbacks finales | Faltan valores y verificación sobre el dominio real |
| QR comercial y escaneo físico | Nueve archivos válidos, todos con URL local |
| Cerrar registro público en Auth | La última lectura alojada indica que sigue habilitado |
| SMTP y entrega de recuperación real | Sin acceso de configuración suficiente ni prueba de entrega; DEMO sin comunicaciones |
| Políticas alojadas de contraseña, sesión y acceso anónimo | La configuración local no prueba la del proyecto alojado |
| Advisors de Supabase | Integración sin permiso para ejecutar la consulta |
| Backup y restauración aislada | Procedimiento documentado, ensayo completo no realizado |
| Capacidad y disponibilidad comercial | CSV de hasta 1.000 filas probado; no es una prueba de carga concurrente |

Estas tareas no se consideran completadas por las pruebas locales o por las comprobaciones reales de API. El detalle de alcance y resultados está en [AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md](../AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md).
