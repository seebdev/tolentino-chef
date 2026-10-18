# Restaurantes DEMO — Tolentino

> Actualización del 18 de octubre de 2026 (UTC): los tres DEMO se migraron a `hgntppemxwcxaxritnfq` conservando UUID, catálogo y tokens QR. El servidor local actual usa ese destino. Sus contraseñas nuevas están exclusivamente en `.runtime/migrations/hgntppemxwcxaxritnfq/accounts.json`; el acceso administrador está en `admin-account.json` de la misma carpeta protegida. Las credenciales y evidencias históricas indicadas más abajo corresponden al entorno anterior. Véase [estado vigente](docs/MIGRATION_STATUS.md) y [manifiesto nuevo](artifacts/migrations/hgntppemxwcxaxritnfq/restaurants.json). Todavía no existen URLs públicas verificadas.

Fecha de entrega: 17 de octubre de 2026 (America/Bogota).

Los tres restaurantes están guardados en Supabase y marcados como DEMO. Cada uno tiene un propietario distinto, una única sucursal, 24 productos, 6 categorías principales, 2 subcategorías, ilustraciones propias, logo, colores, promociones, horarios y español/inglés habilitados. Son datos ficticios; no representan clientes reales. Las cuentas .test no reciben invitaciones ni recuperación por correo.

## Menús y propietarios

| Restaurante | Usuario DEMO | Menú en este equipo | Productos |
| --- | --- | --- | ---: |
| Pizzería Aurora · DEMO | `aurora@tolentino-demo.test` | [Abrir menú](http://localhost:3000/menu/pizzeria-aurora-demo) | 24 |
| Café Bruma · DEMO | `bruma@tolentino-demo.test` | [Abrir menú](http://localhost:3000/menu/cafe-bruma-demo) | 24 |
| Bento Marea · DEMO | `marea@tolentino-demo.test` | [Abrir menú](http://localhost:3000/menu/bento-marea-demo) | 24 |

Para entrar al panel de cualquiera de los tres, abre [Iniciar sesión](http://localhost:3000/login), usa su correo DEMO y su contraseña local. La aplicación lo dirige a [Mi restaurante](http://localhost:3000/dashboard). Cada propietario administra únicamente su restaurante.

Las contraseñas aleatorias se conservan exclusivamente en el archivo local ignorado por Git `.runtime/demo-accounts.json`. Este documento no contiene contraseñas. El superadministrador existente puede abrir [Administración](http://localhost:3000/admin) y entrar en **modo soporte** desde la tarjeta del restaurante.

## Identidad y contenido

- **Pizzería Aurora:** rojo oscuro, crema y dorado; pizzas, pastas, entradas, bebidas, postres y combos.
- **Café Bruma:** oliva, beige y café; cafés calientes/fríos, panadería, desayunos, postres y bebidas especiales.
- **Bento Marea:** negro, rojo y blanco; sushi, ramen, arroces, entradas, bebidas y postres.

Cada menú incluye productos destacados y agotados, ocho productos con presentaciones y doce con extras. Los precios de presentaciones son precios finales; los extras son adicionales informativos. No hay pedidos ni cobros en línea.

Las imágenes son ilustraciones originales de demostración, generadas por `scripts/demo-catalog.mjs`, guardadas en `artifacts/demo/` y subidas mediante el flujo real de imágenes. No se reutilizaron fotografías ni marca de Crepes & Waffles.

## QR y publicación

**Todavía no existe un despliegue público en Render.** Las direcciones anteriores funcionan en el equipo que ejecuta la aplicación. Los archivos de la tabla son material de validación local y no acreditan QR públicos para teléfonos.

| Restaurante | Ruta canónica por token | Archivos de validación local |
| --- | --- | --- |
| Pizzería Aurora · DEMO | `/q/5820b231-3a31-43aa-a1ec-4f6f79ef2bb6` | [PNG](artifacts/qr/local-validation/aurora.png) · [SVG](artifacts/qr/local-validation/aurora.svg) · [PDF](artifacts/qr/local-validation/aurora.pdf) |
| Café Bruma · DEMO | `/q/5d236a67-793a-4a72-92f4-63abe20e8d95` | [PNG](artifacts/qr/local-validation/bruma.png) · [SVG](artifacts/qr/local-validation/bruma.svg) · [PDF](artifacts/qr/local-validation/bruma.pdf) |
| Bento Marea · DEMO | `/q/199258db-b193-4055-9f26-b1f3ea9ee1eb` | [PNG](artifacts/qr/local-validation/marea.png) · [SVG](artifacts/qr/local-validation/marea.svg) · [PDF](artifacts/qr/local-validation/marea.pdf) |

El token no depende del slug ni del dominio propio del restaurante. Las pruebas cambian y restauran el slug para comprobar que la ruta sigue resolviendo al mismo restaurante. Para publicar, configurar una URL HTTPS permanente de la plataforma en APP_URL, desplegar Render y descargar de nuevo los QR. El dominio canónico de la plataforma debe mantenerse. Después verificar HTTP público y escanear en dispositivos reales; esa comprobación no se ha realizado.

## Ejecución y evidencias

El cierre se verifica con `npm run build` y `npm run start -- --hostname 127.0.0.1 --port 3000` (producción local). Para desarrollo, desde esta carpeta con Node 22 y `.env.local` configurado, ejecutar `npm run dev -- --webpack`. El servidor usa el puerto 3000. La base y las imágenes permanecen en Supabase aunque se reinicie este proceso.

- Catálogo e identidades no secretas: `artifacts/demo/restaurants.json`.
- Provisionamiento real: `docs/evidence/demo-provisioning.json`.
- Auditoría de API/DB: `docs/evidence/live-audit.json`.
- Auditoría de navegador: `docs/evidence/live-browser-audit.json`.
- Verificaciones complementarias: `docs/evidence/live-gap-audit.json`.
- Persistencia tras reinicio: `docs/evidence/restart-persistence.json`.
- Capturas: `artifacts/screenshots/`.
- Informe completo: [AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md](AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md).

`scripts/provision-demos.mjs` permite reproducir el catálogo usando credenciales administrativas suministradas al proceso mediante AUDIT_ADMIN_EMAIL y AUDIT_ADMIN_PASSWORD. Comprueba el proyecto y la marca DEMO antes de reutilizar un registro. `scripts/run-live-audit.mjs` prueba y modifica temporalmente solo estas demos; no debe ejecutarse contra restaurantes de clientes. Los productos de carga CSV se crean en una categoría oculta y se retiran al terminar.
