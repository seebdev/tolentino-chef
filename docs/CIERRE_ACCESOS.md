# Cierre de accesos de propietarios

Estado del 18 de octubre de 2026: implementación y comprobaciones locales. La aplicación de la migración al destino, el despliegue y la aceptación real se coordinan en el cierre general; este documento no los da por ejecutados. No se enviaron correos ni se modificaron cuentas reales durante estas pruebas.

## Acceso y entrega

El superadministrador dispone de **Acceso del propietario** en la lista de restaurantes y en el espacio de administración de cada restaurante. Puede consultar el correo existente, establecer un usuario opcional, generar una contraseña temporal con 192 bits aleatorios o escribir una de 12 a 128 caracteres, y suspender o reactivar el acceso.

El correo y el UUID Auth existentes se conservan. El usuario opcional se normaliza con trim y minúsculas; admite 3 a 32 caracteres ASCII: letras, números, punto, guion y guion bajo, y comienza por letra o número. Su unicidad se impone en PostgreSQL. La resolución a correo ocurre sólo en el servidor. Los propietarios no pueden consultar un directorio de usuarios, asignarse alias ni invocar las operaciones de administración.

La contraseña se entrega una sola vez en la respuesta de la operación que la estableció y permanece únicamente en memoria del diálogo. Al cerrarlo desaparece. No hay consulta posterior ni persistencia en localStorage, tablas de negocio, huellas de idempotencia o eventos de auditoría. Supabase Auth sigue siendo responsable de almacenar su verificador; la aplicación no pretende eliminar ni sustituir ese mecanismo. Si se perdió la respuesta, se establece otra contraseña después de reconciliar el intento anterior.

Crear un restaurante ya no envía una invitación automáticamente. La pantalla indica que el acceso se entrega mediante este diálogo. La recuperación por correo permanece como acción explícita; las direcciones reservadas `.test` no llaman al proveedor de correo. SMTP y entrega real de recuperación siguen pendientes de una validación autorizada.

## Control efectivo del primer cambio y de sesiones

El primer inicio con contraseña temporal lleva a `/login?mode=password`. El control también se ejecuta en servidor y PostgreSQL:

- `actor()` impide entrar en las API de negocio mientras el cambio es obligatorio.
- Las políticas existentes de tablas y Storage consultan `private.owner_session_allowed()`. La sesión temporal no puede eludir el bloqueo usando directamente la API REST.
- El cambio válido se completa con el UUID de sesión verificado y una generación de acceso. Si otro reset modificó esa generación, la confirmación se rechaza sin liberar el bloqueo.
- Un reset invalida las sesiones anteriores al reservarse y vuelve a fijar el corte al confirmarse Auth. Una sesión creada durante el reset también queda excluida.
- Suspender o reactivar el restaurante o su membresía exige un nuevo inicio de sesión. Reactivar no rehabilita los JWT anteriores.
- Tras cambiar la contraseña, se acepta la sesión que completó el cambio y se bloquean las demás sesiones temporales anteriores.

Se comprueba `session_id` contra `auth.sessions` y su fecha de creación. El resultado es revocación del acceso a los datos de esta aplicación, aunque un JWT ya emitido no desaparezca físicamente del navegador. El cierre de sesión habitual conserva alcance `local` y limpia las cookies de esa sesión. La identidad del administrador y el soporte no se convierten en propietarios.

La migración conserva el acceso de los propietarios existentes hasta que el administrador solicite un reset o cambie el estado. No fuerza cambios retroactivos de contraseña al desplegarse.

## Idempotencia y fallos parciales

`private.owner_access_requests` guarda el administrador, request UUID, restaurante, propietario reservado, correo esperado, alias y estado; nunca la contraseña. El servidor reserva la identidad y un lease antes de llamar a Auth. La transición durable `auth_started` precede a la escritura de contraseña.

Dos envíos simultáneos no autorizan dos escrituras. Un lease vencido puede renovarse antes de comenzar Auth; el token anterior pierde validez. Una vez comenzada la operación, los reintentos sólo consultan el marcador de servidor en `app_metadata`. No repiten a ciegas una escritura cuyo resultado sea incierto. Una confirmación completada devuelve éxito sin revelar de nuevo la contraseña.

La identidad reservada se verifica por UUID y correo. No se adopta ni se elimina una cuenta ajena ante un conflicto. Cuando falta la membresía, su creación y la confirmación del acceso ocurren en una transacción SQL y la cuenta reservada permanece asociada al registro durable durante la reconciliación.

Auth y PostgreSQL no forman una transacción distribuida. Si la respuesta de Auth se pierde y el marcador no permite confirmar el resultado, el intento permanece pendiente y el acceso queda bloqueado. El diálogo conserva o recupera su request UUID y permite comprobarlo; no inventa un éxito ni repite la contraseña. Una incertidumbre permanente requiere comprobar el estado del proveedor antes de intervenir. No se promete recuperación automática de cualquier caída externa.

Los errores conocidos del proveedor distinguen conflicto de correo, datos inválidos, contraseña rechazada y límite de solicitudes. Un fallo desconocido no se presenta como correo duplicado.

## Contrato de servidor

| Operación | Contrato |
| --- | --- |
| Estado administrativo | `GET /api/admin/owner-access?restaurantId=<uuid>`; sólo superadministrador |
| Establecer contraseña | `POST` con `action:set_password`, `restaurantId`, `requestId`, `alias` opcional y `password` opcional |
| Cambiar usuario | `POST` con `action:alias`, `restaurantId` y `alias` |
| Suspender/reactivar | `POST` con `action:status`, `restaurantId`, `alias` e `isActive` |
| Inicio de sesión | `POST /api/auth` acepta `identifier`; conserva compatibilidad con `email` |
| Cambio obligatorio | `POST /api/auth` con `action:password`; valida identidad, sesión y generación en servidor |
| Pendiente | HTTP 202 con `OWNER_ACCESS_PENDING`; conserva el mismo request UUID |
| Resultado incierto | HTTP 503 con `OWNER_ACCESS_UNCONFIRMED`; reconciliar, no repetir Auth |
| Conflicto de alias | HTTP 409 con `OWNER_ALIAS_TAKEN` |
| Generación sustituida | HTTP 409 con `PASSWORD_CHANGE_STALE` |

El estado administrativo usa `operationPending`, distinto de `pending` en la respuesta HTTP 202, para que cargar el diálogo no sea interpretado como un error por el cliente HTTP.

## Footer administrable

La misma migración agrega `platform_settings.creator_brand`, `creator_phone` y `creator_whatsapp`. Los valores iniciales son Tolentino Chef, 3108853158 y un enlace HTTPS `wa.me` con el número colombiano y mensaje preparado. Se conservan `contact_label` y `contact_url` por compatibilidad. La API de plataforma valida los campos y sólo permite guardarlos al superadministrador. El componente público y su texto por idioma se verifican en el cierre de menú/apariencia.

## Respaldo y restauración

Los scripts de respaldo final y restauración local ahora inventarían las tablas reales de `public` y `private`; no suponen 15 tablas para futuras capturas ni un máximo silencioso de 1000 filas. Los límites explícitos fallan de forma visible si se exceden. Se capturan catálogo, dependencias, historial y hashes.

La restauración selecciona únicamente las versiones incluidas en el respaldo y verifica que sus bytes coincidan con las migraciones locales. La existencia de migraciones nuevas en el repositorio no las aplica al restaurar un archivo histórico. Las filas se insertan con parámetros, orden de claves foráneas y restricciones activas; los triggers de aplicación se reactivan y se comparan los hashes. El adaptador destructivo de restauración sólo admite PGlite local en memoria.

El respaldo fresco previo a aplicar estas migraciones pasó **71/71 comprobaciones**: 617 filas públicas, 15 tablas públicas, dos privadas con 50 filas, cuatro identidades Auth y 28 objetos con 315166 bytes. Se preservaron IDs, membresías, tokens QR y hashes; se probaron seis pares de aislamiento. [Evidencia de restauración](evidence/migrations/hgntppemxwcxaxritnfq/20261018T060751628Z/target-final-restore-local.json).

El ensayo restaura el esquema y datos de aplicación. Auth usa stubs de identidad/metadatos y sesiones vacías; Storage se valida en memoria. No equivale a restaurar GoTrue, contraseñas, sesiones ni toda la plataforma Supabase. La doble lectura del respaldo detecta cambios durante una ventana sin escrituras, pero no proporciona una transacción distribuida. El cifrado local protegido con DPAPI requiere preservar de forma segura el perfil o una estrategia de recuperación portátil.

## Verificación local

Se reprodujeron primero dos fallos: el alias no era admitido por el inicio de sesión y una cuenta marcada para primer cambio recibía la ruta del panel. Las regresiones cubren resolución privada, cambio obligatorio, aislamiento SQL, sesiones antiguas, reset concurrente, leases, resultado incierto, contraseña visible una vez y ausencia de comunicaciones automáticas.

Las seis pruebas de interfaz con API interceptada pasaron en escritorio y móvil. Comprueban doble envío, secreto eliminado al cerrar, recuperación del request UUID pendiente y redirección al primer cambio. Estas pruebas no demuestran persistencia en Supabase; las pruebas PGlite y de handlers con mocks tienen alcance separado.

El pase focalizado final pasó **133/133 casos** en ocho archivos, con TypeScript y ESLint correctos. Incluye 15 casos específicos de política de propietarios en PostgreSQL y nueve del handler de inicio/cambio de contraseña. Una defensa adicional, primero reproducida con un fallo, limpia la sesión si un alias inexistente llegase a autenticar el correo señuelo.

El resumen de resultados finales y comandos se publica en [owner-access-regression.json](evidence/owner-access-regression.json). Los resultados históricos fallidos se conservan como reproducción y no se presentan como pruebas de aceptación.

## Archivos principales

- `supabase/migrations/20261018053627_owner_access.sql`
- `src/lib/owner-access.ts`, `src/lib/access.ts`, `src/lib/create-restaurant.ts`
- `src/app/api/admin/owner-access/route.ts`, `src/app/api/auth/route.ts`, `src/app/api/session/route.ts`
- `src/components/owner-access-dialog.tsx`, `src/components/admin-app.tsx`, `src/components/login.tsx`
- `tests/owner-access.test.ts`, `tests/owner-access-database.test.ts`, `tests/owner-login.test.ts`, `tests/e2e/owner-access.spec.ts`
- `scripts/migration-target-final-backup.mjs`, `scripts/migration-target-final-restore-local.mjs`, `tests/final-backup-restore.test.ts`

La verificación de sesiones se fundamenta en la [documentación de sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions), y la escritura administrativa en [updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid). Se revisaron también las guías de autenticación y cookies incluidas en la versión instalada de Next.js.
