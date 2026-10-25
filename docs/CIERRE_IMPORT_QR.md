# Cierre local de importación y QR — 18 de octubre de 2026

Esta entrega corresponde a los requisitos 6 y 7 de la reparación funcional. Son cambios locales y pruebas con PostgreSQL PGlite o endpoints sintéticos. No aplica migraciones a Supabase, no modifica el catálogo existente y no despliega Render.

## Importación

`src/components/import-panel.tsx` sustituye el panel anterior. `import-progress.tsx` mide la lectura con FileReader y la transferencia con XMLHttpRequest. El porcentaje sólo representa bytes conocidos; la validación, el guardado atómico y la consulta de un resultado incierto son indeterminados. El 100 % de la transferencia no se presenta como confirmación de guardado. El éxito requiere el resultado confirmado del servidor, con conteos de creados, actualizados, omitidos y rechazados.

Antes del POST se guarda localmente un UUID de intento, la huella del contenido/opciones, nombre del archivo y fecha. No se guarda el CSV. El bloqueo inmediato evita el doble clic; Web Locks serializa intentos del mismo restaurante entre pestañas compatibles. Tras perder la respuesta o recargar, el panel consulta `GET /api/workspace/{id}/import?attempt={UUID}`. Un resultado ausente se muestra como **sin confirmar**, nunca como cancelación. Reenviar el mismo archivo/opciones conserva el UUID. Un rechazo explícito de validación anterior a la transacción permite corregir y volver a validar; otros errores mantienen la recuperación pendiente.

La migración incremental `20261018053802_import_attempts_and_qr_versions.sql`, creada mediante `supabase migration new`, añade `private.import_attempts` y RPCs autenticadas. La identidad del actor procede de la sesión del servidor; el RPC compara `auth.uid()` y permisos del restaurante. El soporte con service role requiere un administrador activo. Propietarios pendientes de restablecer/cambiar contraseña tampoco pueden importar ni consultar intentos.

El RPC bloquea la fila del restaurante y confirma catálogo, categorías, journal y auditoría en una transacción. El subbloque revierte todo el lote si una fila tardía falla. Las traducciones encoladas por los triggers de la plataforma participan de esa misma transacción. El journal conserva sólo huellas y conteos, sin filas del CSV ni mensajes internos SQL. Un UUID repetido con contenido diferente da conflicto; el mismo contenido devuelve el resultado anterior. No se expone la tabla privada a propietarios. Los respaldos posteriores deben incluir este journal privado.

Las traducciones tienen estado independiente en **Idiomas**. Guardar productos no implica haber llamado al proveedor ni haber completado las traducciones. No se añadió ningún envío de correos.

La búsqueda ampliada encontró `tolentino_123_productos_prueba.csv` en el Escritorio. Se leyó en memoria y se verificó con `scripts/verify-csv-file-local.mjs`: 123 filas válidas/SKU únicos, exactamente 123 altas en PostgreSQL local vacío, reenvío del mismo intento sin nuevas escrituras y otro intento en modo omitir con 123 omitidos y 123 filas totales. La evidencia saneada está en `docs/evidence/closure-csv123-actual.json`; no se copió su contenido al repositorio ni se importó a Supabase. También se entrega `tests/fixtures/productos-equivalentes-123.csv`, sintético, para regresiones portables sin depender del archivo del usuario.

## QR

`qr-settings.tsx` comparte el generador del servidor con las descargas. El soporte dispone de texto, colores, marco, tipografía predefinida, tamaño de exportación, logo y módulos cuadrados/suaves. Los propietarios descargan la configuración guardada. Cada respuesta informa la URL permanente construida por el servidor; el navegador no reconstruye esa identidad usando un dominio personalizado. El token no cambia al editar diseño o slug.

El generador conserva ECC H, al menos cuatro módulos de silencio, contraste mínimo 7:1 y primer plano oscuro. El logo raster permitido se normaliza con Sharp, tiene límite de 5 MB/resolución y placa de contraste de hasta 14 % del **lado** del símbolo; no es 14 % del área. Los patrones reservados siguen cuadrados y se redibujan sobre el logo cuando coinciden con él. No se aceptan logos SVG ni tipografías/estilos arbitrarios. El texto se escapa y tiene límite de 80 caracteres.

Cada exportación se compone completa y se decodifica con jsQR antes de entregarse. PNG se comprueba terminado; SVG se rasteriza completo; PDF se abre con PDF.js y su página real se renderiza con `@napi-rs/canvas`. No se sustituye la comprobación del PDF por extraer su imagen incrustada. Se comprueba además una escala reducida. El renderizador limita la cola concurrente. Se añadieron dependencias de ejecución fijadas: `pdfjs-dist@6.4.299`, `@napi-rs/canvas@1.0.11` y `jsqr@1.4.0`.

`saveQrConfiguration` valida PNG, SVG y PDF antes de escribir. La RPC actualiza sólo la versión esperada e incrementa `config_version`; una sesión desactualizada recibe conflicto, sin sobrescribir el diseño más nuevo. La previsualización del borrador no guarda nada. AbortController y un contador de petición descartan respuestas obsoletas. Una edición inválida mantiene visible la última imagen válida, muestra el error e inhabilita guardar/exportar. Un borrador válido debe guardarse antes de descargarse.

## Verificación y límites

Regresiones reproducidas antes de implementar: 13 casos QR fallaban por opciones ignoradas/validador final ausente; 9 casos de journal fallaban por ausencia de `import_products_attempt`. El primer montaje PGlite también necesitó los stubs de Auth de la migración de acceso del propietario; ese fallo de arnés no se cuenta como defecto del producto.

Pruebas implementadas:

| Archivo | Cobertura |
| --- | --- |
| `tests/import_attempts.test.ts` | PostgreSQL local: 1/123/1000 filas, reenvío idempotente, omisión posterior, rollback por última fila inválida, vacío/1001, contenido cambiado, aislamiento/actor, reset y primer cambio, versión QR/token |
| `tests/import_protocol.test.ts` | Handler HTTP con BD simulada: UUID obligatorio, actor del servidor, conteos, recuperación completa/fallida/ausente, conflicto y rechazo antes de commit |
| `tests/qr_closure.test.ts` | Composición completa con logo/texto/marco/módulos suaves: PNG/SVG/PDF a 256/512/1024 y escala reducida; URL insegura, opciones no admitidas y artefacto ilegible |
| `tests/qr_save.test.ts` | Guardado condicionado a los tres formatos, fallo PDF sin escritura, logo excesivo, conflicto de versión, origen canónico |
| `tests/csv_123_fixture.test.ts` | Archivo equivalente de 123 productos sin filas omitidas |
| `tests/e2e/import-qr-closure.spec.ts` | Chrome con fixtures: doble clic, respuesta perdida, recarga, reenvío mismo UUID, respuestas QR fuera de orden, último diseño válido y exportación bloqueada |
| `tests/e2e/audit-downloads.spec.ts` | Errores de descarga CSV/QR no se guardan como archivos; nombre de exportación correcto |

Los resultados focalizados previos fueron 89/89 en siete suites, 12/12 después de ampliar PGlite y 13/13 en los nuevos handlers/guardado. Estos conteos **se solapan**; no deben sumarse como ejecuciones únicas. La ejecución final consolidada terminó con **106/106 pruebas en 10 suites** y **10/10 escenarios Chrome de escritorio/móvil**. Evidencia: `docs/evidence/closure-import-qr-unit.json` y `closure-import-qr-browser-final.json`. `tsc --noEmit --incremental false` y lint focalizado de los archivos de implementación pasaron.

El primer pase del navegador queda preservado en `closure-import-qr-browser-initial.json`: un clic durante la recarga de desarrollo no abrió el panel y el arnés intentaba leer un blob con `fetch`, bloqueado correctamente por CSP. El siguiente pase, con espera de hidratación y captura del blob por el arnés, completó los tres escenarios de escritorio. No se relajó CSP.

Pendientes fuera de esta evidencia local: aplicación coordinada de la migración después del respaldo, build/despliegue y aceptación contra el entorno nuevo, concurrencia real entre conexiones PostgreSQL independientes, desempeño y memoria del PDF en Render Free, teléfonos/cámaras físicos e impresión. PGlite verifica transacciones y permisos SQL; no emula GoTrue ni Storage HTTP. Las pruebas del navegador usan fixtures y no certifican persistencia remota. La decodificación automática no se presenta como escaneo físico.
