# Plan de migración sin pérdida de datos — Tolentino

Actualizado el 18 de octubre de 2026 (UTC). Estado: migración real y corte local completados; aceptación local aprobada. Render y aceptación HTTPS pendientes. Consultar MIGRATION_STATUS.md para resultados vigentes.

## Destinos y conservación

| Recurso | Origen conservado | Destino autorizado |
| --- | --- | --- |
| GitHub | tolentinosftw-dotcom/tolentino-chef | seebdev/tolentino-chef |
| Supabase | ylcnrfzosjzuljufwups | hgntppemxwcxaxritnfq |
| Render | No hay despliegue anterior acreditado | Workspace Tolentino Restaurantes, tea-dba1s4m1egvs7391ve50; inventario sin servicios |

El repositorio local conserva su historial y los cambios preparados. GitHub nuevo se encontró vacío; la cuenta seebdev está autenticada y tiene permiso ADMIN. No se requiere fusionar un README inicial. El historial y la preparación están publicados en main con SHA 2650c7096b4ba6b7076ac14dba5ab30dec75c490; los cambios de esta ejecución se publicarán tras su revisión y pruebas. No se harán pushes al repositorio anterior, resets, reinicialización Git ni eliminación de recursos. Crepes & Waffles queda fuera de esta migración.

El servidor anterior está detenido. La configuración original se respaldó cifrada antes del corte; .env.local y el build actual corresponden exclusivamente al proyecto nuevo. La importación real conservó 361 filas, cuatro identidades y 27 objetos, y la comparación posterior a QA confirmó catálogo, UUID y QR. No ejecutar contra el origen los runners que crean, editan, suspenden o eliminan datos. Las pruebas antiguas no acreditan el destino.

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

Las claves del destino y la contraseña DB rotada ya fueron verificadas, incluida conexión Session pooler. Management permitió cerrar el registro público con autorización específica. La cuenta Render nueva funciona; el usuario seleccionó Tolentino Restaurantes (tea-dba1s4m1egvs7391ve50), actualmente sin servicios. Falta autorizar la creación/despliegue concreto, obtener HTTPS y configurar SMTP.

La corrección de logout fue autorizada y aplicada: 17/17 pruebas focalizadas y 239/239 de la suite completa pasan. PRODUCTION_AUTH_REVIEW.md conserva el hallazgo y la evidencia. La revisión anterior quedó resuelta con la autorización específica del usuario.

La migración de datos fue ejecutada y verificada en el destino. La preparación y aceptación local no equivalen a publicación: Render, HTTPS, SMTP, QR públicos y verificación desde otro dispositivo siguen pendientes. Las evidencias vigentes están en MIGRATION_STATUS.md.
