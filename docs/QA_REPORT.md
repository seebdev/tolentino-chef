> Reporte histórico de la entrega anterior. Para el estado del 17 de octubre de 2026, consultar [la auditoría final](../AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md).

# Informe de QA

Fecha de trabajo: 16 de octubre de 2026, America/Bogota. Las evidencias guardan marcas UTC, algunas del 17 de octubre.

## Resultado y alcance

La implementación local tiene frontend, rutas de servidor, migración, políticas y pruebas ejecutables. Supabase `ylcnrfzosjzuljufwups` ya está conectado y tiene la migración aplicada y verificada. **Render, la configuración operativa de Auth/SMTP y la aceptación con dos propietarios reales siguen pendientes; no se declara listo para producción.** Ningún dato de prueba sustituye la persistencia de la aplicación.

Se emplean cuatro niveles distintos de evidencia:

1. PostgreSQL PGlite ejecuta el SQL real de la migración y roles efectivos. Los esquemas mínimos de Auth y Storage son sustitutos de prueba; esta suite no usa el servidor Supabase alojado.
2. Pruebas de módulos y handlers ejecutan validación/autorización/caché/QR reales, con mocks explícitos de servicios externos cuando corresponde.
3. Playwright usa Chrome y páginas reales de Next. El login sin configuración corresponde a la etapa local anterior y se probó sin sustituir la API. Los recorridos administrativos y de catálogo interceptan la API con fixtures ficticios: prueban interfaz y peticiones, no persistencia remota ni sesiones reales.
4. La verificación PostgreSQL remota comprueba migración, RLS, grants, RPC y configuración del bucket del proyecto autorizado. No ejecuta la aceptación A/B con Auth ni carga objetos en Storage.

## Verificación remota de esquema

La evidencia `evidence/db-migration-verification.json` registra el 16 de octubre de 2026 a las 22:49 (America/Bogota) la migración `20261017021301_initial_tenant_security` vigente en `ylcnrfzosjzuljufwups`, con 98 sentencias registradas. Se verificaron 15 tablas públicas y una privada con RLS, cero grants de SELECT anónimo sobre negocio, ocho RPC y sus permisos, cuatro FKs compuestas de tenant y diez triggers de identidad. El bucket `restaurant-media` es privado, con límite de 5 MiB y cuatro políticas de tenant.

La RPC de estadísticas de servicio se ejecutó y un rol autenticado sin membresía no vio restaurantes ni productos. No se crearon usuarios Auth, restaurantes ni objetos Storage, ni se enviaron correos. Esta evidencia no acredita login, cookies, SMTP, uploads/downloads ni aislamiento A/B con dos usuarios remotos reales.

La comprobación conectada posterior, a las 22:51 (America/Bogota) del 16 de octubre de 2026, está en `evidence/connected-supabase-smoke.json`: estadísticas REST correctas con cero restaurantes, bucket privado accesible y listado administrativo Auth correcto con cero usuarios en la primera página. En el servidor local de producción, `/api/health` respondió 200 con `status:ok` y `configured:true`, `/login` respondió 200 y `/api/admin/restaurants` y `/api/session` respondieron 401 sin sesión. Esto acredita conectividad y denegación anónima, no un login de usuario ni recorridos de correo o Storage.

La clave de servicio y las variables públicas están configuradas en `.env.local`, ignorado por Git. La última lectura de Auth devuelve `disable_signup: false`: desactivar registro público, configurar SMTP/recuperación y elegir el correo del primer administrador antes del bootstrap. Render permanece pendiente. Los resultados anteriores sin credenciales se conservan como evidencia histórica y no describen el estado actual de conexión.

## Verificación automatizada

Los resultados definitivos y conteos se registran en `evidence/validation-summary.json`, `evidence/unit-tests.json` y `evidence/playwright-results.json`. **161/161 pruebas locales aprobadas en nueve archivos**, incluidas 35 SQL, 14 QR y 43 de proxy/refresco de sesiones añadidas antes de publicar el repositorio. **22/22 E2E aprobados en la entrega inicial**, más una repetición dirigida de los dos casos del dashboard tras corregir la métrica de productos publicados; esta repetición está en `evidence/playwright-admin-final.json` y no cuenta como dos escenarios nuevos. No se repitieron los E2E tras añadir el refresco; ese cambio sí se comprobó con las pruebas específicas y la suite completa de módulos.

**Tipos, lint y build de producción: PASS. npm audit: 0 avisos conocidos.** En la ejecución histórica anterior a configurar las credenciales, el build arrancó mediante `npm run start -- --port 3001`; siete comprobaciones HTTP pasaron, guardadas en `evidence/production-smoke.json`. Sin credenciales, health y APIs privadas devolvieron 503; un origen ajeno obtuvo 403, un Host no registrado 421 y un token QR mal formado 400. Esto comprueba el arranque y el estado sin configuración, no una autenticación remota. Los servidores temporales se detuvieron al cerrar la entrega.

| Comprobación                           | Evidencia                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tipos estrictos                        | `npm run typecheck`; sin ignoreBuildErrors                                                                         |
| Lint                                   | `npm run lint`                                                                                                     |
| Compilación de producción              | `npm run build`; Next App Router/Node                                                                              |
| SQL, unidades e integración local      | `npm test -- --reporter=json --outputFile=docs/evidence/unit-tests.json`                                           |
| Interfaz                               | `npm run test:e2e`; Chrome, 1440×1000 y 390×844                                                                    |
| Dependencias                           | `evidence/npm-audit.json`; resultado limitado a avisos conocidos del registro en la fecha de ejecución             |
| Conexión Supabase desde servidor local | `evidence/connected-supabase-smoke.json`; REST/Auth/Storage de servicio, health 200 y APIs privadas 401 sin sesión |
| Original preservado                    | `evidence/reference-before.json` y `evidence/reference-verification.json`                                          |

## Aceptación A–W

PASS significa que se ejecutó la comprobación en el alcance indicado. BLOCKED requiere completar configuración, cuentas o infraestructura para ejecutar el recorrido. NOT RUN no se ejecutó. Un PASS local no se convierte en PASS remoto por inferencia.

| Caso                                      | Estado  | Evidencia ejecutada y límite                                                                                                                                   |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Alta desde superadmin                  | BLOCKED | RPC transaccional y handler con compensación probados; formulario probado con fixture. Falta alta completa con Auth remoto.                                    |
| B. Crear propietario y activar acceso     | BLOCKED | Pruebas de alta, fallo Auth, rollback y fallo de correo. Entrega/activación real no ejecutadas.                                                                |
| C. Login del propietario                  | BLOCKED | Autorización de servidor probada con mocks; falta contraseña/sesión de Supabase real.                                                                          |
| D. Categoría y subcategoría               | BLOCKED | SQL comprueba CRUD propio, FK y ciclos; pendiente recorrido persistente desde navegador.                                                                       |
| E. Producto con fotografía                | BLOCKED | Formulario, validación, rutas privadas y permisos probados por capas. Upload a Storage remoto no ejecutado.                                                    |
| F. Precio actualizado en menú             | BLOCKED | Cambios incrementan versión SQL y caché usa nueva versión; falta recorrido navegador→Supabase→menú remoto.                                                     |
| G. Agotado                                | BLOCKED | Implementado en formulario y catálogo; pendiente persistencia real de esta acción.                                                                             |
| H. Logo, portada y colores                | BLOCKED | Validación de apariencia y rutas de tenant probadas; falta carga/publicación remota.                                                                           |
| I. QR con logo                            | PASS    | Generación real con logo raster, contraste, zona de silencio, marcos y límites; `qr.test.ts`.                                                                  |
| J. Decodificar QR y URL                   | PASS    | jsQR independiente decodifica PNG, SVG rasterizado y píxeles extraídos del PDF; tamaños 256/512/1024. Escaneo físico NOT RUN.                                  |
| K. Cambiar slug conservando QR            | PASS    | Handler real `/q` con DB simulada resuelve el mismo token al slug nuevo; SQL protege token incluso ante service_role. Repetición desplegada BLOCKED.           |
| L. Importar 1.000 productos               | PASS    | Parser y RPC real en PGlite; límites 1/100/999/1000 y rechazo 1001; pertenencia y rollback. Operación remota BLOCKED.                                          |
| M. CSV defectuosos                        | PASS    | Precios/nombres/categorías, UTF-8, delimitadores, columnas, duplicados, límites y fórmulas; `csv.test.ts` y `database.test.ts`.                                |
| N. Aislamiento A/B                        | PASS    | Dos restaurantes y propietarios en PostgreSQL: lectura/listado/escritura/borrado/relaciones/medios ajenos denegados. Repetición con Auth/REST remotos BLOCKED. |
| O. Soporte Tolentino                      | BLOCKED | Rol explícito probado en API, controles SQL y banda UI con fixture; falta edición completa en remoto.                                                          |
| P. Suspender propietario                  | PASS    | Membresía deshabilitada niega acceso SQL y actor del servidor; no depende de metadata del cliente. Sesión real persistente BLOCKED.                            |
| Q. Suspender restaurante                  | PASS    | SQL bloquea propietario/medios, lectura pública consulta estado fuera de caché, UI muestra suspensión con fixture. Repetición remota BLOCKED.                  |
| R. Reactivar y conservar datos            | PASS    | Test SQL restablece acceso a menú/medios y conserva token. Recorrido real de navegador BLOCKED.                                                                |
| S. Idiomas                                | PASS    | Selector/interfaz/fallback de es/en/fr/it/zh/ja/hi en ambos tamaños con fixture. No se certifica traducción de un catálogo comercial.                          |
| T. Móvil y escritorio                     | PASS    | Playwright en 390×844 y 1440×1000; comprobación de desbordamiento y capturas. Dispositivos físicos NOT RUN.                                                    |
| U. Build/lint/tipos/tests/integración/E2E | BLOCKED | Verificaciones locales con resultados en resumen. Integración con Auth/Storage/Render reales pendiente.                                                        |
| V. Autorización real                      | BLOCKED | RLS real en PostgreSQL y handlers probados; endpoint sin sesión no concede acceso. Falta probar tokens, cookies y REST remotos de dos usuarios.                |
| W. Original intacto                       | PASS    | 1.803 SHA256 coincidentes, incluyendo `.git`; sin archivos añadidos/faltantes dentro del inventario. Exclusiones: node_modules/.next/.turbo/dist/build.        |

## Seguridad y correcciones verificadas

- Se reemplazó la persistencia local de la referencia por contratos Supabase y migración con RLS, permisos de columnas y FK compuestas. No se trasladaron credenciales ni bypass de TypeScript.
- El cliente no decide roles: servidor verifica `getUser`, `platform_admins` y membresía activa. El servicio privilegiado solo se usa después de comprobar autorización.
- Se prueban IDOR, escalada de permisos, referencias de imágenes/categorías entre restaurantes, suspensión, errores sin secretos, CSRF y rate limit compartido.
- El límite de upload cuenta bytes reales del stream aun con Content-Length falso; se recodifican imágenes y se restringen dimensiones y rutas. El bucket es privado.
- Se corrigieron la omisión del email protegido al editar, la conservación de ventas parcialmente enviadas, la prioridad exclusiva de SKU y la validación de apariencia incluso por SQL directo.
- El menú filtra borradores, categorías ocultas y traducciones privadas; una suspensión prevalece sobre contenido cacheado. Los agregados y catálogos no quedan truncados a 1.000 filas de PostgREST.
- Se eliminaron dependencias de lint con avisos conocidos y se volvió a ejecutar npm audit. Cero avisos en una corrida no equivale a ausencia de todas las vulnerabilidades posibles.

## QR, rendimiento y evidencia visual

`evidence/qr-sample.png`, `.svg` y `.pdf` son muestras técnicas con un dominio ilustrativo, **no el QR de un restaurante desplegado**. La suite comprueba destino exacto, personalización sin cambio de token, contraste mínimo, tamaño de logo y rechazo de destinos no permitidos. No imprimir estas muestras para uso comercial.

`evidence/database-benchmarks.json` contiene tiempos de una importación transaccional local en PostgreSQL PGlite/Node 22, con 1, 100, 999, 1.000 y rechazo de 1.001 filas. Son mediciones de una ejecución en Windows, sin red ni concurrencia de visitantes; no comparan planes Supabase ni acreditan capacidad de producción.

Capturas revisables: `ui-real-login-desktop.png`, `ui-real-login-mobile.png`, `ui-fixture-admin-desktop.png`, `ui-fixture-admin-mobile.png`, `ui-fixture-public-desktop.png` y `ui-fixture-public-mobile.png`, dentro de `evidence`. Los nombres con fixture identifican datos exclusivos de pruebas.

## Lo no ejecutado

Despliegue y reinicio en Render, correo SMTP y bootstrap del administrador, recorridos con sesiones Auth reales, uploads/downloads y aislamiento A/B mediante REST/Storage, DNS/TLS real, escaneo físico de QR, restauración de backup, pruebas de alta concurrencia y auditoría formal de accesibilidad: **BLOCKED o NOT RUN**, según [PENDIENTES.md](PENDIENTES.md). No se declara PASS para estas operaciones.
