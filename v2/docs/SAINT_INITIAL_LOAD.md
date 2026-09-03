# Smart Inventory V2 — Carga inicial desde SAINT

## Objetivo

Crear el baseline productivo de Smart Inventory V2 usando el catálogo y la existencia real exportada desde SAINT, sin migrar Smart Inventory V1 y sin editar stock directamente.

## Reglas no negociables

1. La unidad base es la magnitud real de inventario.
2. Empaques/presentaciones solo convierten y muestran cantidades humanas.
3. Importar catálogo nunca modifica stock.
4. La existencia inicial SAINT se aplica mediante movimientos trazables.
5. La apertura se permite una sola vez por workspace.
6. Si la apertura fue incorrecta, se corrige mediante movimientos/reversos autorizados; no se vuelve a ejecutar la carga inicial.

## Flujo

1. Descargar la plantilla de carga inicial desde Catálogo.
2. Completar/pegar la exportación SAINT.
3. Marcar USAR=SI/NO.
4. Configurar unidad base, presentación principal/secundaria, conversiones, mínimo, máximo, categoría y reposición.
5. Cargar el Excel y revisar el preview.
6. Importar el catálogo.
7. Sincronizar completamente catálogo y categorías con el servidor.
8. Verificar que el workspace no tenga movimientos previos.
9. Confirmar “Aplicar existencia inicial”.
10. El servidor crea de forma atómica:
   - un registro en `workspace_initial_loads`;
   - un documento `ADJUSTMENT` cerrado;
   - líneas por todos los productos incluidos;
   - movimientos `ADJUSTMENT` para productos con existencia mayor que cero.
11. El evento `initialLoad` vuelve por sincronización y reconstruye el mismo documento/líneas/movimientos en IndexedDB de los dispositivos.

## Protección contra duplicados

`workspace_initial_loads.workspace_id` es clave primaria. Una segunda apertura devuelve `INITIAL_LOAD_ALREADY_APPLIED`.

Además, la carga inicial se rechaza si ya existen movimientos en el workspace con `INITIAL_LOAD_NOT_CLEAN`.

## Metadata de apertura

Los movimientos creados contienen:

- `kind = SAINT_INITIAL_LOAD`
- `initialLoadId`
- `source = SAINT`
- `sourceCode`
- `sourceRow`
- `saintInitialStock`

## Permisos

La operación exige simultáneamente:

- `catalog.write`
- `adjustment.write`

## Migraciones requeridas

- `010_product_presentations.sql`
- `011_saint_initial_load.sql`

## Validación automática

El CI cubre:

- parser/plantilla SAINT;
- conversiones de empaques;
- editor de catálogo;
- validación y permisos del evento;
- reconstrucción local del evento;
- smoke real PostgreSQL de apertura;
- rechazo de segunda apertura;
- verificación de que actualizar catálogo después no cambia stock;
- integridad del registro de apertura;
- persistencia del registro durante backup/restore.
