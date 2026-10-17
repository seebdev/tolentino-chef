# Administración

## Tolentino

El superadministrador accede a `/admin`. Puede buscar y filtrar restaurantes, dar de alta un cliente y su propietario, registrar venta/moneda/notas, suspender o reactivar el restaurante y restablecer el acceso del dueño. El catálogo nuevo queda vacío.

El alta crea una cuenta Auth con una contraseña aleatoria que no se muestra ni se guarda en tablas comerciales. Una RPC transaccional crea restaurante, membresía, configuración y venta. Si esa transacción falla, se intenta eliminar exclusivamente el usuario recién creado y se registra cualquier compensación fallida. Después se envía el correo para definir contraseña. Si falla el correo, la cuenta y el restaurante permanecen consistentes y el panel informa que debe reintentarse el acceso.

El email de acceso no cambia desde el formulario comercial: una sustitución de propietario requiere un procedimiento administrativo verificado. No se asignan permisos por coincidir un email. Una actualización de restaurante y venta se guarda en una sola transacción.

**Abrir administración** entra en un contexto explícito con la banda **Administrando como Tolentino**. El soporte no necesita la contraseña del cliente. Desde este contexto se editan datos del menú, branding, QR y dominios; cada acción de soporte registra un evento técnico. La suspensión del acceso del propietario es independiente del estado público del restaurante.

El contacto del footer se configura en superadmin con un enlace HTTPS. Si está vacío, el menú no muestra un destino inventado. La aplicación dispone también de una operación para copiar diseño a un restaurante existente, eliminando rutas de imágenes para evitar referencias cruzadas; no copia propietarios ni ventas.

## Propietario

- Productos: crear, editar, duplicar como borrador, publicar/ocultar, agotar/disponibilizar, destacar, ordenar, asignar categoría y eliminar con confirmación. Imagen JPG/PNG/WebP, descripción, precio, ingredientes, etiquetas, variantes y extras informativos.
- Categorías: crear, editar, ordenar, ocultar y gestionar subcategorías. La base impide borrar categorías que dejarían relaciones huérfanas.
- Promociones: título, texto, vigencia y activación.
- Apariencia: logo, portada, favicon, fuente, colores y vista previa. Guardar borrador y publicar son acciones distintas para la apariencia; nombre y descripción se guardan al editar los datos del restaurante.
- Horarios: un horario por día, o cerrado. No incluye intervalos partidos ni calendario de festivos.
- Idiomas: seleccionar principal y disponibles; editar traducciones de productos/categorías. No hay traducción automática ni costos de IA.
- CSV: mapeo, previsualización y transacción de hasta 1.000 productos.
- QR: consultar y descargar PNG, SVG y PDF. Solo Tolentino puede cambiar su diseño; no se puede cambiar su destino a otro restaurante.
- Cuenta: cambiar contraseña desde sesión válida o recuperación segura.

No existen cuentas de empleados, pagos, compras, pedidos ni carrito. No se limita el propietario a datos del navegador: las operaciones de negocio dependen de Supabase. Solo favoritos públicos se conservan localmente, separados por restaurante.

## Suspensión

El servidor consulta estado y membresía en cada operación. Suspender la membresía impide administrar aun con una cookie anterior. Suspender el restaurante bloquea sus propietarios y muestra un estado público controlado; no elimina productos. Reactivar conserva los datos. El superadministrador puede entrar como soporte mientras está suspendido.
