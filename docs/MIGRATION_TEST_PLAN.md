# Plan de pruebas de la migración

Fecha: 17 de octubre de 2026. Destino autorizado: `hgntppemxwcxaxritnfq`; repositorio nuevo: `seebdev/tolentino-chef`.

## Estado y límite de esta preparación

Los guards y los runners de QA se adaptaron localmente. Las pruebas de esos guards usan respuestas simuladas en memoria y no autentican contra ningún Supabase. Las credenciales nuevas siguen pendientes y el servidor que estaba activo en localhost conserva el build y entorno anterior. **No se ejecutaron logins, mutaciones ni pruebas reales del destino nuevo en esta preparación.** La evidencia antigua acredita únicamente el entorno donde se obtuvo.

El archivo `.env.local`, el manifiesto anterior, sus cuentas y las evidencias históricas se conservan. No se modificó Crepes & Waffles. Los cambios de Git, variables de aplicación, corte, Render, migraciones y traslado de datos corresponden a sus tareas coordinadas; este documento no acredita que ya hayan concluido.

## Contrato de ejecución

Los runners adaptados leen `.env.migration.local` mediante Node `--env-file`, con estas variables:

| Variable | Uso |
| --- | --- |
| `TARGET_SUPABASE_URL` | Debe ser exactamente `https://hgntppemxwcxaxritnfq.supabase.co`. |
| `TARGET_SUPABASE_PUBLISHABLE_KEY` | Clave pública del destino; no se registra su valor. |
| `TARGET_SUPABASE_SERVICE_ROLE_KEY` | Sólo los recorridos administrativos que la necesitan; aislamiento RLS usa exclusivamente la clave pública y sesiones del propietario. |
| `AUDIT_BASE_URL` | Origen de la aplicación; localhost por defecto y HTTPS obligatorio fuera de loopback. |
| `AUDIT_RUN_ID` | Identificador de la ejecución. Obligatorio al comparar un reinicio, verificar archivos QR o consolidar capturas de varias corridas. |
| `AUDIT_ALLOW_DEMO_MUTATIONS` | Debe igualar el identificador del destino para habilitar pruebas con cambios temporales. Ausente durante preparación y lectura. |

Las variables de conexión PostgreSQL y la contraseña rotada corresponden al migrador, no a estos runners. No se imprime ninguna credencial. Node no sustituye variables heredadas con `--env-file`: si existen variables antiguas `NEXT_PUBLIC_SUPABASE_*` o `SUPABASE_SERVICE_ROLE_KEY` incompatibles con las `TARGET_`, el helper aborta.

Rutas acordadas:

- Manifiesto público nuevo: `artifacts/migrations/hgntppemxwcxaxritnfq/restaurants.json`.
- Tres cuentas DEMO privadas: `.runtime/migrations/hgntppemxwcxaxritnfq/accounts.json`.
- Administrador privado: `.runtime/migrations/hgntppemxwcxaxritnfq/admin-account.json`.
- Evidencias: `docs/evidence/migrations/hgntppemxwcxaxritnfq/<run-id>/`.
- Capturas y QR nuevos: `artifacts/migrations/hgntppemxwcxaxritnfq/<run-id>/screenshots/` y `qr/`.
- Baseline de reinicio: `.runtime/migrations/hgntppemxwcxaxritnfq/restart-before-<run-id>.json`.

El esquema del manifiesto conserva `target`, `base` y `restaurants`; cada DEMO tiene `key`, `id`, `publicToken`, `stableRoute`, `localMenu`, estado, marca DEMO y conteos. Las cuentas conservan `email`, `password`, `restaurantId`, `userId` y opcionalmente `media`. No se inventa un manifiesto de destino antes de verificar el traslado real.

## Barreras antes de autenticar

`scripts/audit-target.mjs` fija el destino nuevo; no acepta una variable que lo redirija al anterior. Valida tres DEMO distintas, sus cuentas, 24 productos y ocho categorías declarados. Compara UUID del restaurante y token QR con el manifiesto histórico para detectar una regeneración involuntaria de identidades permanentes. Los conteos declarados se comprueban nuevamente contra la API en las pruebas reales.

Antes de enviar credenciales, los runners adaptados solicitan únicamente `/api/health` y exigen HTTP200, `status: ok`, `configured: true` y `supabaseProjectRef: hgntppemxwcxaxritnfq`. Un servidor sano que aún use el origen o que no exponga el marcador también se rechaza. La respuesta de health no incluye claves. El cliente compartido repite la verificación antes de POST y exige el flag de mutaciones para acciones distintas de login/logout.

Los recorridos de navegador verifican el mismo marcador antes de iniciar sesión. Los menús se resuelven sobre el origen seleccionado usando su ruta, sin navegar a una URL antigua guardada en el manifiesto. Los cierres de sesión de auditoría mantienen alcance local.

## Inventario de dependencias anteriores

| Ubicación | Hallazgo / tratamiento |
| --- | --- |
| `src/` y SQL existentes | No se encontró el identificador del proyecto anterior ni el repositorio anterior incrustados. La aplicación obtiene las claves de variables. |
| `render.yaml`, `production-preflight.mjs` y documentación operativa | Referencias de repositorio/proyecto a actualizar y verificar por la tarea principal; no prueban acceso a una cuenta nueva. |
| Manifiesto `artifacts/demo/restaurants.json` y evidencias antiguas | Conservados como procedencia histórica; no se usan como evidencia de una ejecución nueva. |
| `verify-production-isolation.mjs` | Destino y cuentas nuevos; seis pares dirigidos; no GET de menú público en esta prueba. |
| `verify-restart.mjs`, `verify-production-local.mjs` | Manifiesto y cuentas nuevos, guard health y salidas separadas. El primero exige baseline del mismo target/run/origen. |
| `verify-demo-qr.mjs` | Lee sólo los nueve archivos del run nuevo y compara la carga útil con su origen y token. Decodificar no acredita HTTP público ni escaneo físico. |
| `visual-live-audit.mjs` | Guard antes de login, namespace de capturas/evidencia y target/run explícitos. Conserva recorridos reales sin interceptar APIs. |
| `consolidate-live-browser-audit.mjs` | Exige nombres de reportes explícitos, mismo destino/run/origen, 24 escenarios únicos y sin errores inesperados. No combina automáticamente los reportes viejos. |
| `run-live-audit.mjs`, `run-admin-live-audit.mjs`, `run-live-gap-audit.mjs` | Adaptados al destino, cuentas nuevas y flag de mutaciones DEMO; requieren baseline y restauración comprobada antes de usarse. No ejecutados en esta preparación. |
| `live-client.mjs` | Guard compartido de destino y health; no reemplaza una auditoría de cada operación directa de otros scripts. |

**NO EJECUTAR para esta migración:** `bootstrap-admin.mjs`, `provision-demos.mjs`, `translate-demos.mjs`, `refine-demo-covers.mjs` y los scripts de backup del origen, salvo su revisión y habilitación expresa por sus responsables. No se consideran adaptados aquí. Aunque algunos usan `Session`, pueden tener operaciones directas, creación de clientes, efectos locales o supuestos previos al guard; no se afirma una protección total por importar el cliente compartido. El flujo acordado traslada el respaldo verificado y recrea credenciales Auth conservando UUID, en lugar de ejecutar las semillas antiguas.

## Pruebas locales de preparación

`tests/migration_target.test.ts` verifica sin red: destino exacto, variables faltantes/heredadas, HTTPS, origen sin credenciales ni ruta, manifiestos viejos o incompletos, conservación de UUID/QR, flag de mutaciones, health degradado/sin marcador/del origen, ausencia de credenciales en health y rechazo antes del POST de login. Sus fixtures no son datos migrados. Las pruebas de interfaz con fixtures existentes conservan sus archivos y no dependen del helper de auditoría real.

Comandos de preparación, sin cargar credenciales:

```text
node node_modules/vitest/vitest.mjs run tests/migration_target.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts tests/migration_target.test.ts
```

La suite completa y el build se coordinan una sola vez con la tarea principal. Los resultados locales nuevos deben guardarse con fecha y alcance; nunca se presentan los resultados históricos como si fueran pruebas del destino.

## Secuencia después del traslado y corte

1. Verificar credenciales rotadas, migraciones ordenadas, RLS/grants, Auth sin registro público, bucket privado y objetos. Comparar datos del destino con el respaldo, incluidos UUID y QR; hacerlo en la tarea de datos.
2. Confirmar tres cuentas propietarias y administrador con contraseñas nuevas protegidas; tres DEMO con 24 productos, seis categorías principales y dos subcategorías, imágenes propias, variantes/extras, apariencia, promoción, siete horarios y 32 traducciones inglesas por restaurante.
3. Detener el servidor anterior de forma coordinada, configurar exclusivamente las variables nuevas de aplicación, reconstruir e iniciar un proceso nuevo. Health debe identificar el destino nuevo antes de cualquier login. No basta con cambiar el archivo del runner.
4. Ejecutar aislamiento privado y positivos propios. Comparar hashes antes/después; mantener separado el efecto normal de Auth, auditoría y límites de solicitudes.
5. Guardar baseline y ejecutar secuencialmente los recorridos DEMO con mutaciones temporales habilitadas. No solapar suspensiones/slug/CSV con capturas, backups o verificaciones de persistencia. Restaurar y comparar contenido al final.
6. Ejecutar navegador real y persistencia tras reiniciar. No usar mocks en estos recorridos. Guardar nuevas capturas y versiones de navegador; no afirmar Safari ni dispositivos físicos si no se ejecutaron.
7. Tras Render y origen HTTPS confirmado, repetir smoke público/propietarios y controles pertinentes desde esa URL; regenerar QR y acreditar decodificación más HTTP público. Un resultado local sigue siendo local.

Matriz mínima de aceptación nueva:

| Área | Criterio / evidencia nueva |
| --- | --- |
| Superadmin y propietarios | Login, rol, asignación, logout local y nuevo login con cuentas del destino. |
| Creación | Handler/UI e idempotencia en destino. Replay no duplica; pruebas sólo DEMO y limpieza verificada. |
| Productos/precios/imágenes | CRUD y persistencia; tipos/tamaños de archivos y referencias de tenant; originales restaurados al terminar. |
| CSV | Vista previa, validaciones, exportación y commit hasta 1.000 filas sobre DEMO, sin registros temporales residuales. |
| Aislamiento | Seis direcciones API403; nueve tablas por dirección con cero filas ajenas y control positivo; descarga privada ajena denegada de un objeto existente. |
| Suspensión/soporte | Suspender/reactivar DEMO y salir del modo soporte; confirmar restauración de estado. |
| Traducciones y apariencia | 72 nombres/descripciones de productos y 24 categorías inglesas, más identidad visual independiente. |
| Persistencia | Hash privado antes/después y tras proceso nuevo; mismo target/run/origen. |
| QR | Mismo token permanente, archivos PNG/SVG/PDF, resolución al slug actual; tras deploy carga útil HTTPS y HTTP correcto. Cambio/restauración de slug sólo en DEMO. |
| Público/navegador | Tres menús, imágenes, precios, búsqueda/filtros, favoritos por tenant, horarios; Chrome/Edge y vistas 390/768/1440 según disponibilidad real. |
| Secretos | Revisar índice Git, artefactos y bundles frente a credenciales nuevas en memoria; no imprimir coincidencias completas. |

Ejemplos de ejecución futura desde una terminal limpia, únicamente cuando el destino esté listo:

```powershell
$env:AUDIT_RUN_ID = 'migration-acceptance-01'
$env:AUDIT_BASE_URL = 'http://localhost:3000'
node --env-file=.env.migration.local scripts/verify-production-isolation.mjs
node --env-file=.env.migration.local scripts/verify-restart.mjs before
# Reinicio coordinado del proceso nuevo; conservar el mismo AUDIT_RUN_ID.
node --env-file=.env.migration.local scripts/verify-restart.mjs after
node --env-file=.env.migration.local scripts/verify-production-local.mjs
```

Los recorridos con cambios requieren habilitar explícitamente el flag del destino y desactivarlo al terminar. Este plan no lo habilita ni ejecuta por sí mismo.

```powershell
$env:AUDIT_ALLOW_DEMO_MUTATIONS = 'hgntppemxwcxaxritnfq'
node --env-file=.env.migration.local scripts/run-live-audit.mjs
node --env-file=.env.migration.local scripts/run-admin-live-audit.mjs
node --env-file=.env.migration.local scripts/run-live-gap-audit.mjs
Remove-Item Env:\AUDIT_ALLOW_DEMO_MUTATIONS
node --env-file=.env.migration.local scripts/verify-demo-qr.mjs
```

Para agrupar varias corridas visuales se mantiene el mismo run y se eligen nombres distintos con `LIVE_AUDIT_REPORT`. La consolidación recibe sólo los reportes nuevos seleccionados como argumentos, por ejemplo `node scripts/consolidate-live-browser-audit.mjs chrome.json edge.json`. Rechaza archivos de otra ejecución, duplicados y reportes históricos sin marcador de destino.

## Límites de las afirmaciones

Login/logout, auditoría y límites de solicitudes producen actividad normal del sistema; las visitas públicas pueden registrar métricas. La prueba de aislamiento expresa `businessContentMutations:false` y `authSessionLifecycle:true`, no «cero escrituras totales». La decodificación QR no demuestra escaneo físico. Los tests unitarios/handlers simulados/PGlite no sustituyen Auth, RLS y Storage alojados. La confirmación final debe separar preparación local, pruebas reales del destino, publicación HTTPS y verificaciones externas pendientes.
