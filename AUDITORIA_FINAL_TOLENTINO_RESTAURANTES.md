# Auditoría final — Tolentino Restaurantes Admin

> Actualización del 18 de octubre de 2026 (UTC): esta auditoría conserva los resultados históricos del proyecto anterior. El destino vigente es `hgntppemxwcxaxritnfq`; su migración real, registro público desactivado y nuevas pruebas se documentan en [MIGRATION_STATUS.md](docs/MIGRATION_STATUS.md). Las cifras y pendientes históricos siguientes no sustituyen ese estado. Render todavía no está publicado.

**Fecha:** 17 de octubre de 2026.

**Estado de este documento:** auditoría funcional y controles de entrega cerrados con evidencias. Los bloqueos externos se enumeran por separado.

**Proyecto auditado:** tolentino-restaurantes-admin. El proyecto original de Crepes & Waffles se conservó como referencia de solo lectura.

## 1. Resumen ejecutivo

La creación de restaurantes se corrigió en frontend, backend y PostgreSQL. La aplicación local está conectada al proyecto Supabase autorizado y el manifiesto de provisión ya registra tres restaurantes DEMO, tres propietarios diferentes y 24 productos por restaurante. La suite automatizada actual tiene **201 pruebas aprobadas y cero fallidas**, distribuidas en 12 archivos. Esta cifra incluye pruebas unitarias, handlers con servicios simulados y SQL real ejecutado en PGlite; no equivale a 201 recorridos contra Supabase alojado.

La auditoría real de API/Auth/DB/Storage cerró con 84/84 comprobaciones aprobadas, la ampliación administrativa con 10/10 y los recorridos complementarios con 19/19: 113 comprobaciones reales entre esos tres grupos. Se validaron seis direcciones de acceso cruzado entre los tres propietarios, CRUD, persistencia después de cerrar e iniciar sesión, suspensiones, replay de creación y CSV de hasta 1.000 filas. La interfaz con fixtures cerró 48 casos en Chrome y 47 en Edge, incluida tableta y una regresión adicional de Apariencia en tres anchos. Además se ejecutaron 24 escenarios reales de navegador, con 372 comprobaciones aprobadas. Estos grupos tienen alcances distintos y no se suman como una única suite.

La entrega todavía no se considera validada para producción. El usuario confirmó que la aplicación no está desplegada: no hay una URL pública de menú acreditada ni QR comerciales independientes de localhost. Los nueve archivos QR pasan decodificación local. Las 96 traducciones inglesas completas ya se verificaron por API privada y pública. El build de producción actual, typecheck y lint pasaron; next start local sirve health 200 y favicon 200. El recorrido real sin fixtures cerró con 24/24 escenarios y 372/372 comprobaciones; los 19 recorridos complementarios pasaron y los hashes privados/públicos de las tres DEMO son iguales después de reiniciar en un proceso nuevo. El smoke final de producción local también pasó. Las 18 capturas finales y sus 54 comprobaciones pasaron; el escaneo del índice Git también terminó sin hallazgos. SMTP, DNS, Render, backup, carga y escaneo físico siguen sin verificación externa.

| Hallazgo | Resultado comprobado |
| --- | --- |
| Respuesta 409 indiscriminada ante cualquier fallo de Auth | Corregida: sólo conflictos reales devuelven 409; validación, límites y fallos de servicio tienen respuestas distintas. |
| Dos envíos de creación antes de actualizar el estado React | Reproducidos como dos POST; bloqueo síncrono en UI y clave persistente de idempotencia en servidor. |
| Guardado de apariencia antes de validar datos | Reproducido y corregido; entradas inválidas no producen escrituras. |
| Registro inexistente convertido en error 500 | Corregido a 404 con prueba de regresión. |
| Referencia a imagen de otro restaurante convertida en 500 | Corregida a 400, antes de persistir. |
| Exportación del catálogo actual | Añadida y probada con paginación, aislamiento, UTF-8 y protección ante fórmulas. |
| Correos a datos DEMO | Creación, restablecimiento administrativo y recuperación omiten el envío a dominios .test; comprobado también por API real. |
| Aislamiento y persistencia reales | Seis parejas dirigidas API/RLS/Storage denegadas; tres DEMO conservan 24 productos y hashes privados/públicos iguales tras reiniciar producción en otro proceso. |
| Apariencia desbordaba el ancho disponible | Reproducido a 1440 píxeles; CSS del input de archivo corregido y una regresión pasa a 1440/820/390. |
| Despliegue automático esperaba checks inexistentes | Blueprint cambiado a commit; build conserva tipos, lint, tests y compilación. No se ejecutó despliegue público. |
| Cierre de sesión revocaba otras sesiones | Cambiado a cierre local; cubierto por regresión. |
| Registro público en Supabase | **FALLA de configuración pendiente:** la consulta real devuelve registro habilitado. |
| Producción, SMTP, restauración y escaneo físico | **NO VERIFICADO**; no se presentan como resultados aprobados. |

El original permanece sin cambios: la comparación de 1.803 archivos registró cero modificaciones, ausencias o incorporaciones. Evidencia: [comparación de referencia](docs/evidence/reference-verification-20261017.json).

La arquitectura inspeccionada usa Next.js 16.4.2 App Router, React 19.3.1, TypeScript 6.0.3 y Node 22.23.3; Supabase JS 2.118.0 y SSR 0.12.7 acceden a PostgreSQL, Auth y Storage sin ORM adicional. El frontend se encuentra en src/components; las rutas y handlers en src/app; la lógica compartida en src/lib; SQL en supabase/migrations y pruebas en tests. El menú es informativo: no incorpora pedidos, pagos, suscripciones ni planes diferenciados. Hay un propietario por restaurante y una sola entidad de sucursal.

Resumen estructurado de entrega: [final-summary.json](docs/evidence/final-summary.json).

Fuentes principales: [inventario de arquitectura y 119 funciones](docs/AUDITORIA_INVENTARIO_20261017.md), [inventario estructurado](docs/evidence/audit-inventory-20261017.json), [suite de 201 pruebas](docs/evidence/unit-tests-final-20261017.json) y [provisión DEMO](docs/evidence/demo-provisioning.json).

## 2. Error HTTP 409

### Causa y alcance de la evidencia

**La causa exacta de los dos errores de la captura original sigue indeterminada.** La captura no contiene el cuerpo enviado ni la respuesta del servidor. No permite concluir si se repitió un correo, un slug o un fallo de infraestructura.

Se reprodujo de forma controlada un conflicto verdadero usando el correo de una cuenta administrativa ya existente, sin registrar ese correo en el reporte. Dos llamadas al endpoint original devolvieron 409 y dejaron cero restaurantes. Esto demuestra el comportamiento del caso ensayado, no identifica retrospectivamente el contenido de la captura. Evidencia: [reproducción anterior a la corrección](docs/evidence/409-before-fix.json).

Además se verificaron dos defectos independientes:

1. En src/app/api/admin/restaurants/route.ts, cualquier error de auth.admin.createUser se convertía en 409 con el mismo mensaje de correo duplicado. Una caída de Auth, permisos de servicio, correo inválido o limitación de peticiones quedaban mal clasificados.
2. El formulario de src/components/admin-app.tsx usaba estado React y botón deshabilitado, pero no un bloqueo síncrono previo al envío. Dos eventos submit seguidos generaban dos POST antes del siguiente render. La prueba de navegador esperaba una solicitud y recibió dos. No se encontró un doble onClick/onSubmit ni reintento automático de fetch; tampoco se acreditó que React Strict Mode duplicara el evento de envío. Evidencia: [reproducción UI](docs/evidence/audit-ui-before.json).

### Corrección

El formulario conserva un requestId UUID por intento y payload. Un reintento después de una respuesta incierta usa la misma clave; cambiar los datos genera otra. Una referencia síncrona bloquea el segundo submit inmediato. La respuesta 202 mantiene abierto el formulario para reintentar el mismo intento.

El helper [src/lib/create-restaurant.ts](src/lib/create-restaurant.ts) coordina la operación con tres RPC de servicio y una tabla privada de intentos. PostgreSQL reserva los identificadores de propietario y restaurante antes de llamar Auth. Un arrendamiento temporal y un identificador de ejecución impiden que un proceso antiguo finalice o compense el trabajo de otro. El hash del payload detecta el uso de una clave con datos distintos.

La provisión del restaurante, membresía, ajustes, QR, siete horarios, venta inicial, auditoría y respuesta completada ocurre en una transacción SQL. Auth es un servicio separado: después de un fallo SQL definitivo se persiste primero la decisión de compensar y se elimina únicamente la cuenta reservada que coincide con los marcadores de aplicación del intento. Un timeout de resultado incierto consulta el estado persistido; no dispara una eliminación a ciegas. Los fallos de limpieza quedan recuperables.

| Caso | Respuesta actual |
| --- | --- |
| Creación válida | 201 con identificador del restaurante. |
| Reintento del mismo intento completado | 201, mismo restaurante, replayed true, sin nuevo usuario ni correo. |
| Otro proceso sigue ejecutando el intento | 202, REQUEST_IN_PROGRESS. |
| Correo existente o slug ocupado | 409 y campo/mensaje específico. |
| Misma clave con otro payload | 409, IDEMPOTENCY_KEY_REUSED. |
| Correo o datos inválidos | 400. |
| Límite de Auth | 429. |
| Auth o provisión temporalmente indisponibles | 503; conserva el intento para reintento seguro. |
| Fallo del correo después de crear | 201, invitationSent false; el restaurante se conserva. |

### Pruebas y resultado

Las 23 regresiones del handler prueban errores diferenciados, envíos concurrentes, replay, respuestas perdidas de Auth y SQL, compensación y datos comerciales. Las 43 pruebas PGlite incluyen ocho nuevas para permisos de RPC, exclusión de procesos antiguos, transacción completa, rollback tardío, limpieza persistida y modo DEMO. La creación de Pizzería Aurora se hizo desde navegador real y las de Bruma y Marea por la API real, según el manifiesto de provisión; la auditoría real posterior confirmó replay concurrente, tres restaurantes en total, cero cuentas huérfanas y 409 para conflictos verdaderos de correo y slug. Evidencia adicional: [live-audit.json](docs/evidence/live-audit.json).

Evidencias: [regresiones de creación](docs/evidence/creation-regression-tests.json), [migración remota](docs/evidence/creation-migration-verification.json), [suite actual](docs/evidence/unit-tests-final-20261017.json) y [provisión de los tres DEMO](docs/evidence/demo-provisioning.json).

## 3. Restaurantes creados

Los siguientes datos proceden del manifiesto saneado de provisión real y de las consultas finales de la auditoría, no de fixtures. Los correos son identidades sintéticas reservadas .test; no se enviaron comunicaciones externas. Cada restaurante conserva 24 productos, seis categorías principales y dos subcategorías después de retirar los registros temporales de QA.

| Restaurante | Identificador | Propietario DEMO | Estado | URL pública | Productos | QR generado | QR validado | Estado de pruebas |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| Pizzería Aurora · DEMO | 1932e721-78ab-4320-9f84-f186a80fba48 | aurora@tolentino-demo.test | Activo; is_demo true | No disponible; ruta local /menu/pizzeria-aurora-demo | 24 | PNG/SVG/PDF | 3/3 decodificados localmente | Creado desde UI real; Auth/API/RLS/Storage/CRUD/QR local y navegador real Chrome/Edge aprobados; persistencia tras reinicio verificada. Capturas finales Chrome/Edge revisadas. |
| Café Bruma · DEMO | eca7481c-fc27-479c-b364-76274b0b4230 | bruma@tolentino-demo.test | Activo; is_demo true | No disponible; ruta local /menu/cafe-bruma-demo | 24 | PNG/SVG/PDF | 3/3 decodificados localmente | Creado mediante API real; Auth/API/RLS/Storage/CRUD/QR local y navegador real Chrome/Edge aprobados; persistencia tras reinicio verificada. Capturas finales Chrome/Edge revisadas. |
| Bento Marea · DEMO | e2cda10d-2771-4056-8cf0-13e00f4b1bd8 | marea@tolentino-demo.test | Activo; is_demo true | No disponible; ruta local /menu/bento-marea-demo | 24 | PNG/SVG/PDF | 3/3 decodificados localmente | Creado mediante API real; Auth/API/RLS/Storage/CRUD/QR local y navegador real Chrome/Edge aprobados; persistencia tras reinicio verificada. Capturas finales Chrome/Edge revisadas. |

Se generaron ilustraciones propias de demostración y se renderizaron a imágenes raster; no se incorporaron fotografías de terceros. Logo, portada y favicon usan recursos propios bajo el prefijo de cada restaurante. La API pública real verificó 24 productos, ocho categorías, seis imágenes distintas de catálogo, variantes, extras, productos agotados, promociones y siete horarios por restaurante. Español e inglés están habilitados y las 96 traducciones inglesas completas (72 productos con nombre/descripción y 24 categorías) se comprobaron en las APIs del propietario y pública. Los 18 escenarios públicos y seis de propietarios en Chrome/Edge aprobaron el recorrido real; las tres portadas finales ya usan ilustración propia sin texto incrustado, manteniendo la identidad como texto accesible del DOM; las 18 capturas finales pasaron revisión visual y 54 comprobaciones automatizadas. Evidencias: [provisión](docs/evidence/demo-provisioning.json), [auditoría real](docs/evidence/live-audit.json), [live-browser-audit.json](docs/evidence/live-browser-audit.json) y [QR](docs/evidence/demo-qr-decoding.json).

Evidencia: [demo-provisioning.json](docs/evidence/demo-provisioning.json). Las instrucciones de acceso se entregan separadamente en RESTAURANTES_DEMO.md; este informe no incluye contraseñas ni credenciales.

Las capturas finales se tomaron después de publicar las portadas sin texto incrustado y de reiniciar el servidor de producción local. **18/18 capturas y 54/54 comprobaciones automáticas aprobadas**, sin errores inesperados. Dos agentes inspeccionaron visualmente las nueve capturas Chrome y las nueve Edge; no encontraron defectos visibles de composición, precios ocultos ni solapamientos. Es revisión por agentes de IA, no certificación humana ni WCAG. Los archivos, dimensiones y SHA256 están en [revisión visual](docs/evidence/live-browser-visual-review.json); el registro de captura es [capturas finales](docs/evidence/live-browser-screenshots.json).

| Restaurante | Chrome: móvil / tableta / escritorio | Edge: móvil / tableta / escritorio |
| --- | --- | --- |
| Aurora | [Móvil](artifacts/screenshots/real-aurora-mobile.png) / [Tableta](artifacts/screenshots/real-aurora-tablet.png) / [Escritorio](artifacts/screenshots/real-aurora-desktop.png) | [Móvil](artifacts/screenshots/real-aurora-mobile-msedge.png) / [Tableta](artifacts/screenshots/real-aurora-tablet-msedge.png) / [Escritorio](artifacts/screenshots/real-aurora-desktop-msedge.png) |
| Bruma | [Móvil](artifacts/screenshots/real-bruma-mobile.png) / [Tableta](artifacts/screenshots/real-bruma-tablet.png) / [Escritorio](artifacts/screenshots/real-bruma-desktop.png) | [Móvil](artifacts/screenshots/real-bruma-mobile-msedge.png) / [Tableta](artifacts/screenshots/real-bruma-tablet-msedge.png) / [Escritorio](artifacts/screenshots/real-bruma-desktop-msedge.png) |
| Marea | [Móvil](artifacts/screenshots/real-marea-mobile.png) / [Tableta](artifacts/screenshots/real-marea-tablet.png) / [Escritorio](artifacts/screenshots/real-marea-desktop.png) | [Móvil](artifacts/screenshots/real-marea-mobile-msedge.png) / [Tableta](artifacts/screenshots/real-marea-tablet-msedge.png) / [Escritorio](artifacts/screenshots/real-marea-desktop-msedge.png) |

## 4. Matriz funcional

Estados: **FUNCIONA**, **CORREGIDO Y VERIFICADO**, **FALLA**, **NO IMPLEMENTADO** y **NO VERIFICADO**. FUNCIONA significa que pasó la evidencia indicada, con su alcance explícito; una prueba con mocks no acredita funcionamiento remoto. NO IMPLEMENTADO distingue funciones ausentes o deliberadamente fuera del producto, como pedidos y pagos.

Se conserva la cobertura de 119 filas del inventario base, actualizando sólo las filas respaldadas por evidencia posterior. Las validaciones de navegador con APIs interceptadas se identifican como fixtures. Se incorporan 84 comprobaciones reales de API/Auth/PostgreSQL/Storage, 10 administrativas, 19 complementarias, 24 escenarios de navegador con 372 comprobaciones y una pasada final de 18 capturas/54 comprobaciones. La etiqueta NO VERIFICADO se conserva para los alcances que aún no tienen prueba final, aunque otra parte de la misma función sí haya pasado.

<!-- AUDIT_MATRIX_START -->

### Superadministración

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F001. Inicio de sesión superadministrador | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Sesión administrativa real; listado, búsqueda, métricas y contexto de soporte aprobados. La salida de soporte y los ajustes globales también pasan en navegador real mediante el runner complementario. |
| F002. Cierre de sesión | CORREGIDO Y VERIFICADO | [tests/auth_routes.test.ts](tests/auth_routes.test.ts); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Logout scope local probado en handler; los tres propietarios cierran sesión, reingresan y conservan datos por API. No revoca las demás sesiones. |
| F003. Panel, listado, búsqueda, paginación y métricas | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Sesión administrativa real; listado, búsqueda, métricas y contexto de soporte aprobados. Los recorridos complementarios reales de soporte y ajustes globales también pasaron. |
| F004. Crear restaurante desde interfaz y API / diagnóstico 409 | CORREGIDO Y VERIFICADO | [src/lib/create-restaurant.ts](src/lib/create-restaurant.ts); [docs/evidence/demo-provisioning.json](docs/evidence/demo-provisioning.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Tres DEMO creadas por UI/API reales; clasificación de errores corregida; conflictos verdaderos conservan 409. La causa exacta de la captura sin payload permanece indeterminada. |
| F005. Doble envío e idempotencia de creación | CORREGIDO Y VERIFICADO | [docs/evidence/audit-ui-before.json](docs/evidence/audit-ui-before.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json); [tests/database.test.ts](tests/database.test.ts); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Doble POST reproducido y bloqueado; dos replay concurrentes reales conservaron tres restaurantes y cero cuentas huérfanas. Solicitud pendiente 202 y payload distinto con misma clave 409 cubiertos además en handler. |
| F006. Consultar y editar restaurante | CORREGIDO Y VERIFICADO | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/admin_routes.test.ts](tests/admin_routes.test.ts) | Edición real de nota comercial sin cambiar propietario; handler preserva campos de venta omitidos y valida email protegido. Registro inexistente real devuelve 404. |
| F007. Suspender restaurante | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Suspensión/reactivación real de restaurante y propietario en las tres demos, con sesión existente y QR estable. Se restituyó el estado activo al terminar. |
| F008. Reactivar restaurante | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Suspensión/reactivación real de restaurante y propietario en las tres demos, con sesión existente y QR estable. Se restituyó el estado activo al terminar. |
| F009. Crear propietario distinto por restaurante | FUNCIONA | [docs/evidence/demo-provisioning.json](docs/evidence/demo-provisioning.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Tres usuarios Auth diferentes con asignación única; login real de cada propietario correcto. Sin correos externos ni contraseñas en documentos. |
| F010. Suspender/reactivar acceso de propietario | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Suspensión/reactivación real de restaurante y propietario en las tres demos, con sesión existente y QR estable. Se restituyó el estado activo al terminar. |
| F011. Restablecer acceso y entrega de correo | NO VERIFICADO | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/auth_routes.test.ts](tests/auth_routes.test.ts) | El bloqueo de correo DEMO y la respuesta genérica de recuperación sí pasan por API real. Entrega de correo a un destinatario real autorizado y SMTP no verificados. |
| F012. Edición integral en modo soporte | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json) | El superadmin accede al workspace ajeno autorizado, copia apariencia y cambia/restaura una imagen publicada. La salida visual de soporte pasa en escritorio y móvil, con identidad administrativa intacta. |
| F013. Salida del modo soporte | FUNCIONA | [live-gap-audit.json](docs/evidence/live-gap-audit.json) | Salida real de soporte en escritorio y móvil devuelve al panel, retira el banner y conserva la identidad autenticada y el rol superadmin. |
| F014. Contacto comercial y mensaje de suspensión | FUNCIONA | [live-gap-audit.json](docs/evidence/live-gap-audit.json) | Formulario admin guarda contacto y mensaje global reales; la suspensión temporal muestra el mensaje en API/UI. La configuración original y estados se restauraron y verificaron. |
| F015. Copiar diseño entre restaurantes | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json) | Copia real de apariencia excluye imágenes ajenas y conserva el catálogo; selección explícita probada en UI. No copia productos, propietario ni identidad. |
| F016. Persistencia después de recarga y reingreso | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [restart-persistence.json](docs/evidence/restart-persistence.json) | Recarga, logout, rechazo anónimo y nuevo login conservan snapshots de catálogo. Tras detener producción y arrancar otro proceso, los SHA256 de registros privados y payload público coinciden para las tres DEMO. |
| F017. Protección de funciones exclusivas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Tres sesiones Auth reales: funciones exclusivas denegadas, seis direcciones de acceso cruzado bloqueadas, cuentas suspendidas sin negocio. Pruebas adicionales de lógica con mocks se identifican en su suite. |

### Propietario y catálogo

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F018. Inicio y panel del propietario | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [live-audit.json](docs/evidence/live-audit.json) | Seis escenarios de propietario (tres restaurantes por Chrome/Edge) verifican login, sesión ligada al restaurante, nueve pestañas, descargas, vista previa y reingreso. |
| F019. Editar nombre y descripción | CORREGIDO Y VERIFICADO | [docs/evidence/workspace-validation-before.json](docs/evidence/workspace-validation-before.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Tres ensayos reales de apariencia inválida confirman ausencia de guardado parcial; entradas válidas se usan en provisión. No se afirma que todas las operaciones del workspace sean una única transacción. |
| F020. Logo, portada y favicon | FUNCIONA | [demo-provisioning.json](docs/evidence/demo-provisioning.json); [live-audit.json](docs/evidence/live-audit.json); [live-browser-audit.json](docs/evidence/live-browser-audit.json) | Guardado y publicación reales de apariencia; logos, portada, favicon, colores/fuentes y vista previa comprobados en navegador. Borrador sólo de apariencia, no integral de precios/nombre. Portadas finales publicadas con ilustración propia sin texto incrustado; capturas finales Chrome/Edge revisadas. |
| F021. Colores y fuentes | FUNCIONA | [demo-provisioning.json](docs/evidence/demo-provisioning.json); [live-audit.json](docs/evidence/live-audit.json); [live-browser-audit.json](docs/evidence/live-browser-audit.json) | Guardado y publicación reales de apariencia; logos, portada, favicon, colores/fuentes y vista previa comprobados en navegador. Borrador sólo de apariencia, no integral de precios/nombre. Portadas finales publicadas con ilustración propia sin texto incrustado; capturas finales Chrome/Edge revisadas. |
| F022. Borrador, vista previa y publicación | FUNCIONA | [demo-provisioning.json](docs/evidence/demo-provisioning.json); [live-audit.json](docs/evidence/live-audit.json); [live-browser-audit.json](docs/evidence/live-browser-audit.json) | Guardado y publicación reales de apariencia; logos, portada, favicon, colores/fuentes y vista previa comprobados en navegador. Borrador sólo de apariencia, no integral de precios/nombre. Portadas finales publicadas con ilustración propia sin texto incrustado; capturas finales Chrome/Edge revisadas. |
| F023. Horarios semanales | FUNCIONA | [docs/evidence/demo-provisioning.json](docs/evidence/demo-provisioning.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Se guardan siete horarios por API y el menú público real devuelve siete por restaurante, incluido un día cerrado. Un intervalo por día; sin horarios partidos. |
| F024. Categorías y subcategorías | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | CRUD real de categoría y subcategoría, modificación de orden y eliminación de registros QA en los tres tenants. FK compuestas y ciclos además cubiertos por PGlite. |
| F025. Crear, consultar y editar productos | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | CRUD real de producto, precio y disponibilidad se refleja en menú público; eliminación restaura catálogo; precio inválido y registro inexistente se rechazan. Se conservan 24 productos por DEMO al cerrar. |
| F026. Eliminar productos y categorías | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | CRUD real de producto, precio y disponibilidad se refleja en menú público; eliminación restaura catálogo; precio inválido y registro inexistente se rechazan. Se conservan 24 productos por DEMO al cerrar. |
| F027. Duplicar producto | FUNCIONA | [live-gap-audit.json](docs/evidence/live-gap-audit.json) | Duplicación real en cada DEMO genera borrador sin SKU, conserva variantes/extras y deja el original intacto. Copias QA eliminadas; catálogo final igual al snapshot original. |
| F028. Precios y moneda | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | CRUD real de producto, precio y disponibilidad se refleja en menú público; eliminación restaura catálogo; precio inválido y registro inexistente se rechazan. Se conservan 24 productos por DEMO al cerrar. |
| F029. Variantes, tamaños y extras | CORREGIDO Y VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json) | Variantes, extras e ingredientes se prueban con API real y UI informativa; precios inválidos no se envían desde el formulario. No generan pedidos ni cobros. |
| F030. Ingredientes y etiquetas | CORREGIDO Y VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json) | Variantes, extras e ingredientes se prueban con API real y UI informativa; precios inválidos no se envían desde el formulario. No generan pedidos ni cobros. |
| F031. Disponibilidad y agotados | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | CRUD real de producto, precio y disponibilidad se refleja en menú público; eliminación restaura catálogo; precio inválido y registro inexistente se rechazan. Se conservan 24 productos por DEMO al cerrar. |
| F032. Reordenar productos/categorías | FUNCIONA | [live-gap-audit.json](docs/evidence/live-gap-audit.json); [live-audit.json](docs/evidence/live-audit.json) | Orden de productos y categorías principales persiste y cambia la presentación pública; jerarquía de subcategorías preservada. Orden y catálogos restaurados en las tres DEMO. |
| F033. Promociones y fechas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/public_security.test.ts](tests/public_security.test.ts) | CRUD real de promociones y presencia en menú público; reglas de fechas/filtro temporal además probadas localmente. Promociones informativas, sin cálculo de checkout. |
| F034. Idiomas y traducciones manuales | FUNCIONA | [demo-english-translations.json](docs/evidence/demo-english-translations.json); [live-browser-audit.json](docs/evidence/live-browser-audit.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json) | 96 traducciones inglesas verificadas por API y renderizadas en el navegador real. Siete idiomas soportados con fallback; DEMO traducidas y habilitadas sólo en español/inglés. |
| F035. Descargas QR del propietario | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json) | Los seis escenarios de propietario descargan PNG/SVG/PDF reales y decodifican PNG a la ruta estable. Los nueve archivos finales pasan decodificación independiente. QR con origen local; configuración reservada a superadmin. |
| F036. Denegación de contexto ajeno y cuentas suspendidas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Tres sesiones Auth reales: funciones exclusivas denegadas, seis direcciones de acceso cruzado bloqueadas, cuentas suspendidas sin negocio. Pruebas adicionales de lógica con mocks se identifican en su suite. |

### CSV

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F037. Parsear 1 productos UTF-8 | FUNCIONA | [tests/csv.test.ts](tests/csv.test.ts) | Parser real ejecutado con 1 filas. No es una escritura remota. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F038. Parsear 100 productos UTF-8 | FUNCIONA | [tests/csv.test.ts](tests/csv.test.ts) | Parser real ejecutado con 100 filas. No es una escritura remota. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F039. Parsear 999 productos UTF-8 | FUNCIONA | [tests/csv.test.ts](tests/csv.test.ts) | Parser real ejecutado con 999 filas. No es una escritura remota. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F040. Parsear 1000 productos UTF-8 | FUNCIONA | [tests/csv.test.ts](tests/csv.test.ts) | Parser real ejecutado con 1000 filas. No es una escritura remota. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F041. Importar 10 productos en DB real | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Importaciones contra Supabase real de 1, 10, 100, 500 y 1.000 filas, con commit y repetición en skip sin duplicados. Registros de carga en categoría oculta propia de QA y eliminados al finalizar. |
| F042. Importar 500 productos en DB real | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Importaciones contra Supabase real de 1, 10, 100, 500 y 1.000 filas, con commit y repetición en skip sin duplicados. Registros de carga en categoría oculta propia de QA y eliminados al finalizar. |
| F043. Importación real de 1/100/1.000 productos | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Importaciones contra Supabase real de 1, 10, 100, 500 y 1.000 filas, con commit y repetición en skip sin duplicados. Registros de carga en categoría oculta propia de QA y eliminados al finalizar. |
| F044. Previsualizar, mapear columnas y confirmar | FUNCIONA | [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json); [tests/e2e/ui.spec.ts](tests/e2e/ui.spec.ts) | UI real de previsualización, mapeo y confirmación pasa en Chrome/Edge con respuestas de negocio interceptadas. Las escrituras reales CSV se acreditan aparte en live-audit.json. |
| F045. Omitir o actualizar existentes sin duplicados | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/database.test.ts](tests/database.test.ts) | Skip real del mismo lote no crea duplicados; update e identidad SKU/nombre-categoría probados en SQL PGlite. Con SKU se usa exclusivamente SKU exacto; sin SKU, nombre/categoría normalizados. |
| F046. Rollback completo de lote inválido | FUNCIONA | [tests/database.test.ts](tests/database.test.ts) | Una fila inválida revierte categorías y productos del lote en PostgreSQL PGlite. Auditoría de importaciones contra Supabase real en curso. |
| F047. Rechazo de 1.001 filas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F048. Precios inválidos y ambiguos | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F049. Categoría inexistente sin autocreación | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F050. Duplicados dentro del archivo | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F051. Encabezados repetidos o faltantes | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F052. UTF-8 inválido y comillas corruptas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F053. Comas, saltos de línea y caracteres especiales | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F054. CSV completamente vacío | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/csv.test.ts](tests/csv.test.ts) | CSV real rechaza archivo vacío, encabezados incorrectos/faltantes, precio inválido, categoría inexistente, duplicados, comillas corruptas, UTF-8 inválido y 1.001 filas. El parser también prueba comas, saltos y caracteres especiales; no se atribuye una prueba de carga concurrente. |
| F055. Plantilla compatible conservada | FUNCIONA | [tests/import_export.test.ts](tests/import_export.test.ts) | GET sin query devuelve plantilla-productos.csv sin consultar catálogo. Contexto de acceso simulado. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F056. Exportar catálogo completo de su restaurante | CORREGIDO Y VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/import_export.test.ts](tests/import_export.test.ts) | Exportación real supera 1.000 registros y omite campos privados; pruebas de handler cubren catálogo vacío, fórmulas y2.505 filas paginadas. Cinco columnas; no es backup integral de imágenes, variantes o traducciones. |
| F057. Exportación vacía, privada y sin fórmulas ejecutables | CORREGIDO Y VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/import_export.test.ts](tests/import_export.test.ts) | Exportación real supera 1.000 registros y omite campos privados; pruebas de handler cubren catálogo vacío, fórmulas y2.505 filas paginadas. Cinco columnas; no es backup integral de imágenes, variantes o traducciones. |
| F058. Backup integral en CSV de imágenes/variantes/traducciones | NO IMPLEMENTADO | [src/app/api/workspace/[restaurantId]/import/route.ts](src/app/api/workspace/[restaurantId]/import/route.ts) | La exportación básica contiene nombre, precio, categoría, descripción y SKU. El CSV no sustituye un backup de base y Storage; un catálogo mayor de 1.000 filas debe dividirse para reimportarlo. |

### Menú público e interfaz

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F059. Acceso sin login a un menú activo | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [live-audit.json](docs/evidence/live-audit.json) | 18 escenarios públicos sin login: tres DEMO por tres anchos (390/768/1440) y dos navegadores; cada uno conserva 24 productos y ocho categorías. Origen local con Supabase real, sin URL pública acreditada. |
| F060. Categorías/subcategorías y búsqueda | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json) | Categorías/subcategorías, búsqueda y filtros funcionan en los menús reales en Chrome/Edge; los padres vacíos aparecen en navegación, no como secciones de contenido vacías. |
| F061. Fotografías, descripciones y precios | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Menú sin sesión con identidad correcta, 24 productos, ocho categorías, fotos, precios, agotados, variantes y extras para cada DEMO. HTTP local con persistencia Supabase real; no URL de producción. |
| F062. Variantes/extras visibles | CORREGIDO Y VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json) | Variantes, extras e ingredientes se prueban con API real y UI informativa; precios inválidos no se envían desde el formulario. No generan pedidos ni cobros. |
| F063. Productos agotados | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Menú sin sesión con identidad correcta, 24 productos, ocho categorías, fotos, precios, agotados, variantes y extras para cada DEMO. HTTP local con persistencia Supabase real; no URL de producción. |
| F064. Promociones vigentes | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/public_security.test.ts](tests/public_security.test.ts) | CRUD real de promociones y presencia en menú público; reglas de fechas/filtro temporal además probadas localmente. Promociones informativas, sin cálculo de checkout. |
| F065. Cambio de los siete idiomas | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [demo-english-translations.json](docs/evidence/demo-english-translations.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json) | Cambio español/inglés con traducciones persistidas renderizadas en los tres DEMO reales. Los siete selectores y fallback se prueban adicionalmente con fixtures; no hay catálogo traducido a los otros cinco idiomas. |
| F066. Identidad visual independiente | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [demo-provisioning.json](docs/evidence/demo-provisioning.json) | Tres identidades propias comprobadas en Chrome/Edge y 390/768/1440: Aurora italiana, Bruma café y Marea asiática, con colores e imágenes independientes. Portadas finales propias sin texto incrustado ya publicadas; capturas finales Chrome/Edge revisadas. |
| F067. Favoritos locales | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json) | Favoritos y su separación por restaurante comprobados en navegador real; se guardan localmente en el navegador, no como datos de Supabase. |
| F068. Enlace comercial/footer | FUNCIONA | [live-gap-audit.json](docs/evidence/live-gap-audit.json) | Contacto comercial configurado temporalmente aparece en los tres footers; al vaciar URL se oculta. No se abrió el destino externo. Configuración original restaurada. |
| F069. Estados vacíos, error y menú suspendido | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json); [tests/q_resolver.test.ts](tests/q_resolver.test.ts) | Suspensión real limita acceso; estados vacíos/error y token inexistente se prueban en UI/handler. No se confunde un fallo de métricas con la disponibilidad del menú. |
| F070. Móvil y escritorio | CORREGIDO Y VERIFICADO | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json); [Apariencia después](docs/evidence/audit-appearance-after.json) | 18 menús reales en 390/768/1440, más seis paneles owner, sin overflow final. UI con fixtures: 48 Chrome y 47 Edge; Apariencia corregida además a 1440/820/390. No se equipara emulación a teléfonos físicos. |
| F071. Tableta, Edge y Safari | NO VERIFICADO | [live-browser-audit.json](docs/evidence/live-browser-audit.json); [UI con fixtures](docs/evidence/audit-ui-consolidated.json) | Chrome y Edge con anchos de móvil, tableta y escritorio ejecutados y aprobados. Safari/WebKit no estaba instalado y no se ejecutó; la cobertura de esta fila es parcial. |
| F072. Accesibilidad básica | FUNCIONA | [live-browser-audit.json](docs/evidence/live-browser-audit.json) | Cero controles sin etiqueta, cero imágenes sin alt, foco visible y 90 muestras de contraste sobre fondo opaco (5 por escenario público), mínimo observado 5,85:1; 54 revisiones de pestañas owner. Alcance básico, sin certificación WCAG/axe. |
| F073. Excluir borradores/categorías ocultas y traducciones privadas | FUNCIONA | [tests/public_security.test.ts](tests/public_security.test.ts) | Proyección real con DB/cache simuladas; comprueba ancestros ocultos, ciclos y traducciones asociadas. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F074. Suspensión prevalece sobre caché y versión invalida contenido | FUNCIONA | [tests/public_security.test.ts](tests/public_security.test.ts) | Estado consultado fuera de caché; simulación con contenido anterior y nueva menu_version. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F075. Pedidos, carrito, checkout o pagos | NO IMPLEMENTADO | [src/components/public-menu.tsx](src/components/public-menu.tsx) | Fuera del alcance solicitado: menú de consulta. No añadir estas funciones para completar la auditoría. |

### Seguridad

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F076. Actor validado en servidor y rol persistido | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Tres sesiones Auth reales: funciones exclusivas denegadas, seis direcciones de acceso cruzado bloqueadas, cuentas suspendidas sin negocio. Pruebas adicionales de lógica con mocks se identifican en su suite. |
| F077. Acceso cruzado por identificador | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Tres sesiones Auth reales: funciones exclusivas denegadas, seis direcciones de acceso cruzado bloqueadas, cuentas suspendidas sin negocio. Pruebas adicionales de lógica con mocks se identifican en su suite. |
| F078. CSRF y origen oficial exacto | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Mutación de origen ajeno rechazada en API real; pruebas locales cubren ausencia, falsificación y cross-site. Origen de plataforma exacto. |
| F079. Límite real de upload y body | FUNCIONA | [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/api_security.test.ts](tests/api_security.test.ts) | Subida de tipo inválido y raster falsificado rechazada antes de almacenamiento real; streams excesivos cubiertos localmente. No se usa Content-Length como única protección. |
| F080. Rate limiting compartido y claves hash | FUNCIONA | [tests/api_security.test.ts](tests/api_security.test.ts) | Contratos RPC probados; falla cerrado y no envía identificador en claro. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F081. Errores sin secretos y respuestas privadas | FUNCIONA | [tests/api_security.test.ts](tests/api_security.test.ts) | Mensajes saneados y no-store comprobados. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F082. Imágenes públicas solo si están referenciadas | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/public_security.test.ts](tests/public_security.test.ts) | Seis direcciones bloquean Storage privado y referencias ajenas; fotos publicadas cargan sin login, la suspensión bloquea contenido. Traversal y borradores además cubiertos por handler con mocks. |
| F083. Paths de medios, traversal y suspensión | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [docs/evidence/live-admin-audit.json](docs/evidence/live-admin-audit.json); [tests/public_security.test.ts](tests/public_security.test.ts) | Seis direcciones bloquean Storage privado y referencias ajenas; fotos publicadas cargan sin login, la suspensión bloquea contenido. Traversal y borradores además cubiertos por handler con mocks. |
| F084. Refresco de sesión y cookies por petición | FUNCIONA | [tests/proxy_session.test.ts](tests/proxy_session.test.ts) | 43 casos incluyen rotación, chunks, cabeceras, aislamiento y host; SDK/Auth simulados. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F085. Host no confiable y X-Forwarded-Host falsificado | FUNCIONA | [tests/proxy_session.test.ts](tests/proxy_session.test.ts) | No concede administración ni refresca sesión en dominios ajenos. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F086. Dominio personalizado restringido a su menú | FUNCIONA | [tests/proxy_session.test.ts](tests/proxy_session.test.ts) | Host verificado resuelve solo el restaurante asignado; sin rutas admin. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F087. RLS, grants, FK y triggers alojados | FUNCIONA | [docs/evidence/creation-migration-verification.json](docs/evidence/creation-migration-verification.json); [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/database.test.ts](tests/database.test.ts) | RLS/grants remotos y seis pares reales por PostgREST/Storage; integridad FK/triggers probada en PostgreSQL PGlite. No equivale a resultado de advisors. |
| F088. Aislamiento con tres propietarios Auth reales | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json) | Seis pares dirigidos entre Aurora/Bruma/Marea con Auth real; lectura/escritura API y RLS, descargas Storage y referencias de imagen ajenas rechazadas. Cero escalamiento de rol o acceso superadmin desde propietario. |
| F089. Secretos fuera del cliente y Git | FUNCIONA | [security-final-scan.json](docs/evidence/security-final-scan.json); [src/lib/supabase.ts](src/lib/supabase.ts) | Cero hallazgos al buscar secretos concretos y marcadores de claves privadas: 251 archivos candidatos, 251 archivos del índice, 44 archivos del bundle cliente y 110 blobs del historial Git alcanzable. Archivos sensibles locales ignorados. |
| F090. Configuración de registro público alojado | FALLA | [docs/evidence/auth-settings-readonly.json](docs/evidence/auth-settings-readonly.json) | GET real de configuración Auth: registro público habilitado; confirmación de correo requerida. Desactivar signup público en el proyecto alojado y volver a leer configuración; no hay acceso Management autorizado disponible. |
| F091. Política de sesión y contraseña en Auth alojado | NO VERIFICADO | [supabase/migrations/20261017021301_initial_tenant_security.sql](supabase/migrations/20261017021301_initial_tenant_security.sql); [src/lib/supabase.ts](src/lib/supabase.ts); [src/app/api/auth/route.ts](src/app/api/auth/route.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. config.toml no prueba que esos ajustes estén aplicados al proyecto remoto. |
| F092. SMTP, recuperación e invitación reales | NO VERIFICADO | [supabase/migrations/20261017021301_initial_tenant_security.sql](supabase/migrations/20261017021301_initial_tenant_security.sql); [src/lib/supabase.ts](src/lib/supabase.ts); [src/app/api/auth/route.ts](src/app/api/auth/route.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. Plantilla token_hash documentada; no se enviaron correos en este subtrabajo. |
| F093. Advisors de Supabase y auditoría formal | NO VERIFICADO | [docs/evidence/advisors-access.json](docs/evidence/advisors-access.json) | Se invocó supabase_get_advisors tipo security contra el proyecto autorizado. Supabase denegó permiso; no hubo resultado. No fue un rechazo de aprobación automática. |

### QR

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F094. PNG 256/512/1024 con y sin logo | FUNCIONA | [docs/evidence/demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json); [tests/qr.test.ts](tests/qr.test.ts) | Los nueve PNG/SVG/PDF DEMO se decodifican; tamaños/variantes adicionales cubiertos por generador real. URL localhost, sin aceptación pública ni escaneo físico. |
| F095. SVG con texto y logo saneado | FUNCIONA | [docs/evidence/demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json); [tests/qr.test.ts](tests/qr.test.ts) | Los nueve PNG/SVG/PDF DEMO se decodifican; tamaños/variantes adicionales cubiertos por generador real. URL localhost, sin aceptación pública ni escaneo físico. |
| F096. PDF con marco, texto y logo | FUNCIONA | [docs/evidence/demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json); [tests/qr.test.ts](tests/qr.test.ts) | Los nueve PNG/SVG/PDF DEMO se decodifican; tamaños/variantes adicionales cubiertos por generador real. URL localhost, sin aceptación pública ni escaneo físico. |
| F097. Contraste mínimo 7 y colores oscuros sobre claro | FUNCIONA | [tests/qr.test.ts](tests/qr.test.ts) | Validador real rechaza colores insuficientes o invertidos. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F098. Zona de silencio y corrección H | FUNCIONA | [tests/qr.test.ts](tests/qr.test.ts) | Cuatro módulos de quiet zone y ECC H comprobados en datos y píxeles. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F099. Límites de logo, texto y dimensiones | FUNCIONA | [tests/qr.test.ts](tests/qr.test.ts) | Hasta 5 MiB/16MP logo raster, texto80, tamaño256–2048; fronteras y rechazos probados. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F100. Personalización conserva el destino | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/qr.test.ts](tests/qr.test.ts); [tests/q_resolver.test.ts](tests/q_resolver.test.ts) | Personalización y cambio/restauración de slug reales mantienen el QR del tenant; suspensión conserva identidad. Tokens inválidos se prueban localmente. Se mantiene el host canónico local; no acredita DNS público. |
| F101. Token estable resuelve slug nuevo | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/qr.test.ts](tests/qr.test.ts); [tests/q_resolver.test.ts](tests/q_resolver.test.ts) | Personalización y cambio/restauración de slug reales mantienen el QR del tenant; suspensión conserva identidad. Tokens inválidos se prueban localmente. Se mantiene el host canónico local; no acredita DNS público. |
| F102. Destino controlado sin redirección externa | FUNCIONA | [tests/q_resolver.test.ts](tests/q_resolver.test.ts) | Host/query/domino arbitrarios no alteran APP_URL; slug se codifica. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F103. Token inexistente o inválido y menú suspendido | FUNCIONA | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/qr.test.ts](tests/qr.test.ts); [tests/q_resolver.test.ts](tests/q_resolver.test.ts) | Personalización y cambio/restauración de slug reales mantienen el QR del tenant; suspensión conserva identidad. Tokens inválidos se prueban localmente. Se mantiene el host canónico local; no acredita DNS público. |
| F104. Tres QR DEMO con URL pública verificable | NO VERIFICADO | [docs/evidence/demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json) | Tres QR generados en tres formatos y9/9 decodificados con HTTP local correcto. No hay URL pública: el requisito comercial de QR accesibles fuera del equipo sigue sin cumplir. |
| F105. Persistencia de QR después de cambiar dominio real | NO VERIFICADO | [docs/evidence/live-audit.json](docs/evidence/live-audit.json); [tests/domains.test.ts](tests/domains.test.ts) | Cambio/restauración de slug real aprobado en los tres tenants; integración de dominio simulada localmente. Cambio DNS/dominio público real no ejecutado. |
| F106. Escaneo Android/iPhone e impresión | NO VERIFICADO | [src/lib/qr.ts](src/lib/qr.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. No hubo dispositivos físicos; decodificación automática no acredita escaneo con cámara. |

### Dominios y Render

| ID / Función | Estado | Evidencia | Alcance y límite |
| --- | --- | --- | --- |
| F107. Validar TXT de propiedad antes de registrar | FUNCIONA | [tests/domains.test.ts](tests/domains.test.ts) | DNS y fetch simulados; no envía petición Render sin prueba correcta. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F108. Registro explícito e idempotente en Render | FUNCIONA | [tests/domains.test.ts](tests/domains.test.ts) | POST fijo al servicio configurado, relee conflictos409 y nunca activa dominio por el POST. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F109. Activación separada TXT+CNAME+verified | FUNCIONA | [tests/domains.test.ts](tests/domains.test.ts) | Requiere tres comprobaciones y rechaza CNAME ajeno/proveedor pendiente. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F110. Sin SSRF por host o redirección | FUNCIONA | [tests/domains.test.ts](tests/domains.test.ts) | Endpoint api.render.com fijo, hostname restringido, redirect:error, mensajes saneados. El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F111. Build/start/health Render | NO VERIFICADO | [production-build-20261017.txt](docs/evidence/production-build-20261017.txt); [render-preflight.json](docs/evidence/render-preflight.json); [render.yaml](render.yaml) | Build de producción, next typegen/tsc y lint locales PASS; next start en 127.0.0.1:3000 responde health 200 y favicon 200. Render todavía no está desplegado, por lo que su build/start/health externo no se acredita. |
| F112. Variables de entorno Render | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. No aparecen RENDER_API_KEY/SERVICE_ID/SERVICE_HOSTNAME/EXTERNAL_URL en .env.local ni proceso observado. |
| F113. URL pública de aplicación y HTTPS | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. APP_URL clasificado loopback; repositorio GitHub público no equivale a aplicación desplegada. |
| F114. Logs y despliegue de un servicio existente | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. No se accedió a cuentas Render ni se crearon servicios en este subtrabajo. |
| F115. DNS real y dominio personalizado | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. No se modificó DNS ni se probó un proveedor real. |
| F116. Persistencia tras reiniciar servicio | FUNCIONA | [restart-persistence.json](docs/evidence/restart-persistence.json); [production-local-smoke.json](docs/evidence/production-local-smoke.json) | Servidor de producción detenido y proceso nuevo iniciado: nuevos logins owner y SHA256 idénticos de registros privados y payload público para las tres DEMO. Health 200 y smoke Chrome final PASS. Es reinicio local, no Render. |
| F117. Backup y restauración | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. No ejecutado; SQL no respalda objetos Storage por sí solo. |
| F118. Carga concurrente y disponibilidad comercial | NO VERIFICADO | [render.yaml](render.yaml); [src/lib/config.ts](src/lib/config.ts); [src/lib/domains.ts](src/lib/domains.ts) | Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. Benchmark PGlite histórico no prueba límites ni latencias de Render/Supabase alojados. |
| F119. Apex con ALIAS/flattening o comodines | NO IMPLEMENTADO | [src/lib/domains.ts](src/lib/domains.ts) | La verificación actual exige CNAME directo; cada hostname se registra individualmente. Usar subdominio con CNAME o ampliar el mecanismo con alcance y pruebas explícitos. |

<!-- AUDIT_MATRIX_END -->

## 5. Pruebas automáticas

### Suite actual de unitarios, handlers y SQL

Resultado consolidado: **201 aprobadas / 201 ejecutadas, cero fallidas, cero pendientes, 12 archivos**. El JSON de Vitest también cuenta 31 grupos internos de suites; esa cifra no representa 31 archivos.

Comando final: npm run test -- --reporter=json --outputFile=docs/evidence/unit-tests-final-20261017.json, con resultado en [unit-tests-final-20261017.json](docs/evidence/unit-tests-final-20261017.json). Se utilizó Node 22.23.3 del entorno local.

| Archivo | Aprobadas | Tipo y límite |
| --- | ---: | --- |
| [admin_routes.test.ts](tests/admin_routes.test.ts) | 23 | Handler real, parser y validación reales; Auth y frontera de DB simulados. |
| [api_security.test.ts](tests/api_security.test.ts) | 14 | Autorización, CSRF, límites y errores con dependencias de Auth/DB simuladas. |
| [auth_routes.test.ts](tests/auth_routes.test.ts) | 4 | Recuperación DEMO sin correo y logout local; SDK simulado. |
| [csv.test.ts](tests/csv.test.ts) | 21 | Parser CSV real, formatos, límites y validaciones negativas. |
| [database.test.ts](tests/database.test.ts) | 43 | PostgreSQL real en PGlite; esquemas mínimos Auth/Storage de prueba. |
| [domains.test.ts](tests/domains.test.ts) | 12 | Lógica y validación reales; DNS y Render simulados. |
| [import_export.test.ts](tests/import_export.test.ts) | 9 | Exportación de 2.505 registros con DB simulada, aislamiento y errores. |
| [proxy_session.test.ts](tests/proxy_session.test.ts) | 43 | Proxy/cookies con SDK Auth y servicios simulados. |
| [public_security.test.ts](tests/public_security.test.ts) | 8 | Proyección pública y acceso de imágenes; dependencias simuladas. |
| [qr.test.ts](tests/qr.test.ts) | 14 | Generación real PNG/SVG/PDF y decodificación independiente. |
| [q_resolver.test.ts](tests/q_resolver.test.ts) | 7 | Resolver real con DB simulada; cambio de slug y destino controlado. |
| [workspace_validation.test.ts](tests/workspace_validation.test.ts) | 3 | Validación previa a persistencia y referencias de imagen ajenas. |

La ejecución focalizada del backend fue node node_modules/vitest/vitest.mjs run tests/admin_routes.test.ts tests/auth_routes.test.ts tests/database.test.ts: **70/70 aprobadas**, subconjunto de las 201 y no una cantidad adicional.

### Navegador, verificaciones reales y comprobaciones estáticas

| Comando / ejecución | Resultado final disponible | Alcance |
| --- | --- | --- |
| npm run typecheck (next typegen && tsc --noEmit) | PASS, salida 0 | [production-validation-summary.json](docs/evidence/production-validation-summary.json): genera tipos antes de comprobar TypeScript. |
| npm run lint | PASS, salida 0 | [Consolidado de comandos](docs/evidence/production-validation-summary.json); revisión global final. |
| Playwright: ui.spec, audit-ui.spec, audit-flows.spec, audit-downloads.spec, audit-tablet.spec y audit-appearance.spec; canales chrome y msedge | **95/95 casos navegador aprobados: Chrome 48/48 y Edge 47/47** | Base por navegador: 23 escritorio, 23 móvil y una tableta; Chrome añade un caso de Apariencia con tres viewports. Negocio interceptado con fixtures. |
| node scripts/run-live-audit.mjs | **84/84 comprobaciones aprobadas** | Auth, API, PostgreSQL/PostgREST/RLS y Storage reales; aplicación local. |
| node scripts/run-admin-live-audit.mjs | **10/10 comprobaciones aprobadas** | Listado/búsqueda/métricas, soporte, copia segura, venta, medios, CSRF, 404 y bloqueo de correo DEMO reales. |
| node scripts/run-live-gap-audit.mjs | **19/19 comprobaciones aprobadas** | Duplicación, orden, salida de soporte, contacto y suspensión global reales; datos y configuración restaurados y verificados. |
| node scripts/verify-demo-qr.mjs | **9/9 artefactos decodificados** | PNG/SVG/PDF de los tres DEMO; URL localhost, sin escaneo físico. |
| node scripts/translate-demos.mjs | **96 traducciones verificadas** | 72 productos con nombre/descripción ingleses y 24 categorías; API privada y pública reales. Son registros comprobados, no 96 tests unitarios. |
| node scripts/visual-live-audit.mjs | **24/24 escenarios y 372/372 comprobaciones aprobados** | 18 menús y seis paneles de propietario; Chrome/Edge, servidor local y Supabase real, sin interceptar API. Procedencia dev/producción detallada abajo. |
| npm run build (next build --webpack) | PASS actual | [production-build-20261017.txt](docs/evidence/production-build-20261017.txt): Next 16.4.2, compilación optimizada y generación de 12 páginas. |
| npm run start / next start | PASS local | 127.0.0.1:3000 sirve /api/health 200 y /favicon.ico 200 image/x-icon; comprobación externa en Render pendiente. |
| Escaneo de secretos de archivos, bundle e historial Git | Cero hallazgos | [security-final-scan.json](docs/evidence/security-final-scan.json): 251 candidatos, 251 archivos del índice, 44 archivos cliente y 110 blobs; cero hallazgos. |
| node scripts/verify-restart.mjs before / after (entre procesos distintos) | PASS, tres DEMO | [restart-persistence.json](docs/evidence/restart-persistence.json): hashes privados/públicos idénticos en proceso nuevo y nuevos logins owner. |
| node scripts/verify-production-local.mjs | PASS | [production-local-smoke.json](docs/evidence/production-local-smoke.json): tres menús/72 productos, CSP de producción, health y sesión owner/logout; sin errores inesperados. |
| node scripts/visual-live-audit.mjs (LIVE_AUDIT_PHASE=screenshots) | **18/18 capturas, 54/54 comprobaciones aprobadas** | Producción local tras reinicio y portadas finales; [capturas finales](docs/evidence/live-browser-screenshots.json) y [revisión visual](docs/evidence/live-browser-visual-review.json). |
| npm audit | Cero vulnerabilidades en evidencia histórica | [npm-audit.json](docs/evidence/npm-audit.json); sin afirmar que se haya repetido en este corte. |

El [consolidado de producción local](docs/evidence/production-validation-summary.json) registra los comandos reales, salidas y build; no acredita una publicación en Render.

La consolidación UI toma el último resultado de cada caso: **48 en Chrome y 47 en Edge, sin sumar repeticiones**. Edge tuvo una pasada completa de 46 y una de tableta. Chrome añade un único caso de Apariencia que recorre 1440, 820 y 390 píxeles; no se contabiliza como tres tests. El cambio final de CSS se verificó con ese caso y dos repeticiones de carga de archivos/CSV, que no aumentan el total. No se repitieron las suites completas después del ajuste focalizado. Los comandos y fuentes están en [audit-ui-consolidated.json](docs/evidence/audit-ui-consolidated.json).

Los fallos históricos se conservan como evidencia de reparación, no como pendientes actuales: el doble submit y la publicación sin campos requeridos se reprodujeron; la descarga directa de un error JSON como archivo se corrigió con verificación HTTP; cuatro aserciones intermedias confundían la alerta de la aplicación con el anunciador de rutas de Next y se restringió el selector. Los casos afectados pasaron al repetirlos. Además, el recorrido real detectó que Apariencia desbordaba de 1440 a 1557 píxeles: el input de archivo oculto heredaba width:100% de un selector más específico. Se excluyó ese tipo del estilo genérico y se restableció su caja; el test falla antes y pasa después a 1440/820/390. Referencias: [antes](docs/evidence/audit-ui-before.json), [Apariencia antes](docs/evidence/audit-appearance-before.json), [Apariencia después](docs/evidence/audit-appearance-after.json), [controles de archivo después](docs/evidence/audit-file-controls-after.json), [consolidado final](docs/evidence/audit-ui-consolidated.json).

La prueba administrativa inicial de imagen elegía un producto QA no publicado y no lo encontraba en el menú. Se corrigió únicamente la selección del dato de prueba y el mismo chequeo pasó: [9/10 inicial](docs/evidence/live-admin-audit-initial.json), [10/10 final](docs/evidence/live-admin-audit.json). No se presenta ese error del harness como fallo de producto.

### Importación real y alcance de los conteos

| Filas CSV | Resultado contra Supabase real | Tiempo registrado por el ensayo | Duplicados creados al repetir |
| ---: | --- | ---: | ---: |
| 1 | Aprobado | 8.883 ms | 0 |
| 10 | Aprobado | 4.224 ms | 0 |
| 100 | Aprobado | 4.683 ms | 0 |
| 500 | Aprobado | 8.194 ms | 0 |
| 1.000 | Aprobado | 8.663 ms | 0 |

Los tiempos incluyen el recorrido de API local y su comunicación con Supabase; no son latencias de una consulta SQL aislada ni un benchmark de disponibilidad comercial. También se rechazaron archivo vacío, encabezados incorrectos, precio ausente/inválido, categoría inexistente, filas duplicadas, comillas corruptas, UTF-8 inválido y 1.001 filas. Se exportó un catálogo con más de 1.000 registros sin campos privados y se retiraron los datos temporales. La consulta final conservó 24 productos por restaurante. Evidencia: [live-audit.json](docs/evidence/live-audit.json).

El navegador real cerró **24/24 escenarios y 372/372 comprobaciones**, sin errores finales inesperados: 18 menús (tres DEMO × tres anchos × Chrome/Edge) y seis propietarios. Se comprobaron imágenes cargadas, identidad visual, categorías, búsqueda/filtros, detalle con precios/variantes/extras, horarios, favoritos aislados e inglés persistido. Cada propietario recorrió nueve pestañas, descargó CSV de 24 productos y tres formatos QR, abrió la vista previa, recargó y cerró/reabrió sesión con snapshots de catálogo iguales. Los nueve escenarios públicos Chrome y el propietario Bruma en Chrome proceden del servidor de desarrollo; Aurora/Marea en Chrome y todos los escenarios Edge proceden de next start en producción local. No hubo interceptación de API ni fixtures en estos recorridos. Evidencia y fuentes con SHA256: [live-browser-audit.json](docs/evidence/live-browser-audit.json).

La accesibilidad ensayada cubre etiquetas de controles, alt de imágenes, foco visible de teclado y 90 muestras de contraste sobre fondo opaco (cinco por escenario público), con mínimo observado de 5,85:1. Se hicieron 54 revisiones de pestañas de propietario y 522 comprobaciones de carga de elementos img (29 × 18; no son 522 archivos distintos). No es una certificación WCAG ni una auditoría completa. Los intentos históricos no se suman al total final: se corrigieron selectores de categorías/exportación y esperas de hidratación/logout; un BOM temporal de package.json se eliminó antes del build final. El overflow real de Apariencia se conserva como defecto reproducido y corregido. La revisión final cambió las tres portadas a ilustraciones propias sin texto incrustado; el texto de identidad permanece accesible en el DOM. Las 372 comprobaciones completas preceden ese ajuste de recursos; el smoke posterior verificó los tres menús, CSP y sesión owner. Las 18 capturas finales pasaron revisión visual y 54 comprobaciones automatizadas. Evidencias: [demo-cover-refinement.json](docs/evidence/demo-cover-refinement.json) y [production-local-smoke.json](docs/evidence/production-local-smoke.json).

La suite de 201, los 95 casos UI, los 84 + 10 + 19 chequeos reales de API/administración y recorridos complementarios, los 24 escenarios/372 comprobaciones de navegador real, las 18 capturas/54 comprobaciones finales y los nueve archivos QR miden cosas diferentes y parcialmente superpuestas. **No se suman como una sola cantidad de pruebas independientes.** PGlite demuestra SQL ejecutado y rollback local; los mocks demuestran contratos/lógica; el ensayo real acredita Auth/REST/Storage alojados; ninguno de ellos sustituye al despliegue y escaneo externos.

No se ejecutó Safari ni escaneo de cámara Android/iPhone. La emulación de viewport móvil y tableta en Chrome/Edge acredita esa interfaz, no dispositivos físicos.

## 6. Seguridad

### Resultados acreditados

- El servidor valida al usuario con getUser y consulta rol/membresía persistidos. No usa user_metadata para conceder privilegios. Los handlers administrativos exigen superadministrador; los de workspace reciben contexto explícito del restaurante.
- PostgreSQL aplica RLS, claves foráneas compuestas de tenant y restricciones de propiedad. PGlite ejecuta pruebas como anon, authenticated y service_role: propietario A no lee ni modifica B; las relaciones cruzadas fallan; propietarios suspendidos pierden acceso al negocio.
- La tabla de intentos de creación está en schema privado con RLS. La comprobación remota confirma que anon y authenticated no pueden leerla ni ejecutar sus tres RPC; service_role sí. Ninguno de esos RPC usa SECURITY DEFINER.
- El propietario no puede actualizar status, slug, identidad pública permanente, correo de propietario ni is_demo mediante grants de REST. Las cuentas administrativas de plataforma no obtienen un bypass global de RLS por metadatos del cliente.
- Storage conserva el bucket restaurant-media privado. Las rutas de medios se vinculan al restaurante. Las pruebas locales rechazan traversal, prefijos de otro tenant, formatos indebidos y publicación de imágenes de borrador.
- La proyección pública excluye campos privados y contenido no publicado. La suspensión se consulta antes de servir el menú y prevalece sobre la caché.
- Los errores devueltos y logs de creación omiten claves, contraseñas y mensajes internos de Auth. CSRF, tamaño real del cuerpo, límites compartidos y claves de rate limit con hash están cubiertos por pruebas.
- Las cuentas DEMO no reciben correos de creación, recuperación ni restablecimiento administrativo. El cierre de sesión es local y no revoca otros dispositivos.
- El archivo temporal de contraseña PostgreSQL usado para aplicar la migración se eliminó. Ningún reporte incluye credenciales ni tokens de sesión.

Evidencias: [tests de autorización](tests/api_security.test.ts), [SQL/RLS](tests/database.test.ts), [medios y menú](tests/public_security.test.ts), [proxy](tests/proxy_session.test.ts), [ACL remotas](docs/evidence/creation-migration-verification.json).

### Tres propietarios reales y configuración pendiente

**Aislamiento real aprobado en las seis direcciones:** Aurora→Bruma, Aurora→Marea, Bruma→Aurora, Bruma→Marea, Marea→Aurora y Marea→Bruma. En cada dirección se rechazaron lectura/escritura por API, lectura/escritura directa por PostgREST/RLS, descarga privada de Storage y referencia a medios ajenos. Ningún propietario pudo usar el endpoint de superadmin, administrar QR ni escalar su rol en DB. Las pruebas emplearon sesiones Auth reales y el Supabase autorizado, no mocks.

Los tres propietarios cerraron sesión, reingresaron y conservaron datos. La suspensión/reactivación de restaurante y de propietario se comprobó con las sesiones reales; la ruta QR conservó la identidad. El CRUD temporal y las cargas CSV se limitaron a las demos, y la consulta final confirmó 24 productos por restaurante y ausencia de registros QA. Los dos replay concurrentes de creación no añadieron restaurantes ni cuentas huérfanas. Evidencia: [84 comprobaciones reales](docs/evidence/live-audit.json).

La ampliación administrativa añade 10 comprobaciones aprobadas de listado/búsqueda/métricas, soporte, copia segura de apariencia, venta, correos DEMO bloqueados, 404, CSRF y carga de imágenes inválida. El ensayo inicial de cambio de imagen seleccionó por error un producto temporal no publicado; se corrigió el selector a producto publicado, se repitió la misma comprobación y pasó. Ese fallo del harness se conserva en [live-admin-audit-initial.json](docs/evidence/live-admin-audit-initial.json); no se atribuye a la aplicación. Resultado final: [live-admin-audit.json](docs/evidence/live-admin-audit.json).

La consulta real GET /auth/v1/settings del 17 de octubre a las 17:11 UTC obtuvo **registro público habilitado** y autoconfirmación de correo deshabilitada. Aunque una cuenta no asignada no recibe acceso al negocio, permitir altas públicas es una configuración pendiente antes de producción. No se cambió la configuración alojada sin acceso Management autorizado. El endpoint público no expone la configuración SMTP, por lo que no acredita proveedor, remitente, plantillas ni entrega efectiva. Evidencia: [auth-settings-readonly.json](docs/evidence/auth-settings-readonly.json).

Esta revisión no equivale a una auditoría de penetración completa. Se intentó ejecutar el advisor de seguridad mediante el MCP conectado al proyecto correcto y Supabase devolvió falta de permiso. Es una denegación de permisos del proveedor, no un rechazo de revisión automática. No hay resultado de advisors; la restauración y la carga siguen pendientes. El escaneo actual de secretos sí está ejecutado y se describe a continuación. Evidencia: [advisors-access.json](docs/evidence/advisors-access.json).

El escaneo del build actual buscó coincidencias exactas de la clave de servicio, credenciales administrativas/de DB y las tres contraseñas DEMO, además de marcadores de claves privadas. Revisó 251 archivos candidatos, 251 archivos del índice Git, 44 archivos del bundle público y 110 blobs de todo el historial Git alcanzable, sin hallazgos. Confirmó que .env.local y el archivo local de accesos DEMO están ignorados. No publica los valores buscados. La revisión posterior a staging también pasó con 251 archivos del índice. Evidencia: [security-final-scan.json](docs/evidence/security-final-scan.json).

## 7. QR

La ruta permanente de plataforma tiene forma /q/identificador-publico y se resuelve al slug vigente. El identificador público es independiente del slug y de los dominios personalizados; SQL impide modificarlo incluso desde servicio. El dominio canónico de la plataforma debe mantenerse: cambiar el host al que apunta un QR ya impreso sin conservarlo sí rompe su acceso.

Se producen PNG, SVG y PDF. Las pruebas del generador comprueban corrección H, al menos cuatro módulos de zona de silencio, contraste mínimo 7, colores oscuros sobre fondo claro, logos raster saneados y decodificación independiente. Se verifican tamaños 256, 512 y 1.024 con y sin logo, y la identidad del QR extraído del PDF.

| Restaurante | Archivos | URL decodificada local | Decodificación | HTTP y permanencia |
| --- | --- | --- | --- | --- |
| Pizzería Aurora | [PNG](artifacts/qr/local-validation/aurora.png) / [SVG](artifacts/qr/local-validation/aurora.svg) / [PDF](artifacts/qr/local-validation/aurora.pdf) | http://localhost:3000/q/5820b231-3a31-43aa-a1ec-4f6f79ef2bb6 | 3/3; PNG/SVG y píxeles PDF decodificados | HTTP local correcto; slug cambiado y restaurado, mismo restaurante |
| Café Bruma | [PNG](artifacts/qr/local-validation/bruma.png) / [SVG](artifacts/qr/local-validation/bruma.svg) / [PDF](artifacts/qr/local-validation/bruma.pdf) | http://localhost:3000/q/5d236a67-793a-4a72-92f4-63abe20e8d95 | 3/3; PNG/SVG y píxeles PDF decodificados | HTTP local correcto; slug cambiado y restaurado, mismo restaurante |
| Bento Marea | [PNG](artifacts/qr/local-validation/marea.png) / [SVG](artifacts/qr/local-validation/marea.svg) / [PDF](artifacts/qr/local-validation/marea.pdf) | http://localhost:3000/q/199258db-b193-4055-9f26-b1f3ea9ee1eb | 3/3; PNG/SVG y píxeles PDF decodificados | HTTP local correcto; slug cambiado y restaurado, mismo restaurante |

**Estos artefactos son de validación local.** No existe una URL pública de aplicación confirmada; un QR que decodifique localhost no cumple todavía el requisito comercial de abrir desde otro teléfono. No se usa un dominio inventado para aparentar cumplimiento.

La validación real completada contempla los nueve archivos de 1.024×1.024 píxeles, decodificación independiente de PNG/SVG y de los píxeles contenidos en PDF, HTTP local, pertenencia al restaurante, personalización y cambio/restauración de slug. Resultado 9/9 aprobado, todos con publicReady false y physicalScan false. Evidencias: [demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json) y [live-audit.json](docs/evidence/live-audit.json). Un cambio de dominio DNS real, HTTPS público, escaneo físico con Android/iPhone e impresión no se han acreditado. Para publicar se debe configurar APP_URL con un host HTTPS permanente, desplegar, regenerar los archivos y repetir las comprobaciones externas. Los QR locales no deben imprimirse para clientes.

Evidencias del generador: [qr.test.ts](tests/qr.test.ts), [q_resolver.test.ts](tests/q_resolver.test.ts), [suite actual](docs/evidence/unit-tests-final-20261017.json). Los archivos entregados son exclusivamente artefactos de validación local; los QR comerciales con URL pública siguen pendientes del despliegue.

## 8. Base de datos

Se usa el Supabase autorizado ylcnrfzosjzuljufwups. La aplicación local consulta PostgreSQL/Auth/Storage alojados; esto no constituye un despliegue público del frontend.

| Migración | Estado y propósito |
| --- | --- |
| [20261017021301_initial_tenant_security.sql](supabase/migrations/20261017021301_initial_tenant_security.sql) | Base existente aplicada: restaurantes, membresías únicas, categorías y relaciones de tenant, productos, promociones, horarios, idiomas/traducciones, QR, dominios, venta única, métricas, auditoría, grants, RLS y Storage privado. |
| [20261017165549_restaurant_creation_requests.sql](supabase/migrations/20261017165549_restaurant_creation_requests.sql) | Nueva y aplicada tras pruebas PGlite y dry-run: is_demo, CHECK de correo reservado, intentos privados y RPC claim/complete/settle para idempotencia y recuperación. |

La nueva migración se creó con Supabase CLI, se ejecutó primero en PostgreSQL PGlite con las migraciones anteriores y se verificó con pruebas de permisos, rollback y concurrencia lógica. Después se aplicó exclusivamente al destino autorizado mediante conexión pooler explícita y secreto temporal en variables de entorno. El historial remoto quedó alineado con las dos migraciones.

Se comprobaron de nuevo permisos de los RPC, RLS de la tabla privada y bucket privado. Una invocación real de claim devolvió processing dentro de una transacción que terminó en ROLLBACK. No se crearon propietarios ni restaurantes como parte de esa prueba SQL; la provisión de las tres demos se hizo posteriormente por los flujos de aplicación.

Las claves UNIQUE conservan un propietario por restaurante, un restaurante por propietario, slug único y SKU único dentro de cada tenant. Las FK compuestas impiden referencias a categorías, productos y traducciones de otro restaurante. Los cambios de menú incrementan su versión para invalidar contenido, mientras el estado de suspensión se consulta fresco.

La importación se ejecuta de forma transaccional. Con SKU se identifica únicamente por SKU exacto; sin SKU se usa nombre y categoría con normalización de espacios extremos y minúsculas. Una coincidencia ambigua se rechaza. La exportación básica de cinco columnas no es un backup completo de imágenes, traducciones, variantes ni extras.

Permanencia de datos: la provisión está guardada en Supabase y no sólo en memoria. Los tres propietarios cerraron sesión, reingresaron y recuperaron los mismos datos por API. Los cambios CRUD y de disponibilidad se reflejaron en la API pública; luego se restauraron las demos. Recarga, logout y reingreso del navegador real ya conservan snapshots idénticos. Después de detener el servidor de producción e iniciar un proceso nuevo, nuevos logins de los tres propietarios devolvieron hashes SHA256 idénticos de registros privados y payload público. Cada DEMO conservó 24 productos, ocho categorías y 32 traducciones; health y smoke Chrome posteriores pasaron. Evidencias: [restart-persistence.json](docs/evidence/restart-persistence.json) y [production-local-smoke.json](docs/evidence/production-local-smoke.json). No se ejecutó un ensayo de backup/restauración ni se afirma tolerancia a carga de producción.

## 9. Archivos modificados

| Archivo o grupo | Motivo |
| --- | --- |
| src/app/api/admin/restaurants/route.ts; src/lib/create-restaurant.ts | Idempotencia persistente, clasificación de errores, compensación y DEMO sin comunicación. |
| src/lib/api.ts | Errores con code/fields y 404 para registro singular inexistente. |
| src/app/api/auth/route.ts | Recuperación .test sin correo; logout local. |
| src/app/api/workspace/[restaurantId]/route.ts | Validación antes de persistir apariencia y rechazo comprensible de medios de otro tenant. |
| src/app/api/workspace/[restaurantId]/import/route.ts | Exportación paginada y autorizada del catálogo actual. |
| src/components/admin-app.tsx | Bloqueo síncrono del doble submit, requestId estable, errores visibles y modo DEMO. |
| src/components/workspace.tsx; workspace-settings.tsx | Validación de formularios, variantes, estado de carga de imágenes y descargas. |
| src/components/public-menu.tsx | Subcategorías y opciones informativas del producto en el menú público. |
| src/components/download-link.tsx; ui.tsx; login.tsx; src/app/globals.css | Manejo de errores de descarga, estados y ajustes de interfaz. |
| supabase/migrations/20261017165549_restaurant_creation_requests.sql | Estado durable de creación y restricciones DEMO. |
| tests/admin_routes.test.ts; auth_routes.test.ts; database.test.ts; workspace_validation.test.ts; import_export.test.ts | Regresiones de backend, SQL, seguridad y exportación. |
| tests/e2e/audit-*.spec.ts; audit-fixtures.ts | Reproducción y verificación de UI, con fixtures explícitos cuando corresponde. |
| scripts/demo-catalog.mjs; provision-demos.mjs; live-client.mjs; run-live-audit.mjs; run-live-gap-audit.mjs; visual-live-audit.mjs | Recursos propios, provisión real y auditorías limitadas a registros DEMO. |
| artifacts/demo; artifacts/qr/local-validation; artifacts/screenshots | Imágenes originales, archivos QR de prueba local y capturas. |
| public/favicon.svg; public/favicon.ico | Icono propio de plataforma; resuelve el 404 y se verificó HTTP 200 image/x-icon. |
| render.yaml; package.json | Disparador commit y generación de tipos Next antes de tsc para instalación limpia; controles del build conservados. |
| docs/DEPLOY_RENDER_SUPABASE.md | Estado real de tres DEMO y dos migraciones, administrador existente y pendientes externos; sin repetir bootstrap. |
| docs/AUDITORIA_INVENTARIO_20261017.md; docs/evidence; docs/CSV.md | Inventario, evidencia saneada y contrato de importación/exportación. |
| AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md; RESTAURANTES_DEMO.md | Informe y acceso a demos sin contraseñas en los documentos. |

La lista destaca archivos relevantes; no presenta archivos generados por Next ni capturas antiguas como cambios funcionales. La comparación separada del original confirma que no se modificó Crepes & Waffles.

## 10. Estado de despliegue

| Entorno | Estado comprobado |
| --- | --- |
| Local | Aplicación Node 22 con Supabase real: tres DEMO, 84 comprobaciones API/DB, 10 administrativas y 19 complementarias aprobadas; 95 casos UI con fixtures aprobados. Build de producción, typecheck y lint PASS; next start local y health 200. 24 escenarios/372 comprobaciones de navegador real aprobados; hashes iguales tras reinicio y smoke final PASS. Servidor next start disponible en localhost:3000; capturas finales Chrome/Edge revisadas. |
| Supabase alojado | Esquema y migraciones aplicados al proyecto autorizado, Storage privado y propietarios/restaurantes DEMO persistidos. No equivale a hosting público de Next.js. |
| Staging | No existe despliegue acreditado. |
| Producción / Render | **No desplegado**, según confirmación del usuario. No hay URL HTTPS pública de la aplicación comprobada. |

render.yaml define un solo servicio Node, npm ci --include=dev y comprobaciones de tipos/lint/tests/build, inicio con npm run start y health check /api/health. Se cambió autoDeployTrigger a commit porque GitHub confirmó cero checks/statuses: Render no activa checksPass cuando no detecta checks. typecheck genera primero tipos de rutas con next typegen antes de tsc. Evidencia: [render-preflight.json](docs/evidence/render-preflight.json); referencias oficiales de [Render CI](https://render.com/docs/deploys#integrating-with-ci) y [Next typegen](https://nextjs.org/docs/app/api-reference/cli/next#next-typegen-options). Los nombres de variables están definidos para Supabase, APP_URL, hosts de plataforma y host Render; los valores secretos no forman parte del reporte.

La configuración versionada no demuestra que Render haya ejecutado el build, aplicado variables o emitido un certificado. No se crearon servicios duplicados ni se sustituyó la base de datos. Las pruebas de integración de dominios usan DNS/Render simulados; ningún resultado de ellas se presenta como DNS real.

## 11. Problemas pendientes

| Pendiente | Motivo / bloqueo | Evidencia | Acción necesaria |
| --- | --- | --- | --- |
| Causa exacta de los dos 409 de la captura original | Falta payload y respuesta de esos intentos. | [409-before-fix.json](docs/evidence/409-before-fix.json). | Si reaparece, conservar requestId/código/cuerpo saneado; no inferir el correo utilizado. |
| Registro público de Auth habilitado | Configuración alojada permite signup; no hay permiso Management suficiente para modificarla desde esta sesión. | [auth-settings-readonly.json](docs/evidence/auth-settings-readonly.json). | Desactivar altas públicas en Supabase y volver a leer configuración; conservar creación administrativa. |
| SMTP, remitente, plantillas y entrega real | Ajustes públicos no exponen SMTP; demos no pueden recibir correo. | [lectura Auth](docs/evidence/auth-settings-readonly.json), [bloqueo DEMO real](docs/evidence/live-admin-audit.json). | Configurar/verificar con destinatario real expresamente autorizado fuera de las demos. |
| URL pública, Render y HTTPS | El usuario confirmó que la aplicación no está desplegada. | render.yaml y APP_URL local. | Desplegar un servicio autorizado, configurar variables/health/dominio y observar logs. |
| QR comerciales utilizables desde otro teléfono | 9/9 decodifican, pero todos apuntan a localhost. | [demo-qr-decoding.json](docs/evidence/demo-qr-decoding.json). | Regenerar con host HTTPS permanente y repetir decodificación, HTTP público y escaneo físico. |
| DNS y cambio de dominio público real | Sin dominio/proveedor operativo en el entorno. | Tests DNS/Render con mocks; slug real sí aprobado en [live-audit.json](docs/evidence/live-audit.json). | Probar TXT, CNAME, certificado y enrutamiento real manteniendo el host canónico. |
| Safari y escaneo físico Android/iPhone | No hay ejecución acreditada en esos entornos. | Límites del [consolidado UI](docs/evidence/audit-ui-consolidated.json). | Registrar dispositivo/navegador, fecha y resultado; no equiparar emulación con cámara real. |
| Backup y restauración | No se realizó ejercicio de recuperación. | Sin evidencia ejecutada. | Respaldar PostgreSQL y objetos Storage y restaurar en destino de pruebas autorizado. |
| Carga concurrente y disponibilidad comercial | Las cargas CSV son funcionales; no representan concurrencia comercial. | [live-audit.json](docs/evidence/live-audit.json) y PGlite. | Definir carga objetivo y ejecutar ensayo controlado con métricas y límites. |
| Advisors de seguridad | MCP del proyecto correcto devolvió “You do not have permission to perform this action”. | [advisors-access.json](docs/evidence/advisors-access.json). | Un usuario con permiso de Management debe ejecutar advisors; no fue rechazo de revisión automática. |
| Política alojada de contraseña, sesiones y acceso anónimo | No se acreditó la configuración completa mediante Management API; el archivo local no prueba los valores alojados. | Filas F091 y [lectura pública de Auth](docs/evidence/auth-settings-readonly.json). | Revisar en Dashboard con permiso suficiente y registrar los valores pertinentes sin secretos. |
| Apex mediante ALIAS/flattening y comodines | No implementado; la validación actual exige CNAME directo por hostname. | Inventario F119 y src/lib/domains.ts. | Utilizar subdominios CNAME o ampliar soporte con pruebas específicas. |

Pedidos, carrito, checkout, pagos y planes están deliberadamente fuera del alcance solicitado. La exportación CSV básica no reemplaza un sistema de backup integral.

**Alcance comprobado:** funcionalidad local con Supabase real, aislamiento, persistencia tras reinicio, build de producción y pruebas indicadas aprobados. Las capturas finales y el escaneo del índice Git también pasaron. Producción pública, correo, DNS, restauración y dispositivos físicos mantienen los límites descritos. No se afirma que Render esté publicado.
