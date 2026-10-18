# Servicio Render propuesto para autorización

Estado: preparado, sin servicio creado ni despliegue iniciado. La elección del workspace no autoriza la creación. La migración y aceptación local del nuevo Supabase ya están verificadas, incluido respaldo y restauración aislada. Este es el siguiente paso externo reservado para autorización; véase MIGRATION_STATUS.md.

| Ajuste | Propuesta concreta |
| --- | --- |
| Workspace | Tolentino Restaurantes — tea-dba1s4m1egvs7391ve50 |
| Inventario verificado | Cero servicios; volver a inventariar inmediatamente antes de crear |
| Blueprint | render.yaml existente, un único Web Service |
| Nombre | tolentino-restaurantes-admin |
| Repositorio / rama | https://github.com/seebdev/tolentino-chef — main |
| Runtime / región | Node22.23.3 — Virginia |
| Plan | Free para validación pública; no contratar recursos de pago |
| Base de datos | Supabase existente hgntppemxwcxaxritnfq; no crear otra |
| Build | npm ci --include=dev && npm run typecheck && npm run lint && npm run test && npm run build |
| Inicio / health | npm run start — /api/health |
| Autodespliegue | Cada commit de main, según blueprint |
| Hostname | El que asigne Render; aún no existe uno confirmado |

## Configuración segura

Las claves nuevas ya están en `.env.migration.local`, ignorado por Git. Pasarlas directamente al almacén de variables de Render sin imprimir sus valores. Nunca cargar credenciales del proyecto anterior.

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SERVICE_ROLE_KEY` deben pertenecer al destino. La última es exclusivamente del servidor. Establecer `APP_URL` con el origen HTTPS real asignado, `PLATFORM_HOSTNAMES` con ese hostname exacto y `RENDER_SERVICE_HOSTNAME` con el hostname onrender.com real. Configurar `RENDER_API_KEY` y el ID del servicio nuevo si se habilita la gestión integrada de dominios; no añadir dominios de clientes sin una solicitud propia.

Configurar en el nuevo Supabase Site URL y los callbacks exactos después de conocer el hostname. No emitir QR definitivos ni considerar sano un despliegue que aún use localhost. La preparación de SMTP y prueba de recuperación requieren un proveedor/remitente y un buzón autorizados; actualmente no hay SMTP propio configurado.

## Comprobaciones posteriores a la autorización

1. Volver a inventariar; si aparece un servicio coincidente, verificarlo y reutilizarlo. Si hay ambigüedad, detener la creación.
2. Crear/sincronizar únicamente el servicio del blueprint. Obtener su URL e ID reales y completar las variables y URLs Auth antes de la aceptación pública.
3. Comprobar build, SHA desplegado, estado saludable, HTTPS y proyecto nuevo en health; revisar logs sin mostrar secretos.
4. Probar administrador, propietarios, tres menús, aislamiento y persistencia desde la URL pública.
5. Regenerar nueve archivos QR con los tres tokens conservados, decodificar cada formato y comprobar sus destinos HTTPS. El usuario comprobará el escaneo en otro dispositivo.

Free suspende el servicio por inactividad; permite validar el sitio pero no acredita disponibilidad comercial continua. Si se necesita operación continua, presentar un plan de pago y su precio vigente para una autorización separada. [Límites oficiales](https://render.com/docs/free), [blueprint](https://render.com/docs/blueprint-spec).

Evidencia de workspace y registro cerrado: [inspección de sólo lectura](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013932176Z/selected-render-workspace.json).
