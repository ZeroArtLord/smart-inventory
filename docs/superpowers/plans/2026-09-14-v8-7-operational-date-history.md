# V8.7 · Plan de implementación — fecha operativa e historial jerárquico

Clave de retomada: `VIGIA-HIST-SURT-01`
Diseño aprobado: `docs/superpowers/specs/2026-09-14-v8-7-operational-date-history-design.md`
Base productiva: `909b75ae74025278ce21ad8a2c6aba7f431a828c`
Rama: `feature/v8-7-operational-date-history`

## Reglas de ejecución

- TDD estricto: cada comportamiento nuevo entra primero como prueba que falla por la razón esperada.
- La rama productiva `feature/vigia-warehouse-ops-v5` no se modifica durante implementación.
- No se crea migración SQL salvo que aparezca una necesidad demostrada y el diseño se reabra. `documents.metadata` y `supply_area_deliveries.payload` ya son JSONB.
- No se reescriben movimientos históricos; los movimientos son inmutables.
- EXACT-ONCE sigue dependiendo del token de entrega y del documento hijo `LIVE_SUPPLY_DELIVERY`.
- Antes de merge: HEAD exacto con client-tests, server-syntax y server-integration verdes, diff revisado y rollback creado desde productiva.

## Task 1 — Contrato puro de fecha operativa

**Crear:**
- `v2/src/documents/operationalDate.js`
- `v2/test/operationalDateV87.test.js`

**RED:** probar primero:
- `todayOperationalDate()` devuelve `YYYY-MM-DD` usando calendario local del `Date` recibido.
- formato inválido y fecha imposible se rechazan.
- pasado y hoy se aceptan; futuro se rechaza.
- `operationalDateToEffectiveAt('2026-09-12')` devuelve `2026-09-12T12:00:00.000Z`.
- resolver fecha de documento usa `metadata.operationalDate`; legacy cae en `closedAt || updatedAt || createdAt`.

**GREEN mínimo:** implementar funciones puras exportadas:
- `todayOperationalDate(now = new Date())`
- `normalizeOperationalDate(value, { today } = {})`
- `operationalDateToEffectiveAt(value)`
- `resolveDocumentOperationalDate(document)`
- `resolveDocumentEffectiveAt(document, fallbackNow = new Date())`

**Verificación:** `node --test test/operationalDateV87.test.js` y `node --check src/documents/operationalDate.js`.

## Task 2 — Carrito V5-E: default, edición, bloqueo, herencia y EXACT-ONCE

**Modificar:**
- `v2/src/documents/liveSupplyService.js`
- `v2/test/liveSupplyService.test.js` o prueba V8.7 aislada si mejora independencia.

**RED:** cubrir:
- al habilitar carrito sin fecha, se fija hoy.
- fecha pasada puede cambiarse antes de entrega.
- fecha futura se rechaza en servicio, no solo UI.
- tras una entrega CLOSED, cambiar fecha falla y no cambia metadata.
- hijo `LIVE_SUPPLY_DELIVERY` hereda exactamente `operationalDate` del padre.
- reintento con el mismo token sigue devolviendo el mismo hijo.

**GREEN mínimo:**
- `enableLiveSupplyCart` agrega `metadata.operationalDate` solo si falta.
- exportar `setLiveSupplyOperationalDate(documentId, value, { userId, now } = {})`.
- setter valida SUPPLY V5-E DRAFT, fecha no futura y `closedDeliveryCount === 0`; actualiza versión, `updatedAt` y sync queue sin tocar líneas/movimientos.
- `createDeliveryDraftAtomic` copia `parent.metadata.operationalDate` al hijo.

**Verificación:** test focal + test existente de `liveSupplyService` para EXACT-ONCE.

## Task 3 — Movimiento SUPPLY aprende el día operativo sin falsear auditoría

**Modificar:**
- `v2/src/documents/documentService.js`
- pruebas de documento/live supply.

**RED:** al cerrar un hijo SUPPLY con `operationalDate=2026-09-12`:
- cada movimiento SUPPLY tiene `effectiveAt=2026-09-12T12:00:00.000Z`.
- `movement.createdAt` sigue siendo el instante real de ejecución y no se retrocede.
- `document.closedAt` sigue siendo el instante real.
- ENTRY sin operationalDate conserva comportamiento actual.
- SUPPLY legacy sin operationalDate conserva `effectiveAt` real.

**GREEN mínimo:** resolver `effectiveAt` una vez por documento; aplicarlo únicamente a movimientos SUPPLY. No tocar `createdAt`, `closedAt` ni movimientos existentes.

**Verificación:** test focal y `node --test test/liveSupplyService.test.js`.

## Task 4 — Fecha operativa en consumo por áreas, local y servidor

**Modificar:**
- `v2/src/ui/supplyAreaUi.js`
- `v2/src/areas/supplyAreaDeliveryService.js`
- `v2/src/reporting/areaConsumptionReport.js`
- `v2/server/src/routes/areas.js`
- `v2/test/supplyAreasV7.test.js` y/o `v2/test/operationalDateV87.test.js`

**RED:** cubrir:
- intención/registro de área conserva `operationalDate`.
- POST al servidor incluye fecha operativa.
- servidor persiste `operationalDate` dentro de `payload` y la devuelve en GET.
- canonical/idempotency considera la fecha para que el mismo token no pueda cambiar de día silenciosamente.
- reporte de áreas filtra por operationalDate cuando existe y usa `closedAt` como fallback legacy.
- una entrega cargada el 14 con operationalDate 12 entra en consulta/reporte del día 12, no del 14.

**GREEN mínimo:**
- `supplyAreaUi` obtiene fecha del padre y la pasa a `createAreaDeliveryIntent`.
- servicio local normaliza, guarda, sincroniza y restaura `operationalDate`.
- ruta `/areas/deliveries` valida `YYYY-MM-DD`, persiste `{ rows, operationalDate }` y mapea el campo.
- filtro `from` del servidor usa operationalDate cuando existe; fallback `closed_at` para legacy, evitando casts inseguros sobre texto inválido.
- `buildAreaConsumptionReport` usa un helper de fecha operativa/fallback para su rango.

**Verificación:** client tests focales + `node --check server/src/routes/areas.js`; integración completa quedará a CI.

## Task 5 — Modelo puro del historial jerárquico

**Crear:**
- `v2/src/documents/supplyHistoryGrouping.js`
- `v2/test/supplyHistoryGroupingV87.test.js`

**RED:** cubrir:
- padre V5-E aparece una sola vez.
- hijos asociados por `metadata.parentCartId` quedan dentro de `deliveries` y no como top-level.
- hijos se ordenan por hora técnica real.
- grupo principal usa operationalDate y luego timestamp técnico para desempate.
- hijo huérfano/legacy no desaparece: se devuelve como fallback técnico.
- documentos SUPPLY normales legacy permanecen visibles.
- resumen del padre deriva `deliveryCount` y `deliveredTotal` de hijos/movimientos, no de contador mutable cuando se proporciona contexto.

**GREEN mínimo:** exportar una función pura `buildSupplyHistoryGroups({ documents, movements })` sin acceso DOM/IndexedDB.

**Verificación:** `node --test test/supplyHistoryGroupingV87.test.js`.

## Task 6 — Historial visual WAREHOUSE/GOD sin ruido

**Modificar:**
- `v2/src/ui/godOperationalOversightUi.js`
- `v2/src/ui/operationalDomRenderGuard.js`
- `v2/src/ui/app.js` solo donde sea imprescindible para que el renderer base no compita con la capa operativa.
- `v2/css/v8-7-operational-history.css` (nuevo, si el estilo no cabe limpiamente en estilos existentes).
- `v2/index.html`
- tests UI GOD/PWA.

**RED:** contratos DOM para:
- Supply history parent: `Resumen` + `Ver entregas (N)` únicamente en nivel principal.
- cada hijo cerrado despliega acciones técnicas con su `data-id` real.
- WAREHOUSE sigue viendo solo sus documentos; GOD ve equipo; ADMIN no obtiene bypass.
- render key incluye operationalDate y estructura padre/hijo para evitar stale DOM y no reintroducir loops de MutationObserver.

**GREEN mínimo:**
- alimentar historial Supply con `buildSupplyHistoryGroups` después de aplicar `filterOperationalDocumentsForActor`.
- renderizar padre compacto; `<details>` para hijos; orphan fallback visible.
- mantener acciones existentes (`export-document`, `correct-document`) sobre child id; módulos decoradores de 80mm/SAINT deben seguir encontrando los hijos cerrados.
- `Resumen` es lectura y muestra fecha operativa, responsable, planificado/entregado/pendiente/cancelado/estado sin mutaciones.

**Verificación:** tests UI contract + regresión V8.3.1 de estabilidad DOM.

## Task 7 — Selector de fecha en Surtido vivo

**Modificar:**
- `v2/src/ui/liveSupplyUi.js`
- CSS V8.7 o `v5-live-supply.css` según alcance.

**RED:** contrato UI:
- input `type=date`, valor operationalDate, `max=hoy`.
- editable si `closedDeliveryCount === 0`.
- bloqueado después de primera entrega.
- change llama a servicio y rerenderiza; no genera movimiento.
- no hay hora editable.

**GREEN mínimo:** añadir control compacto al encabezado V5-E y manejar `change` con guard anti-reentrada existente. Evitar escrituras DOM repetitivas que puedan revivir el problema V8.6/MutationObserver.

**Verificación:** test UI focal + suite live supply.

## Task 8 — PWA shell 57 y contratos de carga

**Modificar:**
- `v2/sw.js`: shell 56 → 57.
- `v2/index.html`: nuevo CSS si aplica.
- `v2/test/mobilePwaHardening.test.js`
- `v2/test/godOperationalOversightUi.test.js`
- `v2/test/supplyAreasV7.test.js`
- cualquier test que aún exija shell56.

**RED/GREEN:** primero ajustar contratos para esperar shell57 y nuevos assets, confirmar fallo contra shell56, luego actualizar `sw.js`/APP_SHELL.

**Verificación:** búsqueda de `shell-56` debe quedar solo en documentación/histórico, no en tests activos ni runtime.

## Task 9 — Suite completa, revisión de alcance y CI

1. Ejecutar CI mediante PR draft, porque el workflow corre en `pull_request` para `v2/**`; pushes a esta rama no lo disparan por sí solos.
2. `client-tests`, `server-syntax`, `server-integration` deben quedar SUCCESS en el mismo HEAD.
3. Revisar diff contra `feature/vigia-warehouse-ops-v5`: no migración SQL, no cambios ajenos a V8.7, no mutación de movimiento existente.
4. Verificar que tests de EXACT-ONCE, reversals, ownership, áreas, PWA y DOM stability siguen verdes.
5. Convertir PR a ready solo cuando todo esté verde.

## Task 10 — Pre-merge/rollback y checkpoint humano

Antes de merge:
- crear `rollback/pre-v8-7-operational-date-history-20260914` apuntando al SHA productivo vigente.
- volver a comprobar que productiva no avanzó inesperadamente; si avanzó, rebase/merge controlado y repetir CI.
- no fusionar a productiva sin presentar al usuario: PR, HEAD, CI, archivos cambiados, riesgos y plan de despliegue.

## Despliegue esperado después de merge

Como V8.7 toca cliente y lógica cliente que produce eventos sincronizados, además de ruta backend de áreas, el despliegue requerirá:
- precheck `git status` limpio y SHA remoto exacto;
- `git pull --ff-only`;
- no migración SQL si se conserva el diseño JSONB;
- reinicio controlado de `SmartInventoryV2` por el cambio en `server/src/routes/areas.js`;
- `/health` y `/ready`;
- shell57 en navegador/PWA;
- prueba funcional: cargar sábado desde lunes, hacer dos entregas, verificar fecha bloqueada, historial agrupado, aprendizaje/áreas en sábado y auditoría técnica en lunes.

## Criterio de parada inmediata

Detener y no fusionar si cualquiera ocurre:
- una fecha futura atraviesa servicio;
- fecha cambia después de primera entrega;
- retry duplica movimiento;
- `createdAt/closedAt` se retroceden a la fecha operativa;
- un hijo desaparece del historial sin padre seguro;
- WAREHOUSE ve documentos ajenos o ADMIN obtiene bypass GOD;
- CI no está completamente verde en el HEAD a fusionar;
- aparece una necesidad de migración no prevista: reabrir diseño antes de implementarla.
