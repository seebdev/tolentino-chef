# Plan de traslado de datos a Supabase hgntppemxwcxaxritnfq

Estado al 17 de octubre de 2026: preparación y ensayo locales terminados. No se ha conectado este procedimiento al nuevo proyecto ni se ha escrito en ningún Supabase. Faltan las nuevas credenciales, la inspección del destino y su respaldo previo. Las pruebas históricas del proyecto anterior no acreditan el nuevo entorno.

## Decisión: trasladar el respaldo final

Se revisó scripts/provision-demos.mjs. Busca restaurantes por slug, crea identidades nuevas cuando no existen, configura contraseñas y vuelve a escribir catálogo, traducciones y arte. Sus guardas y archivos actuales apuntan al proyecto anterior. Ejecutarlo como mecanismo de migración cambiaría UUID, QR o contenido respecto al resultado final.

Se preparó el traslado con el respaldo lógico cifrado ya verificado, sin ejecutar semillas ni bootstrap-admin.mjs. No se necesitan contraseñas antiguas. Antes de importar de verdad, una nueva lectura estrictamente de sólo lectura del origen debe acreditar que ese snapshot sigue representando los datos actuales. Se conserva su infraestructura y todos los archivos históricos de accesos y evidencias.

Fuente del ensayo autorizado: .runtime/backups/application-20261017193357263.json.enc. SHA256 del archivo cifrado:

    79be105c5b3828056209dcab47c3e887dccac158e0121a8416f848b267e73207

El archivo usa AES-256-GCM y una clave protegida por DPAPI CurrentUser; sólo se descifra en memoria. El procedimiento valida su hash, los hashes internos, cada byte de Storage y la coincidencia de las dos migraciones con los SQL locales. Otro archivo necesita revisión y actualización explícitas del contrato.

El respaldo reúne 358 filas en 15 tablas, cuatro perfiles Auth y 27 objetos, con 314.126 bytes de imágenes. La doble lectura de origen detectó estabilidad; no representa un snapshot transaccional. Este snapshot no establece un punto de corte autorizado para la migración definitiva. El servidor anterior puede seguir recibiendo cambios. Antes de importar, se compararán nuevamente hashes de todas las tablas incluidas, perfiles de identidad e inventario/bytes de Storage mediante credenciales autorizadas de sólo lectura del contenido, nunca con la contraseña expuesta. Si hay diferencias, se capturará un nuevo archivo cifrado, se verificará su restauración, se actualizará el contrato de hash y se repetirá el ensayo. No se ignoran cambios posteriores. Esa comparación o captura nueva no se ejecutó en esta fase.

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

Herramientas locales inventariadas: Supabase CLI 2.75.0; PostgreSQL/psql/pg_dump 16.11; PGlite 0.5.10; Node 22.23.3. Docker está instalado pero su daemon no estaba disponible. PGlite sirve para el ensayo aislado, no sustituye pg_dump ni los servicios Auth/Storage. Si el servidor usa PostgreSQL 17, se necesita un pg_dump compatible de versión 17 o superior antes de respaldarlo; no se usará pg_dump 16 suponiendo compatibilidad. La herramienta y los flags se descubren con --help antes de su uso.

## Secuencia futura de aplicación

La aplicación remota no está implementada como comando ejecutable en esta fase. Los helpers preparados no son una autorización ni sustituyen las guardas de un runner remoto. Éste debe incorporar la inspección, el respaldo y un diario cifrado antes de conectar un adaptador SQL.

1. Mantener el nuevo entorno sin tráfico de usuarios ni escrituras concurrentes. Obtener exclusión de ejecución para evitar dos migradores simultáneos. Vincular el diario a ref de destino, hash del archivo fuente, hash del respaldo destino y hashes de las migraciones.
2. Aplicar en orden 20261017021301_initial_tenant_security.sql y 20261017165549_restaurant_creation_requests.sql mediante el historial de migraciones del destino. Ensayar dry-run primero. Verificar que las versiones ya aplicadas coincidan exactamente antes de reutilizarlas; nunca repetir SQL de creación indiscriminadamente.
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

En este ensayo sólo se generaron secretos efímeros en memoria para comprobar el plan Auth. No se crearon cuentas remotas ni archivos de credenciales.

## Ensayo local y resultado

Código preparado:

- scripts/migration-data-common.mjs: validación de origen/destino, planes Auth y Storage, normalización del txid e importador transaccional idempotente.
- scripts/migration-data-local.mjs: descifra el archivo autorizado en memoria, aplica las dos migraciones a PGlite y ejecuta comprobaciones sin red.

Comando con el runtime local:

    .\.runtime\node-v22.23.3-win-x64\node.exe scripts/migration-data-local.mjs .runtime/backups/application-20261017193357263.json.enc

Resultado: 52/52 comprobaciones PASS. Primera importación: 357 filas insertadas y un singleton inicial sustituido. Segunda importación: 358 filas reutilizadas, cero inserts y cero sustituciones. Se verificaron las 15 tablas, UUID/QR, columnas generadas, RLS activado, triggers reactivados y rollback por FK. Las pruebas también rechazan origen alterado, destino incorrecto, Transaction pooler, Auth ajeno/sin marcador, objetos diferentes y filas desconocidas o editadas.

Auth y Storage se probaron como planes sobre snapshots en memoria, no mediante servicios reales. PGlite prueba PostgreSQL local con stubs mínimos de los esquemas administrados. No demuestra configuración Auth, correo, API, RLS HTTP o persistencia del nuevo Supabase.

Evidencia: [local-data-preparation.json](evidence/migrations/hgntppemxwcxaxritnfq/local-data-preparation.json). El respaldo original tiene sus evidencias separadas en [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Criterios pendientes antes del cierre de la migración

Faltan inspección y respaldo destino, ejecución versionada, cuatro logins con credenciales nuevas, creación administrativa, aislamiento entre los seis pares de propietarios, Storage, importación CSV, suspensión/reactivación, soporte, traducciones, reinicio y hashes de persistencia sobre el nuevo proyecto. Se deshabilitará el registro público sin impedir Auth Admin. La configuración de URLs, SMTP y recuperación deberá verificarse por separado.

Los QR conservan identidad; sus PNG/SVG/PDF públicos sólo se regeneran cuando exista la URL HTTPS real de Render. Decodificación y resolución HTTP pública, incluida una prueba de cambio de slug, quedan pendientes. No se entregan QR comerciales basados en localhost.

GitHub, Render, .env de aplicación y publicación los coordina la tarea principal. Este trabajo no cambió el proyecto Crepes & Waffles ni mutó la infraestructura anterior.
