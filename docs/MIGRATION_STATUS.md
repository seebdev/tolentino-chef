# Estado de preparación de la migración

Actualizado el 17 de octubre de 2026. Esta entrega prepara el traslado; no acredita que se haya migrado Supabase o publicado Render.

| Componente | Resultado verificado |
| --- | --- |
| GitHub | Cuenta seebdev, permiso ADMIN; historial completo publicado en main del nuevo repositorio. Remoto anterior conservado como legacy-origin con push deshabilitado localmente. |
| Destino Supabase | hgntppemxwcxaxritnfq; credenciales aún ausentes, inspección/migraciones/traslado reales pendientes. |
| Código y scripts | Health identifica el proyecto público; verificadores rechazan origen anterior antes de login y guardan evidencia separada. |
| Suite local completa | 226/226 pruebas en 14 archivos; incluye SQL/RLS aislado, CSV1000, Auth/API, QR y 19 controles de destino. |
| TypeScript y lint | Ambos aprobados con el runtime Node22.23.3. |
| Traslado ensayado | 52/52 comprobaciones en PGlite: 358 filas/15tablas, segunda importación sin duplicados, conflictos/rollback y conservación de UUID/QR. Planes Auth/Storage sólo en memoria. |
| Blueprint | Esquema válido: repositorio seebdev, main, un Web Service, Virginia y Free para validación. No crea otra base de datos ni incorpora secretos. |
| Render | Sin API key nueva ni workspace verificado; no se creó, modificó o desplegó ningún servicio. |
| Auth/correos | Registro público, SMTP, sesiones alojadas y recuperación del proyecto nuevo aún sin verificar. |
| QR públicos | Pendientes de HTTPS real y verificación pública; no se entregan QR locales como comerciales. |
| Rebuild y aceptación real | Pendientes del traslado y de las variables nuevas. El build/servidor anteriores no se presentan como prueba del destino. |

Los tres restaurantes y toda la infraestructura anterior se conservan. No se modificó Crepes & Waffles. Antes de aplicar el traslado se volverá a comparar el origen en modo de sólo lectura: el respaldo ensayado no autoriza perder cambios posteriores.

## Siguiente paso seguro

Completar en el equipo .env.migration.local con claves del proyecto nuevo y contraseña DB recién rotada. Confirmar TARGET_SUPABASE_DB_PASSWORD_ROTATED y, si se usa Session pooler, sus parámetros reales y TARGET_SUPABASE_DB_SESSION_CONFIRMED. No introducir secretos en el chat o Git.

Después: inspeccionar y respaldar destino, verificar vigencia del origen, aplicar migraciones y traslado, configurar Auth, reconstruir y probar la aplicación. Para Render hace falta una API key de la cuenta nueva y confirmar su workspace; inventariar antes de presentar el servicio concreto para autorización. APP_URL se establecerá cuando exista su origen HTTPS real.

No están implementados ni ejecutados todavía el adaptador de escritura remota y el respaldo completo del destino: deben construirse sobre su inventario real. Las utilidades locales no equivalen a esa ejecución.

La propuesta de corregir el error temprano de logout permanece pendiente de autorización explícita después de que la revisión automática rechazara modificar Auth/UI en la fase anterior. Véase PRODUCTION_AUTH_REVIEW.md. No se declara corregido.

## Evidencias y procedimiento

- [Plan general](MIGRATION_PLAN.md), [datos](MIGRATION_DATA_PLAN.md), [Auth](MIGRATION_AUTH_PLAN.md), [pruebas](MIGRATION_TEST_PLAN.md).
- [Guía vigente de Render/Supabase](DEPLOY_RENDER_SUPABASE.md).
- [Ensayo de datos](evidence/migrations/hgntppemxwcxaxritnfq/local-data-preparation.json).
- [Controles de destino](evidence/migrations/hgntppemxwcxaxritnfq/local-guards-20261017/validation.json).
- Evidencias de preflight, esquema del blueprint, suite completa y escaneo de secretos: subdirectorios fechados bajo docs/evidence/migrations/hgntppemxwcxaxritnfq/.