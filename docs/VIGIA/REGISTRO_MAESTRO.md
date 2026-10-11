# VIGÍA — REGISTRO MAESTRO Y PROTOCOLO DE CONTINUIDAD

> **Palabra clave permanente:** `VIGIA-FARO-1011`  
> **Inicio del registro formal:** 2026-10-11  
> **Proyecto:** VIGÍA (repositorio `ZeroArtLord/smart-inventory`)  
> **Rama de trabajo conocida:** `feature/v9-0-phase-c-offline-access`  
> **Estado del documento:** bitácora viva y versionada en GitHub.  
> **Uso:** recuperar el hilo aunque cambie o termine la conversación de ChatGPT.

## 0. Protocolo de continuidad (ACORDADO — REG-001)

1. En cada respuesta sobre VIGÍA, el asistente incluirá la palabra clave literal **`VIGIA-FARO-1011`**. Mantener una sola clave estable; no reemplazarla por claves nuevas de cada mensaje.
2. Toda decisión, requisito, modificación solicitada, restricción, prueba, resultado, bloqueo o corrección relevante del proyecto tendrá entrada en esta bitácora: fecha, ID, alcance, estado y siguiente paso. **Diferenciar explícitamente** deseos, propuestas, decisiones aprobadas, código implementado, pruebas superadas y despliegues verificados.
3. Actualizar esta bitácora en GitHub **durante la conversación, cuando haya acceso a herramientas y se acuerden novedades del proyecto**. Una promesa verbal de memoria no reemplaza el commit. Si una actualización no se puede guardar, avisarlo y proporcionar el texto pendiente de registrar. No se puede escribir a GitHub de forma automática cuando no hay conversación activa o sin herramientas disponibles.
4. Cuando el usuario escriba `VIGIA-FARO-1011` en un chat nuevo, buscar primero `docs/VIGIA/REGISTRO_MAESTRO.md` en `ZeroArtLord/smart-inventory`, revisar el HEAD actual de la rama, recuperar pendientes y **retomar el próximo paso sin reinventar ni repetir decisiones**.
5. No publicar contraseñas, tokens, correos personales, datos sensibles ni credenciales de producción. Los registros técnicos tendrán identificadores mínimos necesarios y nunca secretos. Mantener referencias a evidencias sin hacer públicas capturas privadas.
6. Trabajar **paso a paso**. No cambiar de arquitectura ni ejecutar despliegues antes de distinguir el diseño aprobado de lo meramente propuesto.
7. Mantener un historial **append-only** de decisiones y eventos. Si una decisión cambia, añadir revisión explícita y marcar la anterior como reemplazada; no borrar el contexto.

### Formato obligatorio de las próximas entradas

```text
[REG-XXX] Fecha | Tema | Estado
Origen: conversación / revisión técnica / prueba / despliegue
Necesidad y contexto:
Decisión exacta o requisito:
Alcance y exclusiones:
Dependencias y riesgos:
Código/archivos/commits (si aplica):
Verificación (evidencia y resultado):
Pendiente y siguiente acción:
```

Estados permitidos: **PROPUESTO**, **POR DECIDIR**, **ACORDADO**, **EN DESARROLLO**, **IMPLEMENTADO EN RAMA**, **TESTS OK**, **DESPLEGADO CONFIRMADO**, **FALLÓ / BLOQUEADO**, **REEMPLAZADO**. No asumir `DESPLEGADO CONFIRMADO` solo por la existencia de un commit.

## 1. Cambio de rumbo: VIGÍA como MONITOR operativo (REG-002, 2026-10-11 — ACORDADO a nivel de objetivo)

### Problema relatado por el usuario

VIGÍA pasó de ayudar al almacén a convertirse en **otro sistema de inventario** que exige estar pendiente de cantidades, existencias, movimientos, conteos y ajustes, duplicando trabajo frente al sistema de inventario oficial. El objetivo principal del rediseño es **reducir trabajo administrativo**, no crear una segunda contabilidad de stock.

### Nueva misión solicitada (requisitos de producto)

VIGÍA debe ser un **monitor y asistente de trabajo**, centrado solamente en estos flujos:

- **Visualizar los surtidos registrados**: qué producto se entregó, cantidad, destino/área, fecha y responsable, y consultar su historial. Los detalles exactos de reportes quedan por definir.
- **Preparar y sacar listas de COMPRAS y PEDIDOS** con edición continua; agregar, quitar, cambiar cantidades y notas, y usar el resultado para comprar o pedir.
- **Recomendar qué COMPRAR o PEDIR**: sugerencias accionables que no obliguen a llevar inventario paralelo.
- **Registrar surtidos como carrito de compras**: buscar productos, agregarlos libremente, ajustar cantidades y guardar el surtido, **independientemente de que el stock en VIGÍA sea cero, insuficiente o desconocido**.

### Límites expresos

- VIGÍA **no debe exigir mantener un inventario secundario al día** para trabajar.
- No bloquear la anotación de surtidos por stock insuficiente o desconocido.
- El carrito es un **registro operativo de entregas**, no una orden de descontar stock del sistema oficial.
- Quitar del **flujo diario** el requisito de entradas, conteos y ajustes para sostener una cifra paralela.
- El destino de los históricos y módulos viejos queda **POR DECIDIR**; no borrar información existente ni eliminar funcionalidades en producción sin migración, auditoría y validación.
- La simplificación funcional está aprobada como rumbo; **la arquitectura e implementación concretas no están aprobadas todavía**.

### Flujo conceptual solicitado (no implementado)

```text
VIGÍA MONITOR
  Surtidos   -> carrito libre -> guardar evento y consultar historial
  Comprar/Pedir -> única lista de trabajo editable e imprimible
  Inteligencia -> sugerencias de qué comprar o pedir
  Sistema oficial de inventario -> fuera de VIGÍA como gestor paralelo
```

## 2. Fuente de datos para recomendaciones (REG-003, 2026-10-11 — POR DECIDIR)

Se plantearon tres fuentes; el usuario **aún no eligió** una:

A. Existencias leídas en **modo consulta** del sistema oficial (SAINT / OLD / NEXUM; integración técnica y sistema fuente exacto pendientes).
B. Solo historial de surtidos registrado en VIGÍA (pronóstico de demanda, **sin afirmar stock actual real**).
C. Ambas fuentes: historial de surtidos + existencias oficiales consultadas, cuando estén disponibles.

No confundir consumo estimado con stock real. Hasta decidir la fuente, no diseñar cálculos definitivos ni automatizaciones que resten inventario oficial.

## 3. Requisitos operativos ya discutidos (historia útil — registrar sin equiparar a nueva aprobación)

### REG-004 — Lista semanal de compras/pedidos

- El usuario arma la lista el **lunes**, normalmente se compra/pide el **jueves**.
- El negocio sigue consumiendo entre lunes y jueves; por eso necesita **una sola lista vigente que se pueda reabrir, completar, corregir y quitar líneas**, en lugar de varias listas.
- Existe diferenciación entre `PURCHASE` (comprar) y `ORDER` (pedir).
- Se usan productos del catálogo, cantidades, presentaciones/unidades, notas y extras fuera de catálogo.
- Los productos cancelados no deben aparecer como activos ni en el ticket, pero se debe conservar trazabilidad; el usuario detectó el error `Transición no permitida: CANCELLED → CANCELLED` al pulsar repetidamente `Quitar`.
- La operación deseada debe permitir guardar trabajo sin perder selecciones aunque se salga de la pantalla, se recargue o haya un apagón.

### REG-005 — Autosave de la lista de trabajo

- Antes del rediseño se detectó que `state.drafts` y `state.pendingExtras` vivían en memoria y los cambios previos a confirmar se perdían con un cierre o corte eléctrico.
- Se implementó un **borrador local** separado por usuario y almacén, con persistencia IndexedDB y respaldo localStorage.
- Debe conservar selecciones, cantidades, unidades, notas, método comprar/pedir, entradas manuales y extras.
- Es **persistencia por dispositivo**; sincronización entre PC y móvil como borrador compartido **no se ha implementado ni acordado**.

### REG-006 — Carrito de surtidos propuesto

- Agregar libremente productos y cantidades como un carrito.
- No pedir "stock disponible" como requisito de entrada.
- Sugeridos: registrar destino, usuario, fecha y detalle; permitir ver surtidos anteriores.
- **POR DEFINIR**: permisos, edición/cancelación de surtidos, impresión, lectura de código de barras, uso sin conexión y sincronización, relación con sistemas externos.

## 4. Estado técnico conocido y trazabilidad (no asumir cambios en producción sin pruebas)

Repositorio: `ZeroArtLord/smart-inventory`. Rama: `feature/v9-0-phase-c-offline-access`.

| Commit | Descripción | Estado conocido |
| --- | --- | --- |
| `bbb19bdd2a95aeca24e7d7b51eeb51f466a92f87` | Hotfix epsilon en validación sync y cálculo stock | **Desplegado confirmado**; 22/22 tests; HEALTH/READY OK |
| `d0581e447b33bcf93d46c59ca1008cf7f364b8e2` | Autosave/restauración de borrador Comprar/Pedir | **Desplegado confirmado** como parte de `9b66e80` |
| `bee03998933745dcf8151ba9458bbced022af425` | Agregar/editar líneas en una lista semanal, reabrirla si aún no hay recepción | **Desplegado confirmado** como parte de `9b66e80` |
| `9b66e80fdc4b3e889003eea78c9787f7dd9adda6` | Corrección de test por normalización de acentos | **Último despliegue plenamente verificado en salida de PowerShell**: 23/23 tests, sintaxis OK, HEALTH/READY OK, 0 migraciones pendientes, servicio Running, worktree limpio |
| `067eb9f94e1441836c67f26c97f0c34a5e4745b8` | Ocultar líneas `CANCELLED` y hacer idempotente el botón Quitar | **IMPLEMENTADO EN RAMA**; no hay evidencia posterior en este historial que confirme su despliegue |
 
### Incidentes y riesgos históricos (REG-007)

- La cola offline y conflictos pueden bloquear operaciones; se observó repetición del error de validación `Existencia esperada inválido` por un residuo de coma flotante `-2.220446049250313e-16`; se corrigió el tratamiento de epsilon sin aceptar negativos reales.
- En el móvil, tras el hotfix, se observó `103 cambio(s) pendiente(s)`, `103 conflicto(s)`, `Último sync: synced`. Esto significa que los eventos no conflictivos drenaron, **pero los conflictos NO quedaron resueltos**. Falta conciliación controlada.
- Se planteó una resolución masiva segura de duplicados, **no desarrollada / no ejecutada en el historial disponible**. No pulsar `Usar servidor` o `Reaplicar mi cambio` indiscriminadamente: podrían existir diferencias reales.
- **No limpiar IndexedDB, cache, almacenamiento del navegador, colas offline o datos de usuario**, ni reinstalar PWA, como solución rápida. Preservar evidencia y datos.
- El nuevo diseño de MONITOR no debe introducir un nuevo circuito de conflictos por escrituras duplicadas de stock.

### Infraestructura histórica

- Backend Windows Service `SmartInventoryV2` en servidor HP, Node, ruta de aplicación `C:\SmartInventory\App\v2\server`, escucha local `127.0.0.1:5190`.
- Aplicación servida mediante `https://vigia.internal`, PWA que previamente indicaba `shell-64`; versión exacta futura por verificar.
- Endpoints de salud `/health` y `/ready`; antes de desplegar comprobar rama/HEAD, worktree limpio, tests y migraciones.
- Catálogo y datos históricos **no se deben borrar** como parte del rediseño conceptual.

## 5. Decisiones que NO deben darse por tomadas

1. Sistema origen exacto para leer existencias y permisos de solo lectura.
2. Si las recomendaciones dependerán de stock oficial, de consumo por surtidos o de ambos.
3. Qué pantallas existentes se ocultarán, archivarán o sustituirán, y cómo se accede a históricos.
4. Cómo se sincronizarán los nuevos surtidos entre equipos si están offline, sin conflictos ni duplicados.
5. Qué constituye un surtido finalizado y si se permite anular/corregirlo, imprimir o exportar.
6. Campos mínimos de área de destino, solicitante, responsable y observaciones.
7. Frecuencia, fórmulas y controles manuales de recomendaciones de compras/pedidos.
8. Seguridad, permisos, auditoría y retención del registro de eventos.
9. Plan de pruebas piloto, migración, respaldo y reversión.

## 6. Próximo paso inmediato (REG-008, 2026-10-11 — ACORDADO como metodología)

**Trabajar paso a paso, empezando por documentar TODO** antes de reprogramar VIGÍA. El usuario pidió registro integral y palabra clave en **cada respuesta**. Una vez registrado esto, abordar **una decisión de diseño por vez**, con un resumen verificable, sin desplegar cambios funcionales implícitos.

### Checklist de continuidad

- [x] Establecer palabra clave permanente: `VIGIA-FARO-1011`.
- [x] Crear bitácora versionada en GitHub.
- [ ] Confirmar primera decisión funcional concreta del rediseño.
- [ ] Documentar flujos exactos con ejemplos reales.
- [ ] Diseñar y validar propuesta de interfaz.
- [ ] Implementar en rama o espacio aislado; preservar versión anterior.
- [ ] Ejecutar pruebas unitarias, flujos de usuario y simulación de apagón/offline.
- [ ] Desplegar únicamente tras aprobación y plan de reversión.

## 7. Registro cronológico incremental

### [REG-001] 2026-10-11 | Bitácora, continuidad y palabra clave | ACORDADO

- **Origen:** petición explícita del usuario: registrar cada detalle, parte, cosa o modificación y dar una palabra clave en todas las respuestas para retomar tras agotarse la conversación.
- **Decisión:** bitácora versionada, identificadores REG-XXX, una clave permanente, estados verificables, registrar también asuntos pendientes.
- **Entregable:** este archivo.
- **Siguiente acción:** empezar a concretar el diseño de VIGÍA MONITOR con el usuario, paso a paso.

### [REG-002] 2026-10-11 | Simplificación radical VIGÍA MONITOR | ACORDADO como visión

- **Origen:** usuario indica que VIGÍA se volvió un segundo inventario y consume trabajo.
- **Requisitos:** ver surtidos, generar listas de compra/pedido, recomendar compras/pedidos, registrar surtidos sin restricciones de stock mediante carrito.
- **No implica:** borrar módulos históricos, migrar datos ya, modificar stock oficial, ni desplegar.
- **Estado:** visión acordada, implementación pendiente.

### [REG-003] 2026-10-11 | Fuente de las recomendaciones | POR DECIDIR

- **Opciones:** inventario oficial read-only / historial surtidos / ambos.
- **Siguiente paso:** escoger la fuente antes de fijar el motor de sugerencias.


### [REG-009] 2026-10-11 | Inventario funcional completo de VIGÍA existente | ANALIZADO, RECOMENDACIONES POR DECIDIR

- **Origen:** petición explícita del usuario de estudiar todas las funciones presentes y resumir qué conservar, simplificar o eliminar, antes de aprobar rediseño.
- **Base de revisión:** rama `feature/v9-0-phase-c-offline-access`, árbol GitHub auditado en el commit `ee45c9fafde45a340dabe9c1eb8bc79542f8556a` (331 archivos de todos los tipos, incluyendo módulos, documentación, tests, migraciones, frontend legado). Se revisaron `v2/index.html`, `v2/src/ui/app.js`, más de 40 módulos representativos de cliente/API y documentación. **Análisis de código, no auditoría en ejecución de todas las pantallas ni consulta en vivo de PostgreSQL.**
- **Las 12 secciones principales visibles en el menú:** 1 Dashboard, 2 Catálogo, 3 Conteo, 4 Entradas, 5 Surtidos, 6 Comprar/Pedir, 7 Reportes, 8 Alertas, 9 Usuarios, 10 Auditoría, 11 Conflictos, 12 Configuración. Los permisos pueden ocultar secciones a determinados roles.
- **Dashboard:** cantidad de productos, stock bajo/crítico, lotes por vencer, surtidos del día, sugerencias de reposición, movimientos recientes, acciones rápidas, estado de sesión/pendientes/conflictos. Sugerencia: convertir en tablero de actividad, sin cifras de stock interno presentadas como verdad real.
- **Catálogo:** productos, categorías, SKU y Código SAINT separados, código de barras (varios), alias, búsqueda por nombre/código, unidades base y presentaciones/conversiones, mínimos, máximos, método de compra/pedido, importación y vista previa Excel/CSV de catálogo, asociación de códigos con cámara/lector. Sugerencia: CONSERVAR como directorio de consulta/búsqueda y administración opcional; quitar exigencia de mantener stock local.
- **Conteo:** conteo físico por categoría, pausa/salto/pendientes, reanudación, diferencias, conciliación GOD (recontar/ignorar/ajustar), ajustes masivos y corrección rápida de existencias. Sugerencia: OCULTAR del trabajo cotidiano en VIGÍA MONITOR (conservar históricos y no borrar los datos).
- **Entradas:** documentos de ingreso de mercancía, borradores, líneas, cierre, generación de movimientos/stock, costos y lotes/vencimientos, reconciliación de recepciones con pedidos. Sugerencia: OCULTAR como segundo inventario; evaluar si se conserva un simple registro informativo de llegada sin existencias.
- **Surtidos:** documentos carrito, borradores, líneas, surtido vivo a lo largo del turno, cantidades planificadas vs entregadas, parciales, reintento idempotente mediante delivery tokens, historial, fechas operativas, áreas y distribuciones, atajos rápidos, checklist, reimpresión/impresión térmica, reportes SAINT. **Actualmente el cierre/descargo usa movimientos de stock y FEFO y el servidor rechaza stock negativo** (`STOCK_NEGATIVE`); por tanto NO cumple todavía la nueva exigencia de carrito libre sin existencia. Sugerencia: rehacer esta lógica con un registro operativo independiente de stock, preservando historial/auditoría.
- **Comprar/Pedir:** recomendaciones, selección de productos, búsqueda manual, extras fuera de catálogo, cantidades, notas, método comprar/pedir, listas separadas por tipo, lista abierta editable con adiciones y cancelaciones, reapertura previa a recepción/transporte, seguimiento de realizado/en camino/recibido, tickets 80 mm, borrador local auto-guardado y restaurado por usuario/almacén (IndexedDB + localStorage). Sugerencia: CONSERVAR y simplificar, asegurando una única lista semanal editable, sin abrir otra por error. Estado de código no equivale a prueba funcional completa.
- **Inteligencia de compras:** cálculo de consumo por movimientos/surtidos, ventanas 7/14/30/60/90, aprendizaje V4D, tendencia, estacionalidad semanal/anual, anomalías, cobertura, confianza, objetivos y min/max, mercancía en tránsito, explicación de la sugerencia. **Hoy la sugerencia usa stock interno derivado**; fuente futura pendiente (surtidos, lectura del sistema oficial, ambos). Sugerencia: CONSERVAR aprendizaje útil, sustituir dependencia del stock paralelo.
- **Reportes:** panel avanzado V8 con filtros por tiempo/área/categoría/producto, consumo y destinos, top productos, tendencias, hallazgos/anomalías, reportes por área/ubicación, consultas operativas interpretadas localmente ("Pregúntale a VIGÍA"), vistas guardadas, export CSV/Excel y opción de impresión/PDF vía navegador. Sugerencia: CONSERVAR reportes de surtidos y consumo, retirar tablas y métricas derivadas de stock local no fiable.
- **Alertas:** riesgo mínimo/crítico, vencimiento de lotes, conflictos. Sugerencia: cambiar a alertas de demanda, tareas operativas y sincronización técnica, no falsos faltantes de inventario.
- **Usuarios y seguridad:** login Google/Firebase, sesión y workspaces aislados, roles GOD/ADMIN/SUPERVISOR/WAREHOUSE/VIEWER, permisos granulares, listas de usuarios/membresías. Sugerencia: CONSERVAR.
- **Auditoría:** eventos y acciones trazables, historial operativo y reversión de ajustes de stock. Sugerencia: CONSERVAR bitácora/auditoría pero ocultar las compensaciones de stock en nuevo modo.
- **Conflictos/Offline/Sync:** PWA instalable PC/móvil, Service Worker, IndexedDB local, cola durable, push/pull incremental, eventos/versiones, reintentos, modo offline autorizado, resolución manual aceptar servidor/reaplicar. Problema histórico: 103 conflictos en móvil; no hay evidencia de resolución completa. Sugerencia: CONSERVAR sincronización fiable, esconder detalle técnico a usuario normal; no limpiar colas/datos.
- **Configuración:** workspace, sesión/rol, conectividad, sincronización, opción SAINT futura; ajustes de impresora térmica con configuración, test y comprobación de conexión en panel propio. Sugerencia: CONSERVAR simplificado.
- **Integración SAINT:** existen catálogo/carga inicial por Excel, validación, mapeo/variantes SAINT, exportes de surtido y reporte SAINT-ready; **no se verificó integración productiva automática de stock en vivo desde SAINT/OLD**. No equiparar export/reporte con API de lectura real del inventario oficial.
- **Backend/infraestructura:** Node/Express, PostgreSQL, migraciones 001..019, Firebase, API administración/áreas/sync/auditoría/impresión; seguridad, validación, protección de stock no negativo, backups/restore/integridad/preflight, servicio Windows en HP. **No borrar esta infraestructura por querer retirar menús**: hay dependencias que requieren migración.
- **Legado:** repositorio raíz también contiene frontend JS/HTML antiguo, Rubbish y documentación histórica; `v2/` es la PWA desplegada. No borrar por intuición; se debe verificar uso/referencia y respaldos.
- **Último estado técnico verificado en conversación:** despliegue confirmado `9b66e80` (23/23 pruebas del flujo compras, health/ready OK); hotfix de ocultar cancelados `067eb9f` en GitHub pero sin salida de despliegue confirmatoria. La bitácora ahora tiene commits posteriores SOLO de documentación. `REG-009` no cambia producción.
- **Clasificación provisional (sin aprobación del usuario):** CONSERVAR: compras/pedidos, directorio de productos, historial de surtidos, usuarios, auditoría, seguridad y reportes de consumo. SIMPLIFICAR: dashboard, sugerencias, alerts, exportaciones, impresión, configuración, sincronización. REEMPLAZAR: carrito de surtidos con descargo de stock -> registro libre. RETIRAR DEL FLUJO NORMAL (no borrar datos): conteo físico, entradas de stock, ajustes/correcciones, control de lotes FEFO y duplicación de existencias.
- **Riesgos antes de quitar módulos:** mantener archivo histórico, permisos, registros anteriores, datos/sync pendientes; no dejar que nuevos surtidos agreguen movimiento `SUPPLY` de stock ni crear `STOCK_NEGATIVE`; separar métricas de consumo de métricas de stock.
- **Decisión del usuario:** PENDIENTE. Esta auditoría **no constituye permiso para eliminar ni modificar funciones**.
- **Siguiente acción:** usuario identifica sección por sección qué conservar/simplificar/retirar; definir diseño mínimo del monitor y fuente de recomendaciones, luego migración aislada y pruebas antes de despliegue.


### [REG-010] 2026-10-11 | Recorrido completo del catálogo para Comprar/Pedir con pendientes | REQUISITOS DEL USUARIO ACORDADOS; MECÁNICA DETALLADA POR APROBAR

- **Origen:** el usuario quiere combinar el recorrido secuencial por categorías y el sistema de productos saltados del módulo antiguo CONTEO con la decisión COMPRAR/PEDIR. Señala que las sugerencias automáticas pueden equivocarse y que los productos están distribuidos en diferentes ubicaciones físicas. La revisión humana de absolutamente todos los productos es necesaria para decidir qué hace falta.
- **Problema actual comprobado en código:** \`procurementWorkspaceV6Ui.js\` construye \`visible\` desde \`state.rows.filter(r => Number(r.suggestedQuantity||0)>0)\`, de manera que la vista principal enseña sugeridos y productos añadidos manualmente, **no** el catálogo completo. \`confirmLists()\` exige cantidad >0 antes de crear renglones de lista; esto no sirve para la primera pasada de marcado sin cantidad. No modificar este comportamiento hasta aprobar nuevo diseño.
- **Requisito explícito 1:** mostrar **TODOS** los productos activos del catálogo, agrupados por categoría, incluso sin sugerencia, sin déficit o sin stock disponible. La revisión no depende de \`minStock/maxStock\` ni del motor de sugerencias.
- **Requisito explícito 2:** recorrer los productos como en CONTEO: seleccionar categoría y avanzar uno por uno con el mínimo de interacciones; permitir cambiar entre categorías.
- **Requisito explícito 3:** al revisar visualmente un producto, decidir **COMPRAR** o **PEDIR** con un toque, sin tener que escribir cantidades en la primera pasada.
- **Requisito explícito 4:** botón **PENDIENTE / SALTAR** para cuando el producto no está a la vista o aún debe comprobarse físicamente; el recorrido debe avanzar al siguiente producto **sin tratar pendiente como cero, rechazado o revisado**. El usuario podrá retomar todos los pendientes después desde una vista propia, sin perder posición ni decisiones previas.
- **Requisito explícito 5:** continuar trabajando y guardar elecciones aunque salgas/recargues/apagón, aprovechando el principio de autosave ya construido. Debe estar disponible desde PC y móvil, pendientes y avances intactos según la estrategia de persistencia que se acuerde. No prometer sincronización entre dispositivos antes de implementarla.
- **Requisito explícito 6:** mantener la lista semanal editable del lunes al jueves, con recomendación del sistema como referencia **no vinculante**. No exigir mantener inventario paralelo.
- **Propuesta del asistente pendiente de aprobación:** botón adicional \`NO HACE FALTA\` (estado humano explícito distinto a PENDIENTE, para poder cerrar el progreso); contador revisados/total por categoría y global; botones COMPRAR / PEDIR / NO HACE FALTA / PENDIENTE; avance automático; pestaña "Pendientes"; sección "Seleccionados"; poder corregir decisiones; importación de marcaciones a la(s) lista(s) semanal(es) existente(s) sin duplicar.
- **PUNTO ABIERTO PRINCIPAL:** ¿al marcar COMPRAR/PEDIR se conserva la decisión sin cantidad y la cantidad se pide únicamente al preparar/cerrar la lista, o la cantidad puede seguir siendo opcional incluso al imprimir/emitir? El usuario dijo *primero reviso visualmente sin tener que poner cantidades*; no inferir aún el momento exacto de ingresar cantidades.
- **Segundo punto de diseño:** el usuario dice que después vuelve a los pendientes "y contarlo". Confirmar más adelante si significa revisar físicamente la existencia, ingresar una cantidad de inventario como dato auxiliar o simplemente determinar COMPRAR/PEDIR. La nueva filosofía MONITOR prohíbe volver a exigir conteos de stock interno.
- **Riesgos y dependencias:** no reutilizar \`documentLine\` de COUNT ni la conciliación/ajuste de stock para esta revisión, para evitar movimientos o conflictos innecesarios. Reutilizar solo patrón de navegación, categorías, progreso y pendientes de \`countWorkflowUi.js\` y \`countWorkflow.js\`. Persistir decisiones como entidad de revisión de compras independiente del stock; definir sincronización robusta.
- **Estado actual:** diseño solicitado, todavía NO implementado ni desplegado. No borrar ni reemplazar el módulo Conteo todavía.
- **Siguiente paso:** explicar una versión simple del recorrido, confirmar el momento de cantidades, y solo entonces construir propuesta operativa paso a paso.
