# Modelo de datos inicial

## Product

Campos previstos:

- id
- sku
- name
- aliases[]
- barcode
- categoryId
- inventoryUnit
- purchaseUnit
- purchaseConversion
- presentations[] (empaques/presentaciones humanas; conversión siempre hacia la unidad base)
- minStock
- maxStock
- replenishmentMethod
- supplierId
- active
- createdAt
- updatedAt

### Presentaciones / empaques

La existencia real, mínimos, máximos y movimientos se expresan siempre en la unidad base del producto.

`presentations[]` permite representar una o varias presentaciones humanas sin cambiar la magnitud real del stock. Cada elemento contiene, como mínimo:

- id
- unitId opcional
- code
- name
- conversion (cantidad de unidad base contenida)
- primary
- active

Ejemplo: unidad base UND, CAJA = 24 UND y BULTO = 96 UND. Un stock de 485 UND sigue siendo 485 internamente y puede mostrarse como 20 CAJAS + 5 UND. Los campos legacy `purchaseUnit` / `purchaseConversion` reflejan la presentación principal para conservar compatibilidad.

## Movement

Registro inmutable que afecta inventario.

- id
- productId
- type
- quantity
- delta
- documentId
- lotId
- locationId
- userId
- createdAt
- reversedMovementId
- metadata

Nunca se corrige sobrescribiendo silenciosamente. Una corrección genera un nuevo movimiento/reverso.

## Document

Agrupa movimientos relacionados.

Tipos iniciales:

- COUNT
- ENTRY
- SUPPLY
- ADJUSTMENT

Estados previstos para surtidos:

- DRAFT
- CLOSED
- VERIFIED
- READY_FOR_SAINT
- SENT_TO_SAINT
- SAINT_PENDING
- POSTED

## Lot

- id
- productId
- lotNumber
- receivedAt
- expiresAt
- originalQuantity
- remainingQuantity
- unitCost
- supplierId

## SAINT Initial Load

La carga inicial desde SAINT es una operación excepcional y única por workspace.

### workspace_initial_loads

- workspaceId (único / PK)
- runId
- source
- documentId
- productCount
- positiveStockCount
- appliedBy
- appliedAt
- metadata

La existencia inicial nunca actualiza una columna global de stock. El servidor crea un documento `ADJUSTMENT` cerrado y movimientos `ADJUSTMENT` con metadata `kind=SAINT_INITIAL_LOAD`. La fila única de `workspace_initial_loads` impide ejecutar una segunda apertura accidental.

El evento de sincronización `initialLoad` contiene las cantidades por producto y permite reconstruir de forma determinista el documento, sus líneas y movimientos en IndexedDB de otros dispositivos.

## SyncQueue

Registro durable de operaciones aún no confirmadas por el servidor.

- id
- entityType
- entityId
- operation
- payload
- status
- attempts
- createdAt
- updatedAt
- lastError

## Regla fundamental

La existencia mostrada para un producto se obtiene de la suma de sus movimientos válidos. El conteo físico puede generar un movimiento ADJUSTMENT, pero no modifica directamente una propiedad global de stock sin trazabilidad.
