# Respaldo y restauración de Tolentino

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

No hubo nuevas cuentas, correos, servicios, proyectos, escrituras remotas ni cambios en Crepes & Waffles durante este trabajo.
