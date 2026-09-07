# VIGÍA V5 — Warehouse Operations Status

Actualizado: 2026-09-07

## Objetivo

Adaptar VIGÍA al flujo real del almacén antes del retorno operativo de Armando al puesto de almacenista.

Producción estable permanece en `feature/smart-inventory-v2`.
Desarrollo V5 aislado en `feature/vigia-warehouse-ops-v5`.

## V5-A — Conteo operativo por categoría

Estado: IMPLEMENTADO EN BRANCH · CI VERDE · PENDIENTE VALIDACIÓN VISUAL / DEPLOY GUARDADO.

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

PR: #2 `V5-A · Conteo operativo por categoría y pendientes` (draft).

CI run inicial: #547

- client-tests: SUCCESS
- server-syntax: SUCCESS
- server-integration: SUCCESS

## Reglas operativas acordadas

1. VIGÍA es la fuente operacional del almacén; SAINT seguirá siendo sistema externo/administrativo mientras no exista Bridge.
2. Los conteos deben reflejar el recorrido físico real, no obligar al almacenista a seguir el orden del catálogo.
3. `PENDIENTE` nunca significa existencia cero.
4. La decisión humana prevalece sobre una sugerencia de compra/pedido.
5. Entradas y surtidos reales son los que modifican stock; compras/pedidos pendientes no son stock físico.
6. La demanda se aprende principalmente de `SUPPLY`, no de compras.
7. Ajustes de conciliación sensibles se reservarán al rol GOD.
8. Documentos y movimientos originales no se reescriben silenciosamente; correcciones deben ser trazables.
9. VIGÍA debe permitir operación sin papel; los surtidos cerrados serán el material de descargo manual en SAINT hasta Fase 26.

## V5-B — Comprar / Pedir manual + Extras

Pendiente.

Requisitos:

- buscar cualquier producto aunque VIGÍA no lo sugiera;
- cantidad manual editable;
- elegir COMPRA o PEDIDO;
- sugerencia VIGÍA visible pero no obligatoria;
- motivo/nota opcional;
- EXTRA fuera de catálogo con descripción, cantidad, unidad y nota;
- extra no modifica stock ni aprendizaje;
- lista final conjunta para operación/impresión.

## V5-C — Reporte de surtido SAINT-ready

Pendiente.

Debe incluir Código SAINT, producto, cantidad, unidad, destino, responsable, fecha, documento y totales. Exportar/imprimir de forma limpia para transcripción manual a SAINT.

## V5-D — Conciliación GOD

Pendiente y sensible.

Flujo objetivo:

`Conteo -> Diferencias -> Revisión -> GOD -> Recontar / Ignorar / Ajustar`.

El cierre de un conteo no deberá convertir automáticamente diferencias en stock cuando esta fase sea activada. Requiere diseño, permisos, auditoría y pruebas de migración/comportamiento antes de producción.

## V5-E — Surtido vivo

Pendiente y sensible.

Objetivo: carrito de surtido abierto durante el turno, pero cada entrega física debe impactar stock exactamente una vez. Antes de implementarlo deben resolverse idempotencia, cambios de cantidad, eliminación, cancelación, reversals, offline y conflictos.

Mientras V5-E no exista, regla segura: si la mercancía salió físicamente durante un conteo, cerrar ese surtido antes de continuar el conteo para evitar doble descuento al conciliar.

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
