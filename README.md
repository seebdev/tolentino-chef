# Tolentino Restaurantes Admin

Repositorio: [tolentinosftw-dotcom/tolentino-chef](https://github.com/tolentinosftw-dotcom/tolentino-chef).

Una aplicación Next.js para administrar múltiples restaurantes con Supabase Auth, Postgres y Storage. Una venta única por restaurante; no incluye suscripciones, empleados, pedidos, carrito ni pagos.

## Estado de esta entrega

El código, migraciones y pruebas se encuentran en este proyecto independiente. El proyecto Supabase elegido es `ylcnrfzosjzuljufwups`; sus variables públicas están configuradas localmente y su endpoint Auth responde. La migración remota sigue pendiente de una conexión PostgreSQL accesible y falta la clave secreta de servidor. La aplicación **requiere Supabase** para operar: no contiene una base simulada ni un acceso de demostración. Sin las variables necesarias, el acceso muestra que falta la conexión y el health endpoint responde 503. La publicación en Render y la aceptación completa con Auth/Storage remotos están pendientes; consultar `docs/QA_REPORT.md` y `docs/PENDIENTES.md`.

El proyecto original `crepes menu` se inspeccionó exclusivamente en lectura. No se copiaron sus credenciales, fotografías, logos, catálogo comercial ni repositorio Git. Evidencia de integridad y alcance: `docs/evidence/reference-verification.json`.

## Ejecutar en Windows

Requisito: Node 22. También se descargó y verificó un runtime local en `.runtime/node-v22.23.3-win-x64`, excluido del repositorio.

```powershell
# Desde la raíz del proyecto:
# Solo si el Node global es anterior a 22:
$env:Path=(Resolve-Path '.runtime/node-v22.23.3-win-x64').Path+';'+$env:Path
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
# Completar .env.local con el proyecto NUEVO, antes de iniciar sesión.
npm run dev
```

Abrir `http://localhost:3000`. La primera cuenta de Tolentino se crea desde el servidor después de aplicar la migración, sin mostrar ni almacenar una contraseña en la aplicación:

```powershell
node --env-file=.env.local scripts/bootstrap-admin.mjs TU_CORREO_REAL
```

Este comando crea una cuenta nueva, le asigna el rol y solicita un correo de recuperación; no reutiliza cuentas por coincidencia de email. Configurar primero el proveedor de correo y la plantilla descrita en `docs/DEPLOY_RENDER_SUPABASE.md`.

## Comprobar

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run start
# En otra terminal, con el servidor activo:
npm run test:e2e
```

Las pruebas SQL usan PostgreSQL PGlite con interfaces mínimas de Auth y Storage. Validan las políticas y migraciones reales; no equivalen a probar los servicios alojados. Las pruebas UI con fixtures están aisladas en `tests/e2e`, nunca forman parte de la persistencia de la aplicación. El reporte clasifica cada aceptación como PASS, FAIL, BLOCKED o NOT RUN.

## Rutas

| Ruta                      | Uso                                                      |
| ------------------------- | -------------------------------------------------------- |
| `/login`                  | Acceso privado y recuperación                            |
| `/admin`                  | Clientes, estadísticas y contacto comercial de Tolentino |
| `/admin/restaurants/[id]` | Soporte autorizado con contexto visible                  |
| `/dashboard`              | Panel del propietario                                    |
| `/menu/[slug]`            | Menú público de consulta                                 |
| `/q/[token]`              | Resolver QR permanente al slug actual                    |
| `/api/health`             | Estado de configuración y conectividad                   |

## Documentación

- [Auditoría de referencia](docs/AUDITORIA_REFERENCIA.md)
- [Arquitectura](docs/ARQUITECTURA.md), [base de datos](docs/BASE_DE_DATOS.md) y [seguridad](docs/SEGURIDAD.md)
- [Administración](docs/ADMINISTRACION.md), [CSV](docs/CSV.md) y [QR y dominios](docs/QR_Y_DOMINIOS.md)
- [Despliegue](docs/DEPLOY_RENDER_SUPABASE.md), [QA](docs/QA_REPORT.md) y [pendientes](docs/PENDIENTES.md)
