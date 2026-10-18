# Plan de migración de Auth, sesiones y accesos

## Estado actualizado — 2026-10-18 UTC

El destino nuevo ya tiene aceptación real local: **24 escenarios / 372 comprobaciones PASS** en Chrome y Edge, con seis escenarios de propietario que comprueban login, recarga, logout y nuevo login; además, **4/4 controles administrativos** verificaron salida de soporte sin cambiar identidad, lista de tres DEMO cargada y logout final. Las 20 capturas finales se inspeccionaron, y los navegadores/procesos se cerraron antes del backup. No se enviaron correos ni se editó catálogo/configuración durante este pase visual. [Pruebas reales](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/live-browser-audit.json), [admin y capturas](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/admin-loaded-screenshots.json), [inspección visual](evidence/migrations/hgntppemxwcxaxritnfq/local-acceptance-20261018/visual-inspection.json). HTTPS público, SMTP/recuperación real y Safari continúan fuera de esta aceptación local.

La corrección de logout fue autorizada expresamente y está implementada. La validación integrada pasó **239/239 pruebas unitarias**, incluidos los 17 casos focalizados, y **54/54 E2E de interfaz**, incluidos los cuatro casos de logout en escritorio/móvil. La revisión independiente confirmó limpieza del proyecto actual, scope local, respuesta 503 honesta y propagación segura del aviso a login. Los E2E usaron fixtures sobre el build nuevo y el servidor temporal 3001 ya está cerrado; la aceptación posterior de sesiones reales del destino ya pasó en el build local, como se detalla a continuación. [Pipeline local](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013032608Z/application-validation.json), [regresión UI](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T013918216Z/ui-e2e-summary.json). [Estado y evidencia de Auth](PRODUCTION_AUTH_REVIEW.md).

El registro público de `hgntppemxwcxaxritnfq` se desactivó con autorización específica, backup cifrado previo y un único PATCH. Management y Auth público confirman `disable_signup:true`; email sigue habilitado y acceso anónimo deshabilitado. [Verificación final](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T012638307Z/auth-signup-readback.json). No se cambiaron JWT, contraseñas, SMTP ni URLs: la lectura actual mostró JWT 3600 s, mínimo de contraseña 6, Site URL localhost y redirects vacíos; no confundirlos con los valores propuestos por el TOML.

El usuario confirmó el workspace Render **Tolentino Restaurantes**, `tea-dba1s4m1egvs7391ve50`. El inventario autorizado encontró cero servicios; crear o desplegar todavía está prohibido sin autorización aparte. Las credenciales de migración se leen únicamente desde el archivo separado y nunca se incluyen en la evidencia. [Inventario sanitizado](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T012136752Z/render-auth-inspection.json).

Fecha: 2026-10-17. Destino autorizado: **hgntppemxwcxaxritnfq**. Nuevo repositorio: [seebdev/tolentino-chef](https://github.com/seebdev/tolentino-chef). El contenido histórico siguiente preparaba la migración; la conexión y las sesiones nuevas se acreditan mediante la aceptación local anterior. No acredita un despliegue público.

Alcance de la revisión inicial: lectura de aplicación, scripts, migraciones, configuración de ejemplo y documentación oficial. No se leyeron valores secretos, no se iniciaron sesiones y no se ejecutaron operaciones en Supabase o Render. La infraestructura anterior debe permanecer intacta. Esa fase fue de lectura; el arreglo de logout se autorizó e implementó posteriormente, como indica el estado actualizado.

## Inventario y riesgo de destino

| Área | Situación observada | Tratamiento antes de operar |
| --- | --- | --- |
| src/lib/supabase.ts y session-refresh.ts | URL y claves vienen del entorno; no contienen el ref anterior fijado en código. | Sustituir conjuntamente URL, clave publicable y clave de servidor por las del nuevo proyecto. Reiniciar y reconstruir. |
| src/lib/config.ts | configured comprueba presencia; no demuestra que las claves pertenezcan al destino. APP_URL admite localhost para trabajo local. | Preflight debe acreditar destino exacto y origen real; no dar por válida una mezcla de claves antiguas/nuevas. |
| /api/health | Ahora devuelve supabaseProjectRef además de status/configured; mantiene comprobación de platform_settings, no-store y errores sin detalles privados. | Antes de login o mutaciones exigir HTTP 200, status=ok, configured=true y ref exactamente hgntppemxwcxaxritnfq. El valor del ref es público; no revela claves. |
| provision-demos, translate-demos, run-live-audit, run-live-gap-audit, verify-production-isolation | Contienen guard del proyecto anterior. | Adaptar al nuevo contrato de destino antes de ejecutar. No retirar el guard para hacerlos funcionar. |
| production-preflight | Cambiado al proyecto nuevo y seebdev/tolentino-chef. Lee exclusivamente .env.migration.local, mapea TARGET_ y guarda evidencia bajo docs/evidence/migrations/hgntppemxwcxaxritnfq/<fecha>/. | Sin fallback a .env.local ni claves heredadas. Se señalaron al agente principal el guard previo a git ls-remote y la falta de verificación de cuenta/workspace Render; debe quedar explícita antes de operar. |
| backup-common y backup-application | Ref anterior forma parte del formato y guard del respaldo ya creado. | Conservar la identidad histórica del respaldo. Separar explícitamente origen del archivo y destino nuevo; no reemplazar refs globalmente ni ejecutar captura sobre el proyecto anterior. |
| bootstrap-admin | No tiene guard de proyecto; crea usuario, asigna rol y solicita correo de recuperación. No es idempotente. | No ejecutarlo tal cual. Preparar un bootstrap específico, con destino exacto, reanudación segura y envío de correo separado. |
| render.yaml y documentación | Blueprint actualizado a seebdev/tolentino-chef, main, Node 22.23.3, virginia, variables sync:false y build con controles. El agente principal confirmó publicación de main 67a9977 en el repositorio nuevo. | Verificar la cuenta/workspace Render nueva antes de crear el servicio; actualizar documentación operativa que conserve instrucciones anteriores y mantener auditorías históricas identificadas. No existe aún URL pública confirmada. |
| .runtime/demo-accounts.json y procesos existentes | Pueden conservar IDs, claves o destino anterior. No se abrieron sus valores en esta revisión. | Usar manifiesto del nuevo destino separado o archivado controlado; nunca cargar credenciales DEMO antiguas por defecto ni iniciar un runner contra un servidor antiguo. |

No se encontró un dominio Supabase anterior fijado dentro de src. Las migraciones SQL revisadas definen identidades mediante UUID y políticas de tablas, sin fijar un hostname Supabase. El nombre genérico .onrender.com en validación de dominios es una regla del proveedor, no una referencia a una cuenta antigua.

**Orden de seguridad:** detener los procesos que puedan seguir usando el entorno anterior; recibir las credenciales nuevas por el mecanismo seguro acordado; confirmar el ref exacto; reconstruir/iniciar un proceso limpio; verificar destino de la instancia; solo entonces crear identidades o iniciar sesión. Las variables ya exportadas en un proceso pueden prevalecer sobre archivos de entorno; cambiar .env.local no sustituye un proceso ya arrancado ni todos los valores heredados.

## Variables y secretos nuevos

| Variable o dato | Requisito |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | https://hgntppemxwcxaxritnfq.supabase.co |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Clave publicable obtenida del nuevo proyecto; no copiar la anterior. |
| SUPABASE_SERVICE_ROLE_KEY | Credencial administrativa de servidor válida del nuevo proyecto, en el nombre que usa el código actual. Nunca NEXT_PUBLIC ni bundle, reporte o argumento visible. |
| Contraseña PostgreSQL | Debe ser nueva, después de rotar la contraseña que el usuario declaró expuesta. No es la contraseña del administrador de la aplicación. |
| APP_URL | Para pruebas locales, un origen local deliberado. Para Render, únicamente el origen HTTPS real una vez conocido, sin ruta. |
| PLATFORM_HOSTNAMES | Solo hosts exactos de la plataforma nueva. Eliminar dependencias operativas de dominios anteriores sin modificar la infraestructura antigua. |
| RENDER_API_KEY / RENDER_SERVICE_ID / RENDER_SERVICE_HOSTNAME | Solo valores de la cuenta y servicio nuevos; omitirlos hasta disponer de acceso confirmado. No recuperar valores viejos como fallback. |
| Credenciales de administrador y DEMO | Nuevas, distintas de las antiguas. Guardar únicamente en ubicación local protegida o gestor seguro autorizado; no en Git, terminal, evidencia o capturas. |

No conservar procesos con la clave vieja mientras se aplica la nueva URL. Las claves públicas incorporadas durante el build requieren una compilación nueva; no reutilizar una carpeta de build anterior como prueba del nuevo entorno. La contraseña expuesta no se reproduce ni se usa para comprobar conexión.

El usuario facilitó conexión directa 5432 y Transaction pooler 6543. Si se necesita Session pooler por conectividad IPv4, obtener sus parámetros reales del panel. No inventar hostname/puerto de Session pooler ni tratar Transaction como equivalente. La aplicación utiliza la API HTTPS de Supabase; la conexión SQL es una dependencia separada para migraciones.

## Sesiones, cookies y límites de dominio

El cliente instalado deriva la clave de sesión desde el hostname del proyecto. Con el destino nuevo, la clave esperada es `sb-hgntppemxwcxaxritnfq-auth-token`, incluyendo los fragmentos y verificadores PKCE asociados. La cookie anterior pertenece a otra clave; no constituye una sesión válida del proyecto nuevo y no se deben copiar sus tokens.

Las cookies actuales son HttpOnly, SameSite=Lax, Path=/ y Secure bajo NODE_ENV=production; no tienen Domain. La sesión se renueva en servidor con getUser y las APIs vuelven a consultar rol/membresía. No hay cliente Supabase de navegador ni almacenamiento local de credenciales. El localStorage de menú se limita a favoritos por restaurante.

Para la validación de migración usar un contexto de navegador nuevo. No llamar logout, refresh ni recovery sobre Supabase antiguo para limpiar el navegador. Si después se decide retirar cookies antiguas locales, hacerlo solo en el host afectado y sin revocar sesiones del proyecto anterior.

El host canónico debe coincidir con APP_URL. PLATFORM_HOSTNAMES permite pasar el filtro de host, pero los POST siguen exigiendo Origin exactamente igual a APP_URL. Un alias no funciona automáticamente como segundo origen de login. Redirigir al canónico antes de autenticar y probar cookies/PKCE en ese único origen. Los dominios de restaurantes no deben añadirse como hosts administrativos.

Los registros restaurant_domains importados no prueban propiedad ni registro/TLS en la cuenta Render nueva. No dar por trasladado un estado verified de la cuenta anterior; revalidar la configuración con el agente responsable antes de activar esos dominios. No modificar DNS ni servicios anteriores durante esta revisión.

La documentación oficial de SSR exige renovar y propagar las cookies al servidor y al navegador; ese patrón existe en el proxy actual. La aceptación se repetirá contra el nuevo proyecto. [Supabase SSR con Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs).

## Configuración Auth del proyecto nuevo

Verificar estos ajustes directamente en hgntppemxwcxaxritnfq. El estado observado anteriormente en otro proyecto y supabase/config.toml no acreditan el nuevo servicio alojado.

1. Proveedor email/password habilitado. Desactivar registro público y acceso anónimo, preservando creación administrativa desde servidor.
2. Revisar política de contraseñas, duración JWT, rotación de refresh y reutilización. El archivo local propone mínimo 12 caracteres, JWT 900 segundos, rotación activa y ventana de reutilización 10 segundos; no afirmar que ya estén aplicados en el nuevo proyecto.
3. Una vez conocido el HTTPS público, Site URL igual a APP_URL y callback exacto APP_URL/auth/callback. Evitar comodines amplios para producción.
4. Configurar SMTP/remitente de la cuenta nueva antes de aceptar entrega. No reutilizar credenciales SMTP antiguas ni enviar correo de prueba sin la autorización y buzón correspondientes.
5. Configurar la plantilla Reset Password con el endpoint de servidor, porque el flujo de alta de la aplicación solicita recuperación después de crear las relaciones; no usa Invite como flujo principal.

Plantilla prevista, sin dominio inventado:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">
  Definir mi contraseña
</a>
```

/auth/confirm valida el token con el cliente del proyecto nuevo y redirige al login canónico en modo password. /auth/callback admite intercambio PKCE. El servidor no procesa tokens de sesión en fragmentos de URL. Los enlaces emitidos por el proyecto anterior no deben reutilizarse.

La configuración de registro público afecta signup; la administración autorizada de usuarios debe mantenerse en el servidor con la clave administrativa. [Configuración de Auth](https://supabase.com/docs/guides/auth/general-configuration), [creación administrativa](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [plantillas de servidor](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

## Crear el administrador nuevo sin exponer la contraseña

El administrador de la aplicación no es la cuenta GitHub, Render ni la cuenta del panel Supabase. Se necesita el correo del administrador autorizado y una identidad Auth del proyecto nuevo.

El procedimiento a preparar debe:

1. Rechazar cualquier URL distinta del proyecto nuevo antes de crear cliente o hacer peticiones. Verificar las migraciones y que platform_admins exista.
2. La decisión coordinada es preservar el UUID y correo del administrador en el Auth nuevo, con una contraseña aleatoria nueva y una marca de migración en app_metadata. Buscar de forma paginada y verificar UUID, correo y marca antes de reanudar; un correo coincidente por sí solo no autoriza sobrescribir contraseña ni conceder privilegios. La marca debe proceder del proceso administrativo, no de user_metadata.
3. Crear la identidad mediante auth.admin.createUser especificando el UUID preservado, con contraseña nueva fuerte generada en memoria y almacenada por el mecanismo local protegido. El SDK instalado admite id en AdminUserAttributes. La confirmación administrativa del email solo procede para la dirección controlada y autorizada. No utilizar signUp público para el bootstrap.
4. Asignar platform_admins.is_active=true al UUID exacto retornado por el nuevo Auth. El rol depende de esa tabla, no de user_metadata. Verificar la relación y permitir reanudar sin duplicar usuarios o roles.
5. Guardar las credenciales nuevas únicamente en almacenamiento local protegido autorizado, antes de depender de ellas. No imprimir contraseña, token, correo en logs de fallo ni enlaces que contengan tokens.
6. Probar login exclusivamente contra una instancia cuyo destino haya sido confirmado como nuevo; /api/session debe devolver role=superadmin. El modo soporte debe conservar esa identidad.

Si SMTP y HTTPS todavía no están listos, el bootstrap puede crear una credencial temporal segura sin correo. No ejecutar el script actual que envía recuperación incondicionalmente. Cuando el servicio de correo esté configurado y autorizado, el propio usuario puede definir su contraseña mediante la recuperación del proyecto nuevo.

Para restablecer una contraseña olvidada durante el bootstrap, usar únicamente el UUID confirmado del administrador nuevo y la operación administrativa updateUserById desde servidor, con un secreto nuevo introducido por el canal seguro. No escribir contraseñas por SQL en auth.users, no trasladar el hash anterior y no cambiar otra cuenta por una coincidencia de correo. Tras completar un acceso normal, el usuario puede cambiar su contraseña desde la cuenta. [API administrativa de actualización](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

## Identidades DEMO y preservación de relaciones

El respaldo lógico conserva perfiles seleccionados e IDs, pero excluye hashes de contraseña, sesiones, refresh tokens y secretos MFA. Por ello, copiar las quince tablas no crea una restauración de Auth funcional. Las identidades DEMO deben recrearse o importarse mediante un procedimiento compatible con el Auth nuevo y recibir contraseñas nuevas.

La decisión final coordinada preserva los UUID originales de Auth, incluido el administrador, y sus correos. Las identidades se crean en el proyecto nuevo con contraseñas aleatorias nuevas y una marca de migración administrativa en app_metadata que se verifica antes de reanudar. Preservar IDs conserva las referencias de restaurant_memberships y auditoría; mantener UUID de restaurantes, public_token y rutas conserva la identidad permanente de los QR y de las imágenes. No se copian sesiones, hashes ni contraseñas anteriores. La concesión del rol administrativo se verifica contra la identidad prevista del respaldo y la decisión autorizada, no por coincidencia de correo.

Comprobar una sola membresía activa por propietario, correo DEMO .test, restaurante correcto y separación de permisos. El agente de datos utilizará .runtime/migrations/hgntppemxwcxaxritnfq/accounts.json como archivo separado de accesos nuevos, protegido e ignorado por Git. Los UUID se preservan explícitamente desde el respaldo validado; las contraseñas antiguas no se leen ni se reutilizan. No enviar email a .test.

Volver a ejecutar el provisioner sin adaptar su estado, guards e idempotencia puede mantener asociaciones antiguas o crear UUID y tokens QR nuevos. No usarlo como atajo para preservar la identidad QR sin una comparación explícita. El agente de base de datos decide la ruta de traslado y prepara sus verificaciones.

## Aceptación posterior de la migración

Las suites antiguas son evidencia histórica, no resultado del destino nuevo. Repetir después de configurar y verificar el destino:

| Prueba | Resultado exigido |
| --- | --- |
| Preflight de instancia | URL/API/servicio del proyecto nuevo; sin fallbacks al viejo. Health 200 y ref nuevo comprobado antes del login. |
| Sesión anterior sintética | Una cookie con prefijo del proyecto anterior no autentica; no se realizan solicitudes al host antiguo. |
| Superadmin nuevo | Login, rol de DB, acceso admin y soporte con identidad constante. |
| Tres owners nuevos | Login de cada uno, su restaurante y rechazo de los seis pares cruzados. |
| Renovación y cookies | Renovación tras caducar JWT, cookies del proyecto nuevo con atributos correctos, propagación SSR y no-store. |
| Logout | Camino normal local y API posterior 401 en el destino nuevo; verificar también el manejo del error temprano ya corregido y probado localmente. |
| Signup | Desactivado en el proyecto nuevo, sin impedir altas administrativas autorizadas. |
| Recovery | Solo cuando se autorice correo: enlace nuevo, destino canónico, enlace inválido/usado/expirado y cambio de contraseña. |
| Datos y Storage | Tres DEMO con identidades, catálogos, imágenes privadas y relaciones correctas; pruebas funcionales nuevas. |
| QR y dominios | Tokens conservados, URLs del HTTPS nuevo y verificación pública; ninguna activación basada solo en estado de la cuenta anterior. |
| Secretos y compilación | Rebuild con variables nuevas; ningún secreto en Git o bundle; auditoría de destinos sin imprimir valores. |

Al cerrar, registrar evidencia nueva con fecha, proyecto y origen comprobados, separada de los resultados anteriores. En esta revisión documental no se ejecutó ninguna de estas pruebas contra hgntppemxwcxaxritnfq.

## Revisión independiente de los cambios de configuración

Se leyeron production-preflight.mjs, render.yaml, la ruta health y tests/health.test.ts después de los cambios del agente principal. La revisión no ejecutó Git remoto, login, Auth ni lecturas del proyecto origen.

- El preflight usa el archivo de migración separado; la petición pública Auth solo se construye si la URL coincide exactamente con el proyecto nuevo. fetch rechaza redirecciones. La salida registra presencia de variables, no valores de claves. La clave administrativa se comprueba por presencia, no se certifica todavía su validez.
- La lectura Render es inventario GET paginado; no crea ni modifica servicios. Encontrar un repositorio o nombre coincidente no demuestra que la credencial pertenezca al workspace nuevo. El agente principal coordina marcar accountVerified=false y exigir verificación del workspace.
- Se señaló que git ls-remote debe quedar condicionado a que origin corresponda al repositorio nuevo, para no consultar accidentalmente un remoto anterior. El agente principal asumió ese ajuste; no se modificó su archivo desde esta revisión.
- La ruta health no devuelve secretos ni errores de base de datos. Sus seis casos de prueba revisados cubren ref nuevo/anterior, credencial ausente, hostname ajeno y errores seguros. Estas pruebas son mocks y no acreditan el destino remoto; su ejecución global corresponde al agente principal.
- El blueprint no contiene credenciales ni URL pública inventada. Usa el repositorio nuevo y variables de Render no sincronizadas desde el archivo. El plan gratuito y la región declarada requieren revisión de disponibilidad antes de aceptación comercial.

Los pendientes registrados en la revisión inicial incluían credenciales, inspección y respaldo del destino, selección de Render, URL canónica y SMTP. El estado actualizado confirma selección de workspace y registro público desactivado; consultar los reportes de migración del agente principal para el avance de datos. HTTPS/SMTP y el despliegue siguen sin acreditarse. El arreglo de logout ya está autorizado e implementado; su prueba con Auth real del destino nuevo permanece separada.
