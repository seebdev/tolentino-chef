# Cierre funcional — Tolentino Chef

Actualización: 25 de octubre de 2026. Estado: VALIDACIÓN LOCAL COMPLETADA / PUBLICACIÓN Y SMOKE PENDIENTES.

## Destinos y preservación

Repositorio: https://github.com/seebdev/tolentino-chef. Servicio único Render: srv-dba32beq1p3s73a4g6v0, workspace tea-dba1s4m1egvs7391ve50, plan Free Virginia. Supabase: hgntppemxwcxaxritnfq. URL canónica: https://tolentino-restaurantes-admin.onrender.com. No se modificaron el Supabase anterior ni Crepes & Waffles.

Respaldo cifrado del 25 de octubre: target-final-hgntppemxwcxaxritnfq-20261025T065225059Z.json.enc, SHA256 b4b805e7919df65d62ac2b705c5f1313733e1f40fd16ebf39abf1093c970bb3a. Restauración aislada: 104 comprobaciones PASS, sin peticiones remotas. Incluía temporalmente 3 restaurantes de pruebas además de las 3 muestras. Esos 3 temporales, sus 3 cuentas y 3 imágenes ya se limpiaron mediante el manifiesto de propiedad; los originales quedaron idénticos. El registro de gasto y la auditoría se conservaron.

## Matriz de aceptación

| Área | Causa reproducida y corrección | Evidencia / estado |
|---|---|---|
| Apariencia y publicación | Dos renderizadores, payloads parciales y revisiones ausentes. Renderer compartido, iframe de viewport real, borrador privado y publicación atómica CAS. | 12 comprobaciones reales PASS; conflicto devuelve 409 en 1,18 s. |
| Columnas y recomendaciones | Columnas móviles ignoradas y recomendaciones ocultas por filtros. Ajustes independientes móvil/escritorio; tablet usa breakpoint documentado. | 48 pruebas en Chrome, Firefox, WebKit y Edge; matriz 320/390/768/1440. |
| Idiomas y banderas | Faltaban recursos locales y contrato de traducción completo. SVG MIT y diccionarios es/co, en/gb, fr/fr, it/it, zh/cn, ja/jp, hi/in. | Persistencia por restaurante y pruebas de teclado, contenido y recursos. |
| Importación | Respuesta perdida podía duplicar filas. Intento durable, transacción única, recuperación por ID y etapas de progreso reales. | 15 comprobaciones reales PASS: CSV 1/123/1000, duplicados, respuesta perdida, 1001 y datos inválidos. |
| QR | Faltaba validar la composición final. Generador compartido, contraste, zona silenciosa y validación PNG/SVG/PDF mediante lector independiente; PDF se rasteriza. | 106 pruebas unitarias de importación/QR y 10 de navegador en la evidencia especializada; smoke público final separado. |
| Acceso propietario | Faltaban alias, contraseña temporal y revocación. Creación administrativa idempotente, cambio inicial obligatorio y soporte identificado. | 160 comprobaciones reales de seguridad PASS; seis direcciones de aislamiento API/RLS/Storage/QR/trabajos. |
| Variantes | Omitirlas podía enviar lista vacía. Se retiró el formulario y se preservan columnas omitidas. | Integración real conserva variantes, extras, ingredientes, precio y categoría. |
| Muestras | Textos DEMO e ilustraciones de semilla. Cambios limitados a IDs/SKU/textos/hashes esperados; sin restaurar a 24 productos. | 46/72 productos con foto revisada; 26 sin foto adecuada. 123 importados excluidos. Aplicación: pendiente tras publicar créditos. |
| Footer | Faltaba identidad global consistente. Tolentino Chef, 3108853158 y enlace wa.me/573108853158 con introducción traducida; propietario no modifica configuración global. | Renderer público y preview compartidos; ningún mensaje enviado. |
| Traducción automática | No había ejecutor persistente. Cola, hash fuente, presupuesto acumulado, proveedor estructurado y procedencia manual por campo. | Fixtures PASS; proveedor rechazó clave. Usuario retiró gasto: desactivada, presupuesto 0, traducción real pendiente por decisión explícita. |
| Dominios personalizados | Middleware bloqueaba banderas, versión y créditos. Permisos limitados al menú propio y recursos exactos. | 63 regresiones de proxy PASS. |
| Regresión | Resultados históricos no acreditan esta versión. | 411/411 pruebas automáticas PASS; typecheck/lint/build y smoke con evidencia separada. |
| Despliegue | Producción anterior ae0f7cb. | Pendiente: no se declara publicado hasta comprobar SHA y rutas públicas. |

## Informes y pruebas

- [Menú y apariencia](CIERRE_MENU_APARIENCIA.md).
- [Importación y QR](CIERRE_IMPORT_QR.md).
- [Traducciones](CIERRE_TRADUCCIONES.md).
- [Fotografías y licencias](CIERRE_FOTOS_MUESTRAS.md).
- [Importación real](evidence/functional-closure-20261018/content-live-integration.json).
- [Aislamiento real](evidence/functional-closure-20261018/closure-owner-security.json).
- [Limpieza temporal](evidence/functional-closure-20261018/closure-temporary-cleanup.json).
- [Retirada de presupuesto](evidence/functional-closure-20261018/translation-disabled-by-user.json).

## Guía breve

El superadministrador entra por /login y accede a /admin. El propietario usa el mismo /login con su correo o alias; el servidor lo dirige a /dashboard y sólo autoriza su restaurante. La opción administrativa de acceso permite asignar/restablecer una contraseña temporal que debe cambiar al entrar.

En Apariencia: modificar previsualiza localmente, Guardar conserva un borrador y Publicar lo hace visible. Nombre, descripción y apariencia comparten revisión. Catálogo, horarios, promociones e idiomas se guardan por separado y pueden reflejarse públicamente al confirmar; no son borrador integral. Ante conflicto, conservar cambios locales y recargar la versión nueva antes de volver a guardar.

Para importar, validar el CSV y esperar la confirmación del guardado. Si se pierde respuesta, recuperar el intento; no iniciar un ID nuevo sin consultar el anterior. El progreso de subida no equivale a filas confirmadas.

## Límites que no se presentan como PASS

SMTP propio todavía no configurado: no se ha acreditado entrega de recuperación de acceso por correo. Traducción con OpenAI desactivada por decisión del usuario; el contenido disponible se conserva y lo faltante usa la fuente. 26 productos de muestra no tienen foto adecuada. El escaneo físico Android/iPhone, Safari en iPhone e impresión de PDF requieren prueba del usuario; WebKit emulado no los sustituye.

Prueba física: abrir cada menú con datos móviles; escanear PNG y PDF impreso a tamaño real desde otra pantalla/cámara, comprobar HTTPS y el restaurante correcto, cambiar idioma, buscar, abrir producto y volver. Registrar dispositivo/navegador y cualquier fallo.

## Recuperación y rollback

Conservar el respaldo cifrado y su clave DPAPI fuera de Git. Probar restauración sólo con scripts/migration-target-final-restore-local.mjs y el hash exacto; nunca apuntar una restauración de ensayo a producción. DPAPI depende del usuario/equipo Windows: una custodia externa exige exportación segura de la clave, no copiar sólo el archivo cifrado.

Para un fallo de aplicación, volver al último deploy conocido en el mismo servicio Render, manteniendo APP_URL y variables. Las migraciones son incrementales: no ejecutar rollback destructivo de tablas ni restaurar catálogos antiguos. Para las fotos, el diario local conserva rutas anteriores en el plan y las nuevas; los objetos históricos no se borraron. Revertir únicamente los campos afectados tras verificar que no hubo una edición posterior. Una restauración completa de Auth/Storage/DB requiere revisión coordinada, no un reemplazo automático del destino.
