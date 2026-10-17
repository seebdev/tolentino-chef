# Inventario técnico y matriz de alcance — 17 de octubre de 2026

Corte de esta subauditoría: `2026-10-17T17:05:00.188699+00:00`. Proyecto: `tolentino-restaurantes-admin`.

Este documento es un insumo del reporte final. No reemplaza las pruebas reales de los tres restaurantes ni las correcciones concurrentes de otros agentes. Las filas con FUNCIONA declaran únicamente el alcance de su evidencia; un handler con DB simulada no acredita una sesión Auth ni persistencia remotas.

## Arquitectura e inventario

| Área | Implementación inspeccionada |
| --- | --- |
| Framework | Next.js 16.4.2 App Router, React 19.3.1, TypeScript 6.0.3; Node ejecutado 22.23.3 |
| Frontend | Componentes React propios y CSS responsive; administración, workspace y menú público |
| Backend | Route Handlers Node; Zod; utilidades de autorización, caché, CSV, QR, dominios y medios |
| Persistencia | Supabase JS 2.118.0 / SSR 0.12.7; Postgres con SQL/RPC, Auth y Storage privado; sin ORM adicional |
| Autorización | getUser, rol/membresía persistidos, tenant explícito, RLS y grants; servicio solo tras control o proyección pública |
| Datos | Un propietario por restaurante; categorías jerárquicas, productos, promociones, horarios, traducciones, QR/dominos, ventas y auditoría |
| Idiomas | es, en, fr, it, zh, ja, hi; traducciones manuales y fallback, no traducción automática |
| Imágenes | Multipart acotado a 5 MiB, máximo16MP, recodificación WebP; bucket privado y proxy de medios |
| QR | qrcode/sharp/pdf-lib; jsQR independiente en tests; token permanente separado del slug |
| CSV | PapaParse; importación1–1000 por transacción y exportación básica paginada del catálogo |
| Carpetas | src/app, src/components, src/lib, supabase/migrations, tests, scripts, docs/evidence |

El JSON acompañante incluye versiones, rutas, migraciones, hash SHA256 y tamaño de cada archivo de código/configuración inspeccionado. No incluye valores de `.env.local`, credenciales, rutas de usuario ni el inventario privado de Crepes.

## Pruebas ejecutadas ahora

**128/128 aprobadas; 0 fallidas en 8 archivos.** No se ejecutó build ni se reinició el servidor de desarrollo.

```powershell
node .\node_modules\vitest\vitest.mjs run tests/csv.test.ts tests/qr.test.ts tests/domains.test.ts tests/api_security.test.ts tests/public_security.test.ts tests/q_resolver.test.ts tests/proxy_session.test.ts tests/import_export.test.ts --reporter=json --outputFile=<reporte-local>
```

Se usó el ejecutable local de Node22.23.3. El destino real del reporte de trabajo fue un archivo fuera del repositorio; el resumen saneado está en `evidence/audit-inventory-20261017.json`.

| Archivo | Aprobadas | Alcance |
| --- | ---: | --- |
| `tests/api_security.test.ts` | 14/14 | Handler/lógica real con dependencias externas simuladas |
| `tests/csv.test.ts` | 21/21 | Parser real |
| `tests/domains.test.ts` | 12/12 | Handler/lógica real con dependencias externas simuladas |
| `tests/import_export.test.ts` | 9/9 | Handler/lógica real con dependencias externas simuladas |
| `tests/proxy_session.test.ts` | 43/43 | Handler/lógica real con dependencias externas simuladas |
| `tests/public_security.test.ts` | 8/8 | Handler/lógica real con dependencias externas simuladas |
| `tests/qr.test.ts` | 14/14 | Lógica/render reales y decodificador independiente |
| `tests/q_resolver.test.ts` | 7/7 | Handler/lógica real con dependencias externas simuladas |

ESLint de la ruta CSV y del test nuevo terminó con código 0. También pasó `node node_modules/typescript/bin/tsc --noEmit --incremental false` con el código disponible en ese momento. Vite emitió un aviso sobre el futuro configLoader native/ESM, sin fallos. El build y los E2E de la entrega final corresponden al agente principal; no se infieren de estos unitarios.

## Evidencia anterior y acceso al despliegue

- `evidence/db-migration-verification.json`: esquema remoto, RLS, grants, RPC y bucket; no hubo usuarios/restaurantes/objetos creados por esa verificación.
- `evidence/connected-supabase-smoke.json`: anterior health local200, APIs401 sin sesión y acceso de servicio a REST/Auth/Storage; no demuestra login de propietario.
- `evidence/playwright-results.json`:22 E2E históricos Chrome, negocio con fixtures; no verifican los tres DEMO actuales ni Safari.
- `evidence/production-smoke.json`: etapa anterior sin credenciales, identificada como histórica.
- `.env.local`: nombres de Supabase, APP_URL y PLATFORM_HOSTNAMES presentes; sin valores en el reporte. APP_URL es loopback. No se detectaron variables Render en el archivo o proceso inspeccionado.
- `render.yaml`: servicio único Node, build con ci/tipos/lint/tests/build, start de Next y health. Una configuración versionada no acredita un despliegue. No se accedió a otros proyectos ni se creó infraestructura.
- No se acreditó URL pública de la aplicación; el repositorio GitHub no es un menú desplegado. No generar tres QR comerciales apuntando a localhost.

## Corrección acotada de CSV

`GET /api/workspace/[restaurantId]/import?download=catalog` exporta `catalogo-productos.csv` con nombre, precio, categoría, descripción y SKU. Conserva la plantilla por defecto, usa contexto autorizado, filtros de tenant, paginación y rate limit. Las pruebas cubren2505 productos sin truncamiento, exclusión de un tenant ajeno, UTF-8, fórmulas, catálogo vacío, errores y falta de autorización.

La exportación no incluye fotos, variantes, extras ni traducciones y no es un backup integral. Para reimportar un catálogo de más de1000 filas hay que dividirlo según el límite de importación. La prueba de exportación usa una DB simulada; la conexión real debe quedar acreditada separadamente.

## Hallazgos enviados para corrección coordinada

1. Registros inexistentes: `.single()` puede generar PGRST116 antes del `if(!data)`, y el manejo genérico devolvía500. El agente de base se encarga de su corrección y regresión.
2. Apariencia: se guardaba draft_appearance antes de validar nombre/descripción; una entrada inválida podía dejar un guardado parcial. El agente principal controla esa ruta.
3. Error409 de creación: no atribuir causa exacta a partir de un mensaje genérico. La reproducción y la corrección de idempotencia pertenecen al trabajo coordinado principal.

## Matriz funcional detallada

Estados solicitados: FUNCIONA, CORREGIDO Y VERIFICADO, FALLA, NO IMPLEMENTADO, NO VERIFICADO. La ausencia de una prueba ejecutada mantiene NO VERIFICADO, aunque exista el código. Los hallazgos estáticos en coordinación no se presentan como una reproducción E2E.

### Superadministración

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F001. Inicio de sesión superadministrador | NO VERIFICADO | `src/app/api/auth/route.ts`, `src/lib/access.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Repetir con cuenta real autorizada; el smoke histórico solo comprobó /login 200 y API sin sesión 401. |
| F002. Cierre de sesión | NO VERIFICADO | `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Comprobar cookies y acceso posterior con sesión real. |
| F003. Panel, listado, búsqueda, paginación y métricas | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/components/admin-app.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Hay evidencia UI histórica con fixtures; verificar datos actuales y persistencia. |
| F004. Crear restaurante desde interfaz y API / diagnóstico 409 | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/components/admin-app.tsx`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Investigación/corrección y regresiones del agente principal; no atribuir causa exacta solo leyendo el 409 genérico. |
| F005. Doble envío e idempotencia de creación | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/components/admin-app.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Trabajo concurrente de frontend/base; integrar su evidencia final antes de marcar aprobado. |
| F006. Consultar y editar restaurante | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Ejecutar con registros reales, preservar venta y propietario. |
| F007. Suspender restaurante | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Pruebas locales de suspensión existen; falta recorrido administrativo real en este subtrabajo. |
| F008. Reactivar restaurante | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Confirmar que datos, token e imágenes se conservan con sesión real. |
| F009. Crear propietario distinto por restaurante | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Provisionamiento transaccional SQL; Auth es una operación separada con compensación. |
| F010. Suspender/reactivar acceso de propietario | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/lib/access.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Validar revocación efectiva de acceso en navegador con sesión existente. |
| F011. Restablecer acceso y entrega de correo | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Requiere SMTP/plantilla reales; no enviar comunicaciones a los propietarios DEMO. |
| F012. Edición integral en modo soporte | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/workspace.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Ejecutar menú real con superadmin, contexto visible y auditoría. |
| F013. Salida del modo soporte | NO VERIFICADO | `src/components/workspace.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Comprobar navegación y ausencia de cambio de identidad del propietario. |
| F014. Contacto comercial y mensaje de suspensión | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Guardado implementado y proyección pública explícita; comprobar UI real. |
| F015. Copiar diseño entre restaurantes | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No copia catálogo/identidad; excluye rutas de imágenes de origen. Verificación real pendiente. |
| F016. Persistencia después de recarga y reingreso | NO VERIFICADO | `src/app/api/admin/restaurants/route.ts`, `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Debe acreditarse con DB real y dos sesiones, no fixtures. |
| F017. Protección de funciones exclusivas | FUNCIONA | `tests/api_security.test.ts`. Handler/actor con Auth y DB simulados rechaza rol de propietario; no confía en user_metadata. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |

### Propietario y catálogo

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F018. Inicio y panel del propietario | NO VERIFICADO | `src/app/api/auth/route.ts`, `src/components/workspace.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Verificar credenciales y sesión reales para cada DEMO. |
| F019. Editar nombre y descripción | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/workspace-settings.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Hallazgo inicial: validar nombre/descripción antes de guardar apariencia; corrección reservada al agente principal. |
| F020. Logo, portada y favicon | NO VERIFICADO | `src/components/workspace-settings.tsx`, `src/app/api/workspace/[restaurantId]/media/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Rutas privadas y carga raster implementadas; falta recorrido real de carga en este subtrabajo. |
| F021. Colores y fuentes | NO VERIFICADO | `src/components/workspace-settings.tsx`, `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Lista cerrada de fuentes y colores hex; probar resultado visual y persistencia. |
| F022. Borrador, vista previa y publicación | NO VERIFICADO | `src/components/workspace-settings.tsx`, `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Solo apariencia tiene borrador; nombre/descripción/precios no constituyen un borrador integral. |
| F023. Horarios semanales | NO VERIFICADO | `src/components/workspace-settings.tsx`, `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Un intervalo por día; validación de siete días sin repetidos. |
| F024. Categorías y subcategorías | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | SQL contiene FK compuesta y prevención de ciclos; confirmar CRUD desde la UI. |
| F025. Crear, consultar y editar productos | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/workspace.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Validación y filtro tenant implementados; recorrido remoto pendiente en este subtrabajo. |
| F026. Eliminar productos y categorías | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Revisar registros inexistentes y FK; hallazgo PGRST116 enviado al agente de base. |
| F027. Duplicar producto | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Copia privada, sin SKU; comprobar duplicación real. |
| F028. Precios y moneda | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/lib/validation.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Dinero finito no negativo con hasta dos decimales; verificar cambio público real. |
| F029. Variantes, tamaños y extras | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/public-menu.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Arrays informativos con nombre/precio; no generan pedidos. |
| F030. Ingredientes y etiquetas | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/public-menu.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Campos implementados; comprobar detalle público real. |
| F031. Disponibilidad y agotados | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/public-menu.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Estado publicado y disponible separados; comprobar UI real. |
| F032. Reordenar productos/categorías | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/components/workspace.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Orden explícito; falta recorrido persistente real en este subtrabajo. |
| F033. Promociones y fechas | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/route.ts`, `src/lib/public-menu.ts`, `src/components/public-menu.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Promociones informativas; filtro temporal comprobado con mocks, CRUD real pendiente. |
| F034. Idiomas y traducciones manuales | NO VERIFICADO | `src/components/workspace-settings.tsx`, `src/lib/i18n.ts`, `src/app/api/workspace/[restaurantId]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | es/en/fr/it/zh/ja/hi; no traducción automática del catálogo. |
| F035. Descargas QR del propietario | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/qr/route.ts`, `src/components/workspace-settings.tsx`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Propietario puede descargar; personalización QR/dominos reservada al superadmin en el diseño actual. |
| F036. Denegación de contexto ajeno y cuentas suspendidas | FUNCIONA | `tests/api_security.test.ts`. Actor/context con DB simulada verifica pertenencia antes de usar servicio y bloquea membresía/restaurante suspendidos. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |

### CSV

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F037. Parsear 1 productos UTF-8 | FUNCIONA | `tests/csv.test.ts`. Parser real ejecutado con 1 filas. No es una escritura remota. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F038. Parsear 100 productos UTF-8 | FUNCIONA | `tests/csv.test.ts`. Parser real ejecutado con 100 filas. No es una escritura remota. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F039. Parsear 999 productos UTF-8 | FUNCIONA | `tests/csv.test.ts`. Parser real ejecutado con 999 filas. No es una escritura remota. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F040. Parsear 1000 productos UTF-8 | FUNCIONA | `tests/csv.test.ts`. Parser real ejecutado con 1000 filas. No es una escritura remota. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F041. Importar 10 productos en DB real | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/import/route.ts`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | El caso exacto requerido no está en la suite CSV inicial seleccionada; corresponde integrarlo a la prueba real del agente principal. |
| F042. Importar 500 productos en DB real | NO VERIFICADO | `src/app/api/workspace/[restaurantId]/import/route.ts`, `supabase/migrations/20261017021301_initial_tenant_security.sql`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | El caso exacto requerido no está en la suite CSV inicial seleccionada; corresponde integrarlo a la prueba real del agente principal. |
| F043. Importación real de 1/100/1.000 productos | NO VERIFICADO | `tests/database.test.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Parser probado; RPC transaccional tiene evidencia PGlite histórica. Ejecución alojada pendiente de integrar. |
| F044. Previsualizar, mapear columnas y confirmar | NO VERIFICADO | `tests/database.test.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Frontend y handler implementados; validar petición real y resumen persistente. |
| F045. Omitir o actualizar existentes sin duplicados | NO VERIFICADO | `tests/database.test.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Identidad SKU exacta o nombre/categoría; evidencia SQL histórica, repetición remota pendiente. |
| F046. Rollback completo de lote inválido | NO VERIFICADO | `tests/database.test.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | RPC SQL transaccional con evidencia PGlite histórica; verificar remoto antes de declararlo E2E. |
| F047. Rechazo de 1.001 filas | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F048. Precios inválidos y ambiguos | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F049. Categoría inexistente sin autocreación | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F050. Duplicados dentro del archivo | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F051. Encabezados repetidos o faltantes | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F052. UTF-8 inválido y comillas corruptas | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F053. Comas, saltos de línea y caracteres especiales | FUNCIONA | `tests/csv.test.ts`. Validación mediante parser real; fallos de entrada no se presentan como importaciones correctas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F054. CSV completamente vacío | NO VERIFICADO | `src/lib/csv.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Código lo rechaza; no hay caso explícito dedicado en la suite inicial de 21 pruebas seleccionadas. |
| F055. Plantilla compatible conservada | FUNCIONA | `tests/import_export.test.ts`. GET sin query devuelve plantilla-productos.csv sin consultar catálogo. Contexto de acceso simulado. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F056. Exportar catálogo completo de su restaurante | CORREGIDO Y VERIFICADO | `tests/import_export.test.ts`. GET ?download=catalog probado con 2.505 filas, paginación y exclusión de otro tenant; contexto y DB simulados. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F057. Exportación vacía, privada y sin fórmulas ejecutables | CORREGIDO Y VERIFICADO | `tests/import_export.test.ts`. Conserva encabezados; UTF-8, comillas, nueva línea, neutralización de fórmulas, no-store, nosniff, 401/403/429 y errores seguros. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F058. Backup integral en CSV de imágenes/variantes/traducciones | NO IMPLEMENTADO | `src/app/api/workspace/[restaurantId]/import/route.ts`. La exportación básica contiene nombre, precio, categoría, descripción y SKU. | El CSV no sustituye un backup de base y Storage; un catálogo mayor de 1.000 filas debe dividirse para reimportarlo. |

### Menú público e interfaz

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F059. Acceso sin login a un menú activo | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Proyección pública y API implementadas; navegador con DB real pendiente en este subtrabajo. |
| F060. Categorías/subcategorías y búsqueda | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Evidencia Chrome histórica con fixtures; confirmar datos DEMO reales. |
| F061. Fotografías, descripciones y precios | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Proyección explícita; verificar objetos y referencias reales. |
| F062. Variantes/extras visibles | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Render del detalle implementado; validar contenido y lectura. |
| F063. Productos agotados | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Se muestra sin convertir el menú en sistema de pedidos. |
| F064. Promociones vigentes | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Filtrado temporal local comprobado; apariencia final real pendiente. |
| F065. Cambio de los siete idiomas | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Interfaz y fallback histórico con fixtures; no certifica traducciones completas. |
| F066. Identidad visual independiente | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Colores/logo/portada por restaurante; los tres DEMO son trabajo del agente principal. |
| F067. Favoritos locales | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Preferencia por navegador; no es persistencia comercial ni sesión Supabase. |
| F068. Enlace comercial/footer | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Proyección de platform_settings y enlaces HTTPS; comprobar destino configurado. |
| F069. Estados vacíos, error y menú suspendido | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Implementados; evidencia visual histórica con fixtures no sustituye recorrido actual. |
| F070. Móvil y escritorio | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | 22 E2E históricos Chrome en 390x844/1440x1000 con fixtures; agente frontend verifica ahora. |
| F071. Tableta, Edge y Safari | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No se ejecutaron aquí; no inferir compatibilidad por usar Chromium. |
| F072. Accesibilidad básica | NO VERIFICADO | `src/components/public-menu.tsx`, `src/lib/public-menu.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No se ejecutó auditoría automatizada/manual completa aquí. |
| F073. Excluir borradores/categorías ocultas y traducciones privadas | FUNCIONA | `tests/public_security.test.ts`. Proyección real con DB/cache simuladas; comprueba ancestros ocultos, ciclos y traducciones asociadas. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F074. Suspensión prevalece sobre caché y versión invalida contenido | FUNCIONA | `tests/public_security.test.ts`. Estado consultado fuera de caché; simulación con contenido anterior y nueva menu_version. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F075. Pedidos, carrito, checkout o pagos | NO IMPLEMENTADO | `src/components/public-menu.tsx`. Fuera del alcance solicitado: menú de consulta. | No añadir estas funciones para completar la auditoría. |

### Seguridad

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F076. Actor validado en servidor y rol persistido | FUNCIONA | `tests/api_security.test.ts`. getUser y membresía/rol DB; rechaza metadata falsificada en pruebas con mocks. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F077. Acceso cruzado por identificador | FUNCIONA | `tests/api_security.test.ts`. Rechazo antes de lectura privilegiada de restaurante ajeno. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F078. CSRF y origen oficial exacto | FUNCIONA | `tests/api_security.test.ts`. Origin debe coincidir con APP_URL; cross-site rechazado. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F079. Límite real de upload y body | FUNCIONA | `tests/api_security.test.ts`. Stream con Content-Length ausente/falso cancela al superar bytes permitidos. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F080. Rate limiting compartido y claves hash | FUNCIONA | `tests/api_security.test.ts`. Contratos RPC probados; falla cerrado y no envía identificador en claro. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F081. Errores sin secretos y respuestas privadas | FUNCIONA | `tests/api_security.test.ts`. Mensajes saneados y no-store comprobados. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F082. Imágenes públicas solo si están referenciadas | FUNCIONA | `tests/public_security.test.ts`. Sin sesión para imagen publicada; rechaza borrador y tenant ajeno antes de descargar. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F083. Paths de medios, traversal y suspensión | FUNCIONA | `tests/public_security.test.ts`. Regex/prefijo tenant, formato y estado verificados con mocks. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F084. Refresco de sesión y cookies por petición | FUNCIONA | `tests/proxy_session.test.ts`. 43 casos incluyen rotación, chunks, cabeceras, aislamiento y host; SDK/Auth simulados. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F085. Host no confiable y X-Forwarded-Host falsificado | FUNCIONA | `tests/proxy_session.test.ts`. No concede administración ni refresca sesión en dominios ajenos. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F086. Dominio personalizado restringido a su menú | FUNCIONA | `tests/proxy_session.test.ts`. Host verificado resuelve solo el restaurante asignado; sin rutas admin. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F087. RLS, grants, FK y triggers alojados | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Evidencia remota histórica db-migration-verification.json leída; no se consultó nuevamente el proyecto en este subtrabajo. |
| F088. Aislamiento con tres propietarios Auth reales | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Debe ejecutarse con A/B/C y tokens/cookies reales; mocks y PGlite no equivalen. |
| F089. Secretos fuera del cliente y Git | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | server-only y .gitignore inspeccionados; se inventariaron nombres/presencia sin valores. No es un escaneo criptográfico del bundle actual. |
| F090. Configuración de registro público alojado | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Evidencia histórica muestra disable_signup:false; comprobar estado actual antes de producción. |
| F091. Política de sesión y contraseña en Auth alojado | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | config.toml no prueba que esos ajustes estén aplicados al proyecto remoto. |
| F092. SMTP, recuperación e invitación reales | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Plantilla token_hash documentada; no se enviaron correos en este subtrabajo. |
| F093. Advisors de Supabase y auditoría formal | NO VERIFICADO | `supabase/migrations/20261017021301_initial_tenant_security.sql`, `src/lib/supabase.ts`, `src/app/api/auth/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Pendiente de evidencia ejecutada por el agente responsable. |

### QR

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F094. PNG 256/512/1024 con y sin logo | FUNCIONA | `tests/qr.test.ts`. Generación y decodificación jsQR real de seis combinaciones. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F095. SVG con texto y logo saneado | FUNCIONA | `tests/qr.test.ts`. SVG rasterizado y decodificado; escape XML y logo raster sin recursos externos. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F096. PDF con marco, texto y logo | FUNCIONA | `tests/qr.test.ts`. Extrae píxeles del PDF y comprueba identidad con PNG y decodificación. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F097. Contraste mínimo 7 y colores oscuros sobre claro | FUNCIONA | `tests/qr.test.ts`. Validador real rechaza colores insuficientes o invertidos. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F098. Zona de silencio y corrección H | FUNCIONA | `tests/qr.test.ts`. Cuatro módulos de quiet zone y ECC H comprobados en datos y píxeles. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F099. Límites de logo, texto y dimensiones | FUNCIONA | `tests/qr.test.ts`. Hasta 5 MiB/16MP logo raster, texto80, tamaño256–2048; fronteras y rechazos probados. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F100. Personalización conserva el destino | FUNCIONA | `tests/qr.test.ts`. Cambios de color/marco/logo/texto decodifican la misma URL. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F101. Token estable resuelve slug nuevo | FUNCIONA | `tests/q_resolver.test.ts`. Handler real con DB simulada; mismo UUID cambia destino al slug actual. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F102. Destino controlado sin redirección externa | FUNCIONA | `tests/q_resolver.test.ts`. Host/query/domino arbitrarios no alteran APP_URL; slug se codifica. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F103. Token inexistente o inválido y menú suspendido | FUNCIONA | `tests/q_resolver.test.ts`. 400/404 o resolución a página de estado; métricas no bloquean acceso. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F104. Tres QR DEMO con URL pública verificable | NO VERIFICADO | `src/lib/qr.ts`, `src/app/q/[token]/route.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | APP_URL actual es loopback; no hay URL pública de aplicación acreditada en las evidencias leídas. No sustituirla con un dominio inventado. |
| F105. Persistencia de QR después de cambiar dominio real | NO VERIFICADO | `src/app/q/[token]/route.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Token inmutable por SQL y resolver probado localmente; falta cambio DNS/slug real y solicitud HTTP pública de cada DEMO. |
| F106. Escaneo Android/iPhone e impresión | NO VERIFICADO | `src/lib/qr.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No hubo dispositivos físicos; decodificación automática no acredita escaneo con cámara. |

### Dominios y Render

| ID / Función | Estado | Evidencia y alcance | Pendiente o límite |
| --- | --- | --- | --- |
| F107. Validar TXT de propiedad antes de registrar | FUNCIONA | `tests/domains.test.ts`. DNS y fetch simulados; no envía petición Render sin prueba correcta. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F108. Registro explícito e idempotente en Render | FUNCIONA | `tests/domains.test.ts`. POST fijo al servicio configurado, relee conflictos409 y nunca activa dominio por el POST. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F109. Activación separada TXT+CNAME+verified | FUNCIONA | `tests/domains.test.ts`. Requiere tres comprobaciones y rechaza CNAME ajeno/proveedor pendiente. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F110. Sin SSRF por host o redirección | FUNCIONA | `tests/domains.test.ts`. Endpoint api.render.com fijo, hostname restringido, redirect:error, mensajes saneados. | El resultado se limita a las pruebas citadas; no acredita por sí solo el recorrido remoto con usuarios reales. |
| F111. Build/start/health Render | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | render.yaml inspeccionado: npm ci/typecheck/lint/test/build; npm run start y /api/health. No se ejecutó build aquí para preservar dev. |
| F112. Variables de entorno Render | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No aparecen RENDER_API_KEY/SERVICE_ID/SERVICE_HOSTNAME/EXTERNAL_URL en .env.local ni proceso observado. |
| F113. URL pública de aplicación y HTTPS | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | APP_URL clasificado loopback; repositorio GitHub público no equivale a aplicación desplegada. |
| F114. Logs y despliegue de un servicio existente | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No se accedió a cuentas Render ni se crearon servicios en este subtrabajo. |
| F115. DNS real y dominio personalizado | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No se modificó DNS ni se probó un proveedor real. |
| F116. Persistencia tras reiniciar servicio | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Datos diseñados para Postgres/Storage; requiere comprobación real de antes/después. |
| F117. Backup y restauración | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | No ejecutado; SQL no respalda objetos Storage por sí solo. |
| F118. Carga concurrente y disponibilidad comercial | NO VERIFICADO | `render.yaml`, `src/lib/config.ts`, `src/lib/domains.ts`. Código inspeccionado; no se ejecutó el recorrido real en este subtrabajo. | Benchmark PGlite histórico no prueba límites ni latencias de Render/Supabase alojados. |
| F119. Apex con ALIAS/flattening o comodines | NO IMPLEMENTADO | `src/lib/domains.ts`. La verificación actual exige CNAME directo; cada hostname se registra individualmente. | Usar subdominio con CNAME o ampliar el mecanismo con alcance y pruebas explícitos. |

## Límites de esta revisión

No se ejecutaron escaneos físicos Android/iPhone, Safari/Edge, cambios DNS, despliegues Render, backups/restauraciones ni acciones contra el proyecto original. No se enviaron correos ni se crearon usuarios desde este subtrabajo. El agente principal debe incorporar su evidencia real posterior y actualizar los estados correspondientes antes de cerrar la auditoría final.

La exportación reutiliza rangos paginados del SDK conforme a la [documentación oficial de Supabase](https://supabase.com/docs/reference/javascript/range); el patrón de respuesta sigue la documentación de Route Handlers incluida en la versión instalada de Next.
