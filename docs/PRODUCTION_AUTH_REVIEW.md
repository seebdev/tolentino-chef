# Revisión de autenticación para producción

Fecha: 2026-10-17. Alcance: lectura de código y documentación, más pruebas locales aisladas. **Esta revisión no acredita un despliegue HTTPS ni entrega de correo.** No se modificaron código de aplicación, variables, Supabase, cuentas, plantillas ni servicios remotos; no se enviaron correos.

Se contrastaron README.md, AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md, RESTAURANTES_DEMO.md y DEPLOY_RENDER_SUPABASE.md con las dependencias instaladas: Next.js 16.4.2, @supabase/ssr 0.12.7 y @supabase/supabase-js 2.118.0. Se consultó el changelog oficial de Supabase y la documentación local de Next sobre autenticación, cookies y Proxy.

## Resultado y límites

Los controles revisados verifican al usuario en el servidor, obtienen los roles de tablas protegidas y vuelven a autorizar cada acceso a un restaurante. Las pruebas locales focalizadas pasan **61/61**; son un subconjunto de la suite general, no 61 pruebas adicionales a su total. Cinco comprobaciones de configuración reproducen el comportamiento documentado abajo; pasar esas comprobaciones no significa que una configuración con localhost sea apta para publicación.

La aceptación de producción sigue condicionada al origen HTTPS permanente, los ajustes alojados de Auth, SMTP y una prueba de recuperación con un buzón autorizado. La comprobación de solo lectura del 2026-10-17 a las 19:41:05 UTC observa `signupDisabled:true` y `anonymousEnabled:false`: el registro público está desactivado en ese momento. La observación anterior `disable_signup=false` queda como antecedente histórico y no representa el estado más reciente. No se atribuye este cambio a una acción de los agentes; el preflight declara `externalMutations:false`. SMTP y ajustes privados de gestión no están verificados, APP_URL sigue siendo local y falta acceso Render. [Preflight actual](evidence/production-preflight.json). El archivo local `supabase/config.toml` no demuestra por sí solo el estado del proyecto alojado.

## Hallazgos concretos antes de publicar

| ID | Resultado comprobado | Acción de operación |
| --- | --- | --- |
| AUTH-P01 | `appUrl()` permite localhost/127.0.0.1 en modo producción y usa localhost cuando falta APP_URL. La comprobación de salud no valida que el origen sea el público definitivo. | Exigir APP_URL explícito, con origen HTTPS real, sin ruta. Comprobar su valor por presencia/origen sin imprimir secretos. Un health 200 no basta. |
| AUTH-P02 | PLATFORM_HOSTNAMES amplía los hosts aceptados por el proxy, pero `mutationOrigin()` solo admite Origin exactamente igual al origen APP_URL. Las cookies no incluyen Domain y pertenecen al host que las emitió. | Usar un único origen canónico para login, soporte y paneles. Si se mantiene un alias, redirigir al canónico antes de autenticar; no presentar el alias como una segunda URL de administración funcional. |
| AUTH-P03 | La creación de un propietario solicita recuperación después de confirmar restaurante y membresía. No utiliza una invitación Auth. El servidor admite token_hash mediante /auth/confirm; no procesa tokens de sesión en fragmentos URL. | Aplicar la plantilla Reset Password indicada en la guía de despliegue, con Site URL igual a APP_URL y enlace /auth/confirm?token_hash=…&type=recovery. Comprobar el flujo desde otro navegador cuando se autorice correo real. |
| AUTH-P04 | No se ha comprobado el SMTP alojado ni la entrega real. Las DEMO .test omiten el servicio de correo. | Configurar proveedor/remitente adecuados y verificar entrega, enlace válido, enlace reutilizado y expirado con un buzón autorizado. Las DEMO no sirven para aceptar este punto. |
| AUTH-P05 | Duración de JWT, rotación, reutilización y caducidad OTP del TOML son configuración local; no se obtuvo la configuración privada alojada. | Verificar los valores del proyecto y probar renovación tras expirar el JWT. No confundir caducidad JWT, duración de cookie y duración total de sesión. |

**Consecuencia reproducible de AUTH-P01:** si se publica conservando el valor local, los POST del dominio público se rechazan por origen y los enlaces construidos con APP_URL apuntan a localhost. El código sí rechaza un APP_URL HTTP en un hostname público. Evidencia: [cinco comprobaciones locales](evidence/production-auth-config-probes.json), código en `src/lib/config.ts:9` y `src/lib/api.ts:93`.

**Consecuencia de AUTH-P02:** un alias permitido puede mostrar /login, pero su POST devuelve rechazo de origen. En un flujo PKCE iniciado en un host y terminado en otro también puede faltar la cookie verificadora. Se trata de una incompatibilidad de configuración, no de autorización adicional concedida al alias. Las URL exactas de producción y Site URL deben coincidir; Supabase recomienda limitar los patrones amplios a entornos de desarrollo o previsualización. [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

**Dependencia adicional para AUTH-P03/P04:** desde 2026-06-03, los proyectos Free nuevos que usan SMTP predeterminado no pueden personalizar plantillas Auth; la aplicabilidad depende de fecha y plan del proyecto, no verificados aquí. SMTP propio puede ser necesario también para habilitar la plantilla, además de entregar a clientes. El servicio predeterminado restringe destinatarios a miembros del equipo y limita el envío; no acredita un correo transaccional de producción. [Cambio de plantillas Free](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier), [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Controles revisados

| Control | Evidencia en código y alcance |
| --- | --- |
| Identidad verificada | `src/lib/session-refresh.ts:67` llama getUser; `src/lib/access.ts:10` vuelve a verificar para autorizar. No se confía en getSession ni en user_metadata para asignar el rol. |
| Renovación SSR | El cliente pertenece a una petición. setAll propaga cookies nuevas/borradas tanto a la petición que sigue como a la respuesta y conserva cabeceras del SDK. Las pruebas cubren fragmentación, varias escrituras y aislamiento de peticiones. |
| Cookies | HttpOnly, SameSite=Lax, Path=/ y Secure cuando NODE_ENV=production, sin Domain. El cliente web usa las APIs propias; no hay cliente Supabase de navegador que necesite leer estas cookies. La renovación se realiza al efectuar peticiones al servidor. |
| Caché | Proxy de sesión y respuestas API usan private, no-store. Callback y confirmación usan no-store y Referrer-Policy=no-referrer. No se debe introducir caché pública/CDN en estas rutas. |
| Host y tenant | Se valida el hostname antes de renovar sesión. Un dominio de restaurante verificado solo sirve sus rutas públicas; no recibe login, administración ni APIs privadas. Un X-Forwarded-Host suministrado por el visitante no amplía permisos. |
| Autorización | actor/context consultan administrador activo o membresía activa; el owner queda limitado a su restaurante. La suspensión se comprueba de nuevo en el acceso. La clave de servicio permanece en módulo server-only. |
| Redirecciones | /auth/callback y /auth/confirm construyen destinos fijos desde APP_URL. No consumen un next externo. Un enlace inválido acaba en /login?error=invalid_link. |
| Cambio de contraseña | La API requiere actor válido y contraseña de 12–128 caracteres. Abrir /login?mode=password por sí solo no concede permiso para cambiar una contraseña. |
| Soporte | El modo soporte conserva la identidad de superadmin; salir vuelve a /admin y no inicia una sesión de propietario. La evidencia funcional previa del runner de huecos cubre salida en escritorio y móvil; no se repitió esa mutación aquí. |
| DEMO y correo | Crear con demo exige .test; crear con cualquier correo .test omite envío. Recuperación pública .test conserva respuesta genérica y rate limit sin llamar al servicio. Reset administrativo rechaza DEMO/.test. Son controles de la aplicación; no una política universal de envío del proyecto Supabase. |

La documentación actual de Supabase propone validar JWT con getClaims para determinados flujos y mantiene getUser como verificación con Auth. Usar getUser aquí no equivale a confiar en datos de cookie. Next recomienda centralizar las decisiones sensibles cerca de los datos y proteger Route Handlers, como hacen actor/context; el proxy no es la única barrera. [SSR con Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs), documentación instalada en `node_modules/next/dist/docs/01-app/02-guides/authentication.md` y `03-api-reference/04-functions/cookies.md`.

## Logout, caducidad y errores

El logout usa explícitamente `scope: "local"`, por lo que conserva sesiones en otros navegadores. Los JWT ya emitidos pueden seguir siendo válidos hasta su vencimiento aunque se revoque su refresh token; esta revisión no afirma revocación instantánea universal. El proyecto no comprueba explícitamente auth.sessions en cada operación. Las restricciones de rol/membresía sí se vuelven a consultar. [Alcances de logout](https://supabase.com/docs/guides/auth/signout), [duración de sesiones](https://supabase.com/docs/guides/auth/sessions).

Dos mejoras operativas quedan propuestas **sin cambio de código**:

1. `src/app/api/auth/route.ts:29` ignora el error devuelto por signOut y responde ok. El SDK instalado borra el almacenamiento local incluso ante varios errores de la llamada de revocación, por lo que no se afirma que todo error conserve la sesión. Sin embargo, existe una salida temprana del SDK si falla la carga/renovación previa de sesión, y el handler no distingue ese resultado. Añadir una prueba local de ese fallo y acordar limpieza/aviso seguro permitiría comprobar el comportamiento ante caída de Auth sin prometer revocación remota.
2. `src/app/api/auth/route.ts:63` devuelve el mensaje genérico aunque resetPasswordForEmail devuelva un error. Es apropiado evitar enumeración de cuentas, pero falta una señal operativa segura de error del proveedor en esa ruta. Proponer registro de etapa/código sin correo, token ni URL; mantener la misma respuesta pública. La creación administrativa sí conserva invitationSent y registra fallos de envío.

No se observó un fallo real de recuperación o logout remoto en esta revisión porque no se ejecutaron esas acciones contra usuarios reales. Tampoco se midió la duración efectiva del proyecto alojado. Supabase distingue el tiempo de JWT de los límites de sesión, aplicados durante la renovación; reducir Max-Age de cookie no sustituye esas políticas. [User sessions](https://supabase.com/docs/guides/auth/sessions).

## Pruebas ejecutadas y aceptación pendiente

Comando local ejecutado con Node 22.23.3:

```text
node node_modules/vitest/vitest.mjs run tests/proxy_session.test.ts tests/auth_routes.test.ts tests/api_security.test.ts --reporter=json --outputFile=docs/evidence/production-auth-local-tests.json
```

| Archivo | Resultado |
| --- | --- |
| proxy_session.test.ts | 43/43 |
| auth_routes.test.ts | 4/4 |
| api_security.test.ts | 14/14 |
| Ejecución aislada de config.ts con entornos sintéticos | 5/5 comportamientos esperados |

[Reporte Vitest](evidence/production-auth-local-tests.json). Estas pruebas usan mocks de Auth y DB; no acreditan persistencia, SMTP ni HTTPS remoto. Las cinco comprobaciones no ejecutan llamadas de red y no modifican variables reales.

Después de configurar el entorno, quedan por aceptar en HTTPS: cookies Secure/HttpOnly/Lax reales; login owner y superadmin; API privada anónima denegada; renovación tras caducidad de JWT; logout y posterior API 401 en el mismo navegador; sesión independiente en otro navegador; recuperación en mismo y distinto navegador; enlace usado/expirado; contraseña nueva; soporte sin cambio de identidad; aislamiento de host de cliente. Las pruebas que envían correo requieren autorización específica y buzón controlado. No ejecutar sobre cuentas de clientes.

El changelog actual también confirma que las bibliotecas Supabase requieren Node 22 o posterior tras el fin de soporte de Node 20. El runtime local y el runtime documentado para Render usan Node 22. No se actualizó ninguna dependencia. [Aviso de Node 20](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20).

## Actualización: reproducción local del fallo temprano de logout

Se reprodujo el caso con las dependencias instaladas, una cookie de sesión sintética caducada y un fetch completamente interceptado que devuelve HTTP 503. No se usó una cuenta ni un token real, ni se contactó Supabase. Resultado: una petición simulada, AuthRetryableFetchError, **cero escrituras de cookie y cookie de sesión conservada**. El endpoint actual, por lectura de su rama logout, ignora ese error y devuelve ok. [Evidencia saneada de la reproducción](evidence/production-auth-logout-before.json).

La corrección quedó **pendiente de aprobación**, sin cambios de código: la revisión automática rechazó modificar autenticación/UI porque interpretó esta fase como lectura y documentación. No se intentó una vía alternativa para aplicar el cambio.

Propuesta concreta para revisión:

1. Añadir un helper junto al cliente SSR que expire las cookies presentes del prefijo exacto `sb-<project-ref>-auth-token`, sus fragmentos y claves PKCE. Derivar el identificador del mismo hostname usado por el SDK; conservar cookies de otros proyectos y cookies ajenas. Usar Path=/, HttpOnly, SameSite=Lax y el mismo Secure que la emisión, con Max-Age=0 y Expires en el pasado.
2. Mantener `signOut({scope:"local"})` y ejecutar esa limpieza en finally, tanto para logout como para descartar un login sin autorización. No llamar a logout global ni afirmar que los JWT previos dejan de ser válidos inmediatamente.
3. Si el SDK devuelve error o lanza una excepción, devolver HTTP 503 con `localSessionCleared:true`, un código fijo y este mensaje: «Cerramos la sesión en este navegador, pero no pudimos confirmar su revocación en el servidor. Vuelve a iniciar sesión para continuar». Solo afirmar que se limpió localmente después de completar la limpieza de cookies.
4. Propagar ese indicador en el cliente HTTP. Al recibirlo durante logout, salir del panel hacia /login con un indicador fijo de aviso; mostrar allí el mensaje. Un error de red sin confirmación de limpieza debe seguir mostrándose como fallo y no fingir un cierre.
5. Mantener la respuesta genérica de recuperación para errores del proveedor, añadiendo únicamente identificadores propios fijos de evento/etapa/código. No registrar email, token, nombre de cookie, URL, error.message ni códigos arbitrarios devueltos por terceros.

Regresiones propuestas antes de aceptar el cambio: éxito de logout con scope local; error retornado y excepción del SDK; sesión caducada con SDK real y fetch 503 interceptado; expiración de cookie base, fragmentos, PKCE fijo y por flujo; conservación de otros proyectos y de prefijos parecidos; limpieza cuando actor rechaza el login; respuesta 503 honesta; salida visual del panel con aviso; recuperación fallida con respuesta genérica y registros sin datos introducidos por el proveedor; .test sin envío ni telemetría de fallo. No se ejecutaron todavía contra una corrección, porque no se aplicó código.
