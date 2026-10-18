# URLs de Auth para producción

Destino exclusivo: hgntppemxwcxaxritnfq. La URL asignada al servicio nuevo es https://tolentino-restaurantes-admin.onrender.com. Cambio aplicado el 18 de octubre de 2026 a las 02:39 UTC: un PATCH HTTP200 y readback completo PASS. Site URL y allowlist coinciden con los valores siguientes; el resto de la configuración permanece idéntico. [Evidencia de aplicación](evidence/migrations/hgntppemxwcxaxritnfq/20261018T023948321Z/auth-production-urls.json).

El cambio está limitado a estos dos campos:

| Campo | Valor exacto |
| --- | --- |
| site_url | https://tolentino-restaurantes-admin.onrender.com |
| uri_allow_list | https://tolentino-restaurantes-admin.onrender.com/auth/callback |

El callback coincide con redirectTo usado por recuperación y alta administrativa. No se añaden comodines, hosts de vista previa ni localhost. Supabase recomienda rutas exactas en producción y utiliza Site URL cuando no se proporciona otro destino. [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Procedimiento ejecutado y verificable

scripts/configure-production-auth-urls.mjs exige referencia de proyecto y URL HTTPS Render válidas. Antes del PATCH comprueba Management y Auth público: registro cerrado, Email activo y anónimo desactivado. Guarda los valores anteriores, plantilla y controles pertinentes en un archivo AES-256-GCM/DPAPI bajo .runtime/backups, con ACL restringida y roundtrip de disco verificado; no copia credenciales SMTP/PAT. Vuelve a leer toda la configuración para detectar cambios concurrentes.

El cuerpo del PATCH contiene sólo site_url y uri_allow_list. El readback exige ambos valores exactos y que todos los demás campos permanezcan idénticos. No modifica SMTP, plantillas, proveedores, cuentas ni datos. No reintenta mutaciones automáticamente ni hace rollback ciego ante cambios externos. Si se pierde la respuesta, reconcilia mediante lectura. [Management API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

    node scripts/configure-production-auth-urls.mjs --apply --confirm-target hgntppemxwcxaxritnfq --site-url https://tolentino-restaurantes-admin.onrender.com

Antes del PATCH se guardó y descifró correctamente .runtime/backups/auth-urls-hgntppemxwcxaxritnfq-20261018T023944266Z.json.enc; su SHA256 consta en la evidencia. Management y Auth público confirmaron disable_signup:true, Email habilitado y anónimo desactivado. No se enviaron correos ni se modificaron tablas, usuarios, plantillas o SMTP.

Pruebas locales: 12/12 PASS, lint PASS; contemplan backup fallido, drift, origen incorrecto, URLs peligrosas, ejecución idempotente, respuesta perdida y redacción. [Evidencia local](evidence/migrations/hgntppemxwcxaxritnfq/20261018T023846695Z/auth-url-local-tests.json).

## Recuperación y SMTP pendientes

La inspección de sólo lectura devolvió plantilla de recuperación con .ConfirmationURL y sin .TokenHash ni /auth/confirm. Que la API devuelva contenido no demuestra su historial de personalización. No se alteró ni se envió correo. No hay host, usuario ni remitente de SMTP propio configurados. [Inspección real](evidence/migrations/hgntppemxwcxaxritnfq/20261018T023631161Z/auth-recovery-inspection.json).

La aplicación dispone de /auth/confirm para verificar token_hash y /auth/callback para intercambiar un code. La entrega y el recorrido completo de recuperación en buzón real siguen sin comprobarse. El endpoint de servidor requiere una plantilla apropiada; configurar las URLs no acredita ese recorrido. [Plantillas y endpoints de servidor](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

Desde el 3 de junio de 2026, proyectos Free nuevos que utilizan el correo predeterminado no pueden personalizar las plantillas; SMTP propio permite hacerlo. Esta restricción debe resolverse con un proveedor/remitente autorizado antes de dar por terminada la recuperación para propietarios. No se contrata un servicio ni se modifican estas opciones en este paso. [Cambio oficial de plantillas Free](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

Las cuentas .test no reciben comunicaciones. La configuración de URLs mantiene disable_signup:true y no habilita altas públicas.
