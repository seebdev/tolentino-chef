# Importar productos desde CSV

Desde **Importar productos**, descargar la plantilla, subir un CSV UTF-8, asignar columnas, validar y confirmar. Se admiten 1–1.000 filas y hasta 5 MB. Los separadores reconocidos son coma, punto y coma, tabulador y barra vertical. Las comillas permiten comas o saltos de línea dentro de un campo.

| Campo       | Regla                                                          |
| ----------- | -------------------------------------------------------------- |
| nombre      | Obligatorio, hasta 160 caracteres                              |
| precio      | Positivo o cero, sin separadores de miles, hasta dos decimales |
| categoria   | Obligatoria, hasta 100 caracteres                              |
| descripcion | Opcional, hasta 3.000 caracteres                               |
| sku         | Opcional, código exacto de hasta 80 caracteres                 |

`12500`, `12500.50` y `12500,50` son precios válidos. En CSV separado por comas, entrecomillar un decimal con coma. `12.500` se rechaza por ambiguo; usar `12500`. No se interpretan notación científica, moneda, Infinity ni expresiones.

Se muestran errores por fila/columna y un resumen antes de guardar. Filas duplicadas dentro del mismo archivo deben corregirse. Ante productos ya existentes se puede **omitir** o **actualizar**: se usa SKU exacto si existe; en su ausencia, nombre y categoría con espacios exteriores eliminados y comparación sin distinción de mayúsculas. Los acentos se conservan. Varias coincidencias impiden actualizar. El usuario debe elegir expresamente actualizar.

Las categorías se crean solo si la opción está activa. El servidor confirma todas las relaciones y ejecuta `import_products` dentro de una sola transacción. Un fallo no deja productos parciales ni categorías huérfanas. La operación mantiene propiedades existentes no incluidas en el CSV. Imágenes, variantes, extras y traducciones se gestionan después en el panel; el CSV no descarga URLs externas.

La plantilla y el helper de exportación neutralizan campos que puedan interpretarse como fórmulas (`=`, `+`, `-`, `@` y caracteres iniciales de control). Los archivos rechazados no se almacenan. No existe un exportador comercial completo en esta versión; el helper debe usarse en cualquier exportación futura.

Evidencia: `tests/csv.test.ts` valida delimitadores, UTF-8, mapeo, límites 1/100/999/1000/1001, duplicados y errores. `tests/database.test.ts` ejecuta la transacción real, aislamiento, rollback y carga bajo RLS. Los tiempos locales se registran en el reporte QA.
