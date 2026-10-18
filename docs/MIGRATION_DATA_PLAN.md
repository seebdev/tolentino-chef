# Plan de traslado de datos a Supabase hgntppemxwcxaxritnfq

Estado al 18 de octubre de 2026, 01:48 UTC: traslado de datos ejecutado y verificado en hgntppemxwcxaxritnfq. Se aplicaron dos migraciones, cuatro identidades con contraseñas nuevas, 361 filas en 15 tablas y 27 objetos privados. Se preservaron UUID, relaciones, contenido y tokens QR. Las pruebas funcionales del nuevo entorno y su publicación se coordinan por separado; no quedan acreditadas por este importador.

## Decisión: trasladar el respaldo final

Se revisó scripts/provision-demos.mjs. Busca restaurantes por slug, crea identidades nuevas cuando no existen, configura contraseñas y vuelve a escribir catálogo, traducciones y arte. Sus guardas y archivos actuales apuntan al proyecto anterior. Ejecutarlo como mecanismo de migración cambiaría UUID, QR o contenido respecto al resultado final.

Se preparó el traslado con el respaldo lógico cifrado ya verificado, sin ejecutar semillas ni bootstrap-admin.mjs. No se necesitan contraseñas antiguas. Antes de importar de verdad, una nueva lectura estrictamente de sólo lectura del origen debe acreditar que ese snapshot sigue representando los datos actuales. Se conserva su infraestructura y todos los archivos históricos de accesos y evidencias.

Fuente del ensayo autorizado: .runtime/backups/application-source-current-20261018012154252.json.enc. SHA256 del archivo cifrado:

    148c4dd9feba2a2b7257e6314cf594b406a9ed80865cf08fd103503198130c6a

El archivo usa AES-256-GCM y una clave protegida por DPAPI CurrentUser; sólo se descifra en memoria. El procedimiento valida su hash, los hashes internos, cada byte de Storage y la coincidencia de las dos migraciones con los SQL locales. Otro archivo necesita revisión y actualización explícitas del contrato.

La revalidación de sólo lectura del 18 de octubre añadió tres eventos de auditoría y actualizó tres perfiles Auth; las otras catorce tablas y los 27 objetos seguían idénticos. El nuevo archivo pasó restauración local 53/53 y el coordinador detuvo el servidor antiguo para evitar cambios durante el traslado. Se conservan el archivo inicial y su evidencia original. Esto no garantiza ausencia de otros escritores externos, por lo que se mantiene la comprobación final de estabilidad.

El respaldo vigente reúne 361 filas en 15 tablas, cuatro perfiles Auth y 27 objetos, con 314.126 bytes de imágenes. La comparación final de sólo lectura, terminada inmediatamente antes de aplicar, confirmó UNCHANGED en tablas, perfiles e inventario/bytes. El servidor local anterior permaneció detenido durante el traslado. Una doble lectura detecta estabilidad, pero no constituye un snapshot transaccional ni excluye otros escritores externos; el runner exige evidencia reciente y falla ante cambios. [Comparación final](evidence/migrations/hgntppemxwcxaxritnfq/source-verification-20261018T014555319Z/source-currentness.json).

## Conservación y diferencias previstas

| Componente | Tratamiento |
| --- | --- |
| Restaurantes Aurora, Bruma y Marea | Mismos UUID, slugs, estado, datos y UUID permanentes de QR |
| Catálogo | 24 productos por restaurante, seis categorías principales y dos subordinadas; mismos UUID |
| Datos relacionados | Apariencia, precios, variantes, extras, promociones, horarios, traducciones, ventas, auditoría y visitas del respaldo |
| Auth | Mismos cuatro UUID y correos, con cuatro contraseñas aleatorias nuevas y sin correos automáticos |
| Membresías y administrador | Mismos UUID de usuario y relaciones; el rol sigue en tablas protegidas |
| Storage | Mismo bucket privado, rutas, bytes y MIME; el servicio puede generar nuevos IDs técnicos y fechas de objetos |
| menu_version | Se conserva |
| menu_version_transaction | Se normaliza a cero: un txid pertenece al clúster de PostgreSQL de origen y podría colisionar en el nuevo |
| Tablas privadas transitorias | rate_limits y restaurant_creation_requests empiezan vacías; no se trasladan leases o respuestas antiguas |

No se copian hashes de contraseñas, sesiones, refresh tokens, MFA, proveedores, SMTP, JWT keys ni todo el estado interno de Auth. Esto es traslado lógico de la aplicación con recreación controlada de identidades, no una clonación completa de PostgreSQL/Auth. Storage requiere cargar los archivos además de las filas. La documentación oficial separa la restauración de base de datos, sus personalizaciones y los objetos de Storage. [Supabase: backup y restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Entradas nuevas y límites de conexión

Se leerá únicamente .env.migration.local, ignorado por Git. No se heredan claves desde .env.local ni se usa la contraseña expuesta. El archivo de plantilla y la configuración de la aplicación corresponden al coordinador de la migración.

| Variable | Requisito |
| --- | --- |
| TARGET_SUPABASE_URL | https://hgntppemxwcxaxritnfq.supabase.co |
| TARGET_SUPABASE_PUBLISHABLE_KEY | Clave pública del proyecto nuevo |
| TARGET_SUPABASE_SERVICE_ROLE_KEY | Clave administrativa nueva, sólo servidor/proceso de migración |
| TARGET_SUPABASE_DB_HOST | Host directo indicado o Session real copiado del dashboard |
| TARGET_SUPABASE_DB_PORT | 5432 |
| TARGET_SUPABASE_DB_USER | postgres para directo; postgres.hgntppemxwcxaxritnfq para Session |
| TARGET_SUPABASE_DB_NAME | postgres |
| TARGET_SUPABASE_DB_PASSWORD | Contraseña recién rotada, suministrada por canal local seguro |
| TARGET_SUPABASE_DB_PASSWORD_ROTATED | true después de confirmar la rotación; el flag no la ejecuta ni prueba por sí mismo |
| TARGET_SUPABASE_DB_SESSION_CONFIRMED | true sólo si se proporcionan los parámetros reales de Session |
| SUPABASE_ACCESS_TOKEN | Opcional para configurar Auth/advisors mediante Management; nunca se registra |

El guard rechaza otro proyecto, URL con ruta/usuario/query, host parecido, puerto 6543, contraseña sin confirmación de rotación y Session no confirmado. La clave de API debe validarse contra el endpoint nuevo durante la inspección; su mera presencia en variables no prueba que pertenezca a ese proyecto.

Primero se comprueba la conexión directa. Si falla por IPv6, se solicita el Session pooler real. No se infiere que cambiar 6543 a 5432 en la conexión Transaction suministrada sea una confirmación suficiente. Supabase recomienda Session para estas tareas cuando no se dispone de conexión directa apropiada. [Conexión PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

Las contraseñas no se pasan en argumentos de comandos ni URLs visibles: se usan variables temporales del proceso. No se guarda un SQL o dump de datos sin cifrar.

## Inspección y respaldo obligatorio del destino

Antes de habilitar cualquier escritura:

Revalidar primero la vigencia del snapshot mediante lectura del origen. Coordinar una ventana sin cambios para la captura definitiva y verificar estabilidad hasta el corte; una doble lectura por sí sola no bloquea futuras escrituras. Si no puede acreditarse que no hay cambios, detener la importación hasta resolver el punto de corte.

1. Verificar URL/ref, claves y conexión PostgreSQL; registrar sólo resultados sin secretos.
2. Consultar versión del servidor, esquemas, migraciones, tablas, extensiones, funciones, triggers, RLS, grants y políticas de Storage. Enumerar Auth y todos los buckets/objetos con paginación completa.
3. Confirmar si es un proyecto vacío. Una tabla, cuenta, bucket o dato ajeno impide aplicar automáticamente el plan. Nunca se borra, resetea ni se repara a ciegas un destino con contenido inesperado.
4. Capturar un respaldo cifrado del destino y su inventario antes de cambios. Si contiene datos, incluir sus tablas, identidades y objetos; requiere un alcance de restauración revisado antes de proseguir. Mantener hashes de archivos, catálogo y contenidos.
5. Verificar el descifrado y la restauración del alcance respaldado. Un inventario de conteos solo no sustituye un respaldo de datos. Si el destino está vacío, conservar también la evidencia de vaciedad y el esquema/configuración inicial.
6. Revisar el diff de esquema y el plan de migraciones contra ese estado. Volver a comprobar que el destino no cambió antes de la escritura.

Herramientas utilizadas: PostgreSQL/psql/pg_dump/pg_restore 17.11 portable para el servidor 17.11; node-postgres 8.23.1 aislado en .runtime/migration-tools; PGlite 0.5.10 y Node 22.23.3. Supabase CLI 2.75.0 y PostgreSQL 16.11 seguían disponibles, pero el dump se realizó con 17.11. Docker no tenía daemon disponible. La distribución portable procede del enlace de PostgreSQL.org a EDB y no instaló servicios. Los flags se revisaron con --help. La conexión persistente verificó TLS1.3, hostname y CA oficial; se impuso read-only explícitamente por sesión porque Supavisor no conservó la opción de inicio. [CA y procedencia](evidence/migrations/hgntppemxwcxaxritnfq/supabase-ca-source.json).

## Secuencia de aplicación ejecutada

El runner scripts/migration-target-apply.mjs aplicó la secuencia siguiente sólo al destino nuevo. Se exigieron --apply, --confirm-target, archivo origen, backup destino y evidencia reciente de vigencia. Un bloqueo advisory evita dos ejecuciones simultáneas; el historial SQL y cada checkpoint se vinculan con los hashes revisados.

1. Mantener el nuevo entorno sin tráfico de usuarios ni escrituras concurrentes. Obtener exclusión de ejecución para evitar dos migradores simultáneos. Vincular el diario a ref de destino, hash del archivo fuente, hash del respaldo destino y hashes de las migraciones.
2. Aplicar en orden 20261017021301_initial_tenant_security.sql y 20261017165549_restaurant_creation_requests.sql mediante el historial de migraciones del destino. Ensayar primero el mismo SQL en PGlite y revisar hashes; el ensayo local y los 17 controles del runner pasaron antes de aplicar. Verificar que las versiones ya aplicadas coincidan exactamente antes de reutilizarlas; nunca repetir SQL de creación indiscriminadamente.
3. Registrar el singleton platform_settings recién creado por la migración. Sólo esa fila inicial comprobada puede sustituirse por los valores del archivo. El helper exige además los defaults SQL exactos (únicamente updated_at es variable); un snapshot personalizado no es admisible aunque el caller lo declare inicial. No se acepta como baseline cualquier fila encontrada posteriormente.
4. Crear las cuatro identidades mediante Auth Admin createUser, con id explícito, email_confirm y contraseña aleatoria nueva; sin invitation, recovery ni signup público. Esta operación administrativa pertenece al servidor. [Supabase: createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser). El SDK instalado admite id explícito en AdminUserAttributes.
5. Reutilizar una identidad sólo si coinciden UUID, correo y marcador app_metadata.tolentino_migration con source/target/hash/UUID y el mismo credentialId aleatorio persistido con el secreto. Un bundle de contraseñas regenerado no puede reutilizar silenciosamente cuentas creadas con otro secreto. El marcador no contiene la contraseña ni un hash de ella. Una cuenta sin marcador o con diferente identidad detiene el proceso. No se modifica su contraseña para “reparar” el conflicto.
6. Cargar los 27 objetos mediante la API de Storage con upsert:false, conservando sus rutas y MIME. Si ya existen, descargarlos y comparar SHA256, bytes y MIME antes de reutilizar. Cualquier discrepancia o ruta ajena detiene la ejecución. No escribir manualmente las tablas administradas de Storage.
7. Importar las 15 tablas de aplicación en una transacción, con bloqueo de tablas, parámetros y lista cerrada de nombres. Los UUID Auth deben existir antes. Se omiten columnas generadas del INSERT y se comprueban sus resultados. Se pausan sólo triggers USER dentro de la transacción para conservar fechas/versiones; FK, checks e índices únicos permanecen activos. Los triggers vuelven a habilitarse antes de COMMIT.
8. Comparar todas las filas finales con el contenido preparado, salvo la normalización declarada del txid. Un error revierte la transacción completa de datos.
9. Verificar Auth real, roles/RLS, bucket privado y objetos, tres catálogos y sus QR. Sólo entonces producir manifiesto destino y habilitar pruebas de aplicación.

Auth, Storage y SQL son tres servicios: no hay una única transacción distribuida. Un fallo puede dejar identidades u objetos creados por el intento antes de importar tablas. El diario conserva esos pasos y permite reanudar con comprobaciones estrictas. No hay limpieza automática que borre cuentas o archivos. El nuevo sitio permanece sin publicar hasta que el conjunto esté verificado. La reanudación de SQL acepta filas iguales, inserta las faltantes y rechaza divergencias o filas ajenas; no usa un upsert destructivo.

Tras poner el destino en uso, las ediciones legítimas harán que la comparación con el respaldo antiguo falle. Eso es intencional: el procedimiento de migración no vuelve a sincronizar ni sobrescribe cambios comerciales posteriores.

## Contrato de archivos privados y manifiestos

Se conservan intactos los archivos del proyecto anterior. Antes de crear la primera cuenta remota se deberá persistir el nuevo secreto local, para poder reanudar tras una interrupción.

- .runtime/migrations/hgntppemxwcxaxritnfq/accounts.json: exactamente aurora, bruma y marea, cada uno con email, password, credentialId, restaurantId, userId y media.
- .runtime/migrations/hgntppemxwcxaxritnfq/admin-account.json: administrador separado con email, password, credentialId y userId.
- Directorio privado con ACL comprobada: usuario Windows actual y SYSTEM; sin permisos heredados; ignorado por Git. El diario y los backups se cifran con AES-GCM y clave protegida. DPAPI CurrentUser requiere ese perfil/máquina, no constituye por sí solo recuperación portable.
- artifacts/migrations/hgntppemxwcxaxritnfq/restaurants.json: se escribe únicamente después de verificar el destino real. Mantiene target, base y restaurants con key, id, isDemo, status, products, categories, publicToken, localMenu y stableRoute, compatibles con los verificadores.
- docs/evidence/migrations/hgntppemxwcxaxritnfq/: pruebas saneadas, sin contraseñas, claves ni correo real del administrador.

La aplicación real generó cuatro secretos nuevos y los persistió en esos archivos protegidos antes de llamar a Auth Admin. No se reutilizaron contraseñas antiguas ni se enviaron correos. Los perfiles y los 27 objetos se releyeron y verificaron antes del import SQL.

## Ensayo local y resultado

Código preparado:

- scripts/migration-data-common.mjs: validación de origen/destino, planes Auth y Storage, normalización del txid e importador transaccional idempotente.
- scripts/migration-data-local.mjs: descifra el archivo autorizado en memoria, aplica las dos migraciones a PGlite y ejecuta comprobaciones sin red.
- scripts/migration-target-inspect.mjs y migration-target-backup.mjs: inspección paginada y respaldo PostgreSQL previo, sólo lectura.
- scripts/migration-target-runtime.mjs y migration-target-schema.mjs: guardas de transporte, TLS, ACL, diario cifrado y esquema versionado transaccional.
- scripts/migration-auth-storage.mjs: preflight y traslado reanudable sin upsert, reset ni correos.
- scripts/migration-target-apply.mjs: orquestación del traslado y verificación final.
- scripts/migration-auth-storage-selftest.mjs y migration-target-selftest.mjs: 30 y 17 comprobaciones locales, respectivamente.

Comando con el runtime local:

    .\.runtime\node-v22.23.3-win-x64\node.exe scripts/migration-data-local.mjs .runtime/backups/application-source-current-20261018012154252.json.enc

Resultado: 52/52 comprobaciones PASS. Primera importación: 360 filas insertadas y un singleton inicial sustituido. Segunda importación: 361 filas reutilizadas, cero inserts y cero sustituciones. Se verificaron las 15 tablas, UUID/QR, columnas generadas, RLS activado, triggers reactivados y rollback por FK. Las pruebas también rechazan origen alterado, destino incorrecto, Transaction pooler, Auth ajeno/sin marcador, objetos diferentes y filas desconocidas o editadas.

Las 52 comprobaciones de datos y las 30 de Auth/Storage usan PGlite y adaptadores simulados; las 17 del runner comprueban guardas, progreso, historial y rollback del esquema. Son suites locales distintas de la ejecución remota. Después, la migración real creó y releyó Auth4, subió y descargó Storage27, comparó las 15 tablas SQL y comprobó RLS/permisos en el nuevo Supabase. Este importador no hizo login ni pruebas de correo o UI.

Evidencia: [local-data-preparation-current.json](evidence/migrations/hgntppemxwcxaxritnfq/local-data-preparation-current.json). El respaldo original tiene sus evidencias separadas en [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Evidencia remota de este traslado

La inspección inicial confirmó PostgreSQL 17.11, cero tablas de aplicación, cero identidades y cero buckets/objetos. El respaldo previo .runtime/backups/target-hgntppemxwcxaxritnfq-20261018T013206536Z.json.enc conserva un dump custom de 364.807 bytes, roles sin hashes de contraseña e inventario, cifrados con AES-256-GCM/DPAPI. Se verificaron inventarios antes/después, roundtrip cifrado, lectura de disco, decodificación completa del archivo y replay del esquema público vacío en PGlite. No se ejecutó una restauración completa de los servicios administrados de Supabase. [Respaldo previo](evidence/migrations/hgntppemxwcxaxritnfq/20261018T013206536Z/target-backup.json).

Resultado real: dos versiones aplicadas; Auth4 creadas; Storage27/314.126 bytes verificados; 360 filas insertadas y un singleton inicial sustituido; 15 tablas con RLS, cero triggers deshabilitados, bucket privado y permisos sensibles restringidos. El runner no realizó solicitudes al origen ni envió correos. [Migración real](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014644816Z/target-migration.json).

El respaldo posterior se capturó con scripts/migration-target-final-backup.mjs a las 02:11–02:12 UTC, después de detener servidor, navegadores y runners. Su decodificador había pasado cuatro controles locales sin red. El comando utilizado fue el siguiente. Incluye dump completo actual, roles sin contraseñas, tablas de aplicación/privadas, Auth y todos los bytes de Storage; compara estado antes/después y cifra antes de escribir. El dump conserva su snapshot SQL, pero la comparación con Storage no es una transacción distribuida. La decodificación íntegra no equivale a una restauración completa de plataforma.

    .\.runtime\node-v22.23.3-win-x64\node.exe scripts/migration-target-final-backup.mjs --capture --confirm-target hgntppemxwcxaxritnfq

El import no es una clonación total de plataforma: las identidades conservan UUID/correo y reciben secretos nuevos; los datos transitorios privados empiezan vacíos. La verificación funcional de servicios y la publicación son pasos separados; el respaldo final y su ensayo local ya se completaron. El backup inicial y los archivos anteriores permanecen intactos.

## Respaldo final y restauración aislada comprobados

La captura final PASS contiene 449 filas en las 15 tablas de aplicación —incluida la auditoría de las pruebas posteriores al traslado—, cuatro identidades y los mismos 27 objetos/314.126 bytes. También incluye las dos tablas privadas operativas, el dump lógico PostgreSQL completo y roles sin sus contraseñas. Las lecturas antes/después fueron estables; no hubo escrituras remotas ni archivos en texto claro.

Archivo privado: .runtime/backups/target-final-hgntppemxwcxaxritnfq-20261018T021153664Z.json.enc, 715.632 bytes cifrados. SHA256:

    57bd66441a9ab399f022899f4e2be41a9d02bbcb2c841a55185dd12ddbc23cab

El dump custom mide 531.178 bytes; se decodificó completo y se comprobó el roundtrip cifrado en memoria/disco. [Captura final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021153664Z/target-final-backup.json).

Restauración local PASS 71/71 en PGlite, sin red: 15 tablas y 449 filas exactas, 25 filas private.rate_limits y tres private.restaurant_creation_requests; cuatro UUID Auth, IDs/QR preservados, 27 objetos/bytes en memoria y seis pares dirigidos de aislamiento RLS. Se conservaron los txid de la captura final sin normalizaciones adicionales. El hash final de aplicación coincide con el respaldo. [Ensayo final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021315710Z/target-final-restore-local.json).

    .\.runtime\node-v22.23.3-win-x64\node.exe scripts/migration-target-final-restore-local.mjs --archive .runtime/backups/target-final-hgntppemxwcxaxritnfq-20261018T021153664Z.json.enc --sha256 57bd66441a9ab399f022899f4e2be41a9d02bbcb2c841a55185dd12ddbc23cab

Este ensayo restaura la aplicación con sustitutos mínimos de Auth/Storage. No restaura GoTrue, contraseñas/sesiones ni el servicio HTTP de objetos; el dump completo se valida por decodificación y no se ejecuta como plataforma Supabase administrada. No acredita PITR ni recuperación en otro equipo con DPAPI. [Procedimiento vigente y límites](BACKUP_RESTORE.md).

## Verificaciones externas a este procedimiento

Traslado y respaldo/restauración de aplicación terminados. Los logins, creación administrativa, aislamiento HTTP, CSV, suspensión/reactivación, soporte, traducciones, reinicio y persistencia se documentan por separado en [MIGRATION_STATUS.md](MIGRATION_STATUS.md) y sus evidencias; sus resultados no se infieren del restore local. El registro público se confirmó cerrado antes de aplicar; la configuración de URLs, SMTP y recuperación se verifica por separado.

Los QR conservan identidad; sus PNG/SVG/PDF públicos sólo se regeneran cuando exista la URL HTTPS real de Render. Decodificación y resolución HTTP pública, incluida una prueba de cambio de slug, quedan pendientes. No se entregan QR comerciales basados en localhost.

GitHub, Render, .env de aplicación y publicación los coordina la tarea principal. Este trabajo no cambió el proyecto Crepes & Waffles ni mutó la infraestructura anterior.
