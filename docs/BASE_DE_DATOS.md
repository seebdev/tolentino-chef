# Base de datos

La migración pertenece exclusivamente al proyecto nuevo Tolentino Restaurantes Admin. No aplicarla al restaurante original ni a un proyecto Supabase existente.

## Archivos y ejecución

- supabase/migrations/20261017021301_initial_tenant_security.sql: esquema, índices, RLS, Storage y RPC.
- supabase/config.toml: configuración local (CLI 2.75.0), PostgreSQL 17, registro deshabilitado, JWT de 15 minutos.
- supabase/seed.sql: sin usuarios ni contraseñas.
- tests/database.test.ts: migración real ejecutada en PostgreSQL PGlite.

Ejecutar npm run test:database. PGlite comprueba SQL y RLS; los esquemas Auth y Storage son sustitutos mínimos y no prueban sus servicios HTTP. La integración completa requiere un proyecto nuevo de Supabase. No se aplicaron migraciones remotas ni se tocó el proyecto original.

## Modelo

| Tabla                  | Función                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| restaurants            | Negocio, estado, COP por defecto, idioma, slug único, token UUID inmutable, menu_version.              |
| restaurant_memberships | Un dueño por negocio y un negocio por usuario; PK restaurant_id, user_id único, role=owner, is_active. |
| platform_admins        | Rol administrativo asignado por servidor; lectura propia.                                              |
| restaurant_settings    | Apariencia publicada, borrador, idiomas, mensaje de suspensión.                                        |
| categories             | Árbol, orden, visibilidad; nombre normalizado único por negocio.                                       |
| products               | Categoría obligatoria, contenido, precio, SKU único por negocio, flags y opciones.                     |
| promotions             | Título, contenido, fechas y actividad.                                                                 |
| restaurant_hours       | UUID por fila; una fila por día (0=domingo). Cierre anterior a apertura representa horario nocturno.   |
| translations           | Entidad e idioma; FKs compuestas generadas impiden referencias ajenas.                                 |
| restaurant_qr_configs  | Colores, marco, texto y logo; URL basada en token estable.                                             |
| restaurant_domains     | Hostname, token DNS, estado y fecha verificada.                                                        |
| commercial_sales       | Una venta comercial del servicio por restaurante; no representa pedidos.                               |
| security_audit_events  | Actor, restaurante, acción y metadatos mínimos.                                                        |
| visit_events           | Contadores diarios visits y qr_scans, sin IP ni identificadores personales.                            |
| platform_settings      | Una fila id=true con contacto opcional, etiqueta y mensaje global de suspensión (1–500 caracteres).    |
| private.rate_limits    | Contadores compartidos entre instancias.                                                               |

Variantes y extras son JSONB con valor array. Apariencia: primary, secondary, font, logo_path, cover_path, favicon_path. Defaults: #244b3b, #efe8dc, serif y rutas nulas. Idiomas: es, en, fr, it, zh, ja, hi.

Storage: bucket privado restaurant-media, máximo 5 MiB, ruta <restaurant UUID>/<asset UUID>.webp (o jpg, jpeg, png, avif). El backend debe validar bytes y recodificar.

## Permisos

Anon no lee tablas. Dueño activo lee solo su restaurante y edita menú/configuración. En restaurants solo puede modificar name, description, phone, currency y default_language. QR y dominios son de lectura; ventas y auditoría solo servidor.

Suspensión bloquea contenido y archivos; conserva lectura del estado. Membresía inactiva conserva solo su propia fila de membresía. Un administrador autenticado no tiene bypass global por RLS: el servidor verifica su rol antes de usar la clave secreta. Las consultas privilegiadas siempre deben fijar restaurant_id.

## RPC

- provision_restaurant: servicio. Requeridos p_id, p_owner_id, p_name, p_slug, p_owner_name, p_owner_email. Opcionales p_phone='', p_currency='COP', p_default_language='es', p_sale_amount=0, p_sale_currency='COP', p_sale_notes='', p_description='', p_status='active', p_sold_at=now(). Crea negocio, membresía, settings, QR, siete horarios y venta de forma atómica. Fecha nula se normaliza a now(). Devuelve UUID.
- update_restaurant: servicio. p_id, p_data objeto de campos permitidos, p_sale objeto opcional. Datos: name, slug, description, owner_name, phone, currency, default_language, status. Venta: sold_at, amount, currency, notes. Excluye owner_email. Edición conjunta transaccional.
- save_restaurant_languages: autenticado bajo RLS o servicio. p_restaurant_id, p_default_language, p_enabled_languages. El idioma principal debe estar habilitado; ambas tablas se actualizan en una transacción.
- import_products: dueño bajo RLS o servicio, negocio activo. p_restaurant_id, p_rows (1–1000 filas), p_mode skip/update, p_create_categories booleano. Filas requieren name, category (nombre) y price; opcionales sku, description, image_path, tags, ingredients, variants, extras y flags/orden. Si la fila tiene SKU, se busca únicamente ese código exacto y sensible a mayúsculas. Sin SKU, se busca el nombre sin espacios exteriores y sin distinguir mayúsculas dentro de la misma categoría. Se conservan los acentos. Si la búsqueda sin SKU apunta a varios registros, se rechaza todo el lote. Campos omitidos preservados en update. Devuelve inserted, updated, skipped, categories_created.
- consume_rate_limit: servicio. p_key, p_limit (1–100000), p_window_seconds (1–86400). Contador atómico y compartido; devuelve booleano. Purgar claves vencidas periódicamente.
- record_menu_visit: servicio. p_restaurant_id, p_day=current_date, p_is_qr=false. Solo incrementa negocios activos, rechaza fechas distintas al día del servidor.

Auth y Postgres no comparten transacción. Crear primero usuario Auth y compensar su eliminación si falla provision_restaurant; registrar cualquier fallo de compensación.

## Caché y suspensión

Cambios de contenido incrementan menu_version. El cliente no puede asignarla. Cachear por (restaurant_id, menu_version), leyendo estado fresco en cada petición pública e imagen. No emitir URLs firmadas de larga vida si se requiere suspensión inmediata.

## Primer administrador

Crear un usuario Auth en el proyecto nuevo y asignar su UUID desde SQL administrativo:

```sql
insert into public.platform_admins(user_id,is_active)
values ('UUID-DEL-USUARIO-ADMIN',true);
```

Nunca hacerlo desde formularios públicos. No hay credenciales ni administradores preasignados en la migración.

## Referencias

Documentación consultada el 16 de octubre de 2026: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage](https://supabase.com/docs/guides/storage/security/access-control), [Changelog](https://supabase.com/changelog).

## Estadísticas y carga verificadas

admin_stats() es RPC de servicio y devuelve total, active, suspended, products, publishedProducts, qr_generated, visits, scans, issues y sales_by_currency (array con currency, total y count).

restaurant_stats(p_restaurant_id) permite dueño autenticado bajo RLS o servicio. Devuelve products, published, categories, visits y scans. Agrega en PostgreSQL para evitar truncar el resultado al límite REST de 1000 filas. La prueba usa 1500 días del restaurante A y datos independientes de B.

La invalidación del menú se consolida una vez por transacción mediante menu_version_transaction, no editable por el dueño. Las transacciones no publican cambios parciales: incrementar una sola vez conserva la corrección de caché y evita actualizar mil veces la fila del restaurante en una importación.

Medición final del 2026-10-16 21:56:35 (America/Bogota), Node v22.23.3, PostgreSQL PGlite. 35 pruebas SQL aprobadas. Otros 7 casos prueban el handler administrativo con mocks de Auth/base de datos, sin red. Evidencia conservada en `evidence/database-benchmarks.json`.

| Filas CSV | Tiempo de la RPC | Resultado                 |
| --------- | ---------------- | ------------------------- |
| 1         | 7 ms             | Inserción completa        |
| 100       | 178 ms           | Inserción completa        |
| 999       | 1570 ms          | Inserción completa        |
| 1000      | 1624 ms          | Inserción completa        |
| 1001      | 7 ms             | Rechazo antes de insertar |

Son mediciones locales de SQL ejecutado con rol de dueño y RLS; no incluyen red, API web ni el servicio remoto de Supabase. Cada ejecución genera test-results/database-benchmarks.json. Nombres normalizados almacenados como columnas generadas e indexadas evitan repetir expresiones durante búsquedas de duplicados.

El acceso del dueño a lectura y descarga del QR se deniega mientras el restaurante está suspendido. El superadministrador puede abrir soporte y consultar el QR. El mensaje global de suspensión se consulta fuera de la caché; el contacto nulo desactiva el enlace comercial.
