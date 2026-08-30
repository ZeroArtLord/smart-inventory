# Smart Inventory V2 Server

Backend pensado para alojarse en el servidor propio del negocio, aislado de otros sistemas.

## Componentes

- Node.js API.
- PostgreSQL.
- Eventos de sincronización idempotentes.
- Inventario basado en movimientos inmutables.
- Separación obligatoria por `workspace_id`.

## Desarrollo local

1. Crear una base PostgreSQL dedicada.
2. Ejecutar `migrations/001_init.sql`.
3. Copiar `.env.example` a un entorno seguro y definir las variables.
4. Instalar dependencias con `npm install`.
5. Ejecutar `npm start`.

## Seguridad

`DEV_ALLOW_HEADER_AUTH=true` existe solamente para desarrollo controlado.

No se debe publicar el servidor usando ese modo. Antes de cualquier despliegue real se implementará autenticación verificable y permisos en servidor.

## Idempotencia

Cada cambio local tiene un ID único. `sync_events` impide aplicar dos veces el mismo evento. Si un teléfono reintenta después de una pérdida de conexión, el servidor responde como duplicado en lugar de crear otra entrada/salida.

## Movimientos

La tabla `movements` tiene un trigger que bloquea UPDATE y DELETE. Una corrección debe generar un movimiento `REVERSAL`.

## Hosting

Objetivo inicial: servidor físico existente o una máquina local dedicada. No es necesario contratar un VPS para comenzar. El acceso remoto se añadirá después mediante una capa HTTPS/túnel seguro, sin exponer PostgreSQL directamente a Internet.
