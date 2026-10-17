# Preparación de producción — iteración del 17 de octubre de 2026

> Plan histórico del entorno anterior, conservado como evidencia. El destino vigente es el descrito en [MIGRATION_PLAN.md](MIGRATION_PLAN.md) y su [estado actual](MIGRATION_STATUS.md). No ejecutar este plan sobre la infraestructura anterior durante el traslado.

Estado: **preparado parcialmente; despliegue bloqueado por acceso y confirmaciones**. Este documento no acredita ninguna URL pública. No se han creado servicios, modificado configuración alojada ni cambiado el contenido de los restaurantes. Las pruebas de sesión generan su actividad normal de Auth, auditoría y límites de uso; el ensayo inicial de aislamiento hizo seis GET públicos que pueden incrementar visitas. El runner final evita peticiones públicas y conserva los hashes de contenido.

## Punto de partida verificado

- Repositorio: https://github.com/tolentinosftw-dotcom/tolentino-chef, rama `main`.
- HEAD local/remoto: `67a99778196584521c9ec048ac7d6de8496e72de` al comenzar esta iteración.
- Cuenta GitHub: `tolentinosftw-dotcom`, permiso `ADMIN`.
- Supabase autorizado: `ylcnrfzosjzuljufwups`. Se conservan las tres DEMO existentes.
- Las tres variables de Supabase están presentes localmente; sus valores no se muestran ni se copian a Git.
- `APP_URL` sigue siendo `http://localhost:3000`: es el entorno local, no la dirección de producción.
- No hay `RENDER_API_KEY` local y la integración Supabase deniega el acceso Management.

Evidencia de solo lectura: [production-preflight.json](evidence/production-preflight.json). Puede repetirse con Node 22 mediante `node scripts/production-preflight.mjs`; no crea ni actualiza recursos. El resultado enumera bloqueos, nunca constituye autorización de despliegue.

## Registro público: cierre observado y verificado

La comprobación inicial devolvió `disable_signup: false`. Una nueva lectura a las 19:41 UTC del 17 de octubre de 2026 devuelve `disable_signup: true`: el registro público ya está deshabilitado, el acceso anónimo sigue desactivado y Email conserva confirmación. El agente no cambió la configuración. No se envió una solicitud de registro de prueba ni correo.

En [Authentication / Providers del proyecto](https://supabase.com/dashboard/project/ylcnrfzosjzuljufwups/auth/providers), desactivar **Allow new users to sign up** y guardar. Mantener Email habilitado y las cuentas existentes. Este paso ya aparece cumplido en la lectura pública; está pendiente la confirmación textual del propietario. La creación administrativa de propietarios seguirá siendo el flujo de la plataforma.

Referencia: [configuración general de Auth](https://supabase.com/docs/guides/auth/general-configuration).

## Acceso seguro a Render

Crear una clave en [Render → Account Settings → API Keys](https://dashboard.render.com/u/settings/api-keys) y guardarla exclusivamente en `.env.local` como `RENDER_API_KEY`. Este archivo está ignorado por Git. No introducir la clave en chats, scripts, argumentos de línea de comandos, capturas ni documentos. También se puede configurar el servicio desde el Dashboard y compartir únicamente su URL e identificador no secretos.

La primera operación con acceso será listar todos los servicios y buscar tanto el repositorio como el nombre `tolentino-restaurantes-admin`. Un servicio coincidente se reutiliza después de revisar su configuración. Si hay varios candidatos, detenerse y pedir selección; si no hay ninguno, pedir autorización concreta para crear uno. La ausencia de credenciales no demuestra que no existan servicios.

Referencia: [API oficial de Render](https://render.com/docs/api).

## Propuesta de despliegue pendiente de autorización

| Campo                       | Configuración preparada                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Recurso                     | Un solo Web Service; reutilizar el existente si lo hay                                       |
| Nombre previsto             | `tolentino-restaurantes-admin`                                                               |
| Repositorio / rama          | `tolentinosftw-dotcom/tolentino-chef` / `main`, explícitos en `render.yaml`                  |
| Workspace / ID              | Pendiente del inventario autenticado; no inventado                                           |
| Runtime                     | Node `22.23.3`                                                                               |
| Región actual del blueprint | `oregon`                                                                                     |
| Build                       | `npm ci --include=dev && npm run typecheck && npm run lint && npm run test && npm run build` |
| Inicio / health             | `npm run start` / `/api/health`                                                              |
| Base de datos / Storage     | Supabase existente; sin Render Postgres, sin recreación ni bootstrap                         |
| Despliegue automático       | `commit`, una vez autorizado y conectado GitHub                                              |
| Plan actual                 | `free`, válido para validación pública inicial; elección comercial pendiente                 |
| URL definitiva              | La URL HTTPS realmente asignada o un dominio controlado; todavía desconocida                 |

El YAML pasa el [esquema oficial](https://render.com/docs/blueprint-spec) y contiene un solo servicio, ninguna nueva base y ningún valor secreto. [Validación local](evidence/production-blueprint-validation.json). La validación del esquema no equivale a inventariar la cuenta ni a crear un servicio.

Render advierte que Free se suspende por inactividad y no debe usarse para producción. Antes de contratar un plan, presentar el precio vigente y obtener autorización. No se ha contratado ningún plan. [Límites Free](https://render.com/docs/free).

Las modificaciones locales y las nuevas evidencias se conservan para revisión. No hacer push ni activar un Blueprint hasta autorizar los cambios externos: un push puede disparar el despliegue automático de un servicio ya conectado.

## Variables y origen definitivo

Proporcionar en la configuración secreta de Render `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY` desde el archivo local. Sólo las dos primeras son públicas. Las variables `NEXT_PUBLIC_` se fijan durante el build; deben estar correctas antes de compilar.

Establecer `APP_URL` al origen HTTPS definitivo, sin ruta ni barra final; `PLATFORM_HOSTNAMES` a hostnames exactos autorizados y `RENDER_SERVICE_HOSTNAME` al host real asignado. No usar localhost, comodines ni un nombre onrender.com adivinado. Mantener la configuración local separada. `RENDER_SERVICE_ID` y la clave de API son necesarios sólo para la integración administrativa de dominios; no son credenciales de la base.

Después, configurar en Supabase **Site URL** igual a `APP_URL` y callback exacto `APP_URL/auth/callback`. Revisar la plantilla `Reset password` documentada en [la guía de despliegue](DEPLOY_RENDER_SUPABASE.md), SMTP, remitente, política de contraseña y sesiones. No enviar una prueba de recuperación a terceros sin autorización ni usar las cuentas `.test` para probar entrega.

## Criterios de aceptación después del despliegue

1. Deploy en estado saludable, commit conocido, HTTPS y `/api/health` 200; revisar logs saneados.
2. `/login`, `/admin` y `/dashboard`: sesión real de cada rol, acceso anónimo rechazado y aislamiento por tenant.
3. Menús `/menu/pizzeria-aurora-demo`, `/menu/cafe-bruma-demo`, `/menu/bento-marea-demo`: 24 productos por menú, imágenes, traducciones y contenido conservados.
4. Comparar hashes de negocio antes/después de un reinicio del servicio autorizado. Ningún reset ni migración automática.
5. Descargar PNG/SVG/PDF nuevos para los tres tokens QR existentes; decodificar 9/9, exigir HTTPS y resolver a la DEMO correcta. Guardar separados de `artifacts/qr/local-validation`.
6. Probar los QR desde un teléfono fuera de la red local cuando el usuario pueda hacerlo; registrar confirmación real, sin equiparar decodificación a escaneo físico.
7. Configurar y probar correo sólo con destinatario y envío expresamente autorizados; conservar datos y acceso del administrador.
8. Acreditar respaldo y restauración aislados, explicando límites de Auth y de configuración del proveedor.

Hasta completar estas comprobaciones, las URLs públicas del administrador y de los tres menús permanecen **no disponibles**.
