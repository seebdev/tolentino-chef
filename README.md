# Tolentino Restaurantes Admin

Repositorio: [tolentinosftw-dotcom/tolentino-chef](https://github.com/tolentinosftw-dotcom/tolentino-chef).

Una aplicación Next.js para administrar múltiples restaurantes con Supabase Auth, Postgres y Storage. Una venta única por restaurante; no incluye suscripciones, empleados, pedidos, carrito ni pagos.

## Estado de esta entrega

Actualizado el 17 de octubre de 2026. La aplicación funciona localmente con Auth, PostgreSQL y Storage reales del proyecto Supabase autorizado `ylcnrfzosjzuljufwups`. Hay un superadministrador configurado y tres restaurantes DEMO independientes con 24 productos cada uno. Las credenciales permanecen fuera de Git.

Se corrigieron la clasificación de errores 409, el doble envío de formularios, la creación idempotente, validaciones de apariencia e imágenes y descargas. Las dos migraciones están aplicadas y verificadas. La evidencia actual incluye 201 pruebas unitarias/SQL, 95 casos UI con fixtures en Chrome/Edge, 113 comprobaciones reales de API y administración, y 24 recorridos reales de navegador (372 comprobaciones). Las suites y sus límites se detallan en el informe; no son una prueba de carga concurrente de producción.

**No está desplegada en Render ni aceptada para producción.** Faltan acceso a Render, URL HTTPS canónica, QR públicos, configuración y prueba de SMTP, desactivar el registro público de Supabase y completar las verificaciones externas indicadas en los pendientes. El usuario confirmó que todavía no hay publicación pública.

- [Auditoría final y evidencia](AUDITORIA_FINAL_TOLENTINO_RESTAURANTES.md)
- [Acceder a los tres restaurantes DEMO](RESTAURANTES_DEMO.md)
- [Pendientes para producción](docs/PENDIENTES.md)

Los datos DEMO están guardados en Supabase; no sustituyen el backend por memoria ni respuestas simuladas. Las pruebas con fixtures se identifican separadamente. El proyecto original de Crepes & Waffles permanece intacto: 1.803 archivos comparados, cero cambios (`docs/evidence/reference-verification-20261017.json`).

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

Abrir `http://localhost:3000/login`. El proyecto actual ya tiene superadministrador; no repetir el bootstrap para esa cuenta. En una instalación nueva, la primera cuenta se crea desde el servidor después de aplicar las migraciones:

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
