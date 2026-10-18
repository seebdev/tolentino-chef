# Despliegue en Render y Supabase

## Destino vigente de la migración

Actualizado el 18 de octubre de 2026 (UTC). Repositorio: [seebdev/tolentino-chef](https://github.com/seebdev/tolentino-chef), rama `main`. Supabase destino: **`hgntppemxwcxaxritnfq`**. Render: **workspace Tolentino Restaurantes (`tea-dba1s4m1egvs7391ve50`), API verificada y sin servicios; creación/despliegue pendientes de autorización**. Todavía no hay una URL pública verificada.

El historial completo y la preparación están publicados con el commit `2650c7096b4ba6b7076ac14dba5ab30dec75c490` antes de esta ejecución. El remoto anterior se conserva como `legacy-origin`, con push deshabilitado localmente. No volver a publicar allí.

La base anterior `ylcnrfzosjzuljufwups` y sus tres DEMO se conservan. El servidor local anterior se detuvo; su configuración se preservó cifrada antes del corte. El entorno local actual ya utiliza exclusivamente el proyecto nuevo. Se trasladaron y verificaron dos migraciones, cuatro identidades Auth, 361 filas y 27 objetos; los tres DEMO conservan sus UUID y tokens QR. Sus resultados están en [la auditoría histórica](../AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md) y [los DEMO históricos](../RESTAURANTES_DEMO.md); **no acreditan el nuevo Supabase ni Render**. El respaldo lógico anterior pasó un ensayo local de restauración, descrito en [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

Seguir primero el [plan de migración sin pérdida](MIGRATION_PLAN.md), [el plan de datos](MIGRATION_DATA_PLAN.md), [Auth](MIGRATION_AUTH_PLAN.md) y [pruebas](MIGRATION_TEST_PLAN.md). No ejecutar `bootstrap-admin.mjs` ni `provision-demos.mjs` como atajo: el traslado debe preservar identidades, relaciones, fotografías y tokens QR.

## 1. Credenciales y conexión del destino

Las credenciales nuevas se reciben exclusivamente en `.env.migration.local`, ignorado por Git. No copiarlas a tickets, terminal, reportes o repositorio. No reutilizar la contraseña anterior declarada expuesta.

| Entrada local | Procedencia y uso |
| --- | --- |
| `TARGET_SUPABASE_URL` | URL del proyecto `hgntppemxwcxaxritnfq` |
| `TARGET_SUPABASE_PUBLISHABLE_KEY` | Clave publicable obtenida del proyecto nuevo |
| `TARGET_SUPABASE_SERVICE_ROLE_KEY` | Clave administrativa del proyecto nuevo, exclusiva del servidor |
| `TARGET_SUPABASE_DB_PASSWORD` | Contraseña nueva de PostgreSQL, después de restablecerla en el destino |
| `TARGET_SUPABASE_DB_PASSWORD_ROTATED` | `true` únicamente tras confirmar ese cambio |
| `TARGET_SUPABASE_DB_HOST/PORT/USER/NAME` | Valores reales de Connect → Direct o Session pooler |
| `TARGET_SUPABASE_DB_SESSION_CONFIRMED` | `true` solo tras copiar los parámetros reales de Session pooler, si se usa esa conexión |
| `SUPABASE_ACCESS_TOKEN` | Opcional: token con acceso de administración al proyecto nuevo |
| `TARGET_RENDER_API_KEY` | Exclusivamente de la cuenta nueva de Render, primero para inventario de lectura |

La conexión directa utiliza IPv6. Si no está disponible desde el equipo, copiar **Session pooler** del panel; no transformar la conexión **Transaction pooler 6543** en Session por suposición. La API HTTPS que utiliza la aplicación es independiente de la conexión SQL usada para migrar. [Conexiones oficiales de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

Antes de escribir en el destino, inspeccionar su esquema, Auth, Storage e historial y crear un respaldo cifrado verificable. Aplicar las dos migraciones existentes en orden solo si faltan; no hacer reset ni sobrescribir datos divergentes. Conservar el bucket `restaurant-media` privado.

## 2. Auth, sesiones y correo

Verificar en **el proyecto nuevo** que el registro público y el acceso anónimo estén deshabilitados, y que Email/password y la creación administrativa sigan disponibles. El estado del proyecto anterior no cuenta como comprobación. Si falta acceso a Management, el propietario debe realizar el cambio en Dashboard → Authentication → configuración de usuarios/registro y confirmarlo; después se vuelve a consultar `/auth/v1/settings`.

Trasladar los cuatro UUID/correos autorizados con contraseñas nuevas aleatorias, guardadas exclusivamente en los archivos privados del destino. No trasladar hashes antiguos, sesiones ni MFA ni enviar correos a las cuentas DEMO `.test`. Las relaciones de permisos proceden de las tablas y del contexto de servidor, nunca de `user_metadata` editable.

Una vez asignado el HTTPS definitivo, configurar **Site URL** igual a `APP_URL` y permitir el callback exacto `APP_URL/auth/callback`. Revisar duración JWT, rotación de refresh, política de contraseñas y atributos de cookie. Usar un navegador/contexto limpio durante la migración; no revocar sesiones del entorno anterior.

La plantilla **Reset password** debe usar el endpoint de servidor:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Definir mi contraseña</a>
```

El alta administrativa confirma primero restaurante y membresía y luego solicita recuperación. Configurar SMTP/remitente en el proyecto nuevo y probar entrega y recuperación en un buzón autorizado; las cuentas `.test` no sirven para probar correo. No se ha acreditado entrega real. [Plantillas de servidor de Supabase](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

El defecto de logout fue corregido con autorización específica: se limpian las cookies locales aunque falle la revocación, sin afirmar éxito completo. Pasan 17/17 pruebas focalizadas y 239/239 de la suite. También se verificaron login/logout reales del destino. La protección contra contraseñas filtradas sigue deshabilitada: Supabase la ofrece desde Pro; no se contrató ese plan. Véase [PRODUCTION_AUTH_REVIEW.md](PRODUCTION_AUTH_REVIEW.md).

## 3. Variables de la aplicación y del servicio Render

El corte local ya se ejecutó después de verificar la importación y cifrar la configuración anterior. El build fue reconstruido con las variables nuevas y health identifica hgntppemxwcxaxritnfq. En futuros cambios, sustituir conjuntamente las variables y reconstruir: un build anterior conserva variables públicas antiguas.

| Variable de aplicación | Valor/requisito |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://hgntppemxwcxaxritnfq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del destino |
| `SUPABASE_SERVICE_ROLE_KEY` | Secreto nuevo exclusivo del servidor |
| `APP_URL` | Local deliberado para pruebas; en Render, solo el origen HTTPS real asignado, sin ruta |
| `PLATFORM_HOSTNAMES` | Hostnames exactos del servicio nuevo, sin protocolo ni comodines |
| `RENDER_SERVICE_HOSTNAME` | Host `onrender.com` real, una vez conocido |
| `RENDER_SERVICE_ID` / `RENDER_API_KEY` | Opcionales para gestión de dominios; solo servicio y cuenta nuevos |

Configurar los secretos mediante el sistema seguro de Render. No subir `.env*`, `.runtime`, accesos privados, backups, `node_modules` o `.next`. PostgreSQL y Storage de Supabase conservan los datos e imágenes; el disco efímero del Web Service no es su almacenamiento persistente.

`/api/health` incluye el identificador público `supabaseProjectRef`. Exigir HTTP 200 **y** `hgntppemxwcxaxritnfq` antes de cualquier login o prueba real. Esa referencia no contiene claves. La presencia de variables por sí sola no acredita su validez.

## 4. Inventario, autorización y despliegue Render

1. Conectar `seebdev/tolentino-chef` mediante la integración GitHub de la **cuenta nueva** de Render. Confirmar su workspace/owner antes de operar.
2. Ejecutar el preflight de lectura con Node 22: `node scripts/production-preflight.mjs`. Solo lee credenciales de `.env.migration.local`; guarda evidencia bajo el identificador del destino. No crea, modifica ni despliega servicios.
3. Revisar el inventario completo por repositorio, nombre e ID. Reutilizar el servicio correcto si ya existe; detenerse ante candidatos ambiguos. No crear duplicados ni usar una API key anterior.
4. Presentar el servicio concreto, workspace, región y plan para autorización. El `render.yaml` propone **un único Web Service**, Node **22.23.3**, región **Virginia**, plan **Free** para validación inicial; no crea una base de datos adicional. Ningún plan de pago está contratado.
5. Crear/sincronizar mediante el blueprint existente solo después de autorizar la acción concreta. Configurar los secretos nuevos mediante Render. Obtener el hostname real y entonces establecer `APP_URL`, hosts y callbacks exactos. No inventar el dominio.
6. El build ejecuta:

   ```sh
   npm ci --include=dev && npm run typecheck && npm run lint && npm run test && npm run build
   ```

   Inicio: `npm run start`. Health: `/api/health`. Render proporciona `PORT`; Next escucha en `0.0.0.0`. `next typegen` genera los tipos antes de comprobar TypeScript.
7. Esperar el estado de despliegue saludable, comprobar el SHA desplegado, logs sin secretos, HTTPS público y el identificador del proyecto. Probar login de superadministrador y tres propietarios, APIs privadas, aislamiento y persistencia sobre esa instancia.

El blueprint usa `autoDeployTrigger: commit`; el build sigue ejecutando todas las verificaciones indicadas. La validación local de su esquema no acredita la cuenta, los permisos Git ni un despliegue. [Referencia oficial del blueprint](https://render.com/docs/blueprint-spec), [Next.js en Render](https://render.com/docs/deploy-nextjs-app).

Free se suspende por inactividad y no se recomienda para operación comercial. La disponibilidad y el plan definitivo requieren una decisión explícita antes de contratar. [Límites de Render Free](https://render.com/docs/free).

## 5. QR, respaldo y aceptación

Conservar los tres `public_token` originales. Después de validar el HTTPS canónico, regenerar PNG/SVG/PDF, decodificar los nueve archivos y comprobar respuesta pública y restaurante correcto. Cambiar el slug debe conservar la identidad del QR. Los QR locales históricos no son comerciales. El escaneo desde otro dispositivo debe confirmarse mediante una prueba real del usuario.

Ensayar restauración en un entorno aislado y comparar tablas, UUID, membresías, tokens y bytes de Storage. Un backup lógico no equivale a una copia completa de Auth/PostgreSQL; documentar exclusiones, cifrado y custodia de claves. Nunca ensayar restauración sobre origen ni sobre datos reales de clientes. [Procedimiento y límites del respaldo](BACKUP_RESTORE.md).

Las evidencias nuevas se guardan en `docs/evidence/migrations/hgntppemxwcxaxritnfq/<run-id>/`. Reejecutar suites locales y pruebas reales del destino: roles, creación idempotente, productos/precios, imágenes, CSV 1000, seis pares de aislamiento, suspensión/reactivación, soporte, idiomas, reinicio y QR. Ninguna prueba histórica sustituye esas verificaciones.

## Bloqueos actuales

Credenciales nuevas, contraseña DB rotada, conectividad SQL, respaldo destino, registro público desactivado y workspace Render ya están verificados. La importación real y la aceptación funcional local del entorno nuevo pasaron: 239 unitarias, 54 de interfaz con fixtures, 113 funcionales reales, 30 de aislamiento y nueve QR locales decodificados. La integridad posterior confirmó catálogo, UUID, cuentas y objetos sin residuos temporales. Quedan autorización del servicio Render, HTTPS, SMTP y aceptación pública. No hay URL pública de superadministrador ni menús que pueda darse por verificada. La infraestructura anterior permanece conservada.