# Arquitectura objetivo

## Cliente

PWA para escritorio y móvil.

- UI optimizada para teclado/Enter y teléfono.
- IndexedDB como almacenamiento local crítico.
- Cola local de operaciones pendientes.
- Indicadores: guardado local / pendiente / sincronizado.

## Servidor

Objetivo de despliegue inicial: servidor propio.

- API Node.js.
- PostgreSQL.
- Smart Inventory aislado de otros sistemas del servidor.
- Acceso remoto mediante HTTPS/túnel seguro.
- Backups automáticos.

## Flujo de escritura

1. Usuario realiza una acción.
2. Se valida en cliente.
3. Se genera un ID único.
4. Se escribe primero en IndexedDB en una transacción.
5. Se agrega evento a la cola de sincronización.
6. La UI confirma "Guardado".
7. El sincronizador envía el evento al servidor.
8. El servidor aplica la operación de forma idempotente.
9. El cliente marca el evento como sincronizado.

## Regla de inventario

El stock no se modifica directamente. Se deriva de movimientos:

- ENTRY
- SUPPLY
- ADJUSTMENT
- TRANSFER
- REVERSAL

Los conteos físicos generan ajustes explícitos cuando hay diferencias.

## Seguridad

Autenticación + autorización por permisos.

Los permisos se validarán tanto en UI como en API; la API es la autoridad final.

## Integración SAINT

Fuera del núcleo V2 inicial. Un surtido cerrado y verificado podrá convertirse en un descargo de inventario en estado revisable/en espera. Nunca se descargará automáticamente sin revisión humana.
