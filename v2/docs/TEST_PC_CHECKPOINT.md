# Smart Inventory V2 — Checkpoint PC de pruebas

## Estado actual

La rama de trabajo es:

`feature/smart-inventory-v2`

No mezclar ni fusionar con `main` todavía.

## Próxima vez en la PC de pruebas

Abrir PowerShell y ejecutar:

```powershell
cd "C:\Users\Yanez\OneDrive\Desktop\Stock\SmartInventory"
git pull --ff-only origin feature/smart-inventory-v2
cd v2
npm install
npm test
cd server
npm install
npm run migrate
npm start
```

Las migraciones pendientes incluyen como mínimo:

- `003_lot_location.sql` — ubicación de lotes para FEFO.
- `004_replenishments.sql` — compras, pedidos y mercancía en tránsito.
- `005_entity_versions.sql` — control optimista de versiones y conflictos multi-dispositivo.
- `006_audit_events.sql` — auditoría persistente de operaciones.
- Cualquier migración posterior que exista en la rama al momento de actualizar.

`npm run migrate` es incremental: solo aplica migraciones que aún no estén registradas.

## Después de actualizar

Verificar:

```powershell
Invoke-RestMethod http://localhost:5190/health | ConvertTo-Json
Invoke-RestMethod http://localhost:5190/ready | ConvertTo-Json -Depth 5
```

Esperado:

- `/health`: `ok: true` y `database: ok`.
- `/ready`: `ok: true`, `migrations: ok` y `pending: []`.
- Si `/ready` devuelve 503 con migraciones pendientes, ejecutar `npm run migrate` antes de continuar.

Después, cuando Armando tenga tiempo para pruebas manuales:

1. Entrada con lote/costo/vencimiento.
2. Surtido con validación de stock y FEFO.
3. Sincronización real PC ↔ servidor ↔ teléfono.
4. Pruebas de conflicto simultáneo entre dos dispositivos.
5. Probar usuario con permisos restringidos y rechazo de API.

## Autenticación

- Desarrollo local/LAN continúa con `AUTH_MODE=dev` y `DEV_ALLOW_HEADER_AUTH=true`.
- Producción quedará en `AUTH_MODE=firebase` con token firmado.
- El cliente ya tiene proveedor de token preparado, pero no activar producción hasta configurar Firebase y probarla.

## Importante

- No usar `git reset --hard`.
- No exponer el servidor a Internet todavía.
- DEV_ALLOW_HEADER_AUTH es solo para desarrollo/LAN.
- PostgreSQL no debe publicarse a Internet.
- La prueba PC ↔ teléfono ↔ servidor queda pendiente para una sesión posterior.


## Backups

Después de actualizar y comprobar que el servidor funciona, los comandos disponibles serán:

```powershell
npm run backup
npm run backup:verify
```

No ejecutarlos como tarea automática todavía. Primero validaremos manualmente la ruta de PostgreSQL y el destino de backup en la PC/servidor de pruebas.

## Autenticación de producción — cuando llegue el momento

No activar Firebase en la PC de pruebas hasta terminar primero la prueba DEV/LAN.

Después, para el primer administrador:

```powershell
cd .\v2\server
npm run admin:provision -- --email TU_EMAIL --workspace-key establo2026 --workspace-name "Almacén principal"
```

Luego cambiar el `.env` a:

```env
NODE_ENV=production
AUTH_MODE=firebase
DEV_ALLOW_HEADER_AUTH=false
FIREBASE_PROJECT_ID=smart-inventory-c296b
GOOGLE_APPLICATION_CREDENTIALS=C:\RUTA\SEGURA\service-account.json
```

Antes de arrancar producción:

```powershell
npm run preflight:production
```

No abrir el puerto PostgreSQL al exterior y no publicar la credencial de service account.

## Verificaciones antes del piloto o producción

Desde `v2\server`:

```powershell
npm run integrity:check
npm run preflight:production
```

Después de migrar V1 y sincronizar:

```powershell
npm run migration:verify -- --workspace-key establo2026
```

No continuar con producción si `integrity:check`, `preflight:production` o `migration:verify` terminan con error.
