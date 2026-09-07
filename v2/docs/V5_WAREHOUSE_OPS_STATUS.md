# VIGÍA V5 — Warehouse Operations Status

Actualizado: 2026-09-07

## Objetivo

Adaptar VIGÍA al flujo real del almacén antes del retorno operativo de Armando al puesto de almacenista.

Producción estable permanece en `feature/smart-inventory-v2`.
Desarrollo V5 aislado en `feature/vigia-warehouse-ops-v5`.

HEAD validado al actualizar este documento: `3b90aadab39c211993c12cff449828651499dff2`.
CI de PR sobre ese HEAD: Smart Inventory V2 Tests #588 — SUCCESS.

## V5-A — Conteo operativo por categoría

Estado: IMPLEMENTADO EN BRANCH · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / OPERATIVA.

Incluye:

- una sola sesión recuperable de conteo;
- progreso global y por categoría;
- navegación libre entre categorías;
- `Saltar / dejar pendiente` sin guardar cero ni considerar contado;
- lista global de pendientes;
- retorno posterior a pendientes;
- persistencia en metadata del documento de categoría activa, modo y pendientes;
- búsqueda dentro de la categoría y salto manual a un producto;
- cierre del conteo solamente cuando todos los productos activos estén contados;
- estado local-first sincronizable sin migración PostgreSQL nueva.

Archivos V5-A:

- `src/documents/countWorkflow.js`
- `src/documents/countWorkflowService.js`
- `src/ui/countWorkflowUi.js`
- `test/countWorkflow.test.js`
- `test/countWorkflowService.test.js`
- `index.html` carga `countWorkflowUi.js`

CI inicial V5-A #547: client-tests, server-syntax y server-integration en SUCCESS.

## V5-B — Comprar / Pedir manual + Extras

Estado: IMPLEMENTADO EN BRANCH · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / OPERATIVA.

Incluye:

- búsqueda manual de cualquier producto del catálogo aunque VIGÍA no lo sugiera;
- cantidad decidida por el usuario, con expresiones matemáticas seguras;
- selección humana `COMPRA` o `PEDIDO` aunque difiera del método habitual del producto;
- stock, mercancía en camino y sugerencia VIGÍA visibles solo como referencia;
- motivo/nota opcional persistido junto con el contexto de la decisión;
- trazabilidad de cantidad sugerida, stock y tránsito existentes al momento de decidir;
- `Compra X / Extra` fuera del catálogo con descripción, cantidad, unidad y nota;
- extras sincronizables sin crear productos, códigos SAINT ni movimientos;
- extras jamás modifican stock ni aprendizaje de demanda;
- extra se puede marcar `Comprado` o `Cancelado` sin generar una Entrada;
- protección visual para impedir que un Extra use el flujo normal `Recibir` de inventario;
- UI responsive añadida al workspace existente de `Comprar / Pedir` sin reescribir el núcleo productivo.

Implementación de extras:

- reutiliza de forma controlada la entidad sincronizable `replenishment` ya existente;
- usa un `productId` sintético con prefijo `__VIGIA_EXTRA__:`;
- `sourceSuggestion.kind = EXTRA` identifica inequívocamente el renglón;
- PostgreSQL no tiene FK de `replenishments.product_id` hacia productos, por lo que no contamina catálogo;
- los extras permanecen `DRAFT` hasta `Comprado`/`Cancelado`, por lo que no forman parte del tránsito de ningún producto real;
- no requiere migración PostgreSQL nueva.

Archivos V5-B:

- `src/replenishment/warehouseProcurementService.js`
- `src/ui/replenishmentWorkflowUi.js`
- `css/v5-procurement.css`
- `test/warehouseProcurementService.test.js`
- `test/warehouseProcurementSyncContract.test.js`
- `index.html` carga la UI/CSS V5-B.

Pruebas V5-B cubren:

- compra manual distinta al método habitual del producto;
- persistencia y cola de sincronización;
- extra fuera de catálogo sin producto nuevo;
- extra sin movimientos de inventario;
- completar/cancelar extras;
- contrato de validación del servidor para compras manuales y extras sintéticos.

## V5-C — Reporte de surtido SAINT-ready

Estado: IMPLEMENTADO EN BRANCH · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / OPERATIVA.

Incluye:

- reporte dedicado para surtidos `SUPPLY` cerrados;
- Código SAINT, producto, cantidad, unidad, destino, responsable, fecha, documento y notas;
- totales por unidad y conteo de líneas/productos;
- advertencias explícitas para productos sin Código SAINT o cantidades inválidas;
- indicador `readyForManualSaint` cuando todas las líneas tienen Código SAINT;
- salida de impresión limpia para transcripción/descargo manual en SAINT;
- exportación XLSX desde la UI V5-C;
- operación de solo lectura: generar/exportar el reporte no crea movimientos ni modifica stock;
- protección V5-E: el carrito vivo padre no puede exportarse como descargo SAINT. Cada entrega física hija cerrada es el documento descargable.

Archivos principales V5-C:

- `src/export/saintSupplyExport.js`
- `src/ui/saintSupplyReportUi.js`
- `css/v5-saint-report.css`
- pruebas asociadas de exportación/UI/sintaxis.

## V5-D — Conciliación GOD

Estado: IMPLEMENTADO EN BRANCH · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / OPERATIVA DE PERMISOS Y CASOS LÍMITE.

Flujo implementado:

`Conteo -> Diferencias -> Revisión -> GOD -> Recontar / Ignorar / Ajustar`.

Reglas de seguridad implementadas:

- cerrar el conteo físico no convierte automáticamente las diferencias en movimientos;
- el stock permanece intacto hasta una decisión explícita de conciliación;
- la conciliación crea un documento `ADJUSTMENT` separado y trazable;
- decisiones sensibles están reservadas al rol GOD;
- cada línea conserva existencia esperada, contada, diferencia, decisión, motivo, usuario y fecha;
- un `ADJUSTMENT` posterior al conteo invalida la base sensible y exige reconteo antes de ajustar;
- `ENTRY`/`SUPPLY` posteriores al conteo no deben descontarse ni aplicarse dos veces dentro de la conciliación;
- pruebas de cronología fueron endurecidas para ser deterministas.

Archivos principales V5-D:

- `src/documents/countReconciliationService.js`
- `src/ui/countReconciliationUi.js`
- `css/v5-reconciliation.css`
- `test/countReconciliationService.test.js`
- pruebas de permisos/sintaxis asociadas.

## V5-E — Surtido vivo exact-once

Estado: IMPLEMENTADO EN BRANCH · HARDENING APLICADO · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / OPERATIVA INTEGRADA.

Objetivo implementado:

- mantener un carrito de surtido abierto durante el turno;
- registrar cada entrega física como un `SUPPLY` hijo cerrado e inmutable;
- descontar stock exactamente una vez por acto físico;
- separar lo planificado en el carrito padre de lo realmente entregado.

Reglas de seguridad implementadas:

- `deliveryToken` idempotente: repetir el mismo token devuelve la entrega existente y no duplica movimientos;
- editar cantidades planificadas del carrito padre no reescribe entregas ya cerradas;
- cancelar pendiente no modifica entregas físicas realizadas;
- finalizar o cancelar el carrito padre no vuelve a descontar stock;
- las correcciones de una entrega hija usan el flujo trazable de `REVERSAL`;
- el progreso entregado se deriva de movimientos reales, no de un contador mutable;
- si V5-E no puede confirmar de forma segura el tipo de surtido, el cierre falla cerrado (`fail-closed`) antes de usar el cierre legacy;
- el carrito vivo padre está bloqueado para exportación SAINT; el reporte debe salir de cada entrega física hija cerrada;
- UI responsive de carrito vivo con entregado, pendiente, cancelado, selección de entrega e historial.

Archivos principales V5-E:

- `src/documents/liveSupplyService.js`
- `src/ui/liveSupplyUi.js`
- `css/v5-live-supply.css`
- `test/liveSupplyService.test.js`
- `test/uiSyntax.test.js`
- `index.html` carga UI/CSS V5-E.

Pruebas V5-E cubren al menos:

- mismo token => un solo descuento de stock;
- edición del objetivo sin reescritura de entregas;
- cancelación de pendiente + finalización sin doble descuento;
- cancelación de carrito preservando entregas físicas;
- corrección de entrega mediante `REVERSAL` reabre el pendiente correspondiente.

## Reglas operativas acordadas

1. VIGÍA es la fuente operacional del almacén; SAINT seguirá siendo sistema externo/administrativo mientras no exista Bridge.
2. Los conteos deben reflejar el recorrido físico real, no obligar al almacenista a seguir el orden del catálogo.
3. `PENDIENTE` nunca significa existencia cero.
4. La decisión humana prevalece sobre una sugerencia de compra/pedido.
5. Entradas y surtidos reales son los que modifican stock; compras/pedidos pendientes no son stock físico.
6. La demanda se aprende principalmente de `SUPPLY`, no de compras.
7. Ajustes de conciliación sensibles se reservan al rol GOD.
8. Documentos y movimientos originales no se reescriben silenciosamente; correcciones deben ser trazables.
9. VIGÍA debe permitir operación sin papel; los surtidos cerrados serán el material de descargo manual en SAINT hasta Fase 26.
10. Un Extra fuera de catálogo pertenece a la lista operativa de compras, nunca al inventario.
11. En V5-E el carrito padre representa intención/plan; solamente las entregas hijas cerradas representan mercancía físicamente entregada y afectan stock.
12. Nunca exportar el carrito vivo padre como descargo SAINT.

## Siguiente paso real — Validación integrada V5-A -> V5-E

No agregar otra función sensible ni desplegar todavía.

Validar en navegador, con datos de prueba y branch V5:

1. Conteo por categorías, saltos, pendientes y recuperación de sesión.
2. Compra/Pedido manual y Extra fuera de catálogo.
3. Cierre de un `SUPPLY` normal y generación del reporte SAINT-ready.
4. Conteo con diferencias: verificar que cierre sin modificar stock; revisar flujo GOD de Recontar / Ignorar / Ajustar.
5. Surtido vivo: entrega parcial, segunda entrega, retry del mismo token, cambio del plan, cancelación de restante y finalización.
6. Verificar que cada entrega hija pueda producir su reporte SAINT-ready y que el carrito padre sea rechazado.
7. Probar corrección/reversal de una entrega hija y confirmar que el stock y el pendiente vuelven al valor correcto.
8. Revisar responsive y mensajes de error en desktop y móvil.
9. Mantener PR en draft hasta terminar esta validación y actualizar su descripción/checklist.
10. Solo después preparar protocolo de merge y despliegue con backup/preflight.

## Carga inicial real

Archivo maestro auditado: `VIGIA_CARGA_REAL_REVISADA.xlsx` (artefacto de conversación, no versionado en Git).

Resumen conocido:

- 484 productos `SI`;
- 245 productos `NO`;
- sin duplicados de identidad entre seleccionados;
- existencias negativas corregidas a 0 en archivo final;
- YUCA: KG, CESTA x30, min 3 CESTA, max 5 CESTA;
- LICORES: 161/161 en UND porque SAINT cuenta botellas;
- `CEPILLO DE BARRER CERDA GRUESA`: unidad corregida a UND;
- REPOSICIÓN vacía actualmente se interpreta como BOTH/AMBOS;
- 332 productos sin min/max se importarán 0/0 y necesitarán historial para recomendación dinámica.

La apertura SAINT sigue siendo UNA SOLA VEZ por workspace y no debe ejecutarse hasta completar backup, preflight, preview, sincronización de catálogo y validación.

## Servidor productivo

No tocar desde la branch V5 hasta aprobar PR y protocolo de despliegue.

Servidor: HP ProLiant ML310e Gen8 v2, Windows Server 2022.
App: `C:\SmartInventory\App`.
Servicio: `SmartInventoryV2`.
Node: loopback `127.0.0.1:5190`.
Workspace key: `establo2026`.

Antes de cualquier despliegue:

```powershell
Set-Location "C:\SmartInventory\App\v2\server"
npm run backup
npm run backup:verify
npm run integrity:check
npm run saint:preflight -- --workspace-key establo2026
npm run preflight:production
```

No ejecutar la carga inicial ni operaciones destructivas automáticamente.
