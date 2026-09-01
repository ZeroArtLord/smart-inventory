# Smart Inventory V2 — Migración desde V1

## Estado

La base técnica del migrador está implementada, pero la migración real debe ejecutarse solamente durante el piloto controlado.

## Principios

1. El V1 original no se modifica ni se borra.
2. El stock V1 nunca se escribe directamente en un campo editable de producto.
3. La existencia V1 se convierte en un movimiento `ADJUSTMENT` trazable cuyo resultado deja el stock V2 exactamente en la existencia del snapshot.
4. El movimiento inicial de cada producto usa un ID determinista para evitar duplicarlo si la migración se repite por accidente.
5. Categorías y proveedores se reutilizan por nombre normalizado.
6. El historial, registros diarios y auditoría V1 se preservan como archivo legado; no se inventan movimientos históricos para simular datos que V1 no registró con trazabilidad suficiente.
7. Una migración completada deja un marcador local para bloquear una segunda ejecución accidental.

## Datos V1 detectados

Claves conocidas de localStorage:

- `smart_inventory_products`
- `smart_inventory_history`
- `smart_inventory_daily`
- `smart_inventory_audit_logs`

IndexedDB V1 conocido:

- base: `smart_inventory_db`
- store principal: `products`

## Flujo previsto del piloto

1. Crear respaldo del V1.
2. Crear respaldo PostgreSQL V2.
3. Sincronizar V2 y verificar `/ready`.
4. Generar preview del snapshot V1.
5. Resolver errores de unidades/min/max antes de aplicar.
6. Aplicar migración una sola vez desde el equipo fuente.
7. Esperar sincronización completa.
8. Verificar catálogo, movimientos de migración y stock final en PostgreSQL.
9. Conservar el archivo legado V1.
10. No retirar V1 hasta terminar el periodo de observación.

## Limitación importante

localStorage e IndexedDB dependen del origen del navegador. Si V1 y V2 se abren desde orígenes distintos, V2 no puede leer automáticamente el storage del V1. Para ese escenario, el piloto usará exportación/importación de snapshot V1 en archivo, sin tocar los datos originales.

## Pendiente antes de marcar la ETAPA 25 como LISTO

- UI de preview/importación del snapshot V1.
- Ruta de archivo para casos de distinto origen.
- Prueba real con copia del V1.
- Comparación de conteos/productos antes y después.
- Piloto controlado.
- Plan de rollback validado.
