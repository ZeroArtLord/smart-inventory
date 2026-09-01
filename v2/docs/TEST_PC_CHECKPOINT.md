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

La migración pendiente incluye como mínimo:

- `003_lot_location.sql` — ubicación de lotes para FEFO.
- Las migraciones posteriores que existan en la rama al momento de actualizar.

`npm run migrate` es incremental: solo aplica migraciones que aún no estén registradas.

## Después de actualizar

Verificar:

```powershell
Invoke-RestMethod http://localhost:5190/health | ConvertTo-Json
```

Esperado:

- `ok: true`
- `database: ok`

## Importante

- No usar `git reset --hard`.
- No exponer el servidor a Internet todavía.
- DEV_ALLOW_HEADER_AUTH es solo para desarrollo/LAN.
- PostgreSQL no debe publicarse a Internet.
- La prueba PC ↔ teléfono ↔ servidor queda pendiente para una sesión posterior.
