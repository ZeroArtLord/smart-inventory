# V8.7 · Fecha operativa diaria + historial jerárquico de Surtidos

Fecha: 2026-09-14
Clave de retomada: `VIGIA-HIST-SURT-01`
Base productiva: `feature/vigia-warehouse-ops-v5` @ `909b75ae74025278ce21ad8a2c6aba7f431a828c`
Rama de trabajo: `feature/v8-7-operational-date-history`
Worklog: GitHub issue #13

## 1. Objetivo

Resolver dos problemas del flujo de Surtido sin debilitar EXACT-ONCE:

1. Permitir cargar Surtidos correspondientes a días pasados y hacer que VIGÍA aprenda por el día real de operación, no por el día en que se digitó la información.
2. Eliminar el ruido visual provocado por las entregas hijas `LIVE_SUPPLY_DELIVERY` en el historial principal, manteniéndolas internamente para stock, reversos, correcciones, auditoría e idempotencia.

## 2. Reglas funcionales aprobadas

### 2.1 Fecha operativa

- VIGÍA aprende por **día**, no por hora.
- Cada Surtido V5-E tendrá una fecha operativa `YYYY-MM-DD`.
- Un Surtido nuevo toma **hoy** como fecha operativa por defecto.
- Se permiten fechas pasadas.
- Se bloquean fechas futuras.
- La fecha puede cambiar mientras el carrito todavía no tenga ninguna entrega física cerrada.
- Después de la primera entrega física la fecha queda bloqueada definitivamente.
- `createdAt`, `updatedAt` y `closedAt` siguen representando la verdad de auditoría: cuándo se creó, editó o cerró en VIGÍA.
- Los datos históricos sin fecha operativa continúan funcionando con fallback a su fecha existente.

### 2.2 Historial jerárquico

- Los documentos hijos `LIVE_SUPPLY_DELIVERY` siguen existiendo y siguen siendo la unidad física que descuenta stock.
- El historial principal de Surtidos muestra **una sola fila por carrito padre**.
- Las entregas hijas no aparecen como Surtidos principales independientes.
- Cada fila padre muestra, de forma compacta: fecha operativa, responsable, total entregado y cantidad de entregas.
- La fila padre expone únicamente `Resumen` y `Ver entregas (N)`.
- `Ver entregas (N)` es desplegable y contiene cada entrega hija con su hora técnica real.
- Las acciones técnicas (80mm, CSV, Excel, PDF, SAINT, Corregir cuando aplique) viven dentro de cada entrega hija, no en la fila padre.
- `Resumen` es solo lectura y no modifica stock ni documentos.

## 3. Modelo de datos

### 3.1 Documento padre

La fecha operativa se guarda en:

`document.metadata.operationalDate = "YYYY-MM-DD"`

No se falsifican `createdAt`, `updatedAt` ni `closedAt`.

No se requiere nueva columna en `documents`: PostgreSQL ya persiste `metadata` como `jsonb` y el cliente sincroniza el documento completo.

### 3.2 Entrega hija

Al crear una `LIVE_SUPPLY_DELIVERY`, el hijo hereda:

`metadata.operationalDate = parent.metadata.operationalDate`

La fecha heredada no es editable en el hijo.

### 3.3 Movimientos

Los movimientos SUPPLY generados al cerrar una entrega hija usarán como `effectiveAt` la fecha operativa del documento cuando exista.

Para eliminar ambigüedad horaria y evitar desplazamientos de día por zona horaria, el timestamp derivado se normaliza a un punto estable dentro del día, por ejemplo:

`YYYY-MM-DDT12:00:00.000Z`

Si el documento no tiene `operationalDate`, se conserva el comportamiento legacy (`effectiveAt = now`).

El motor de demanda ya prioriza `movement.effectiveAt` sobre `movement.createdAt`, por lo que el aprendizaje diario, tendencia y estacionalidad recibirán el día correcto sin alterar la auditoría.

### 3.4 Distribución por áreas

Las distribuciones por área deberán conservar también `operationalDate` en su payload local/remoto.

No se requiere migración SQL nueva para ello: `supply_area_deliveries.payload` ya es `jsonb`.

Los reportes por áreas filtrarán/agrupán por `operationalDate` cuando exista y usarán `closedAt` como fallback para registros legacy.

## 4. Servicio de fecha operativa

Se añadirá una unidad aislada para:

- validar formato `YYYY-MM-DD`;
- obtener hoy según la fecha local que VIGÍA presenta al usuario;
- rechazar futuro;
- convertir fecha operativa a `effectiveAt` estable;
- resolver fallback legacy.

La lógica de fecha no debe duplicarse entre UI, documentos, reportes e inteligencia.

## 5. Edición de fecha del carrito

`liveSupplyService` tendrá una operación explícita para establecer la fecha operativa del padre.

Reglas de servicio, no solo de UI:

- documento debe ser SUPPLY V5-E válido;
- debe estar en DRAFT;
- fecha válida y no futura;
- si ya existe al menos una entrega hija CLOSED, rechazar cambio;
- actualizar versión, `updatedAt` y sync queue;
- no crear movimientos;
- no cambiar líneas;
- no cambiar stock.

La UI deshabilita el selector tras la primera entrega, pero el servicio vuelve a validar para evitar bypass.

## 6. UI del carrito

En Surtido vivo se mostrará un control compacto cerca del encabezado:

`Fecha operativa  [ 12/09/2026 ]`

Estados:

- editable antes de primera entrega;
- `🔒 12/09/2026` después de primera entrega;
- mensaje corto si se intenta futuro;
- sin hora.

Cambiar la fecha solo actualiza metadatos del padre. No recalcula stock ni genera movimientos.

## 7. Creación de entregas y EXACT-ONCE

`dispatchLiveSupply` conserva su token e idempotencia actuales.

Antes de crear el hijo:

- obtiene la fecha operativa ya fijada en el padre;
- la copia al hijo;
- el token sigue identificando un único acto físico;
- reintentar el mismo token no crea otro hijo ni otro movimiento.

`closeDocument` seguirá siendo el punto que descuenta stock. Para SUPPLY con `metadata.operationalDate`, solo cambia el valor de `effectiveAt`; `createdAt` del movimiento sigue siendo el instante real de registro.

## 8. Historial jerárquico

Se añadirá una función pura de agrupación que reciba documentos visibles y construya grupos padre/hijos.

Reglas:

- `LIVE_SUPPLY_DELIVERY` se relaciona por `metadata.parentCartId`.
- El padre se muestra una sola vez.
- Hijos huérfanos o legacy que no puedan asociarse de forma segura no se eliminan: se muestran de forma técnica/fallback para no ocultar información.
- El total entregado se deriva de entregas/movimientos, no de un contador mutable.
- El orden principal usa fecha operativa y luego fecha técnica como desempate.
- El desplegable ordena las entregas por hora real de cierre/creación.

La capa GOD conserva la misma agrupación, respetando las reglas de ownership actuales.

## 9. Resumen del padre

`Resumen` abre una vista compacta de solo lectura con:

- fecha operativa;
- responsable;
- número de entregas;
- total planificado;
- total entregado;
- pendiente/cancelado al cierre;
- estado del carrito.

No añade exportaciones nuevas en esta fase.

## 10. Acciones de hijos

Cada entrega hija conserva las acciones que realmente aplican al documento físico cerrado:

- Ticket 80mm;
- CSV;
- Excel;
- Imprimir/PDF;
- SAINT / SAINT Excel / SAINT PDF cuando corresponda;
- Corregir, sujeto a permisos y reglas existentes.

La fila padre no duplica esos botones.

## 11. Compatibilidad y fallback

- Documentos previos a V8.7 sin `operationalDate` siguen usando `closedAt || updatedAt || createdAt` para visualización histórica.
- Movimientos ya existentes no se reescriben: son inmutables.
- No se hace backfill automático de movimientos viejos.
- Los nuevos Surtidos históricos cargados desde V8.7 sí generarán movimientos con el día operativo correcto.
- No se borra ni compacta información existente de PostgreSQL.

## 12. Seguridad e integridad

- WAREHOUSE mantiene acceso solo a sus Surtidos según las reglas V8.2.
- GOD conserva supervisión de los documentos visibles.
- ADMIN no hereda bypass GOD.
- Cambiar fecha operativa nunca modifica movimientos existentes.
- Tras primera entrega la fecha queda inmutable.
- EXACT-ONCE sigue dependiendo del delivery token y de los hijos cerrados.
- Reversos siguen siendo movimientos separados; nunca se muta un movimiento existente.

## 13. Pruebas obligatorias

TDD debe cubrir como mínimo:

- hoy por defecto;
- pasado permitido;
- futuro rechazado;
- cambio de fecha antes de primera entrega;
- bloqueo tras primera entrega;
- hijo hereda `operationalDate`;
- SUPPLY movement usa el día operativo en `effectiveAt`;
- `createdAt/closedAt` conservan tiempo real;
- reintento EXACT-ONCE no duplica movimientos;
- aprendizaje diario atribuye consumo al día operativo;
- área delivery/report usa operationalDate y fallback legacy;
- historial principal excluye hijos como filas principales;
- desplegable muestra hijos correctos bajo su padre;
- hijos huérfanos no se pierden;
- ownership WAREHOUSE/GOD sigue correcto;
- acciones técnicas permanecen disponibles en los hijos;
- PWA shell incrementado para desalojar caché anterior.

CI debe quedar verde en client-tests, server-syntax y server-integration antes de abrir el merge a productiva.

## 14. Despliegue y rollback

Antes del merge:

- crear branch rollback apuntando al productivo anterior;
- exigir CI verde sobre el HEAD exacto;
- revisar diff por alcance.

Antes de despliegue en servidor:

- `git status --short` limpio;
- backup PostgreSQL + verificación por `pg_restore` si el cambio termina incluyendo backend persistente;
- `git pull --ff-only`;
- tests locales seguros;
- `/health` y `/ready` si hay cambio backend;
- prueba funcional con Surtido histórico real.

Rollback de código no debe alterar movimientos ya emitidos. Como esta propuesta no requiere migración SQL, el rollback esperado es de código/PWA únicamente, salvo que la implementación revele una necesidad no prevista; en ese caso el diseño debe revisarse antes de continuar.

## 15. Criterio de aceptación funcional

Caso principal:

1. Crear Surtido el 14/09/2026.
2. Cambiar fecha operativa a 12/09/2026.
3. Cargar productos y áreas.
4. Hacer Entrega 1.
5. Confirmar que la fecha queda bloqueada.
6. Hacer Entrega 2 y finalizar.
7. Confirmar que el historial principal muestra una sola fila `Surtido · 12/09/2026` con `2 entregas`.
8. Abrir `Ver entregas (2)` y ver ambos hijos con sus horas técnicas.
9. Confirmar que el aprendizaje/reportes atribuyen las cantidades al 12/09/2026.
10. Confirmar que auditoría técnica muestra que el registro realmente ocurrió el 14/09/2026.
11. Confirmar que stock se descontó exactamente una vez por cada entrega física.

## 16. Fuera de alcance

- Editar fecha operativa después de la primera entrega.
- Reescribir fechas de movimientos históricos ya existentes.
- Eliminar físicamente entregas hijas.
- Cambiar el algoritmo predictivo más allá de suministrarle el día correcto vía `effectiveAt`.
- Añadir nuevos formatos de exportación del padre.
- Agrupar por hora o aprender patrones horarios.
