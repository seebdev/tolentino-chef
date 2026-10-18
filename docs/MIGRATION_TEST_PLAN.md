# Plan de pruebas de la migración

Fecha: 17 de octubre de 2026. Destino autorizado: `hgntppemxwcxaxritnfq`; repositorio nuevo: `seebdev/tolentino-chef`.

## Estado de la aceptación local

La importación real y el corte local al nuevo Supabase terminaron. Los recorridos reales contra el destino pasaron: aislamiento 30/30, principal 84/84, administrador 10/10 y comprobaciones adicionales 19/19. La integridad antes y después de QA confirma por contenido las 13 tablas de negocio comparadas, cuatro identidades Auth y 27 objetos de Storage. El registro público y el acceso anónimo del destino están cerrados. La aplicación probada usa un build de producción local; todavía no se acredita una publicación HTTPS.

TypeScript, lint, 239/239 pruebas unitarias y build webpack pasan; las 54/54 pruebas de interfaz usan fixtures y no cuentan como sesiones reales. El `.env.local` actual apunta al destino nuevo y el health de producción local lo identifica. La configuración anterior quedó respaldada cifrada antes del corte. El manifiesto, las cuentas y las evidencias anteriores conservan su carácter histórico; no acreditan esta migración. No se modificó Crepes & Waffles.

La aceptación visual real terminó con 24 escenarios y 372 comprobaciones PASS, más cuatro comprobaciones del administrador con datos cargados. Se revisaron estáticamente 20 capturas, incluidas las nueve Chrome verificadas de forma independiente. La persistencia tras otro reinicio, el respaldo final cifrado del destino y su ensayo local de restauración también pasaron. Render, origen HTTPS, SMTP y QR públicos con escaneo físico siguen pendientes; los nueve QR decodificados hasta ahora contienen URLs locales.

## Evidencia nueva comprobada

Los resultados siguientes pertenecen al destino `hgntppemxwcxaxritnfq`. Sus alcances se mantienen separados; no se suman fixtures, pruebas unitarias y comprobaciones alojadas como si fueran una sola suite E2E.

| Comprobación | Resultado y alcance | Evidencia |
| --- | --- | --- |
| Código y build | 239/239 unitarias; typegen, TypeScript, lint y build PASS. Sin aceptación de usuarios por sí solos. | [Validación local](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013032608Z/application-validation.json) |
| UI con fixtures | 54/54 en Chrome, build de producción y API sintética; cero logins reales. | [UI fixture](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013918216Z/ui-e2e-summary.json) |
| Migración real | Dos migraciones, cuatro identidades Auth, 27 objetos y 361 filas en 15 tablas verificadas; cero mutaciones en origen. | [Importación](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014644816Z/target-migration.json) |
| Corte local y health | Variables de aplicación nuevas, estado anterior cifrado y proceso local con marcador del destino. | [Corte](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014816249Z/local-cutover.json), [smoke real](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/production-local-smoke.json) |
| Aislamiento alojado | 30/30; seis pares dirigidos API/RLS/Storage con positivos propios y contenido de negocio estable. | [Aislamiento real](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/production-isolation-20261018T014923709Z.json) |
| Recorrido principal | 84/84 con API y cuentas del destino; cambios DEMO temporales restaurados. | [Principal](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-audit.json) |
| Administrador | 10/10 con cuenta del destino. | [Administrador](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-admin-audit.json) |
| Comprobaciones adicionales | 19/19, incluidas operaciones temporales y restauración comprobada. | [Adicionales](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-gap-audit.json) |
| QR locales | Nueve archivos PNG/SVG/PDF decodificados; carga útil local y tokens preservados. No demuestra HTTPS ni escaneo físico. | [Decodificación](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/demo-qr-decoding.json) |
| Integridad antes de QA | 13 tablas, cuatro UUID/correos Auth y 27 objetos/314.126 bytes iguales al respaldo; doble lectura estable. | [Antes de QA](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014837642Z/target-integrity-before-qa.json) |
| Integridad después de QA | Mismos hashes de contenido, identidades, bucket privado, MIME y bytes; sin filas u objetos extras. | [Después de QA](evidence/migrations/hgntppemxwcxaxritnfq/20261018T020309718Z/target-integrity-after-qa.json) |
| Navegador real | 24 escenarios, 372 comprobaciones PASS en Chrome/Edge; datos alojados reales, sin mocks. Revisión estática final de las capturas, con hashes asociados. | [Recorrido visual](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-browser-audit.json), [inspección de capturas](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/visual-inspection.json) |
| Administrador cargado | Cuatro comprobaciones PASS: login real, salida de soporte y lista cargada; dos capturas adicionales revisadas. Sin cambios de catálogo/plataforma. | [Administrador cargado](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/admin-loaded-screenshots.json) |
| Persistencia tras reinicio | PASS: proceso nuevo, PID 21044 frente a 20636; logins nuevos de los tres propietarios, hashes privados/públicos iguales al baseline y health HTTP 200 del destino. | [Persistencia](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/restart-persistence.json) |
| Respaldo final del destino | PASS: archivo cifrado nuevo, dump lógico PostgreSQL y Storage; 15 tablas/449 filas, cuatro identidades y 27 objetos/314.126 bytes. Estabilidad y lectura cifrada verificadas. | [Respaldo final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021153664Z/target-final-backup.json) |
| Restauración local del respaldo final | 71/71 PASS en PGlite: filas de aplicación y privadas, UUID y bytes restaurados en memoria. Auth y Storage usan tablas de simulación; no es una restauración completa de los servicios. | [Ensayo local](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021315710Z/target-final-restore-local.json) |

Las dos comprobaciones de integridad comparan el respaldo aprobado SHA256 `148c4dd9feba2a2b7257e6314cf594b406a9ed80865cf08fd103503198130c6a`. Excluyen las tablas `security_audit_events` y `visit_events`, el campo superior `updated_at` y, sólo en `restaurants`, `menu_version` y `menu_version_transaction`. Conservan en la comparación `created_at`, UUID, tokens QR, catálogo, membresías, apariencia, datos comerciales y configuración. Auth compara los cuatro UUID y correos exactos, sin probar contraseñas. Cada verificación hizo 77 solicitudes de lectura, ninguna al origen, sin login ni mutaciones remotas; descargó todos los objetos y comprobó SHA256, longitud y MIME. La doble lectura estable no equivale a una transacción distribuida.

El respaldo final conserva el estado posterior a QA, incluida su actividad de auditoría; su conteo de filas no tiene que igualar el de la importación inicial. El ensayo de restauración usa PGlite con identidades Auth representadas sólo por UUID y objetos Storage en memoria/tablas de simulación. No ejecuta GoTrue, restauración de contraseñas/sesiones ni el servicio HTTP de Storage. La decodificación completa del dump valida el archivo, no acredita una restauración de todo Supabase administrado. El cifrado con DPAPI CurrentUser tampoco demuestra recuperación portable desde otra máquina o perfil de Windows.

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

El esquema del manifiesto conserva `target`, `base` y `restaurants`; cada DEMO tiene `key`, `id`, `publicToken`, `stableRoute`, `localMenu`, estado, marca DEMO y conteos. Las cuentas conservan `email`, `password`, `restaurantId`, `userId`, `credentialId` y opcionalmente `media`. El manifiesto y las cuentas nuevos ya se generaron como parte de la importación verificada; no son fixtures de una migración supuesta.

## Barreras antes de autenticar

`scripts/audit-target.mjs` fija el destino nuevo; no acepta una variable que lo redirija al anterior. Valida tres DEMO distintas, sus cuentas, 24 productos y ocho categorías declarados. Compara UUID del restaurante y token QR con el manifiesto histórico para detectar una regeneración involuntaria de identidades permanentes. Los conteos declarados se comprueban nuevamente contra la API en las pruebas reales.

Antes de enviar credenciales, los runners adaptados solicitan únicamente `/api/health` y exigen HTTP200, `status: ok`, `configured: true` y `supabaseProjectRef: hgntppemxwcxaxritnfq`. Un servidor sano que aún use el origen o que no exponga el marcador también se rechaza. La respuesta de health no incluye claves. El cliente compartido repite la verificación antes de POST y exige el flag de mutaciones para acciones distintas de login/logout.

Los recorridos de navegador verifican el mismo marcador antes de iniciar sesión. Los menús se resuelven sobre el origen seleccionado usando su ruta, sin navegar a una URL antigua guardada en el manifiesto. Los cierres de sesión de auditoría mantienen alcance local.

## Inventario de dependencias anteriores

| Ubicación | Hallazgo / tratamiento |
| --- | --- |
| `src/` y SQL existentes | No se encontró el identificador del proyecto anterior ni el repositorio anterior incrustados. La aplicación obtiene las claves de variables. |
| `render.yaml`, `production-preflight.mjs` y documentación operativa | Configuración de destino bajo la tarea principal; sus archivos no prueban por sí solos una publicación Render ni un origen HTTPS disponible. |
| Manifiesto `artifacts/demo/restaurants.json` y evidencias antiguas | Conservados como procedencia histórica; no se usan como evidencia de una ejecución nueva. |
| `verify-production-isolation.mjs` | Destino y cuentas nuevos; seis pares dirigidos; no GET de menú público en esta prueba. |
| `verify-restart.mjs`, `verify-production-local.mjs` | Manifiesto y cuentas nuevos, guard health y salidas separadas. El primero exige baseline del mismo target/run/origen. |
| `verify-demo-qr.mjs` | Lee sólo los nueve archivos del run nuevo y compara la carga útil con su origen y token. Decodificar no acredita HTTP público ni escaneo físico. |
| `visual-live-audit.mjs` | Guard antes de login, namespace de capturas/evidencia y target/run explícitos. Conserva recorridos reales sin interceptar APIs. |
| `consolidate-live-browser-audit.mjs` | Exige nombres de reportes explícitos, mismo destino/run/origen, 24 escenarios únicos y sin errores inesperados. No combina automáticamente los reportes viejos. |
| `run-live-audit.mjs`, `run-admin-live-audit.mjs`, `run-live-gap-audit.mjs` | Ejecutados en el destino nuevo: 84/84, 10/10 y 19/19. Cambios temporales DEMO coordinados y restauración comprobada por integridad posterior. |
| `verify-migration-integrity.mjs` | Lectura exclusiva del destino; compara contenido con el respaldo aprobado antes/después de QA. No inicia sesiones ni escribe en Supabase. |
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

La suite completa y el build ya se ejecutaron de forma coordinada, con evidencia arriba. Los resultados locales conservan fecha y alcance; nunca se presentan resultados históricos como si fueran pruebas del destino. Las pruebas simuladas específicas del migrador y del verificador de integridad tampoco sustituyen sus ejecuciones alojadas.

## Secuencia después del traslado y corte

1. Completado: credenciales nuevas, dos migraciones ordenadas, RLS/grants, Auth sin registro público, bucket privado y traslado verificado por contenido, incluidos UUID y QR.
2. Completado: tres propietarios y administrador con credenciales nuevas protegidas; tres DEMO con 24 productos, seis categorías principales y dos subcategorías, imágenes, variantes/extras, apariencia, promoción, siete horarios y 32 traducciones inglesas por restaurante.
3. Completado: servidor anterior detenido, `.env.local` cambiado al destino, build de producción con variables nuevas y proceso local cuyo health identifica el destino antes de los logins.
4. Completado: aislamiento privado, positivos propios y hashes estables; actividad normal de Auth, auditoría y límites registrada por separado.
5. Completado: recorridos DEMO coordinados y restauración comprobada. La comparación posterior confirma catálogo y configuración del respaldo tras los cambios temporales.
6. Completado: navegador real y revisión visual de capturas, persistencia tras otro reinicio y respaldo final con ensayo de restauración local 71/71. No se acredita Safari ni dispositivos físicos, ni restauración completa de GoTrue/Storage HTTP.
7. Pendiente externo: Render, origen HTTPS y SMTP. Después se repetirán smoke público/propietarios y controles pertinentes, se verificarán correos autorizados y se generarán QR con URLs públicas para comprobar HTTP y escaneo físico. Un resultado local sigue siendo local.

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

Comandos de reproducción desde una terminal limpia. El destino ya está migrado; cada nueva corrida debe usar su propio identificador y coordinarse para no interferir con capturas, respaldos o verificaciones:

```powershell
$env:AUDIT_RUN_ID = 'migration-acceptance-01'
$env:AUDIT_BASE_URL = 'http://localhost:3000'
node --env-file=.env.migration.local scripts/verify-production-isolation.mjs
node --env-file=.env.migration.local scripts/verify-restart.mjs before
# Reinicio coordinado del proceso nuevo; conservar el mismo AUDIT_RUN_ID.
node --env-file=.env.migration.local scripts/verify-restart.mjs after
node --env-file=.env.migration.local scripts/verify-production-local.mjs
```

La comprobación de integridad lee directamente `.env.migration.local`, exige el identificador fijo y el respaldo aprobado y guarda una evidencia nueva por ejecución:

```text
node scripts/verify-migration-integrity.mjs --target hgntppemxwcxaxritnfq --stage before-qa
node scripts/verify-migration-integrity.mjs --target hgntppemxwcxaxritnfq --stage after-qa
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
