# Respaldo y restauración de Tolentino

## Ultimo ensayo: 25 de octubre de 2026

Captura final posterior a cambios: target-final-hgntppemxwcxaxritnfq-20261025T073720048Z.json.enc, SHA256 e0a20f407bb854884366407c53fb234f55b9194c284caabafaac1bcac8bc38e7. Incluye 16 tablas publicas, siete privadas, 1275 filas, cuatro usuarios y 77 objetos (4777026 bytes). Nueve migraciones incluidas. [Captura PASS](evidence/migrations/hgntppemxwcxaxritnfq/20261025T073720048Z/target-final-backup.json) y [restauracion aislada 126/126 PASS](evidence/migrations/hgntppemxwcxaxritnfq/20261025T074215457Z/target-final-restore-local.json), sin peticiones remotas ni restauracion sobre produccion.

Una captura anterior se aborto correctamente por cambios en contadores de visitas durante las pruebas publicas. Para la captura final se terminaron las pruebas y se detuvo el servidor local; la comparacion antes/despues fue estable. Una ventana sin ediciones ni pruebas evita respaldos rechazados; no requiere suspender produccion. El ensayo PGlite no prueba GoTrue/Storage administrados ni recuperacion portatil de la clave DPAPI. Mantener las limitaciones detalladas abajo.


## Procedimiento vigente para el proyecto nuevo

Destino exclusivo: `hgntppemxwcxaxritnfq`. Los scripts de captura del ensayo histórico inferior están fijados al proyecto anterior; no deben ejecutarse con la configuración local ya migrada. El origen anterior se conserva.

Antes de capturar, detener las pruebas y el servidor local para evitar sesiones, visitas y ediciones concurrentes. La captura nueva lee sólo `.env.migration.local`, verifica el destino y usa TLS con CA y hostname verificados. Nunca necesita escribir en la base ni suspender el proyecto remoto.

```text
node scripts/migration-target-final-backup.mjs --capture --confirm-target hgntppemxwcxaxritnfq
```

El archivo cifrado incluye dump lógico PostgreSQL17.11, roles sin sus contraseñas, datos de las tablas inventariadas (actualmente 16 publicas y siete privadas), tablas Auth en el dump y los bytes de todos los objetos Storage. Se comparan lecturas antes/después; cambios durante la ventana abortan la captura. La evidencia pública registra la ruta y SHA256 del archivo, nunca credenciales ni filas privadas.

Para ensayar la restauración, usar exactamente el archivo y SHA256 registrados en esa captura:

```text
node scripts/migration-target-final-restore-local.mjs --archive .runtime/backups/ARCHIVO.json.enc --sha256 HASH_DE_LA_CAPTURA
```

El ensayo crea exclusivamente una instancia PGlite en memoria, sin URL de destino ni conexión remota. Verifica el cifrado, hashes del dump, historial SQL y migraciones locales; restaura las tablas publicas y privadas inventariadas, y compara UUID, QR y bytes Storage. Comprueba los seis pares de aislamiento. No ejecuta GoTrue ni el servicio HTTP de Storage: Auth usa stubs de UUID y el dump completo se decodifica, no se restaura como plataforma administrada.

Los archivos permanecen cifrados bajo `.runtime/backups`, con ACL del usuario Windows y SYSTEM y clave DPAPI. El respaldo de la configuración anterior también está cifrado allí. Recuperarse en otro equipo sigue requiriendo custodia separada de una clave de recuperación y un ensayo independiente; no se ha acreditado recuperación portátil o PITR. La configuración externa SMTP/Auth/JWT necesita su respaldo propio. Ninguna restauración se ensaya sobre los DEMO existentes.

Las capturas/ensayos nuevos y sus resultados se registran bajo `docs/evidence/migrations/hgntppemxwcxaxritnfq/`; consultar [MIGRATION_STATUS.md](MIGRATION_STATUS.md) para la última ejecución efectivamente comprobada.

### Captura y ensayo final comprobados — 18 de octubre de 2026

Captura realizada con el servidor local detenido y sin runners de QA: **PASS**. Se preservaron 15 tablas/449 filas de aplicación, cuatro identidades y 27 objetos/314.126 bytes. El archivo incluye además el estado de las dos tablas privadas y un dump lógico PostgreSQL17.11 completo. No hubo escrituras remotas ni archivos de respaldo en texto claro.

| Comprobación vigente | Resultado |
| --- | --- |
| Archivo cifrado | 715.632 bytes, AES-256-GCM/DPAPI y ACL usuario Windows/SYSTEM |
| Dump PostgreSQL custom | 531.178 bytes; todos los segmentos decodificados |
| Consistencia | Inventario, tablas, perfiles y bytes Storage iguales antes/después |
| Restauración aislada | 71/71 comprobaciones PASS en PGlite/memoria |
| Filas públicas | 449 exactas en las 15 tablas, incluyendo auditoría/métricas de QA |
| Filas privadas | rate_limits:25; restaurant_creation_requests:3, restauradas exactamente |
| Identidades y Storage | Cuatro UUID Auth y 27 IDs/rutas/bytes de objetos conservados en stubs/memoria |
| Seguridad de aplicación | RLS15/15, triggers habilitados y seis pares de propietarios aislados |
| Efectos del restore | Cero conexiones remotas, mutaciones remotas o archivos en texto claro |

Archivo privado: .runtime/backups/target-final-hgntppemxwcxaxritnfq-20261018T021153664Z.json.enc. SHA256 del archivo cifrado:

    57bd66441a9ab399f022899f4e2be41a9d02bbcb2c841a55185dd12ddbc23cab

Evidencias saneadas: [captura final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021153664Z/target-final-backup.json) y [restauración local final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021315710Z/target-final-restore-local.json).

El snapshot SQL de pg_dump es consistente; la comparación adicional de API/Storage detecta estabilidad y no constituye una transacción distribuida. Auth utiliza UUID-only stubs en el ensayo: **no se ha restaurado GoTrue, contraseñas/sesiones ni Storage HTTP como plataforma completa**. El dump incluye esas tablas actuales cifradas, pero sólo se decodificó íntegramente. No se acreditan recuperación portable de DPAPI, PITR, secretos externos o configuración SMTP/JWT. La sección histórica siguiente se conserva como evidencia separada.

## Ensayo histórico del proyecto anterior

La sección siguiente describe la captura inicial del 17 de octubre. Sus exclusiones y cifras no deben confundirse con el respaldo nuevo, que incluye el dump PostgreSQL y las tablas privadas.


## Resultado del ensayo — 17 de octubre de 2026

Se creó un respaldo lógico cifrado de la aplicación desde el proyecto autorizado y se restauró desde ese archivo en PostgreSQL PGlite, exclusivamente en memoria. No se modificó Supabase ni se creó ningún proyecto, servicio o base remota.

| Comprobación                                        | Resultado                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Captura de tablas públicas de la aplicación         | 15 tablas completas; 3 restaurantes, 72 productos y 96 traducciones                                                                        |
| Identidades Auth                                    | 4 perfiles seleccionados, con sus IDs; sin contraseñas, sesiones ni secretos MFA                                                           |
| Storage                                             | 27 objetos del bucket privado restaurant-media, 314.126 bytes; incluye todos los objetos listados, no sólo los referenciados por productos |
| Archivo cifrado                                     | 460.840 bytes; AES-256-GCM, clave protegida por DPAPI CurrentUser                                                                          |
| Consistencia observada                              | Hashes de filas, perfiles y listado Storage iguales antes y después de descargar                                                           |
| Restauración local                                  | 53/53 comprobaciones aprobadas; cero fallidas                                                                                              |
| Aislamiento restaurado                              | Los seis pares dirigidos de propietarios no pueden leer/modificar productos ajenos ni leer metadatos de sus objetos privados               |
| Integridad                                          | IDs, membresías, tokens QR, contenido y bytes de objetos preservados; FK entre tenants y token inmutable comprobados                       |
| Escrituras remotas del respaldo/restaurador         | Cero                                                                                                                                       |
| Archivos de respaldo o DB restaurada en texto claro | Cero; restauración en memoria                                                                                                              |
| Pruebas de utilidades                               | 7/7; paginación, cambios durante captura, cifrado, corrupción, bloqueo de writes y ACL/DPAPI                                               |

Evidencias saneadas: [captura](evidence/backup-capture.json), [restauración local](evidence/backup-restore-local.json) y [pruebas de utilidades](evidence/backup-selftest.json). El manifiesto completo con hashes por tabla y por objeto está **dentro del archivo cifrado**. Los reportes publicados contienen conteos, resultados y hash del archivo cifrado, no filas privadas, contraseñas ni claves.

## Alcance: respaldo lógico de aplicación

Incluye todos los campos de las quince tablas de negocio expuestas: platform_admins, restaurants, restaurant_memberships, restaurant_settings, categories, products, promotions, restaurant_hours, translations, restaurant_qr_configs, restaurant_domains, commercial_sales, security_audit_events, visit_events y platform_settings. El script compara ese inventario con OpenAPI y falla si aparecen tablas nuevas que no conoce.

Las páginas de filas usan orden por clave primaria y conteo exacto. Continúan hasta completar ese total, incluso si el servidor limita una página por debajo del tamaño solicitado. El listado de Storage recorre carpetas y páginas hasta una respuesta vacía; no supone que 1.000 objetos sean todos. Se detectan claves/rutas repetidas y totales cambiantes. Los límites de memoria declarados son un millón de filas por tabla, 100.000 objetos y 512 MiB de bytes de objetos: excederlos aborta, nunca produce un respaldo truncado.

También incluye perfiles seleccionados de Auth, configuración disponible del bucket, IDs/rutas/metadatos disponibles de los archivos, sus bytes y las dos migraciones SQL. No incorpora la clave de servicio ni el archivo local con contraseñas DEMO.

**No es un respaldo completo de PostgreSQL/Auth ni un procedimiento de recuperación de Supabase listo para producción.** Quedan fuera:

- Hashes de contraseñas, sesiones, refresh tokens, identidades de proveedor completas, factores/secretos MFA y demás tablas internas de Auth.
- private.restaurant_creation_requests y private.rate_limits, que no están expuestas por REST. Sus tablas se recrean vacías en el ensayo. Por tanto, no se acredita recuperación del historial de idempotencia ni de intentos de creación en curso.
- Roles y configuración alojada de PostgreSQL, extensiones/binarios, historial remoto de migraciones y otros esquemas administrados.
- Configuración Auth/SMTP/OAuth, secretos JWT, API keys, DNS y servicio web.
- Metadatos internos de Storage no expuestos por list/getBucket; se conservan los que estas APIs permiten leer.

La documentación oficial confirma que un backup de base de datos no incluye los bytes de objetos Storage. Por eso este respaldo descarga los archivos por separado dentro del mismo contenedor cifrado. [Backups de Supabase](https://supabase.com/docs/guides/platform/backups).

## Herramientas y decisión de aislamiento

Se encontraron Node 22.23.3, PGlite 0.5.10, Supabase CLI 2.75.0 y herramientas nativas PostgreSQL 16.11. Docker está instalado, pero su daemon no estaba disponible. Se consultaron supabase --help, supabase db --help y supabase db dump --help; no se ejecutó un dump remoto ni se reutilizó ninguna contraseña antigua de base de datos.

PGlite permite ejecutar las migraciones y PostgreSQL localmente sin un daemon, puerto o servicio adicional. El ensayo crea sustitutos mínimos de auth.users, auth.uid y storage.objects para comprobar las relaciones y RLS de la aplicación. Guarda los perfiles y los bytes restaurados en tablas auxiliares de esa DB en memoria.

Esto **no ejecuta GoTrue, PostgREST ni el servidor HTTP de Storage**. No se probó iniciar sesión con usuarios restaurados ni descargar objetos mediante un Storage restaurado. Esas pruebas necesitan una recuperación completa de la plataforma.

## Archivos y protección de la clave

El archivo generado está identificado en la evidencia de captura bajo .runtime/backups. La misma carpeta contiene backup-key.dpapi. Ambos están ignorados por Git. La ACL Windows desactiva herencia y sólo permite al usuario Windows actual y SYSTEM. No se guardan SQL, JSON ni imágenes descifrados en el disco.

Cada archivo usa IV aleatorio de 12 bytes y AES-256-GCM con etiqueta de autenticación. Una clave errónea, cambio de ciphertext o formato inválido aborta antes de restaurar datos. La clave aleatoria de 32 bytes permanece protegida con DPAPI CurrentUser y sólo se descifra en memoria del proceso.

**DPAPI no es por sí solo una estrategia de recuperación ante pérdida del equipo o perfil Windows.** Copiar el archivo cifrado y la clave DPAPI a otra máquina no garantiza poder descifrarlos. Antes de depender de este respaldo para desastres, definir una custodia separada y verificada de una clave de recuperación. El script admite TOLENTINO_BACKUP_KEY_BASE64 con una clave externa de 32 bytes codificada en base64; debe suministrarse mediante un gestor de secretos o entorno protegido, nunca en argumentos, código, commits o salidas. Ese modo externo está implementado, pero el ensayo real utilizó DPAPI.

El almacenamiento local está dentro de una carpeta OneDrive. El contenido de respaldo y la clave protegida están cifrados antes de escribirse; esto no acredita retención, disponibilidad de una copia externa ni recuperación en otro equipo.

## Repetir captura y ensayo local

Ejecutar desde la raíz del repositorio con Node 22. La captura carga .env.local mediante Node; sólo necesita NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del proyecto autorizado. Los comandos no contienen valores secretos.

Acordar una ventana sin ediciones, altas, cambios de Auth ni visitas al menú que incrementen métricas. Mantener detenidos los runners que cambien estos datos.

Ejecutar las pruebas locales:

    node --test scripts/backup-selftest.mjs

Capturar:

    node --env-file=.env.local scripts/backup-application.mjs

Usar la ruta de archivo indicada en docs/evidence/backup-capture.json:

    node scripts/backup-restore-local.mjs .runtime/backups/ARCHIVO.json.enc

El paso de restauración **no necesita .env.local ni conexión a Supabase**. No acepta una URL de destino, puerto o base existente: sólo restaura en una instancia nueva de PGlite en memoria y la cierra al terminar.

La doble lectura es una detección de estabilidad observada, **no un snapshot transaccional de PostgreSQL**. No descarta todos los patrones posibles de escrituras concurrentes o cambios que luego se reviertan. Si cambian hashes o conteos, el proceso aborta sin producir un respaldo parcial; repetir en una ventana estable. Para garantías transaccionales se necesita pg_dump/snapshot o backup nativo compatible.

El restaurador verifica el manifiesto, todos los hashes y que las migraciones archivadas coincidan con los archivos locales revisados. Restaura en una transacción, con FK y CHECK activos. Pausa únicamente los triggers de usuario durante la carga de la DB nueva para conservar timestamps y versiones originales, y comprueba su reactivación. Las columnas generadas se recalculan y se comparan con el origen. Los ensayos de seguridad se revierten; una comparación final confirma que no alteraron los datos restaurados.

No incluir .runtime ni el archivo cifrado en un commit. Las evidencias publicables están limitadas a docs/evidence/backup-*.json. La revisión independiente de los scripts comprobó que la captura sólo permite GET/HEAD y el POST de listado Storage, bloquea redirecciones y no contiene operaciones de escritura remota.

## Recuperación completa pendiente

Para acreditar recuperación completa todavía hace falta:

1. Obtener por un canal seguro una credencial PostgreSQL nueva y autorizada para el proyecto concreto, o acceso a sus backups administrados. No extraer contraseñas del historial de chat.
2. Comprobar versión real del servidor, cliente pg_dump compatible, extensiones, roles y alcance de esquemas. El cliente local 16.11 puede no servir para un servidor de una versión principal posterior.
3. Preparar un destino aislado con PostgreSQL y servicios Supabase compatibles, previa autorización. No apuntar la restauración al origen ni crear servicios automáticamente.
4. Respaldar y restaurar también Auth y las tablas privadas operativas; transferir los objetos Storage y verificar su propiedad, permisos y hashes.
5. Configurar explícitamente secretos/proveedores/SMTP, probar login y recuperación autorizados, HTTP de Storage y aislamiento, y conservar IDs públicos y el dominio canónico de los QR.
6. Ensayar recuperación con una clave custodiada fuera del equipo, registrar tiempos, retención y responsables.

La guía oficial describe el respaldo de roles/esquema/datos y el trabajo separado para Storage y configuración externa. No se ejecutó ese procedimiento completo en este ensayo. [Restaurar Supabase alojado a un entorno propio](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

Durante este ensayo histórico inicial no hubo nuevas cuentas, correos, servicios, proyectos ni escrituras remotas. La migración posterior al proyecto nuevo tiene evidencias separadas; Crepes & Waffles se conserva sin modificaciones.
