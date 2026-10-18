# Publicación de Tolentino Restaurantes Admin

Verificado el 17 de octubre de 2026 (America/Bogota; evidencias del 18 de octubre UTC). Un único servicio Free, Virginia, workspace Tolentino Restaurantes, creado con autorización expresa. No se modificó el Supabase anterior ni Crepes & Waffles.

| Recurso | Valor verificado |
| --- | --- |
| Servicio Render | srv-dba32beq1p3s73a4g6v0 |
| Workspace | tea-dba1s4m1egvs7391ve50 |
| Repositorio | https://github.com/seebdev/tolentino-chef — main |
| Supabase | hgntppemxwcxaxritnfq |
| Superadministrador | https://tolentino-restaurantes-admin.onrender.com/admin |
| Login | https://tolentino-restaurantes-admin.onrender.com/login |
| Aurora | https://tolentino-restaurantes-admin.onrender.com/menu/pizzeria-aurora-demo |
| Bruma | https://tolentino-restaurantes-admin.onrender.com/menu/cafe-bruma-demo |
| Marea | https://tolentino-restaurantes-admin.onrender.com/menu/bento-marea-demo |

## Despliegue comprobado

Render validó el render.yaml existente: un servicio, ninguna base de datos. Se creó ese servicio mediante API con los valores validados; no se creó un Blueprint administrado. El despliegue automático inicial sin secretos fue cancelado antes de configurar las ocho variables. APP_URL y hosts usan la dirección HTTPS asignada; las URLs Auth se aplicaron con respaldo cifrado y verificación del resto de la configuración intacta. Autodeploy se mantuvo desactivado durante la aceptación controlada y después se habilitó en commit, conforme al blueprint; la respuesta de Render lo confirmó.

Primer despliegue live: dep-dba342jrjlhs738ne1gg, commit 355e3a64abc38d98ee327e63a855c14258768bf6. Su pipeline pasó TypeScript, lint, 239 pruebas y build. Health público devuelve 200, configured=true y el proyecto nuevo.

La inspección pública detectó ausencia de HSTS. Se añadió max-age=31536000 exclusivamente para producción con APP_URL HTTPS, sin includeSubDomains ni preload, para no extender la política a subdominios ajenos del cliente. Commit 58053f575011e76840081d4abfbbe71a6841d9f7 desplegado live (dep-dba38g8m7kps73f9uib0): HSTS exacto comprobado en seis páginas. El pipeline repitió correctamente typecheck, lint, 239 pruebas y build. Los hashes privados/públicos de los tres DEMO permanecieron idénticos después del despliegue y sus propietarios iniciaron sesión nuevamente.

## Aceptación pública

- Chrome real: 12 escenarios, 186 comprobaciones, nueve menús en tres tamaños y tres propietarios. No son dispositivos físicos.
- Superadministrador/QR: nueve comprobaciones; cookies Secure/HttpOnly/Lax, logout y APIs privadas protegidas.
- Nueve QR PNG/SVG/PDF decodificados, tres rutas HTTPS 302 → 200, tokens y catálogos conservados. [Archivos vigentes](../RESTAURANTES_DEMO.md).
- Aislamiento: 30/30, seis pares dirigidos API/RLS/Storage, controles positivos propios y denegación de contenido ajeno.
- Primer análisis de HTML/JS/CSS: cero secretos en 22 archivos; falló únicamente HSTS. Se conserva ese reporte histórico. Después de la corrección: 22 archivos públicos, cero hallazgos sensibles y cero fallos de cabeceras.

Evidencias en evidence/migrations/hgntppemxwcxaxritnfq/public-acceptance-20261018/; configuración Auth en [AUTH_PRODUCTION_URLS.md](AUTH_PRODUCTION_URLS.md). La prueba de persistencia comparó la referencia pública anterior al redeploy con los datos posteriores: PASS para los tres restaurantes.

## Pendientes y límites

SMTP propio, remitente verificado y entrega/recuperación real en un buzón autorizado siguen pendientes. La plantilla alojada actual usa ConfirmationURL; el flujo SSR necesita revisión y prueba de TokenHash. No se enviaron correos. Las credenciales se proporcionan sólo mediante el archivo local protegido .env.smtp.local, nunca en chat ni Git.

Falta escaneo físico de los QR. Free puede suspender el servicio por inactividad; no se contrató disponibilidad continua. La gestión integrada de dominios personalizados conserva su código, pero las credenciales Render opcionales no se suministraron al servidor ni se registraron dominios/DNS de clientes.

Respaldo AES-256-GCM y restauración local aislada 71/71 comprobados, sin restaurar encima de datos existentes. La clave DPAPI depende de este perfil Windows; recuperación en otro equipo, GoTrue/Storage administrados y PITR no están acreditados. Véase [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## Evidencia de cierre técnico

- [Render live, pipeline y variables verificadas](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T025608979Z/release-verification.json). Ocho valores coinciden sin revelarlos; inventario confirma un único servicio.
- [HSTS y escaneo público posterior](evidence/migrations/hgntppemxwcxaxritnfq/public-secret-20261018T0254/public-secret-check.json).
- [Persistencia después del despliegue](evidence/migrations/hgntppemxwcxaxritnfq/public-acceptance-20261018/restart-persistence.json).
- [Autodeploy commit confirmado](evidence/migrations/hgntppemxwcxaxritnfq/2026-10-18T025645728Z/render-enable-auto.json).

Los reportes de release-verification de 02:55:30 y 02:55:47 UTC fallaron por dos discrepancias del comprobador local (nombre de campo del inspector y barra final normalizada); no registran un cambio ni una configuración Auth incorrecta. El reporte de 02:56:08 corrige esas comparaciones y acredita el estado. El fallo Git temporal de 02:41:27 no inició ningún despliegue. Se conservan los intentos para trazabilidad.

El cierre de documentación se publicará en main; el autodespliegue mantiene el mismo código de aplicación. La comprobación final del SHA y health se guarda en .runtime/render-final-evidence/ para no iniciar otro despliegue sólo por escribir su evidencia. SMTP y pruebas físicas continúan pendientes, por lo que publicación técnica no equivale a cierre operativo completo.

Confirmación posterior del usuario: todavía no dispone de proveedor SMTP y todavía no puede realizar el escaneo físico. Ambos puntos continúan pendientes; no se contrató un proveedor ni se envió correo.
