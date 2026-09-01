# Smart Inventory V2

Nueva generación de Smart Inventory enfocada en operación de almacén, trazabilidad, trabajo móvil y sincronización local-first.

## Principios

1. El stock es resultado de movimientos, no un número editable libremente.
2. Ninguna operación crítica se pierde aunque se cierre el navegador o falle Internet.
3. Cada acción importante queda auditada.
4. Los permisos controlan la visibilidad de la UI y el servidor vuelve a validar toda operación protegida.
5. La inteligencia recomienda; el usuario decide.
6. SAINT Enterprise será la última integración y únicamente recibirá operaciones verificadas como documentos revisables/en espera.

## Arquitectura

- PWA HTML/CSS/JavaScript, optimizada para PC y móvil.
- IndexedDB como cache local y outbox durable.
- Node.js/Express como API propia.
- PostgreSQL como fuente de verdad compartida.
- Sincronización push/pull idempotente por cursor.
- Firebase Authentication en producción.
- Workspace aislado tanto en PostgreSQL como en el cache local del dispositivo.

## Directorios

- `src/core`: lógica de dominio.
- `src/storage`: IndexedDB V2.
- `src/sync`: outbox, versionado, conflictos y aislamiento por workspace.
- `src/documents`: Conteos, Entradas y Surtidos.
- `src/inventory`: movimientos, stock y lotes.
- `src/intelligence`: reposición y predicción.
- `src/replenishment`: compras/pedidos y mercancía en tránsito.
- `src/reporting`: reportes operativos.
- `src/auth`: autenticación de navegador.
- `server`: API, PostgreSQL, migraciones, seguridad y scripts operativos.
- `docs`: arquitectura, roadmap y checklists.

## Comandos principales

Cliente/tests:

```powershell
cd v2
npm install
npm test
```

Servidor:

```powershell
cd v2\server
npm install
npm run migrate
npm start
```

Verificaciones:

```powershell
npm run integrity:check
npm run backup
npm run backup:verify
npm run preflight:production
```

Primer administrador de producción:

```powershell
npm run admin:provision -- --email TU_EMAIL --workspace-key establo2026 --workspace-name "Almacén principal"
```

Después del piloto V1:

```powershell
npm run migration:verify -- --workspace-key establo2026
```

## Seguridad de desarrollo vs producción

`AUTH_MODE=dev` y `DEV_ALLOW_HEADER_AUTH=true` son exclusivamente para desarrollo/LAN.

En producción:

```env
NODE_ENV=production
AUTH_MODE=firebase
DEV_ALLOW_HEADER_AUTH=false
FIREBASE_PROJECT_ID=smart-inventory-c296b
GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\segura\service-account.json
```

El servidor se niega a iniciar con autenticación DEV cuando `NODE_ENV=production`.

## Estado

Consulta `docs/ROADMAP_26.md` para los 26 checkpoints.

La V1 permanece intacta fuera de esta carpeta durante la migración.
