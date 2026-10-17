# Pendientes y límites de entrega

Estado: implementación local y esquema Supabase remoto verificados; **no desplegada en Render ni aceptada en producción**. No se reutilizó infraestructura de otros proyectos. No se introdujeron datos de demostración en la aplicación.

## Estado de Supabase y dependencias para operar

La migración `20261017021301_initial_tenant_security` está aplicada y vigente en el proyecto autorizado `ylcnrfzosjzuljufwups`. La evidencia `evidence/db-migration-verification.json` (16 de octubre de 2026, 22:49 (America/Bogota)) verifica 15 tablas públicas y una privada con RLS, permisos anónimos restringidos, ocho RPC de negocio y sus permisos, y el bucket privado `restaurant-media` con límite de 5 MiB y cuatro políticas de tenant. Se comprobó la ejecución de estadísticas de servicio y que un rol autenticado sin membresía no ve restaurantes ni productos. Esto no equivale al recorrido remoto A/B con sesiones reales.

URL, clave publicable y clave de servicio ya están configuradas en `.env.local`, ignorado por Git. La migración no creó usuarios Auth, restaurantes ni objetos Storage, ni envió correos. La comprobación conectada de las 22:51 (America/Bogota) del 16 de octubre de 2026 está en `evidence/connected-supabase-smoke.json`: estadísticas REST correctas con cero restaurantes, bucket privado accesible, primera página de Auth sin usuarios, health local 200 y APIs privadas 401 sin sesión. No acredita acceso de un propietario ni correo real.

1. Desactivar el registro público: la última lectura de Auth devuelve `disable_signup: false`. Revisar también acceso anónimo, política de contraseña, duración de sesión, Site URL y redirecciones antes de habilitar clientes.
2. Configurar SMTP y la plantilla de recuperación. Elegir el correo real de la primera cuenta Tolentino y ejecutar `scripts/bootstrap-admin.mjs`; comprobar entrega, definición de contraseña, sesión y recuperación con Auth real. Estas operaciones aún no se ejecutaron.
3. El repositorio autorizado `tolentinosftw-dotcom/tolentino-chef` ya está publicado. Conectarlo a Render y desplegar `render.yaml` con sus variables de servidor, `APP_URL` y `PLATFORM_HOSTNAMES`. Render sigue pendiente. Elegir disponibilidad y costos antes de publicar comercialmente.
4. Para dominios personalizados, configurar además `RENDER_API_KEY`, `RENDER_SERVICE_ID` y `RENDER_SERVICE_HOSTNAME`, y los TXT/CNAME mostrados para cada dominio. No se modificó DNS ni se registraron dominios externos.

Los comandos y el orden preciso están en [DEPLOY_RENDER_SUPABASE.md](DEPLOY_RENDER_SUPABASE.md). Los resultados de login/health sin credenciales pertenecen a la etapa local anterior; no deben interpretarse como un fallo actual de configuración. No hay acceso ficticio que sustituya Supabase.

## Aceptación pendiente contra infraestructura real

- Ejecutar el recorrido A–R con dos propietarios reales en un proyecto aislado: correo, acceso, CRUD, imagen, precio público, permisos cruzados, soporte, suspensión y reactivación. Las pruebas SQL locales ya ejercitan políticas, constraints y transacciones; no sustituyen Auth, PostgREST y Storage alojados.
- Ejecutar advisors de Supabase y revisar Auth. RLS, grants, RPC y configuración del bucket ya se verificaron en remoto; faltan intentos directos de lectura/escritura entre A y B con tokens Auth reales y objetos Storage reales.
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
