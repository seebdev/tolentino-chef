# Estado de la migración

Actualizado el 18 de octubre de 2026 (UTC). La migración a Supabase **hgntppemxwcxaxritnfq** y la aceptación local están verificadas. **Render todavía no está publicado y no hay URLs HTTPS públicas acreditadas.**

| Componente | Resultado verificado |
| --- | --- |
| GitHub | Cuenta seebdev con ADMIN/PUSH, rama main y origin en seebdev/tolentino-chef. Historial conservado; legacy-origin tiene push deshabilitado localmente. El SHA publicado se comprueba con Git al cerrar esta ejecución. |
| Migración real | Dos migraciones aplicadas; cuatro identidades con UUID/correos preservados y contraseñas nuevas; 361 filas iniciales en quince tablas y 27 objetos con bytes/MIME verificados. Sin mutaciones en origen. |
| Tres DEMO | Aurora, Bruma y Marea conservan UUID, tokens QR, propietarios, 72 productos, 24 categorías y 96 traducciones. Las pruebas temporales se limpiaron. |
| Integridad después de QA | Trece tablas de negocio, cuatro identidades y 27 objetos iguales al respaldo aprobado. Se excluyen timestamps de edición/versiones internas y auditoría/métricas, cuyos cambios por QA están documentados. |
| Registro y sesiones | Registro público desactivado exclusivamente en el destino, Email habilitado y anónimo deshabilitado. Logout corregido y probado; credenciales nuevas sólo en archivos locales protegidos. |
| Corte local | Configuración anterior cifrada; .env.local, build y servidor actual usan el proyecto nuevo. APP_URL local deliberado: http://localhost:3000. |
| Código | Typegen, TypeScript, lint y build PASS; 239/239 unitarias. Lint final de scripts, src y tests también pasó. |
| Interfaz con fixtures | 54/54, incluyendo cuatro casos de logout; no se presentan como sesiones alojadas reales. |
| Pruebas funcionales reales | Principal 84/84, administración 10/10, complementarias 19/19; creación idempotente, CRUD, CSV hasta 1.000, soporte, suspensión y restauración de los originales. |
| Aislamiento real | 30/30; seis pares dirigidos API/RLS/Storage, controles positivos propios y cero acceso a contenido ajeno. |
| Navegadores reales | Chrome y Edge, 24 escenarios y 372 comprobaciones; tres menús en 390/768/1440 y paneles de propietarios. Capturas adicionales de admin cargado desktop/móvil: 4/4. No son dispositivos físicos. |
| Persistencia | Proceso anterior 20636 cerrado, proceso nuevo 21044; hashes privados/públicos exactos para tres DEMO, nuevos logins y health200. |
| QR | Nueve PNG/SVG/PDF decodificados conservan los tokens originales. Contienen localhost y todavía no son QR públicos definitivos. |
| Respaldo final | Cifrado AES-256-GCM, dump PostgreSQL17.11, quince tablas/449 filas después de QA, dos tablas privadas, Auth en dump y 27 objetos/314.126 bytes. Lecturas estables y descifrado verificado. |
| Restauración aislada | 71/71 en PGlite/memoria; quince tablas, dos privadas y bytes/UUID/QR exactos, seis pares RLS. No restaura GoTrue ni el servicio HTTP de Storage. |
| Seguridad | npm audit sin vulnerabilidades conocidas; advisor sin ERROR. Cinco avisos INFO de tablas cerradas se comprobaron sin grants a anon/authenticated. Protección contra contraseñas filtradas pendiente (requiere Supabase Pro). |
| Render | API verificada, workspace Tolentino Restaurantes — tea-dba1s4m1egvs7391ve50, inventario sin servicios. Creación y despliegue aún requieren autorización específica del usuario. |

El Supabase anterior, los tres DEMO originales y el proyecto Crepes & Waffles se conservaron. No se enviaron correos a las cuentas DEMO. Los nuevos accesos están en .runtime/migrations/hgntppemxwcxaxritnfq/accounts.json y admin-account.json, ignorados por Git; nunca en este documento.

## Respaldo comprobado

Archivo local cifrado: .runtime/backups/target-final-hgntppemxwcxaxritnfq-20261018T021153664Z.json.enc.

SHA256: 57bd66441a9ab399f022899f4e2be41a9d02bbcb2c841a55185dd12ddbc23cab.

La clave DPAPI depende de este perfil Windows. Todavía no se acredita recuperación en otro equipo, PITR ni restauración completa de Supabase administrado. El ensayo no se ejecutó sobre los datos existentes. [Procedimiento, resultados y límites](BACKUP_RESTORE.md).

## Pendiente para publicación

1. Autorizar el [único servicio Render propuesto](RENDER_SERVICE_PROPOSAL.md), basado en render.yaml: repo nuevo/main, Node22.23.3, Virginia y Free para validación pública. No contratar recursos de pago. Volver a inventariar antes de crear para evitar duplicados.
2. Obtener la URL HTTPS realmente asignada y configurar APP_URL, hosts, Site URL y callbacks exactos. Verificar commit desplegado, health, administrador, propietarios y tres menús públicos.
3. Regenerar los nueve QR con ese origen, decodificar y comprobar HTTP/HTTPS. El escaneo desde otro dispositivo requiere una prueba real posterior.
4. Configurar SMTP/remitente por un canal seguro y acreditar entrega y recuperación en un buzón autorizado. Hoy no hay SMTP propio ni entrega verificada.
5. Definir disponibilidad comercial y recuperación ante pérdida del equipo. Free se suspende por inactividad; el ensayo local de respaldo no resuelve por sí solo esos requisitos.

No se declara el despliegue terminado. No hay URLs públicas verificadas de superadministrador o menús que se puedan entregar todavía.

## Evidencias de esta ejecución

- [Importación real](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014644816Z/target-migration.json), [corte local](evidence/migrations/hgntppemxwcxaxritnfq/20261018T014816249Z/local-cutover.json) e [integridad después de QA](evidence/migrations/hgntppemxwcxaxritnfq/20261018T020309718Z/target-integrity-after-qa.json).
- [Registro público cerrado](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T012638307Z/auth-signup-readback.json), [revisión Auth](PRODUCTION_AUTH_REVIEW.md) y [configuración/pendientes Auth](MIGRATION_AUTH_PLAN.md).
- [Código/build239](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013032608Z/application-validation.json) e [interfaz54](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013918216Z/ui-e2e-summary.json).
- [Funcionales84](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-audit.json), [admin10](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-admin-audit.json), [adicionales19](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-gap-audit.json) y [aislamiento30](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/production-isolation-20261018T014923709Z.json).
- [Navegadores24/372](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-browser-audit.json), [admin cargado](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/admin-loaded-screenshots.json), [reinicio](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/restart-persistence.json) y [QR locales](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/demo-qr-decoding.json).
- [Respaldo final](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021153664Z/target-final-backup.json) y [restauración71](evidence/migrations/hgntppemxwcxaxritnfq/20261018T021315710Z/target-final-restore-local.json).
- [Dependencias](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T014342172Z/dependency-audit.json), [advisor](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T014905338Z/security-advisors.json) y [grants cerrados](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T015033170Z/security-advisor-assessment.json).
- [Workspace Render](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013932176Z/selected-render-workspace.json), [plan de pruebas](MIGRATION_TEST_PLAN.md) y [guía de despliegue](DEPLOY_RENDER_SUPABASE.md).

Escaneo final antes del commit: 412 archivos de trabajo/índice, 337 blobs del historial y 44 archivos del navegador; 11 secretos conocidos comprobados en memoria y cero hallazgos. Los archivos .env, accesos privados y respaldos están ignorados. [Reporte del escaneo](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T021723507Z/secret-scan.json).
