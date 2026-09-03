# Smart Inventory V2 — Carga inicial desde SAINT

## Objetivo

Crear el baseline productivo de Smart Inventory V2 usando el catálogo y la existencia real exportada desde SAINT, sin migrar Smart Inventory V1 y sin editar stock directamente.

## Reglas no negociables

1. La unidad base es la magnitud real de inventario.
2. Empaques/presentaciones solo convierten y muestran cantidades humanas.
3. Importar catálogo nunca modifica stock.
4. La importación se bloquea si hay Código SAINT, SKU Smart, código de barras o nombres duplicados/ambiguos.
5. Ausencia de columna Existencia SAINT no equivale a cero; para abrir stock cada producto debe tener un valor explícito, incluido 0.
6. La existencia inicial SAINT se aplica mediante movimientos trazables.
7. La apertura se permite una sola vez por workspace.
8. Si la apertura fue incorrecta, se corrige mediante movimientos/reversos autorizados; no se vuelve a ejecutar la carga inicial.

## Identidad SAINT vs identidad Smart

Cada producto maneja tres identificadores distintos:

- `product.id`: identidad técnica interna de Smart Inventory. No la escribe el usuario.
- `saintCode`: Código SAINT. Es la clave externa estable que utilizará el futuro SAINT Enterprise Bridge para relacionar el producto de Smart con el producto de SAINT.
- `sku`: SKU Smart. Es un código interno humano para control dentro de Smart Inventory y no sustituye al Código SAINT.

En la plantilla de carga inicial, `CÓDIGO SAINT` es obligatorio para las filas usadas. `SKU SMART` es opcional. Si queda vacío, Smart genera uno de forma determinista desde el Código SAINT, por ejemplo:

```text
CÓDIGO SAINT = REF001
SKU SMART    = SM-REF001
```

El SKU Smart puede personalizarse posteriormente sin romper la relación con SAINT, porque la integración siempre usa `saintCode`.

## Flujo

1. Descargar la plantilla de carga inicial desde Catálogo.
2. Mientras no exista el Bridge, exportar SAINT manualmente y copiar a la plantilla los datos que vienen de SAINT: Código SAINT, producto, existencia y código de barras si está disponible.
3. Dejar SKU Smart vacío si no se desea inventarlo manualmente; Smart lo generará desde Código SAINT.
4. Marcar USAR=SI/NO.
5. Completar solamente los datos propios de Smart que SAINT no aporta o que queremos controlar aquí: unidad base confirmada, presentaciones/empaques, conversiones, mínimo, máximo, categoría y reposición.
6. Cargar el Excel y revisar el preview, el plan de altas/actualizaciones y los conflictos de identidad. El parser acepta formatos numéricos habituales de SAINT/Excel en español (por ejemplo 1.080,50 KG) sin convertir unidades desconocidas por su cuenta.
7. Importar el catálogo.
8. Sincronizar completamente catálogo y categorías con el servidor.
9. Verificar que el workspace no tenga movimientos previos.
10. Revisar una muestra de las existencias preparadas.
11. Confirmar “Aplicar existencia inicial” y escribir exactamente `APLICAR SAINT`.
12. El servidor crea de forma atómica:
   - un registro en `workspace_initial_loads`;
   - un documento `ADJUSTMENT` cerrado;
   - líneas por todos los productos incluidos;
   - movimientos `ADJUSTMENT` para productos con existencia mayor que cero.
13. El evento `initialLoad` vuelve por sincronización y reconstruye el mismo documento/líneas/movimientos en IndexedDB de los dispositivos.

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
- `012_product_saint_code.sql`

Antes del piloto real, el servidor puede inspeccionarse sin aplicar stock con:

```bash
npm run saint:preflight
```

Opcionalmente puede limitarse a un workspace:

```bash
npm run saint:preflight -- --workspace-key <workspace_key>
```

El preflight reporta catálogo, movimientos existentes, apertura previa y si el workspace está listo para la carga inicial.

## Validación automática

El CI cubre:

- parser/plantilla SAINT;
- separación Código SAINT ↔ SKU Smart;
- generación automática de SKU Smart cuando queda vacío;
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


## Piloto antes del catálogo completo

La prueba controlada y sus criterios de aceptación están en:

- `docs/SAINT_PILOT_CHECKLIST.md`

No cargar el catálogo completo del negocio hasta aprobar ese checklist con un workspace limpio.
