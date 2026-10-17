# Auditoría de la referencia

Fecha: 16 de octubre de 2026. Revisión estática, exclusivamente de lectura.

## Alcance y preservación

Carpeta examinada: `crepes menu`. Proyecto anidado: `b_lBKxOiXN1f8`. No se ejecutó código, instalación, build, pruebas ni comandos Git dentro del original. No se copiaron logotipos, fotografías, productos ni textos de marca al producto nuevo. No se leyeron valores de archivos `.env`; no se encontraron archivos con ese nombre en el inventario revisado. No se encontró `AGENTS.md` dentro de la referencia.

`docs/evidence/reference-before.json` registra SHA256, tamaño y ruta de 1803 archivos, incluyendo `.git`. Ese inventario detallado se conserva solo en el equipo y está excluido de Git; el resultado resumido de verificación sí se publica. Exclusiones explícitas: directorios `node_modules`, `.next`, `.turbo`, `dist` y `build`. Los hashes acreditan el estado inicial de los archivos incluidos; no representan cobertura de los directorios excluidos. La comparación final se realizó contra este inventario sin escribir en la referencia. Las evidencias publicables sustituyen las rutas personales del equipo por rutas relativas sin alterar resultados.

Se intentó consultar la demo pública y su pantalla de login con la herramienta web: ambas URLs resultaron inaccesibles. El navegador disponible para automatización devolvió inventario vacío. Por tanto, despliegue, comportamiento real de la demo y credenciales válidas son **no verificables**. No se enviaron credenciales ni mutaciones a la demo.

## Criterio de estados

- **Comprobado**: presencia y comportamiento trazable en código leído; no implica una prueba ejecutada.
- **Incompleto**: implementación existente con limitaciones o conexión funcional faltante identificada.
- **No verificable**: requiere ejecución, configuración externa o evidencia no disponible.
- **Inexistente**: no se encontró implementación en las rutas, componentes, dependencias y modelos examinados.

Todas las rutas siguientes son relativas al proyecto anidado.

## Arquitectura comprobada

| Elemento     | Evidencia                                                                                   | Resultado                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework    | `package.json`, `app/layout.tsx`                                                            | Next.js 16.2.4, App Router; React ^19; TypeScript 5.7.3.                                                                                   |
| Interfaz     | `package.json`, `components/ui`, `components.json`                                          | Tailwind 4.2, componentes Radix/shadcn, Lucide.                                                                                            |
| Rutas        | `app/page.tsx`, `app/cliente/page.tsx`, `app/admin/page.tsx`, `app/admin/login/page.tsx`    | `/` redirige a `/cliente`; administrador y acceso separados.                                                                               |
| API          | `app/api/admin/login/route.ts`, `app/api/admin/logout/route.ts`, `app/api/ratings/route.ts` | Solo login/logout y valoraciones. No hay API para guardar o publicar catálogo.                                                             |
| Estado       | `lib/menu-context.tsx:43`                                                                   | React Context con categorías y apariencia; almacenamiento local del navegador.                                                             |
| Modelos      | `lib/types.ts`                                                                              | Producto, categoría y estilo. Sin tenant, organización, membresía, suscripción ni versiones de publicación.                                |
| Catálogo     | `lib/definitivosProductos.json`, `lib/menu-products/*.json`                                 | Datos estáticos importados al cliente. Siete catálogos localizados con 253 productos y 22 categorías cada uno.                             |
| Herramientas | `package.json`                                                                              | Scripts dev (puerto 4200), build, start, lint, test y test:watch. `eslint` no está declarado como dependencia directa pese al script lint. |

## Funcionalidades administrativas

| Funcionalidad                                                                                                              | Estado     | Evidencia y límite                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pantalla de acceso                                                                                                         | Comprobado | `components/menu-editor/login-gate.tsx` envía POST a `/api/admin/login`.                                                                                                               |
| Protección de `/admin`                                                                                                     | Comprobado | `proxy.ts` comprueba la sesión y redirige al login.                                                                                                                                    |
| Navegación Productos / Diseño / Vista previa                                                                               | Comprobado | `components/menu-editor/admin-app.tsx:24`.                                                                                                                                             |
| Crear, editar, borrar categorías                                                                                           | Incompleto | `product-editor.tsx` y `menu-context.tsx`: modifica estado local; cliente/preview ignoran esas categorías. Borrado directo sin confirmación ni recuperación.                           |
| Crear, editar, borrar productos                                                                                            | Incompleto | `product-editor.tsx`: nombre, descripción, precio, imagen, cambio de categoría. Validación mínima; precio no impide negativos. Cambios no llegan al catálogo renderizado.              |
| Carga de imagen individual                                                                                                 | Incompleto | `product-editor.tsx`, `design-editor.tsx`: FileReader/data URL local; sin almacenamiento remoto ni límites explícitos de bytes/dimensiones.                                            |
| Carga masiva de imágenes                                                                                                   | Incompleto | `product-editor.tsx:60`: crea productos pendientes a partir del nombre del archivo; mismo límite de persistencia.                                                                      |
| Organización automática                                                                                                    | Comprobado | `menu-context.tsx`: reclasificación por palabras clave estáticas. No es IA. Puede reemplazar la organización manual; sin undo.                                                         |
| Exportar JSON                                                                                                              | Comprobado | `admin-app.tsx:38`: Blob con categorías y estilo. No se encontró importación complementaria.                                                                                           |
| Publicar                                                                                                                   | Incompleto | `admin-app.tsx:52`: solamente copia `${origin}/cliente` al portapapeles y abre preview. No publica datos ni genera versión pública.                                                    |
| Preview móvil/tablet/escritorio                                                                                            | Comprobado | `admin-app.tsx`: contenedores 390×844, 768×1024 y 1280×800 que renderizan `ClientMenu`.                                                                                                |
| Colores generales, logo, portada, título y fuente                                                                          | Comprobado | Editores actualizan estilo; `client-menu.tsx` consume esos campos. Sigue siendo estado local.                                                                                          |
| Colores de categorías                                                                                                      | Incompleto | Editor altera categorías del Context; `ClientMenu` usa categorías estáticas localizadas.                                                                                               |
| Tipografías por tamaño, columnas, tarjetas, espacios, alineación, bordes, tamaño/posición de imagen y encabezado/subtítulo | Incompleto | Controles presentes en `design-editor.tsx`, pero no consumidos por `ClientMenu`. `menu-preview.tsx` sí implementa varios; no hay consumidor de ese componente en la aplicación actual. |
| Cerrar sesión desde la interfaz                                                                                            | Incompleto | Existe endpoint de logout, pero no se encontró botón ni consumidor en los componentes administrativos.                                                                                 |

## Hallazgo funcional principal

`components/menu-editor/client-menu.tsx:64` calcula `menuDataByLanguage[language] ?? categories`. Los siete idiomas están definidos en `lib/types.ts`; por tanto, nunca llega al estado editable del Context para un idioma admitido. La vista previa administrativa utiliza este mismo componente. Agregar, editar o borrar un producto o categoría puede verse en el editor y en la exportación, pero no modifica el menú cliente ni la vista previa. El mismo defecto afecta colores de categorías.

Además, `lib/menu-context.tsx:61` restaura categorías estáticas cuando cambia una firma calculada del catálogo. Esa firma depende de cantidad, nombres de categorías y solo el primer/último producto; no es un esquema versionado ni una migración completa. Un cambio de firma puede descartar ediciones locales.

## Menú público e idiomas

| Funcionalidad                   | Estado      | Evidencia                                                                                                                                                                     |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buscar por nombre y descripción | Comprobado  | `client-menu.tsx:84`: filtrado local con `useDeferredValue`; ignora mayúsculas, no normaliza acentos.                                                                         |
| Filtrar categorías              | Comprobado  | `client-menu.tsx`: botones y estado `activeCategory`.                                                                                                                         |
| Ampliar fotografía              | Comprobado  | `ProductModal` en `client-menu.tsx`.                                                                                                                                          |
| Valoraciones de 1 a 5           | Incompleto  | Interfaz, GET/POST y agregados implementados; integridad, concurrencia y persistencia tienen limitaciones descritas abajo.                                                    |
| Favoritos                       | Comprobado  | Lista de productos con votos ordenados por promedio y cantidad. Es ranking compartido, no favoritos personales.                                                               |
| Siete idiomas                   | Comprobado  | Español, inglés, francés, italiano, chino, japonés e hindi en `lib/menu-i18n.ts:60`, `lib/menu-products`.                                                                     |
| Traducción de nuevas ediciones  | Incompleto  | Catálogos estáticos y diccionarios; no hay workflow administrativo de traducción ni API de traducción. El fallback por palabras devuelve original si no puede traducir todas. |
| Monedas                         | Incompleto  | Todos los idiomas conservan COP; cambia formato regional, no moneda ni valor.                                                                                                 |
| Persistir idioma                | Inexistente | Estado comienza en `es`; no se encontró almacenamiento de preferencia.                                                                                                        |

## Persistencia y seguridad

1. **Catálogo y apariencia locales:** `lib/menu-context.tsx:50–78` utiliza `localStorage`. No hay sincronización entre usuarios, dispositivos o tenants; tampoco transacción, validación de esquema, backup, borrador/publicación o resolución de conflictos. Escrituras locales no capturan error de cuota. Data URLs grandes pueden agotar almacenamiento.
2. **Sesión firmada:** `lib/admin-auth.ts` usa HMAC-SHA256 con expiración de ocho horas; cookie HttpOnly, SameSite Strict y Secure en producción. `ADMIN_USER`/`ADMIN_PASSWORD` son variables de servidor. Existe un par de credenciales de desarrollo literal dentro del código; sus valores no se reproducen aquí y no deben trasladarse al producto nuevo. El secreto cae a la contraseña si no existe `ADMIN_SESSION_SECRET`.
3. **Cuenta única:** no existen usuarios persistidos, roles, memberships, MFA, recuperación de contraseña, revocación individual o registro de auditoría. No hay multitenancy ni aislamiento por restaurante.
4. **Rate limit local:** `app/api/admin/login/route.ts` usa Map global de proceso y cinco fallos por diez minutos. No coordina instancias ni persiste reinicios; identifica cliente con encabezados IP cuya confianza depende de infraestructura. No equivale a protección distribuida verificada.
5. **Valoraciones manipulables:** POST acepta cualquier `itemId` no vacío y confía en `previousRating` remitido por cliente; no verifica pertenencia al catálogo, identidad ni voto previo en servidor. No hay rate limit del endpoint. `lib/ratings-store.ts` puede recalcular agregados con votos previos inventados.
6. **Concurrencia y durabilidad de valoraciones:** Redis REST opcional mediante variables KV/Upstash, operaciones GET y SET del objeto completo; no hay incremento atómico o transacción. Si falla o no está configurado, cae silenciosamente a memoria de proceso. Infraestructura Redis real: **no verificable**.
7. **Validación de build:** `next.config.mjs` tiene `typescript.ignoreBuildErrors: true`; un build exitoso por sí solo no acreditaría corrección de tipos. Imágenes no optimizadas. `tsconfig.json` declara `strict: true`, pero el build omite sus errores.
8. **Errores de red:** login tiene `finally` sin `catch`, y el cliente actualiza el voto local antes del POST sin revertirlo cuando falla. No se verificó visualmente el tratamiento de estos fallos.

No se diagnosticaron vulnerabilidades de versiones concretas ni se atribuye seguridad de producción a la existencia de estas comprobaciones estáticas.

## Pruebas existentes

Se encontraron seis archivos y 19 casos `it`: `lib/admin-auth.test.ts` (2), `lib/ratings-store.test.ts` (2), `lib/types.test.ts` (3), `lib/menu-i18n.test.ts` (3), `lib/menu-products.test.ts` (6), `components/menu-editor/client-menu.test.tsx` (3). Vitest/jsdom y Testing Library están configurados en `vitest.config.ts` y `vitest.setup.ts`.

Cubren firma y alteración de sesión, comparación de secretos, agregados de votos, catálogo, diccionarios y renderización/cambio de idioma. Los tests de cliente mockean simultáneamente Context y catálogos estáticos, por lo que no prueban que editar en administración modifique el menú publicado. No se encontraron suites E2E, comprobaciones de aislamiento, ciclo completo editor→preview→publicación, concurrencia Redis, accesibilidad o QR. **Resultados de ejecución: no verificables; no se ejecutó el original.**

## Capacidades inexistentes en el código revisado

Plataforma multi-restaurante; onboarding; CRUD de restaurantes; sucursales; membresías y roles; planes/cobros; dashboard con métricas reales; configuración por tenant; dominios propios; DNS/verificación de dominio; tokens públicos estables; QR generado/personalizable; exportación PNG/SVG/PDF de QR; almacenamiento de medios remoto; revisiones/publicación y rollback; auditoría administrativa; notificaciones; pedidos/pagos/reservas; API de edición del catálogo; eliminación/restauración lógica; importación CSV/JSON; administración de traducciones.

La carpeta exterior incluye un PNG de QR, pero eso no prueba generador, token estable, personalización, destino dinámico ni integración con la aplicación.

## Decisiones para el producto independiente

Conservar como requisitos funcionales generales la edición de categorías/productos, imágenes, apariencia, idiomas y preview. Implementarlos con modelos propios, aislamiento por restaurante, validación de servidor, publicación real, tokens QR estables y pruebas integrales. No heredar la persistencia exclusivamente local, credenciales literales, bypass de tipos, datos estáticos como fuente de un menú administrable ni etiquetas de publicación que solo copian una URL.
