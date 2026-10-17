# Pendientes y límites de entrega

Estado: implementación local entregada; **no desplegada ni aceptada en producción**. No se reutilizó infraestructura de otros proyectos. No se introdujeron datos de demostración en la aplicación.

## Dependencias concretas para operar

1. El usuario eligió el proyecto `ylcnrfzosjzuljufwups`. URL y clave publicable ya se guardaron en `.env.local`, ignorado por Git. Auth responde HTTP 200. La cuenta conectada de MCP/CLI no tiene acceso administrativo a este proyecto; no se utilizará el proyecto ajeno que sí aparece en esa cuenta.
2. Falta la conexión **Session pooler** (host, puerto y usuario) para aplicar la migración: el host directo publica solo IPv6 y la conexión desde este equipo expira. También falta `SUPABASE_SERVICE_ROLE_KEY` (clave secreta o service_role, exclusivamente en servidor). La contraseña de PostgreSQL no reemplaza esa clave. Después de migrar: desactivar registro público y configurar correo, redirecciones y plantilla de recuperación.
3. Elegir el correo real de la primera cuenta Tolentino y ejecutar `scripts/bootstrap-admin.mjs`. Comprobar entrega del correo, contraseña, sesión y recuperación con Auth real.
4. Conectar un repositorio nuevo a una cuenta Render autorizada, desplegar `render.yaml` y establecer `APP_URL` y `PLATFORM_HOSTNAMES`. No hay credenciales Render ni servicio Tolentino creado en esta entrega. Elegir disponibilidad y costos antes de publicar comercialmente.
5. Para dominios personalizados, configurar además `RENDER_API_KEY`, `RENDER_SERVICE_ID` y `RENDER_SERVICE_HOSTNAME`, y los TXT/CNAME mostrados para cada dominio. No se modificó DNS ni se registraron dominios externos.

Los comandos y el orden preciso están en [DEPLOY_RENDER_SUPABASE.md](DEPLOY_RENDER_SUPABASE.md). Sin estas dependencias, login y health informan que falta configuración; no hay acceso ficticio que sustituya Supabase.

Comprobación remota de lectura posterior a la elección del proyecto: `/auth/v1/settings` devuelve `disable_signup: false`, por lo que debe desactivarse el registro público antes de operar. `/rest/v1/restaurants` devuelve `PGRST205` (tabla no encontrada en la caché del esquema). Estos resultados no acreditan una migración aplicada; no se ejecutaron escrituras en ese proyecto.

## Aceptación pendiente contra infraestructura real

- Ejecutar el recorrido A–R con dos propietarios reales en un proyecto aislado: correo, acceso, CRUD, imagen, precio público, permisos cruzados, soporte, suspensión y reactivación. Las pruebas SQL locales ya ejercitan políticas, constraints y transacciones; no sustituyen Auth, PostgREST y Storage alojados.
- Ejecutar advisors de Supabase, revisar la configuración remota de RLS/Auth/Storage y repetir intentos directos de lectura/escritura entre A y B.
- Verificar Render, dominio permanente, HTTPS, envío de cookies, refresco de sesiones, health, logs y persistencia después de reiniciar el servicio.
- Registrar y verificar un dominio real, comprobar que el menú se limita al restaurante asociado y que la URL por slug permanece disponible.
- Imprimir QR en varios tamaños y escanear con teléfonos reales, distintas cámaras e iluminación. La decodificación automática de PNG/SVG/PDF ya está probada; no acredita una prueba física.
- Probar backup y restauración de base y objetos Storage en un proyecto aislado.
- Medir carga concurrente, latencias remotas y consumo de recursos bajo el plan contratado. El benchmark local de importación no prueba capacidad comercial ni miles de usuarios concurrentes.

## Límites funcionales explícitos

- Una fotografía principal por producto; variantes y extras informativos en JSONB. No hay galería de múltiples fotografías ni pedidos.
- Un intervalo de apertura por día. No hay turnos partidos ni calendario de festivos.
- Edición manual de traducciones en siete idiomas. No se traducen automáticamente los catálogos ni se promete contenido completo; campos ausentes usan el texto principal.
- El borrador y publicación abarcan apariencia. Nombre, descripción, catálogo y precios se guardan inmediatamente; no hay borrador integral del negocio.
- Copiar diseño conserva el catálogo y los idiomas del destino, y excluye imágenes de otro restaurante. No clona propietarios, ventas ni productos.
- Verificación automática de dominios exige CNAME directo al servicio configurado. No admite apex con ALIAS/flattening ni comodines de subdominios; cada hostname debe registrarse y verificarse individualmente.
- No hay cambio automático del correo/identidad de propietario; requiere un procedimiento administrativo verificado. El panel permite restablecer su acceso.
- Visitas y escaneos son conteos agregados de solicitudes con limitación de frecuencia, no personas únicas ni prueba de escaneos físicos.
- No se ejecutó una auditoría formal de accesibilidad ni pruebas Safari/Firefox/dispositivos físicos. La suite visual usa Chrome en dos tamaños.

No se implementaron suscripciones, empleados, carrito, checkout, pagos, facturación, cocina ni delivery, conforme al alcance solicitado.
