# Plan de migración sin pérdida de datos — Tolentino

Fecha: 17 de octubre de 2026. Estado: preparación local; nuevo Supabase y Render todavía sin verificar.

## Destinos y conservación

| Recurso | Origen conservado | Destino autorizado |
| --- | --- | --- |
| GitHub | tolentinosftw-dotcom/tolentino-chef | seebdev/tolentino-chef |
| Supabase | ylcnrfzosjzuljufwups | hgntppemxwcxaxritnfq |
| Render | No hay despliegue anterior acreditado | Cuenta nueva, pendiente de acceso e inventario |

El repositorio local conserva su historial y los cambios preparados. GitHub nuevo se encontró vacío; la cuenta seebdev está autenticada y tiene permiso ADMIN. No se requiere fusionar un README inicial. El historial completo ya está publicado en main con SHA 67a99778196584521c9ec048ac7d6de8496e72de; los cambios de preparación posteriores se publicarán tras su revisión y pruebas. No se harán pushes al repositorio anterior, resets, reinicialización Git ni eliminación de recursos. Crepes & Waffles queda fuera de esta migración.

El servidor y .env.local todavía corresponden al origen. No cambiar esas variables hasta preparar y verificar la base nueva. No ejecutar contra el origen los runners que crean, editan, suspenden o eliminan datos. Las pruebas antiguas no acreditan el destino.

## Secuencia y controles

1. Conservar el remoto anterior como legacy-origin, bloquear localmente sus pushes y establecer origin en https://github.com/seebdev/tolentino-chef.git. Confirmar HEAD e historial completos; volver a consultar el destino inmediatamente antes del push para integrar cualquier commit aparecido sin force.
2. Mantener credenciales de migración nuevas en .env.migration.local, ignorado por Git. Nunca usar la contraseña anterior expuesta. Verificar que las claves correspondan exactamente a hgntppemxwcxaxritnfq. Confirmar contraseña DB rotada y conexión directa o Session pooler real; no confundir Transaction port6543 con Session.
3. Inspeccionar el nuevo proyecto, versión PostgreSQL, Auth, Storage, tablas e historial. Crear un respaldo cifrado verificable del estado destino antes de escrituras. Si hay datos ajenos o divergencias, detener importación y conservarlos.
4. Validar las dos migraciones existentes en un entorno aislado y aplicarlas en orden sólo al destino, sin reset ni repetir migraciones registradas. Comprobar ACL/RLS/FK/funciones/índices y bucket privado.
5. Trasladar el respaldo lógico cifrado del origen: conservar UUID de negocio, membresías y tokens QR; crear las cuatro identidades Auth con los UUID/correos originales y contraseñas nuevas aleatorias sin enviar correo. Guardar accesos exclusivamente en archivos privados protegidos del destino.
6. Copiar todos los objetos a sus rutas del bucket privado, verificando SHA256/MIME. Los IDs técnicos internos de Storage pueden cambiar; las rutas de aplicación y los bytes deben conservarse. Importar tablas de negocio en una transacción y verificar igualdad. No utilizar provision-demos para regenerar el catálogo final porque puede cambiar IDs/QR, imágenes y traducciones.
7. Hacer repetible la importación: aceptar únicamente entidades del mismo intento con marcadores confiables y datos coincidentes; abortar ante divergencias. No resetear cuentas ajenas ni sobrescribir filas/objetos preexistentes distintos.
8. Deshabilitar altas públicas en el destino sin deshabilitar Email ni creación administrativa. Configurar políticas Auth/SMTP y URLs cuando exista el origen HTTPS real. Los perfiles copiados no transfieren contraseñas, sesiones, MFA ni configuración del proveedor.
9. Añadir una identificación pública del proyecto a /api/health y exigir coincidencia destino antes de cualquier login de pruebas. Reconstruir y reiniciar localmente con credenciales nuevas; mantener una copia privada de configuración anterior para reversión local.
10. Reejecutar suites y recorridos reales del nuevo entorno: roles, creación, edición, imágenes, CSV1000, aislamiento, suspensiones, soporte, idiomas, reinicio y QR. Mantener evidencias nuevas separadas de las históricas.
11. Actualizar blueprint al repositorio nuevo y comprobar cuenta/workspace de Render con credenciales nuevas. Inventariar antes de crear: un único Web Service. Presentar plan/costo/origen y obtener la autorización necesaria antes de crear o contratar.
12. Configurar secretos por Render, APP_URL únicamente con HTTPS realmente asignado, hosts y callbacks exactos. Verificar deploy/commit/logs/health y roles públicos. Regenerar9QR PNG/SVG/PDF conservando los tres tokens, decodificar y comprobar sus destinos HTTPS. El escaneo físico requiere verificación real del usuario.
13. Escanear secretos, ejecutar controles finales y publicar main en seebdev/tolentino-chef sin force. Entregar SHA, URLs realmente comprobadas, estado de3DEMO y límites pendientes.

## Archivos separados por entorno

- Credenciales nuevas de entrada: .env.migration.local; no versionado.
- Manifiesto público destino: artifacts/migrations/hgntppemxwcxaxritnfq/restaurants.json.
- Accesos DEMO privados: .runtime/migrations/hgntppemxwcxaxritnfq/accounts.json.
- Acceso admin privado: .runtime/migrations/hgntppemxwcxaxritnfq/admin-account.json.
- Evidencias nuevas: docs/evidence/migrations/hgntppemxwcxaxritnfq/<run-id>/.
- Capturas y QR nuevos: subcarpetas del destino, separadas de la validación local histórica.

El respaldo de origen ya pasó restauración lógica local53/53 y pruebas de utilidades7/7. Incluye15tablas/4perfiles/27objetos. No es un dump completo de PostgreSQL/Auth: excluye hashes de contraseña, sesiones y tablas privadas de operación. Véase BACKUP_RESTORE.md; esos límites no se ocultan al migrar.

## Accesos pendientes y decisiones

Faltan clave publicable, clave de servidor y contraseña DB nueva del destino; Management opcional para configuración. La integración actual no tiene permiso sobre el proyecto nuevo. Faltan acceso a cuenta Render nueva, selección de servicio/plan y URL definitiva.

El fallo temprano de logout reproducido en la fase anterior conserva una propuesta en PRODUCTION_AUTH_REVIEW.md. Su corrección sigue pendiente de autorización específica tras el rechazo de revisión automática; no forma parte de cambios ya aplicados.

No se declarará migración ni despliegue terminados por haber preparado scripts o por resultados del entorno anterior.
