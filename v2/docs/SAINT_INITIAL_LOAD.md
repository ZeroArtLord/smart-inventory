# Smart Inventory V2 — Carga inicial desde SAINT

## Objetivo

Crear el baseline productivo de Smart Inventory V2 usando el catálogo y la existencia real exportada desde SAINT, sin migrar Smart Inventory V1 y sin editar stock directamente.

## Reglas no negociables

1. La unidad base es la magnitud real de inventario.
2. Empaques/presentaciones solo convierten y muestran cantidades humanas.
3. Importar catálogo nunca modifica stock.
4. La importación se bloquea si hay SKU, código de barras o nombres duplicados/ambiguos.
5. Ausencia de columna Existencia SAINT no equivale a cero; para abrir stock cada producto debe tener un valor explícito, incluido 0.
6. La existencia inicial SAINT se aplica mediante movimientos trazables.
7. La apertura se permite una sola vez por workspace.
8. Si la apertura fue incorrecta, se corrige mediante movimientos/reversos autorizados; no se vuelve a ejecutar la carga inicial.

## Flujo

1. Descargar la plantilla de carga inicial desde Catálogo.
2. Completar/pegar la exportación SAINT.
3. Marcar USAR=SI/NO.
4. Configurar unidad base, presentación principal/secundaria, conversiones, mínimo, máximo, categoría y reposición.
5. Cargar el Excel y revisar el preview, el plan de altas/actualizaciones y los conflictos de identidad.
6. Importar el catálogo.
7. Sincronizar completamente catálogo y categorías con el servidor.
8. Verificar que el workspace no tenga movimientos previos.
9. Revisar una muestra de las existencias preparadas.
10. Confirmar “Aplicar existencia inicial” y escribir exactamente `APLICAR SAINT`.
11. El servidor crea de forma atómica:
   - un registro en `workspace_initial_loads`;
   - un documento `ADJUSTMENT` cerrado;
   - líneas por todos los productos incluidos;
   - movimientos `ADJUSTMENT` para productos con existencia mayor que cero.
12. El evento `initialLoad` vuelve por sincronización y reconstruye el mismo documento/líneas/movimientos en IndexedDB de los dispositivos.

## Protección contra duplicados

`workspace_initial_loads.workspace_id` es clave primaria. Una segunda apertura devuelve `INITIAL_LOAD_ALREADY_APPLIED`.

Además, la carga inicial se rechaza si ya existen movimientos en el workspace con `INITIAL_LOAD_NOT_CLEAN`.

## Huella del archivo fuente

Cuando el navegador dispone de Web Crypto, Smart Inventory calcula SHA-256 del archivo cargado. La huella y el tamaño del archivo viajan con la carga inicial y quedan en la metadata del documento/registro de apertura para poder demostrar qué archivo originó el baseline.

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
- detección de identificadores duplicados o cruzados;
- diferenciación entre “sin columna de existencia”, celda vacía y cero explícito;
- plan de productos nuevos/actualizados antes de importar;
- huella SHA-256 del archivo fuente;
- conversiones de empaques;
- editor de catálogo;
- validación y permisos del evento;
- reconstrucción local del evento;
- smoke real PostgreSQL de apertura;
- rechazo de segunda apertura;
- verificación de que actualizar catálogo después no cambia stock;
- integridad del registro de apertura;
- persistencia del registro durante backup/restore.
