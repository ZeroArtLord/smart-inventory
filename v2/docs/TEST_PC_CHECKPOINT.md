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
```

Esperado:

- `ok: true`
- `database: ok`

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
