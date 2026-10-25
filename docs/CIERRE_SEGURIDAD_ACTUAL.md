# Seguridad: verificación actual

25 de octubre de 2026. La consulta directa verificó RLS en las 16 tablas públicas y capturó los permisos de funciones. Las pruebas unitarias/SQL de aislamiento pasan y la integración real anterior acreditó 160 comprobaciones entre tres propietarios.

La API administrativa de Supabase responde 401 con la credencial local actual; el conector MCP tampoco tiene permiso para get_advisors. Esto no se interpreta como cero advertencias. Queda pendiente volver a consultar los advisors y las URLs Auth mediante una credencial administrativa vigente. La configuración pública de Auth sigue mostrando registro público y anónimo deshabilitados. El acceso real y las rutas de datos se verifican por separado.

Evidencia de la consulta fallida y verificaciones SQL: [advisors-after-schema.json](evidence/functional-closure-20261018/advisors-after-schema.json). No se cambió la configuración Auth durante esta fase ni se debilitó RLS. La configuración de SMTP propio continúa pendiente por no tener proveedor.
