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
- minStock
- maxStock
- replenishmentMethod
- supplierId
- active
- createdAt
- updatedAt

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
