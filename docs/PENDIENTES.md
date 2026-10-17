# Pendientes y límites de entrega

Actualización: 17 de octubre de 2026. Ver el [informe final](../AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md) para las pruebas y evidencia completas.

## Estado comprobado

- Supabase real conectado, dos migraciones aplicadas, RLS y permisos verificados.
- Superadministrador configurado; tres propietarios DEMO distintos y 72 productos persistentes.
- Creación desde interfaz/API, reintentos idempotentes, conflictos auténticos, CRUD, aislamiento A/B/C, Storage, suspensión, reactivación y CSV hasta 1.000 filas probados contra el servicio alojado.
- Las cuentas DEMO terminan en .test y no envían invitaciones ni recuperación por correo.
- QR PNG/SVG/PDF decodificados automáticamente. Sus archivos actuales son exclusivamente de validación local.
- Código y evidencias en el repositorio autorizado. El proyecto original de referencia no se modificó.

## Bloqueos externos para producción

1. **Render y URL HTTPS:** el usuario confirmó que aún no existe despliegue; no hay credenciales Render configuradas. Conectar el repositorio, aplicar render.yaml, configurar APP_URL y PLATFORM_HOSTNAMES y comprobar health, cookies, logs y persistencia en el servicio público.
2. **QR públicos:** requieren el dominio canónico HTTPS de la plataforma. Descargar de nuevo los tres QR tras desplegar y verificar sus destinos por HTTP público. El token soporta cambios de slug y dominio propio del restaurante; el dominio canónico de la plataforma debe mantenerse.
3. **Supabase Auth:** la lectura real de settings aún indica registro público habilitado. Desactivarlo desde la cuenta administradora del proyecto y comprobar Site URL, redirecciones, política de contraseñas, duración de sesión y acceso anónimo. Una interfaz sin registro no deshabilita la API de registro.
4. **SMTP y recuperación real:** configurar proveedor y plantilla de recuperación, después verificar entrega con una cuenta autorizada. No se enviaron correos a las demos. Los endpoints y el tratamiento de errores se probaron; la entrega externa no está acreditada.
5. **Supabase Advisors:** la conexión MCP devolvió falta de permisos al consultar el proyecto correcto. Requiere acceso Management de ese proyecto; la clave de servicio no lo reemplaza. Evidencia: `evidence/advisors-access.json`.
6. **Dominios personalizados:** falta validar DNS/TLS/Render reales con un hostname controlado. Las pruebas de integración de dominios usan respuestas simuladas y no acreditan DNS publicado.
7. **Dispositivos físicos y aceptación operativa:** no se realizaron escaneos impresos Android/iPhone, prueba Safari real, carga remota sostenida ni restauración de respaldos en un entorno aislado. No equivalen a las pruebas de escritorio con viewports móviles.

## Límites funcionales conocidos

- Una imagen principal por producto; variantes y extras informativos, sin pedidos ni pagos.
- Un intervalo de apertura por día, sin turnos partidos ni calendario de festivos.
- Traducciones manuales en siete idiomas; no hay traducción automática.
- Borrador/publicación de apariencia. Nombre, descripción, catálogo y precios se guardan al confirmar cada formulario.
- Copiar diseño conserva el catálogo del destino y excluye imágenes de otro restaurante; no clona propietarios ni ventas.
- Exportación CSV básica de nombre, precio, categoría, descripción y SKU. No exporta imágenes, variantes, extras o traducciones y no es un respaldo integral. Importación limitada a 1.000 filas por archivo.
- Verificación de dominio con CNAME directo, sin apex ALIAS/flattening ni comodines.
- El cambio de identidad/correo del propietario requiere un procedimiento administrativo verificado; el panel restablece su acceso.
- Métricas agregadas de solicitudes, no personas únicas ni acreditación de escaneos físicos.

No se incorporaron suscripciones, empleados, carrito, checkout, pagos, facturación, cocina ni delivery.
