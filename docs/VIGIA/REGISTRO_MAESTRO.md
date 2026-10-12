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


### [REG-011] 2026-10-11 | Cantidad opcional durante revisión por categorías | ACORDADO; diseño técnico PROPUESTO

- **Origen y autorización explícita:** el usuario eligió para REG-010: **«la cantidad será opcional durante la revisión; puedo indicarla en el momento o completarla después»** y pidió continuar con ese diseño.
- **Decisión ACORDADA:** seleccionar **COMPRAR** o **PEDIR** es válido sin escribir cantidad. El campo de cantidad es opcional al clasificar visualmente cada producto. Si conoce la cantidad, puede capturarla en ese momento; si no, la completa más tarde desde seleccionados/lista. La decisión de selección nunca puede perderse ni convertirse accidentalmente en 0 por no haber cantidad.
- **Modelo propuesto de revisión semanal (no implementado):**
  - Una sesión de revisión por usuario/almacén/semana, con categoría actual, producto actual, recorrido y progreso.
  - Todos los productos **activos** del catálogo, incluidos los no sugeridos y los de stock desconocido.
  - Estado humano exclusivo por producto: \`SIN_REVISAR\`, \`COMPRAR\`, \`PEDIR\`, \`NO_HACE_FALTA\` o \`PENDIENTE\`. El botón \`NO_HACE_FALTA\` es **propuesta** del asistente que aún puede ajustarse por feedback; sirve para distinguir revisión completa de producto saltado.
  - \`cantidad\` tipo número positivo **o null**; \`null\` = **POR DEFINIR**, nunca inventar \`0\`. Presentación/unidad y observación opcionales; se anotan al momento o después.
  - \`PENDIENTE\` no cuenta como revisado y no equivale a falta de mercancía; debe permanecer en bandeja de pendientes. \`NO_HACE_FALTA\` es decisión definitiva para esa revisión, editable posteriormente.
  - Al pulsar COMPRAR/PEDIR/NO_HACE_FALTA/PENDIENTE, guardar elección y avanzar; soporte para retroceder, cambiar de categoría, buscar producto, editar elección/cantidad, vista de pendientes y vista de seleccionados.
  - Progreso propuesto: \`revisados = comprar + pedir + no hace falta\`; \`pendientes\` se muestra aparte; \`sin revisar\` también. \`cantidad pendiente\` cuenta productos COMPRAR/PEDIR aún sin cifra, independientemente de revisión terminada.
  - Las sugerencias del motor inteligente son **ayuda no vinculante**, nunca razón para ocultar productos ni imponer stock.
  - El trabajo del lunes a jueves debe seguir siendo **una sola compra y un solo pedido editables**; una decisión posterior actualiza líneas por \`productId\`, sin duplicados; cambios de método o \`NO_HACE_FALTA\` deben manejarse como corrección trazable, no borrar historial.
  - **Separación necesaria:** revisión de decisiones con cantidad \`null\` NO debe enviarse todavía al actual contrato \`createProcurementLists()\`/backend \`replenishment\`, porque hoy exige \`requestedQuantity > 0\` y el persistente \`procurementWorkspaceDraft.js\` transforma cantidades faltantes a \`0\`. Evitar escribir entidades inválidas; crear persistencia de sesión de revisión o evolucionar borrador mediante migración versionada, manteniendo las listas previas.
  - Persistencia local durable antes de confirmar cada paso; al salir/apagón recuperar todos los estados y posición. Sincronización entre dispositivos queda por especificar y probar (no prometerla aún). Sin borrados ni limpieza de IndexedDB.
- **Interfaz propuesta, no aprobada al detalle:** cabecera con avance total/categoría; ficha grande de producto, sugerencia discreta, cuatro botones de estado, cantidad y unidad opcionales, navegación anterior/siguiente; pestañas \`Categorías\`, \`Pendientes\`, \`Seleccionados\`, \`Mis listas\`. No obligar al usuario a entrar cada vez a editar.
- **Regla de finalización POR DEFINIR:** cuando la lista semanal se va a imprimir o marcar realizada, ¿renglones con \`cantidad:null\` se imprimen como espacio en blanco para anotación manual o deben completarse antes de cerrar? No inferir respuesta; ofrecer decisión simple.
- **Pruebas exigidas antes de despliegue:** recorre productos sugeridos/no sugeridos; categoría sin productos; marca sin cantidad; introduce/modifica cantidad; pendiente/retoma; vuelve a categoría; cierre/recarga/apagón con progreso; duplicados de lista por producto; dos sesiones/usuarios; migración desde borradores existentes; conservación de 103 conflictos anteriores; cero alteración de movimientos de stock; impresión con cantidad faltante según regla aprobada.
- **Estado de implementación:** documentación actualizada, **NO SE MODIFICÓ CÓDIGO FUNCIONAL**, sin pruebas ni despliegue de esta nueva funcionalidad.
- **Siguiente paso:** confirmar regla de cantidades incompletas en impresión/cierre, y continuar definición de experiencia mínima antes de crear cambios en rama aislada.


### [REG-012] 2026-10-11 | Impresión de listas con cantidades vacías | DECISIÓN ACORDADA; IMPLEMENTACIÓN PENDIENTE

- **Origen:** aprobación explícita del usuario: «REG-011: permitir imprimir listas con cantidades en blanco para completarlas a mano. Regístralo y continúa.»
- **Regla aprobada:** las listas COMPRAR y PEDIR pueden **imprimirse aunque algunos productos estén marcados sin cantidad numérica**. Se deja un espacio visible de escritura manual donde correspondería la cantidad. El trabajo de revisión y la selección no se bloquean por una cantidad ausente.
- **Semántica de datos obligatoria:** cantidad no informada = \`null\`/«por definir», NUNCA 0 ni stock 0. Una cantidad aportada (por ejemplo, 3 CAJAS) se imprimirá normalmente; una no aportada se representa visualmente como línea en blanco \`________\` y unidad conocida si existe. Las cantidades escritas a mano no se considerarán digitalmente guardadas hasta que alguien las introduzca en VIGÍA.
- **Qué se imprime:** solo productos decididos explícitamente como COMPRAR o PEDIR, agrupados en su tipo y por categoría, con nombre/código, nota y unidad disponible. Las decisiones \`PENDIENTE\`, \`SIN_REVISAR\` y \`NO_HACE_FALTA\` **no son artículos solicitados**, por lo que no salen en la compra/pedido. Estas decisiones se conservan como estado de revisión.
- **Conservar formato actual:** el módulo existente \`v2/src/ui/procurementWorkspaceV6Print.js\` imprime dos copias del ticket 80 mm: en COMPRAR, CHÓFER/DEPÓSITO; en PEDIR, PROVEEDOR/DEPÓSITO. Conservar las funciones de vista previa y calibración de impresora al rediseñar; adaptar impresión directa ESC/POS por separado para mantener coherencia con la vista previa.
- **Restricción técnica confirmada por revisión de código:** las funciones actuales \`createProcurementLists()\`/\`appendProcurementListItems()\` en \`procurementListService.js\` y el contrato de \`replenishment\` exigen \`requestedQuantity > 0\`; por tanto NO pueden almacenar líneas de compras/pedidos sin cantidad en su formato actual. Primero deberá implementarse una entidad o borrador de revisión semanal que conserve selección sin cantidad. No usar conversiones silenciosas \`null -> 0\` ni generar falsos movimientos de inventario.
- **No se decidió todavía:** si «Marcar realizada» (cerrar formalmente) estará permitido cuando haya cantidades digitales en blanco, si se admitirá completar solo en papel o si seguirá un estado de impresión provisional. **Imprimir con blancos está aprobado; cierre sin cantidades no debe inferirse de ello.**
- **Definición preliminar de flujo mínimo propuesta (sin aprobación visual aún):** CATEGORÍAS → ficha secuencial → COMPRAR/PEDIR/NO HACE FALTA/PENDIENTE → vista PENDIENTES para retomarlos → SELECCIONADOS con cantidades opcionales → VISTA PREVIA / IMPRIMIR listas semanales, sin duplicados. Conservar estado de sesión y progreso.
- **Pruebas requeridas:** impresión con todas, algunas o ninguna cantidad; no mostrar ceros ficticios; conservar categoría, texto y unidad; 2 copias por tipo; excluir pendientes/no hace falta; impresión directa y vista previa coinciden; ninguna escritura de stock; prueba móvil, offline, cierre/recarga.
- **Estado del trabajo:** únicamente decisión/documentación. **Ningún módulo funcional ni producción han cambiado en REG-012.** Sin tests ejecutados de nueva impresión.
- **Siguiente paso:** validar representación visual de revisión/lista e identificar la mínima política de finalización; después implementar la nueva sesión de revisión de compras en rama de desarrollo aislada y probarla sin tocar datos reales.


### [REG-013] 2026-10-11 | Continuidad de revisión semanal entre PC y teléfono | ACORDADO; IMPLEMENTACIÓN PENDIENTE

- **Origen:** el asistente preguntó si el avance de revisión debía compartirse entre teléfono y PC, para empezar en un dispositivo y continuar exactamente donde se dejó en el otro. El usuario contestó explícitamente: **«SÍ ME GUSTA»**. Queda confirmada la decisión.
- **Regla acordada:** una misma revisión semanal de Comprar/Pedir debe estar disponible en **PC y teléfono** del usuario. Ambos deben mostrar decisiones COMPRAR/PEDIR/NO HACE FALTA/PENDIENTE, cantidades opcionales o \`null\`, notas, categorías revisadas, pendientes y posición de avance. Un cambio confirmado en un dispositivo debe aparecer al sincronizar el otro, sin reconstruir otra lista ni repetir la revisión.
- **Protección del trabajo:** guardar primero en el dispositivo antes de comunicar que se guardó; enviar al servidor cuando haya conectividad; permitir seguir revisando sin Internet con operaciones identificables y recuperables. Mostrar estados claros \`Guardado en este dispositivo\`, \`Pendiente de sincronización\` y \`Sincronizado\`. No confundir «guardado localmente» con «disponible ya en el otro dispositivo».
- **Estrategia técnica PROPUESTA, todavía no implementada:** sesión de revisión compartida identificada por \`workspaceId\` + período semanal + alcance de revisión (usuario o equipo, alcance final POR DECIDIR), con estado persistido en PostgreSQL y respaldo local durable en IndexedDB; operaciones identificadas para impedir duplicados; sincronización de cambios incrementales y revisión de versión por producto para no sobrescribir decisiones concurrentes.
- **Conflictos:** dos dispositivos offline podrían modificar simultáneamente el mismo producto. NO usar una regla silenciosa de «gana siempre el último», no borrar ninguna elección. Detectar diferencia y permitir conciliación clara al usuario cuando sea inevitable; en caso de modificaciones de productos distintos, combinarlas sin conflicto. La política exacta de combinación está POR DEFINIR y se debe probar.
- **Riesgo preexistente:** existen antecedentes de **103 conflictos locales** en teléfono sin resolución verificada. No borrar IndexedDB, colas ni cookies/datos del sitio, no reiniciar sesión ni usar operaciones destructivas para «arreglar» la sincronización; no reutilizar ingenuamente el flujo de movimientos/stock de la V2 para estas decisiones.
- **Dependencias importantes:** mantener el \`null\` de cantidad hasta la vista previa e impresión con línea en blanco acordada en REG-012; conservar una única lista COMPRAR y una PEDIR editables para el período, sin duplicados; no aplicar ajustes, entradas, salidas ni escrituras de stock por marcar decisiones.
- **Distinción de estado:** **función aprobada como requisito**; todavía NO se han creado entidades nuevas ni desarrollado sincronización de revisión, ni ejecutado pruebas ni desplegado cambio alguno. No prometer que ya funciona.
- **Verificaciones futuras mínimas:** PC->servidor->móvil; móvil->servidor->PC; reconexión tras horas offline; decisión COMPRAR/PEDIR sin cantidad; pendiente y progreso; cierre/reinicio del navegador; dos cambios simultáneos en productos diferentes e iguales; sin duplicados, sin pérdida de datos ni movimientos de stock.
- **Siguiente paso:** precisar si la revisión semanal es **personal** del usuario y visible en sus dos dispositivos o **compartida por todo el equipo del almacén** con permiso, antes de fijar claves de sesión y reglas de colaboración.


### [REG-014] 2026-10-11 | Revisión semanal colaborativa por almacén | ACORDADO; IMPLEMENTACIÓN PENDIENTE

- **Origen:** cuando se le consultó si la revisión sería personal o compartida por empleados, el usuario respondió: «COMO SEA ESO NO IMPORTA MUCHO PUEDEN MODIFICARLAS LAS PEROSANS QUE QUIERAN».
- **Decisión:** la revisión semanal y las listas Comprar/Pedir serán **compartidas por el equipo del mismo almacén**, no atadas a un solo usuario. Cualquier persona **con acceso autorizado a VIGÍA y a ese almacén** podrá consultarlas y editarlas desde PC o teléfono; no se interpreta como permitir escritura anónima o pública.
- **Comportamiento:** una sola revisión semanal colaborativa, una lista de compra y una lista de pedido vigentes; cada miembro ve decisiones, cantidades opcionales, productos pendientes y avance del equipo. Una actualización de un usuario deberá reflejarse en los demás tras sincronización.
- **Controles discretos, sin añadir trabajo:** reutilizar inicio de sesión y membresía existentes, registrar quién cambió cada producto y cuándo, evitar duplicados y detectar ediciones concurrentes del mismo producto sin perderlas silenciosamente. Cambios sobre productos distintos se combinarán; si dos personas modifican el mismo producto, mostrar una resolución simple y preservar el historial.
- **Persistencia:** conservar decisiones locales ante cortes y sincronizarlas con servidor cuando haya red. No confundir guardado local con sincronizado en los demás dispositivos. Preservar colas e historial existente, incluidos 103 conflictos móviles no resueltos; **no borrar IndexedDB**.
- **Hereda REG-010/011/012/013:** revisión de todos los productos activos por categoría, saltar/retomar pendientes, cantidades opcionales, impresión con huecos en blanco, sin depender de stock local ni generar movimientos de inventario.
- **Alcance:** acuerdo funcional. NO se ha implementado este nuevo modo colaborativo, no se ha probado, ni se ha desplegado.
- **Siguiente paso:** consolidar la especificación del recorrido y enseñar al usuario una interfaz inicial revisable antes de desarrollar código funcional en un entorno aislado.


### [REG-015] 2026-10-11 | Primer prototipo visual interactivo Comprar/Pedir | PROTOTIPO PROBADO, REVISIÓN DEL USUARIO PENDIENTE

- **Origen:** el usuario respondió «OK» a la propuesta de preparar el diseño visual completo del nuevo módulo Comprar/Pedir para revisarlo antes de programar.
- **Entregables:** HTML único descargable \`VIGIA_Prototipo_Comprar_Pedir_REG015.html\` en la conversación; documentación permanente de diseño en \`docs/VIGIA/PROTOTIPO_COMPRAR_PEDIR_REG015.md\`. SHA-256 del HTML: \`53ce66a09a3b342a6119702223c5802217e255541b24a22c069943f295796598\`.
- **Diseño:** navegación oscura VIGÍA Monitor + paneles claros, responsive escritorio/teléfono. Pantallas: Inicio/categorías, Revisar productos uno por uno, Pendientes, Seleccionados con cantidades opcionales y extras, Mis listas con tickets 80 mm y dos copias. El prototipo tiene 33 productos simulados organizados en 6 categorías. Las sugerencias son ilustrativas y NO datos del VIGÍA real.
- **Comportamiento de demo:** COMPRAR, PEDIR, NO HACE FALTA, PENDIENTE; avance de revisión, salto y recuperación desde pendientes; cantidades positivas o \`null\`, unidad, observación; cambio de clasificación; extra libre; lista diferenciada COMPRAR/PEDIR; impresión por navegador con cantidad vacía como espacio de escritura \`________\`. Selecciones guardadas SOLO en el navegador de la demo usando prefijo \`vigia.reg015.demo.v1\`.
- **Verificación local:** sintaxis JS revisada; pruebas Playwright con Chromium sin errores JS: navegación, decisiones opcionales, pendiente, recuperación, agregado de extra y dos copias en vista previa; móvil 390px sin desbordamiento horizontal. Pruebas de diseño, NO pruebas operativas ni servidor.
- **Limitaciones:** sin sincronización PC↔móvil real, sin conexión a PostgreSQL/Firebase, sin impresión ESC/POS real, sin catálogos reales, sin integración en producción. No se ha desplegado nada ni borrado datos.
- **Estatus de propuesta:** interfaz preliminar lista para feedback del usuario. El botón \`NO HACE FALTA\` y aspecto visual se presentan como propuesta, aún ajustables. Persistencia/sincronización reales aprobadas como objetivo en REG-013/014, pero no implementadas en este archivo.
- **Siguiente paso:** mostrar prototipo y pedir evaluación concreta del recorrido/pantalla para aprobar o corregir antes de iniciar implementación aislada. No inferir autorización para tocar producción.


### [REG-016] 2026-10-11 | Feedback a diseño REG-015 y aprobación de Extras | ACORDADO

- **Origen:** el usuario revisó el primer prototipo REG-015 y comentó que **la imagen/presentación visual de teléfono está un poco mal hecha**, pero que eso puede arreglarse después; **el resto del diseño le parece bien**.
- **Requisito explícito clave:** añadir **COMPRAS EXTRAS MANUALES** de cosas fuera del catálogo, por ejemplo «cinta métrica», sin registrar esos elementos como producto VIGÍA. El asistente y usuario confirmaron que esas compras deben incluirse obligatoriamente en el flujo.
- **Comportamiento confirmado:** agregar texto libre por ítem Extra, con elección COMPRAR o PEDIR, cantidad/unidad/observaciones opcionales y capacidad de aparecer en Seleccionados, lista final y ticket impreso bajo grupo EXTRAS. No afectar stock ni exigir creación de catálogo. La lista semanal puede incluir extras y productos normales a la vez.
- **Estado:** requisitos y feedback registrados, integración a producto real pendiente. La demo REG-015 ya incluía una opción ilustrativa de extras, pero sin integración backend real.
- **Seguimiento visual:** conservar el rediseño móvil como tarea pendiente, no considerar la captura móvil del REG-015 como diseño definitivamente aprobado.
- **Siguiente paso:** especificar las seis secciones del módulo y validarlas antes de implementar.

### [REG-017] 2026-10-11 | Diseño funcional de seis secciones de Comprar/Pedir | PROPUESTO PARA APROBACIÓN

- **Origen:** el usuario contestó «OK CONTINUEMOS» tras la propuesta de definir exactamente la estructura final, pantalla por pantalla, antes de desarrollar.
- **Documento de especificación:** \`docs/VIGIA/ESPECIFICACION_COMPRAR_PEDIR_MONITOR_REG017.md\`.
- **Seis secciones descritas:** 1 Inicio/revisión semanal; 2 Revisión por categoría; 3 Pendientes; 4 Seleccionados; 5 Extras; 6 Mis listas/impresión. **Extras no depende del catálogo y admite cantidad sin definir.**
- **Hereda decisiones REG-010 a REG-016:** todos los productos activos, recomendaciones no vinculantes, cuatro estados humanos, cantidades positivas o \`null\`, pendientes recuperables, impresión con espacios en blanco, una lista de compra y una de pedido editables, colaboración del equipo del almacén PC/teléfono, sin movimientos de stock.
- **Diferencia importante:** los campos de clasificación se podrán guardar antes de conocer la cantidad; el contrato de reposición existente exige positivo y deberá evolucionarse con seguridad.
- **Puntos todavía por validar:** aprobación final del orden/flujo visual; regla para marcar Realizada si hay cantidades sin definir; ciclo de cierre semanal; rediseño visual móvil.
- **Estado actual:** especificación documental únicamente. No se alteraron código funcional, base de datos, sincronización ni producción; no hubo despliegue.
- **Siguiente paso:** confirmar el diseño con usuario, después crear implementación aislada y plan de pruebas.


### [REG-018] 2026-10-11 | Reportes como módulo principal independiente | PRESERVACIÓN ACORDADA; DISEÑO SIMPLIFICADO PROPUESTO

- **Origen:** después de presentar seis subsecciones internas del módulo Comprar/Pedir, el usuario preguntó explícitamente: «OK Y REPORTES?». Se aclara que las seis subsecciones **no reemplazan el menú general**; Reportes sigue siendo parte principal de VIGÍA Monitor.
- **Estructura general propuesta:** menú principal VIGÍA Monitor con cuatro módulos: 1) Inicio, 2) Surtidos, 3) Comprar/Pedir, 4) Reportes. Catálogo, Usuarios, Auditoría, Configuración y diagnósticos en administración/segundo plano. Esta estructura aún requiere validación fina de usuario.
- **Base técnica comprobada en código:** existe \`v2/src/ui/reportBuilderV8Ui.js\` con reportes avanzados de actividad, cantidad surtida, tendencias, filtros, agrupaciones por área/categoría/producto, productos más movidos, anomalías, mapa de actividad, preguntas interpretadas sobre datos, guardado de vistas y exportación CSV; \`v2/src/reporting/areaConsumptionReport.js\` computa consumo por áreas; \`v2/src/ui/godOperationalOversightUi.js\` presenta histórico de surtidos y export CSV/XLSX/SAINT; \`v2/src/reporting/reportingEngine.js\` incluye reporte de stock derivado y vencimientos. **Algunos indicadores actuales dependen del stock paralelo, por lo que no se deben asumir válidos después del rediseño.**
- **Propuesta para simplificar Reportes (pendiente de aprobación explícita):**
  1. **Surtidos:** eventos y productos entregados por fecha, responsable y área, cantidades y documentos; filtros día/semana/mes/rango y búsquedas.
  2. **Consumo por área:** qué recibió cada área y cuáles productos/presentaciones se surtieron con mayor frecuencia, comparativas entre períodos. Mostrar número de entregas o cantidades solo en unidades compatibles.
  3. **Compras y pedidos:** listas semanales, productos marcados/realizados, cantidades opcionales, extras, pendientes y comparación entre semanas, con trazabilidad. Diferenciar selección de compra de compra realmente ejecutada; **no inventar recepción, costo ni gasto**.
  4. **Tendencias y recomendaciones:** top de surtidos, patrones por semana, variaciones, consumo estimado y justificación de sugerencias; separar demanda observada de stock oficial aún no integrado.
- **Exportaciones a conservar:** CSV, Excel, PDF/impresión y tickets según cada reporte, manteniendo el mecanismo de permisos, formatos y comprobaciones ya desarrollados. PDF mediante impresión/navegador si procede; no afirmar generador PDF nativo en todos los flujos.
- **Debe desaparecer del resumen principal del monitor:** necesidad de conteo físico, alertas de mínimo/máximo y cifras de existencia calculadas desde movimientos internos como si representaran stock oficial. En vez de eliminar sus archivos o históricos, conservarlos archivados/tras administración hasta validación de migración.
- **Datos históricos:** conservar surtidos y registros históricos V2 sin borrado ni conversión automática, diferenciando eventos viejos con movimientos de stock de los futuros eventos informativos de surtido. No sumar falsamente productos de unidades diferentes.
- **Seguridad:** preservación de auditoría de actor/fecha y permisos de acceso a los reportes; no publicar acceso indiscriminado.
- **Estado:** funcionalidad existente revisada y esquema propuesto de cuatro vistas, NO cambios a código de Reportes, NO tests ni despliegue. **PENDIENTE validación de usuario** de las vistas propuestas.
- **Siguiente paso:** confirmar qué información debe predominar en Reportes antes de implementarlos como parte del VIGÍA Monitor.


### [REG-019] 2026-10-11 | Aprobación de Reportes e inicio de desarrollo aislado | ACORDADO / EN DESARROLLO

- **Origen:** el usuario respondió «OK LISTO CONTINUA» tras la propuesta REG-018 de mantener Reportes como módulo principal con vistas Surtidos, Consumo por área, Compras/Pedidos y Tendencias, junto a Inicio, Surtidos y Comprar/Pedir como otras áreas principales.
- **Interpretación confirmada para ejecución:** los cuatro grupos propuestos de Reportes se adoptan como alcance funcional inicial, manteniendo historial y exportaciones. Los nuevos reportes deben distinguir surtidos registrados de stock inventariado: **VIGÍA será un monitor y no llevará segundo inventario**.
- **Autorización de progreso:** continuar hacia implementación gradual en **rama separada**, sin eliminar el código antiguo y sin desplegar modificaciones al servidor HP o instalar migraciones. Evitar alterar el flujo productivo hasta contar con pruebas y aprobación específica de puesta en producción.
- **Primera etapa planificada:** motor de revisión semanal de compras/pedidos independiente de stock, con todos los productos por categorías, marca humana, cantidad positiva u opcional \`null\`, pendientes, listas COMPRAR/PEDIR, extras manuales, versiones para detección de conflictos y funciones puras para pruebas automáticas. Los reportes se conectarán más adelante a los nuevos eventos y al historial existente.
- **Aclaración de estado:** REG-018 reportes diseñados, **no implementados** como nuevas vistas todavía; para REG-019 solo hay autorización para empezar desarrollo. Registrar después las rutas, resultados de pruebas y SHAs realmente producidos.
- **Preservación de datos:** no borrar ni modificar colas offline ni 103 conflictos históricos del teléfono; no eliminar features o entidades V2 antiguas.


### [REG-020] 2026-10-11 | Fase 1 implementada en rama aislada: motor semanal de revisión | TESTS OK · NO DESPLEGADO

- **Rama nueva:** \`feature/vigia-monitor-review-v1\`, creada a partir de \`feature/v9-0-phase-c-offline-access\` cuando REG-019 ya estaba registrado. **No fusionada ni desplegada**.
- **Pull Request de seguimiento:** [PR #23](https://github.com/ZeroArtLord/smart-inventory/pull/23), abierto como **DRAFT** hacia rama original, sin autorización de merge automático.
- **Archivo de código creado:** \`v2/src/replenishment/monitorWeeklyReview.js\` — commit \`ed606cda248e02de3f1853046939fc0248e94a08\`.
- **Archivo de pruebas creado:** \`v2/test/monitorWeeklyReview.test.js\` — commit \`c6e12e5677d8bf8f4ceb66bef2760e54403e3e68\` (HEAD evaluado).
- **Funcionalidad real IMPLEMENTADA EN RAMA (no conectada a UI):** sesión semanal por almacén y lunes; decisión por producto independiente del stock (\`BUY\`, \`ORDER\`, \`NOT_NEEDED\`, \`PENDING\`, \`UNREVIEWED\`), cantidad positiva o \`null\`, observación y unidad opcional; versión de la decisión/actor/timestamp; bandeja de pendientes; progreso general y por categoría incluyendo productos sin sugerencia y stock 0; separación de compras y pedidos; Extras manuales fuera de catálogo con corrección, borrado lógico y prevención de duplicación por ID; \`reviewPrintQuantity()\` que muestra \`________\` en ausencia de cantidad; detección de conflicto de versión cuando se indica \`expectedVersion\`; repetición idempotente simple por \`mutationId\`. **Sin escritura ni ajuste de stock.**
- **24 tests nuevos** (\`v2/test/monitorWeeklyReview.test.js\`). Casos de cantidad null, cero rechazado, recorrido de productos no sugeridos/inactivos, pendientes que regresan, extras sin catálogo, cambio de decisión, versiones, idempotencia, no mutación y impresión en blanco.
- **EVIDENCIA AUTOMATIZADA:** GitHub Actions **Smart Inventory V2 Tests**, run \`38177319596\`, sobre commit \`c6e12e5677d8bf8f4ceb66bef2760e54403e3e68\`, disparado por PR #23: \`client-tests\` **SUCCESS**, \`server-syntax\` **SUCCESS**, \`server-integration\` **SUCCESS**. Log de cliente: **561 pruebas aprobadas, 0 fallidas**, incluye las 24 nuevas. Integración PostgreSQL del flujo antiguo verde; **no implica que nuevo monitor esté integrado con PostgreSQL**.
- **Límites fundamentales:** motor funcional puro, **sin interfaz nueva** conectada, sin IndexedDB/PostgreSQL propios para review, sin push/pull entre PC y teléfono, sin confirmación final de lista, sin impresión ESC/POS conectada, sin nuevos reportes implementados. Detección de conflicto de versión en el modelo no implica resolución de conflictos en servidor.
- **Datos productivos sin tocar:** NO se ejecutaron scripts en el servidor HP, NO se modificó esquema SQL, NO se borró ninguna cola ni histórico. Seguir protegiendo 103 conflictos antiguos.
- **Próximo paso:** persistencia/contrato de sincronización duradero de revisión semanal por almacén, y luego UI integrada/flujo de impresión, con pruebas en rama aislada; desarrollar reportes adaptados a surtidos operativos sin falsear stock.


### [REG-021] 2026-10-11 | Plan de transición al nuevo VIGÍA | PROPUESTO, NO EJECUTADO

- Ante la pregunta del usuario sobre retirar VIGÍA actual: se recomienda conservarlo operando mientras se desarrolla y prueba VIGÍA Monitor.
- El nuevo monitor se probará con acceso, base de datos y configuración separados de producción.
- Antes del cambio: verificar la versión instalada, respaldos y restauración, preservar historial, asegurar las colas offline pendientes, probar todas las pantallas en PC/móvil y pedir aprobación de corte.
- En el cambio definitivo: ventana de mantenimiento, respaldo final, instalación versionada, prueba de regresión y rollback sin descartar datos nuevos.
- Plan completo: docs/VIGIA/PLAN_TRANSICION_VIGIA_MONITOR_REG021.md, commit c19e18e7.
- No se ha detenido, reiniciado ni migrado el servidor real.

### [REG-022] 2026-10-11 | Almacenamiento compartido online de revisión semanal | TESTS OK, NO DESPLEGADO

- Rama: feature/vigia-monitor-review-v1; PR #23 en borrador.
- Archivos nuevos: v2/server/migrations/020_monitor_weekly_reviews.sql; v2/server/src/routes/monitorReview.js; v2/server/scripts/monitorReviewSmoke.js. Modificados: v2/server/src/app.js y .github/workflows/v2-tests.yml.
- Permite lectura y edición por personas autorizadas del mismo almacén, cantidad opcional nula, productos y extras, versiones por línea, auditoría e idempotencia de reintentos. No crea movimientos de inventario.
- CI del commit 904ee445: run 38177938970, client-tests 561/561, server-syntax SUCCESS, server-integration SUCCESS; nuevo smoke PostgreSQL con dos usuarios pasó e informó cero movimientos de stock.
- Las migraciones y la API solo se han ejecutado en el entorno temporal de CI. No se han llevado al HP.
- Falta conectar UI y modo offline durable con sincronización móvil-PC, impresión real y Reportes del monitor.


### [REG-023] 2026-10-11 | Autoguardado offline de revisión semanal | IMPLEMENTADO EN RAMA / TESTS CLIENTE OK / NO DESPLEGADO

- **Código nuevo:** `v2/src/replenishment/monitorReviewOffline.js` (commit `0239b30e`). Cola aislada en el almacén IndexedDB SETTINGS, separada de la cola V2 y de sus 103 conflictos históricos. Clave por almacén + usuario + semana.
- **Comportamiento probado:** guarda la decisión antes de hacer peticiones al servidor; preserva `quantity:null`, pendientes y extras; reintentos de red con ID inmutable; evita duplicados en servidor; orden de ediciones del mismo producto; caso de edición concurrente muestra CONFLICT y conserva la decisión local y la versión remota, sin sobreescribir; otras decisiones no conflictivas pueden avanzar. Estado LOCAL, SYNCED o CONFLICT.
- **Pruebas nuevas:** `v2/test/monitorReviewOffline.test.js`, 13 casos (commit `bfecfdc9`): separación de claves, persistencia IndexedDB, offline, sincronización simulada, doble edición, caída/reintento, extra sin catálogo/cantidad, conflictos, trabajo con otros productos, validación y no uso de SYNC_QUEUE antiguo.
- **Verificación del cliente:** GitHub Actions run `38178550608` (commit `8447346a`), `client-tests SUCCESS`: 574 pruebas aprobadas, 0 fallidas; también `server-syntax SUCCESS`.
- **Límites:** la cola conserva trabajo local después de recargar una vez autenticado, pero **la reapertura en frío sin Internet todavía depende de la recuperación de identidad/sesión que falta implementar y verificar**. No se ha ensayado un apagón real ni teléfono físico. No hay aún resolución humana de conflictos en UI, solo preservación y detección.
- **Pendientes técnicos:** ritmo/reintentos prolongados para catálogos grandes, verificación real de varios navegadores y comportamiento con múltiples pestañas.

### [REG-024] 2026-10-11 | Primera interfaz piloto integrada en rama | IMPLEMENTADA EN RAMA / NO DESPLEGADA

- **Código:** `v2/src/ui/monitorReviewPilotUi.js` (commit `77c4f7e9`), `v2/css/monitor-pilot.css` (commit `1e77a24a`), `v2/index.html` integra el enlace (commit `8447346a`).
- **Acceso:** desde la sección Comprar/Pedir de la V2, aparece lanzador opcional `VIGÍA Monitor (piloto)`. Abre una interfaz aislada sin reemplazar las pantallas/productos del flujo antiguo. Solo en la rama de desarrollo.
- **Secciones disponibles en el código piloto:** Inicio por categorías y progreso; revisión producto por producto y cuatro decisiones; bandeja Pendientes; Seleccionados con cantidad opcional; Extras manuales (incluida cinta métrica); Mis listas y previsualización de dos tickets por tipo con cantidades vacías para anotar a mano. CSS responsive enfocado en pantallas estrechas.
- **Datos:** lee catálogo activo y categorías locales, obtiene sesión autorizada de V2, usa el nuevo guardado local y consulta la nueva API de monitor online. Conserva los cambios antes de sincronizar. No genera movimientos de stock.
- **Limitaciones:** impresión solo navegador de prueba (NO RC-8002 ESC/POS), sin contadores de sugerencias definitivas, sin sincronización offline tras arranque en frío sin sesión, sin cierre semanal, sin Reportes Monitor ni Surtidos Monitor. **Todavía no hay prueba E2E de la experiencia visual en móvil real**; sintaxis CI aprobada, no significa aceptación de UX.
- **Estado de integración:** API, cola e interfaz están en rama `feature/vigia-monitor-review-v1` y PR #23 DRAFT. Sin merge a producción, sin instalación, sin ejecuciones del nuevo Monitor en el HP.
- **Siguiente paso:** prueba piloto con catálogo representativo, probar UI PC/móvil y permisos, resolver arranque offline seguro y estrategia de conflictos, enlazar impresión ESC/POS, adaptar Reportes y Surtidos y cumplir plan de transición REG-021.


### [REG-025] 2026-10-11 | CI final para cola offline y UI piloto | TESTS AUTOMÁTICOS OK / PR EN BORRADOR

- GitHub Actions run 38178550608 sobre commit 8447346a3f0c7b5d4a94190d9550e767a257d8f7.
- Resultados confirmados: client-tests SUCCESS (574/574, 0 fallidas); server-syntax SUCCESS; server-integration SUCCESS.
- El smoke de PostgreSQL volvió a emitir MONITOR_REVIEW_SMOKE_PASS, con dos usuarios, cantidades nulas, extras, versiones y cero movimientos de stock.
- Las 13 pruebas nuevas de monitorReviewOffline se ejecutaron exitosamente dentro del total.
- El nuevo piloto de UI pasó comprobaciones de sintaxis, NO una validación visual real de navegador/telefono ni pruebas end-to-end sobre una instalación real.
- Rama feature/vigia-monitor-review-v1, PR #23 DRAFT. La rama productiva y el HP no han sido modificados.


### [REG-026] 2026-10-11 | Acceso offline para piloto Monitor | IMPLEMENTADO EN RAMA, NO DESPLEGADO

- Origen: el usuario pidió continuar VIGÍA Monitor después de REG-025.
- Código nuevo: `v2/src/replenishment/monitorPilotSession.js` (commit `7abde344`), 9 pruebas en `v2/test/monitorPilotSession.test.js` (commit `b0aa588e`); integración UI en commit `f387faf8`.
- Reutiliza la autorización offline de la V2 con límite y validación ya existentes, comprueba el bloqueo de cierre de sesión y que workspace y permisos coincidan; no inventa credenciales ni omite autenticación. Ante acceso vencido o inválido NO abre el piloto.
- La pantalla piloto cierra su overlay cuando se bloquea la sesión V2 (commit `d3379d8c`).
- Límite: acceso offline depende de autorización previa válida y de que app base ya haya abierto; no permite iniciar cuenta nueva ni acceso a otro almacén sin red. Un acceso revocado que no se pueda comprobar offline mantiene los límites del mecanismo V2 ya existente.
- No toca el servicio HP ni cambia datos de producción.

### [REG-027] 2026-10-11 | Núcleo informativo Surtidos Monitor | IMPLEMENTADO EN RAMA, BACKEND PENDIENTE

- Código `v2/src/documents/monitorSupplyModel.js` (commit `e26bfc21`, corrección de precisión `0ce43f75`) con carrito por área/destino, fecha, responsable, productos, cantidades entregadas y unidades, repetición acumulada, edición/borrado de líneas solo en borrador y finalización `RECORDED`.
- No consulta existencia ni impone mínimo/máximo; no realiza movimientos de stock ni escribe tablas V2. No puede descontar stock negativo porque no maneja existencias.
- La agrupación de consumo por área, producto y unidad evita sumar por error CAJA con UND o KG. Los resúmenes muestran surtidos realmente marcados como registrados, no documentos borrador.
- 16 pruebas nuevas en `v2/test/monitorSupplyModel.test.js` (commit `b586721c`): carrito, cantidades positivas, unidades, edición, finalización, inmutabilidad y filtros/reportes.
- IMPORTANTE: es modelo puro implementado solo en rama, **NO** existe aún API PostgreSQL para persistir estos surtidos ni UI final conectada; no declarar Surtidos Monitor desplegado.
- Decisiones abiertas: correcciones/anulaciones trazables después de registrar un surtido, persistencia y sincronización sin duplicados; conservar trazabilidad histórica.

### [REG-028] 2026-10-11 | Recuperación exacta de posición y mejoras de interacción | IMPLEMENTADO EN RAMA, VERIFICACIÓN EN PROGRESO

- Código `v2/src/ui/monitorPilotPosition.js` (commit `8ce14339`) y 5 pruebas `v2/test/monitorPilotPosition.test.js` (commit `0ec5141d`).
- Guarda en IndexedDB SETTINGS última categoría/producto para cada almacén, usuario y semana sin tocar cola de sincronización antigua; al reabrir el piloto recupera posición si el producto/categoría aún existe; si no, recupera opción segura.
- Cambios en `v2/src/ui/monitorReviewPilotUi.js`: selector de categoría funcional, fondo no refresca campos mientras usuario escribe, el indicador no afirma estar sincronizado si está offline, persistencia de posición tras saltar o avanzar, cierre del piloto cuando la V2 bloquea sesión. HEAD funcional `d3379d8c`.
- La identidad offline se reutiliza de VIGÍA, sin permitir acceso a usuario no autenticado.
- Pruebas unitarias previstas junto a suite CI de 604 o más pruebas. Se confirmaron 599/599 en un commit intermedio; la última ejecución de GitHub Actions `38180481830` estaba EN PROGRESO al registrar este texto. El resultado final debe anotarse como entrada posterior (no inferir aprobación).
- No se han ejecutado pruebas manuales en teléfono o PC físico, ni impresión ESC/POS; el UI responsive requiere aceptación visual del usuario.
- Todo en rama `feature/vigia-monitor-review-v1` / PR #23 DRAFT, sin merge ni despliegue.


### [REG-029] 2026-10-11 | CI final de sesión offline, posición de revisión y Surtidos Monitor | TESTS OK / NO DESPLEGADO

- GitHub Actions run `38180481830` sobre HEAD de rama `feature/vigia-monitor-review-v1` commit `d3379d8cc27f5b87783e3db19e5f086799f7b4b6`.
- Trabajos: `client-tests SUCCESS`, `server-syntax SUCCESS`, `server-integration SUCCESS`.
- Log del cliente: **604 tests, 604 pass, 0 fail**, incluyendo 9 tests del acceso offline, 16 tests de Surtidos y 5 de posición semanal adicionales a los ya existentes.
- Smoke PostgreSQL del nuevo Monitor repitió `MONITOR_REVIEW_SMOKE_PASS` (dos usuarios, extras, nulos, auditoría, control de versión y cero movimientos de stock).
- Alcance comprobado: pruebas unitarias, sintaxis, integración del backend preexistente y API de revisión; **NO implica pruebas end-to-end de interfaz, impresión física ni persistencia/sync real de Surtidos Monitor**.
- PR #23 sigue DRAFT; sin merge ni despliegue en HP. No borrar la base, IndexedDB ni conflictos V2 pendientes.
- Próximo paso: implementar persistencia/endpoint idempotente para Surtidos Monitor sin stock; pruebas de cliente/servidor y pruebas manuales visuales con teléfono; adaptar Reportes para que combinen historial y nuevos surtidos operativos sin falsear existencias.


### [REG-030] 2026-10-11 | Surtidos Monitor persistidos en PostgreSQL y base de Reportes | IMPLEMENTADO EN RAMA; TESTS OK; NO DESPLEGADO

- **Autorización:** el usuario indicó explícitamente «HAZLO» para conectar Surtidos Monitor a almacenamiento seguro con prevención de documentos duplicados y preparar Reportes sobre entregas registradas.
- **Rama/PR:** `feature/vigia-monitor-review-v1`, [PR #23](https://github.com/ZeroArtLord/smart-inventory/pull/23) **DRAFT**. HEAD verificado `735741d75711d70a7d637689e08d07c3bf622d26`. No merge ni despliegue.
- **Migración aditiva 021:** `v2/server/migrations/021_monitor_supply_deliveries.sql`, commit `cee1816b`: nueva tabla `monitor_supply_deliveries` aislada de `documents`, `movements` y `sync_queue`; documento inmutable por `workspace_id` + `id`, área/fecha, nombres y cantidades entregadas, empleado y huella de solicitud. Índices por fecha y área. Migración ejecutada SOLO en base efímera de GitHub CI.
- **API operativa aislada:** `v2/server/src/routes/monitorSupply.js` commit `6047f461`, corrección de líneas multimedida `735741d7`; conectada a app en `v2/server/src/app.js` commit `b7062b88`.
- **Rutas autenticadas:** POST `/api/v1/monitor/supplies` para registrar una entrega (1..250 líneas, cantidades positivas hasta 6 decimales, área y productos activos en el workspace); GET `/api/v1/monitor/supplies` para historial paginado con filtros de fecha/área; GET `/api/v1/monitor/supplies/:deliveryId` para detalle; GET `/api/v1/monitor/supplies/consumption` para agrupación por área, producto y UNIDAD de cantidades efectivamente entregadas.
- **Seguridad y consistencia:** permiso SUPPLY_WRITE para guardar; para consultas SUPPLY_WRITE o REPORT_VIEW; aislamiento multi-almacén en SQL y autenticación existente; autor establecido por servidor y auditado; idempotencia por ID + fingerprint con bloqueo transaccional para reintentos; mismo ID con contenido diferente responde 409 sin reemplazar documento; unidades distintas del mismo producto permitidas como líneas separadas, líneas repetidas producto+unidad rechazadas. No escribe movimientos ni existencias, sin STOCK_NEGATIVE.
- **Cliente con cola separada:** `v2/src/documents/monitorSupplyOutbox.js` commit `1aa165dd`; guarda el documento RECORDED en IndexedDB SETTINGS con el MISMO ID hasta confirmación, permite reintento, conserva conflictos sin borrado y consulta endpoints de Reportes. NO utiliza la cola V2; no hay aún UI conectada ni reintento automático continuo en segundo plano.
- **Pruebas cliente adicionales:** `v2/test/monitorSupplyOutbox.test.js`, commit `bffea07d` — 10 pruebas de persistencia, reintento, conflictos, inmutabilidad, aislamiento y consultas de reportes. El resto de pruebas previas permanece.
- **Prueba integración:** `v2/server/scripts/monitorSupplySmoke.js` (commit `a9c31756`) y ampliación de CI `.github/workflows/v2-tests.yml` (commit `61ca683c`). Usa PostgreSQL, dos usuarios, área activa, un producto en CAJA y UND, reenvío idempotente, conflicto 409, segunda entrega, agregados por unidad, paginación, filtros, aislamiento workspace, permisos revocados, auditoría y cero movimientos de stock.
- **Incidencia detectada/resuelta:** primera integración falló con 400 porque el validador comparó número de productos distintos con número de líneas aun cuando un producto figuraba con dos unidades diferentes. Se corrigió deduplicando IDs solo para validar existencia; conservando las dos líneas por unidad. No se declaró OK durante el fallo.
- **CI FINAL VERIFICADO:** GitHub Actions run `38180963986`, commit `735741d7...`: `client-tests SUCCESS` **614/614, 0 fallidas**, `server-syntax SUCCESS`, `server-integration SUCCESS`; log `MONITOR_SUPPLY_SMOKE_PASS` y `MONITOR_REVIEW_SMOKE_PASS` observados en CI.
- **Alcance real de Reportes:** existe backend de consumo **solo de nuevos surtidos registrados por Monitor**. Todavía no se han combinado historiales históricos V2 ni conectado nueva pantalla de Reportes; no confundir documento registrado con estado de stock, costo o compra realizada.
- **Pendientes fundamentales:** UI real de Surtidos Monitor conectada a nueva API/outbox, reanudación de envíos automáticos y conciliación de conflictos, pruebas manuales Android/PC y PWA, borradores de surtidos persistentes, impresión ESC/POS, incorporación segura del historial de surtidos antiguos a Reportes. No tocar ni limpiar los 103 conflictos móviles reportados previamente.
- **Producción:** NO hubo cambios en Windows/HP, no se apagó `SmartInventoryV2`, no se migró PostgreSQL real ni se borró ningún dato de producción. Mantener PR #23 DRAFT hasta revisión y autorización de despliegue.


### [REG-031] 2026-10-11 | Piloto de Surtidos y Reportes conectado a backend Monitor | CÓDIGO EN RAMA / NO DESPLEGADO

- **Origen:** el usuario respondió «HAGAMOS LO», autorizando continuar con la conexión de interfaz de Surtidos Monitor, reintentos pendientes y Reportes, con la condición mantenida de no modificar producción hasta nuevo visto bueno.
- **Rama:** \`feature/vigia-monitor-review-v1\` y PR #23 DRAFT. **No merge, no despliegue al HP**, no cambios en base productiva ni cola V2.
- **Nuevas vistas piloto:** \`v2/src/ui/monitorSupplyPilotUi.js\`, commit inicial \`67056273\`, mejoras móviles y de apertura \`e88c2359\`, última corrección de interacciones rápidas \`32fb2fb6\`. Botones de piloto separados en pantallas de **Surtido** y **Reportes**, usando identidad y permisos del VIGÍA existente. La interfaz antigua permanece.
- **Surtidos:** carrito a áreas con productos del catálogo activo, cantidad entregada y unidad explícita, fecha, notas; botón de guardar entrega que primero escribe un evento al almacenamiento local y luego intenta enviarlo de forma idempotente a la API PostgreSQL ya verificada en REG-030, **sin generar documentos o movimientos de stock antiguos**.
- **Carritos recuperables:** \`v2/src/documents/monitorSupplyDraftStore.js\` commit \`0f35ff87\`, con 6 pruebas \`v2/test/monitorSupplyDraftStore.test.js\` commit \`dba03e6a\`. Guarda un borrador por usuario/almacén en IndexedDB SETTINGS, conserva líneas y evita reutilizar el ID si el equipo se apaga tras preparar el envío. No borra colas ni almacenes V2.
- **Reintentos y conflictos:** ampliación de \`v2/src/documents/monitorSupplyOutbox.js\` commit \`c11483e9\`: enumerar pendientes, envío secuencial en lotes, envío exclusivo del mismo ID, conservar conflictos y eventos locales. Ocurre al abrir piloto o volver la conexión; no supone automatización permanente en segundo plano cuando la app está cerrada.
- **Reportes Monitor:** el piloto usa GET \`/api/v1/monitor/supplies\` (100 últimos, paginación pendiente en UI) y \`/api/v1/monitor/supplies/consumption\` (agregación por área/producto/unidad). Distingue cantidad surtida real de stock oficial. **Historial viejo de V2 se muestra como sección separada**, en forma de recuento de distribuciones cerradas presentes en el caché del dispositivo, sin sumarlo al total del Monitor ni presentarlo como historia completa del servidor. La vista antigua de Reportes V8 sigue disponible, no fue reemplazada.
- **Estilos:** \`v2/css/monitor-supply-pilot.css\` commit \`697f40b4\`; navegación y layout responsivos, todavía sin prueba visual real en teléfonos o impresoras.
- **Shell PWA:** \`v2/index.html\` commit \`b78396fd\` incorpora estilos y script; \`v2/sw.js\` commit \`36a94d9e\` precachea los módulos necesarios y en \`796bd4eb\` se conserva temporalmente el identificador de caché shell-64 exigido por las pruebas V2, mientras se añaden los activos del piloto. En el futuro verificar una estrategia de actualización del PWA y rollback sin perder datos locales.
- **Permisos:** \`v2/src/replenishment/monitorPilotSession.js\` acepta permisos distintos por módulo, corregido para offline en \`bfecc363\`. Pruebas adicionales en \`v2/test/monitorPilotSession.test.js\` commit \`ba01e642\`: roles de suministros/reportes.
- **Pruebas de outbox:** tres casos añadidos en \`v2/test/monitorSupplyOutbox.test.js\` commit \`6b134df3\` para lotes de reintentos, aislamiento y prevención de envío concurrente del mismo documento.
- **Incidencia y respuesta:** GitHub Actions \`38181364210\` detectó 9 fallos de 620 pruebas del cliente al cambiar identificador PWA y olvidar propagar el permiso offline. Se corrigieron ambos; la ejecución posterior \`38181420786\` terminó cliente/sintaxis/integración correctos. La última verificación sobre HEAD \`32fb2fb6...\` estaba pendiente de resultado al registrar esta entrada. **No declarar esta última suite OK hasta comprobar resultados.**
- **Pendiente para piloto real:** prueba de UI end-to-end con navegador y móvil físico, filtros/consultas históricas integradas en lugar de paneles separados, manejo de errores/offline de producto o área desactivados, impresión ESC/POS, métricas de rendimiento y funcionamiento multiusuario bajo carga. No desplegar ni borrar IndexedDB ni los ~103 conflictos V2.


### [REG-032] 2026-10-11 | Pruebas finales de piloto Surtidos/Reportes + PWA offline | CI COMPLETO PASS, NO DESPLEGADO

- **HEAD probado:** `32fb2fb6a80e22a8c42b15617d1c7d3621e05869`, rama `feature/vigia-monitor-review-v1` (PR #23 DRAFT).
- **GitHub Actions workflow run `38181572146`:** `client-tests SUCCESS`, `server-syntax SUCCESS`, `server-integration SUCCESS`.
- **Resultado de tests Node cliente:** **625/625 pass, 0 fail**, sin omitidos. Contiene pruebas de carrito/borrador persistente, cierre y recuperación tras corte simulado, cola de entregas y reintentos, permisos por módulo, acceso offline seguro y toda regresión V2 anterior.
- **Comprobaciones de integración reales en PostgreSQL temporal:** log `MONITOR_SUPPLY_SMOKE_PASS` (documentos idempotentes, dos usuarios, unidades y áreas, reportes, paginación, aislamiento, permisos, auditoría, cero movimientos de inventario) y `MONITOR_REVIEW_SMOKE_PASS` (compras/pedidos compartidos, cantidad nula, extras, versiones y cero stock).
- **Recuperación tras primer CI rojo:** la primera ejecución de esta tanda falló 9 pruebas por identificar cache PWA como `shell-65-monitor-pilot` donde las pruebas antiguas exigen `shell-64`, y por no pasar `requiredAnyPermissions` en la rama de acceso offline. Ambos errores corregidos y verificados en nueva ejecución verde.
- **Estado probado:** lógica de servidor y navegador con tests, sintaxis y smoke backend. **NO existe evidencia todavía de prueba E2E visual del piloto en Chrome real, pantalla móvil real, impresión ESC/POS ni despliegue HP**. No confundir suite verde con salida a producción. El pilot Reportes muestra historia anterior V2 en sección separada de resumen de caché local, NO un consolidado histórico completo.
- **Producción sigue intacta:** sin merge, sin apagar SmartInventoryV2, sin tocar PostgreSQL real, sin borrar IndexedDB, colas ni los ~103 conflictos anteriores.
- **Siguiente paso recomendado:** ejecutar piloto en entorno de laboratorio independiente en PC y móvil, corregir UX, validar en un corte de red real y ensayar impresión 80mm. Después consolidar Reportes sin duplicar surtidos históricos y solicitar autorización puntual para despliegue de la nueva versión.


### [REG-033] 2026-10-11 | Piloto visual probado en Chromium real para PC y móvil | CI VERDE; NO DESPLEGADO

- **Origen:** el usuario respondió «OK» tras informar que el siguiente paso sería probar VIGÍA Monitor en entorno piloto independiente, con cortes de conexión, móvil, Surtidos, Comprar/Pedir y Reportes. Se interpreta como autorización para pruebas **fuera de producción**, no para instalar en HP.
- **Branch:** \`feature/vigia-monitor-review-v1\` con [PR #23 DRAFT](https://github.com/ZeroArtLord/smart-inventory/pull/23). HEAD validado: \`5096ddb5ca87fc6f010ca891f95b30f5cb0d70cc\`. No se fusionó ni desplegó.
- **Nuevo test de navegador real:** \`v2/scripts/monitorPilotBrowserSmoke.mjs\` con arnés estático \`v2/test/browser/monitorPilot.html\`, usando Chromium headless via Playwright **1.56.1**. Job nuevo \`browser-pilot\` en \`.github/workflows/v2-tests.yml\`: ejecuta navegación real, render de los módulos del piloto y sube capturas como artifact. HTML/API/usuario/almacén/catálogo/áreas son **fixtures totalmente simulados**, sin conexión al servidor HP.
- **PWA:** versión de caché separada \`smart-inventory-v2-shell-64-monitor-pilot-1\` (commit \`b3003c51\`); mantiene el contrato de pruebas V2 y permite precachear assets del nuevo piloto sin confundir la caché anterior. La prueba usa un arnés HTML distinto de la PWA final; **NO verifica arranque completo de la PWA offline sin red**.
- **Casos visuales/funcionales ejecutados:** apertura de Surtidos, selección de área/producto/cantidad, autoguardado IndexedDB, cierre y reapertura recuperando el carrito, falla simulada solo del API durante POST, recarga del navegador con datos locales, reintento con el mismo ID y exactamente un registro confirmado, permanencia de un evento preexistente en \`STORES.SYNC_QUEUE\`, pantalla Reportes con entrega nueva y apartado V2 antiguo separado, adaptación 390px sin desbordamiento horizontal, Comprar/Pedir por categoría con cantidad en blanco, extra manual «Cinta métrica» y vista previa con copia CHÓFER.
- **Limitación importante de conectividad:** Chromium probó desconexión simulada de la **API** manteniendo disponibles los assets de la página; no fue una prueba de reinicio físico sin Wi-Fi, no fue teléfono real y no ejercitó servicio Windows ni impresora ESC/POS.
- **Problemas detectados y resueltos durante la incorporación de E2E:** 1) runner de Chromium ubicado inicialmente dentro de carpeta autodetectada por \`node --test\`, por lo que falló la suite; se movió a \`v2/scripts\`. 2) el primer assert no esperaba la carga asíncrona del carrito desde IndexedDB; corregido. 3) el test verificaba sincronización local antes de corroborar recepción del mock server; ahora exige ambos y registra diagnóstico. 4) mock no interceptaba \`/supplies/consumption\` por usar \`*\` en lugar de \`**\`, corregido. 5) selector ambiguo entre dos botones Cerrar en Reportes; especificado botón de cabecera. Nada de esto justificó borrar cachés/datos productivos.
- **EVIDENCIA FINAL VERIFICADA:** GitHub Actions [run \`38182276549\`](https://github.com/ZeroArtLord/smart-inventory/actions/runs/38182276549), HEAD \`5096ddb5...\`: \`client-tests SUCCESS\` **625/625 pass, 0 fail**; \`server-syntax SUCCESS\`, \`server-integration SUCCESS\` (PostgreSQL temporal, logs \`MONITOR_REVIEW_SMOKE_PASS\` y \`MONITOR_SUPPLY_SMOKE_PASS\`); \`browser-pilot SUCCESS\` con log \`MONITOR_BROWSER_SMOKE_PASS: Chromium desktop/mobile, real pilot screens, IndexedDB autosave/reload, failed API retry, no duplicate, legacy queue untouched, new reports, manual extras\`.
- **Capturas del navegador:** [artifact de GitHub](https://github.com/ZeroArtLord/smart-inventory/actions/runs/38182276549/artifacts/11717454808), incluye desktop Surtidos/Reportes y móvil Surtidos/Reportes/Comprar-Pedir. Son pantallas de módulos reales montados sobre datos de prueba, **no imágenes de la instalación HP**.
- **Deuda pendiente:** probar la aplicación completa con servicio web y PostgreSQL de laboratorio separado de producción, arrancar la PWA offline desde Android real, corregir visual mobile según usuario, imprimir 80 mm/ESC-POS y comparar con previsualización, resolver conflictos offline anteriores de V2 sin perder operaciones, consolidar historial antiguo de Surtidos en Reportes con deduplicación por identificador y unidad compatible. Se mantienen dos fuentes de reporte separadas hasta reconciliación.
- **Producción:** no se tocó servicio \`SmartInventoryV2\`, archivos de \`C:\SmartInventory\App\`, PostgreSQL productivo, IndexedDB de usuario ni los ~103 conflictos V2 pendientes. Sustitución de VIGÍA actual **NO AUTORIZADA** todavía.
- **Siguiente acción:** preparar laboratorio y criterios de aceptación de piloto con pruebas de impresión y Android/PC reales; si se desea instalar en HP luego, solicitar autorización separada tras backups/rollback completos.


### [REG-034] 2026-10-11 | Cambio solicitado: piloto REAL sobre VIGÍA del HP, sin laboratorio aparte | ACORDADO; PREPARACIÓN EN RAMA, NO DESPLEGADO

- **Orden explícita del usuario:** «NO MONTEMOS NADA INDEPENDITNE HAGAMOS REAL Y ASI HAGO PRUEBAS REALES». Esta decisión **sustituye la opción anterior de construir un segundo entorno VIGÍA para las pruebas operativas**. El usuario quiere probar directamente en el HP con su catálogo, usuarios y datos reales.
- **Alcance seguro interpretado:** conservar el servicio \`SmartInventoryV2\` operativo y el sistema anterior accesible durante la prueba. Añadir módulos Monitor de forma incremental y **activación opt-in solo para usuarios autorizados**, sobre el mismo servidor y PostgreSQL productivo, únicamente después de respaldos comprobados y un precheck real. No reemplazar ni destruir producción antes de saber la versión instalada.
- **Preparación de feature flag (rama \`feature/vigia-monitor-review-v1\`, PR #23 DRAFT):** \`MONITOR_PILOT_ENABLED=false\` por defecto en config de servidor; en producción, activarlo requiere \`MONITOR_PILOT_USER_IDS\` con IDs reales admitidos, sin lista vacía; middleware \`monitorPilotGate\` rechaza API Monitor apagada con 404 y no autorizados con 403, preservando la autenticación previa. La UI piloto se mantiene oculta salvo bandera del servidor activa y enlace con \`?vigiaMonitorPilot=1\`. El resto de VIGÍA V2 permanece visible. Archivos modificados: \`v2/server/src/config.js\`, \`v2/server/src/app.js\`, \`v2/server/src/middleware/monitorPilotGate.js\`, \`v2/src/ui/monitorPilotEnabled.js\`, \`v2/src/ui/monitorReviewPilotUi.js\`, \`v2/src/ui/monitorSupplyPilotUi.js\`, \`v2/sw.js\`. Incluye nuevas pruebas Node de bandera y gate, y ajustes a CI de rama.
- **Diagnóstico del servidor de solo lectura:** \`docs/VIGIA/VIGIA_HP_PRECHECK_READONLY.ps1\` en la rama de desarrollo, commit \`6d2d9034\`. Consulta servicio, archivos, salud HTTP, espacio de disco, herramientas de backup y metadatos no sensibles. Escribe solamente un TXT en \`%TEMP%\\VIGIA_PRECHECK\`. **NO** reinicia, instala, migra, toca stock, caché o colas. Se debe ejecutar desde el HP y revisar su salida **antes** de ofrecer comandos de actualización.
- **Previos obligatorios:** respaldar archivos y PostgreSQL y verificar restauración, identificar la versión exacta instalada y pendientes migratorios, comprobar que no se descartarán los ~103 conflictos offline históricos del teléfono, revisar carga actual; no desplegar los últimos commits de manera ciega ni ejecutar \`npm run migrate\` sin revisión.
- **Plan de pruebas reales:** después de preflight, ventana de mantenimiento corta autorizada para cambio versionado y migraciones **aditivas** 020/021 respaldadas, habilitar Monitor solo para usuario(s) seleccionados, validar flujo con 1-2 entregas reales y revisión semanal, consultar historial y cero movimientos de stock, volver a apagar feature flag ante problema. No desplegar un segundo servicio para la prueba humana, no crear un segundo inventario.
- **Límites:** no hay conexión directa del asistente al Windows/HP en esta conversación. El reporte del HP aún no se ha recibido. **No se ha reiniciado, actualizado ni activado ningún servicio real.** Bandera protectora preparada en GitHub, pendiente de verificación CI final antes de usarla.
- **Seguimiento:** esperar informe diagnóstico del HP y recuento de operaciones offline pendientes en cada teléfono; luego crear un procedimiento preciso para la instalación real con backup/rollback de datos y autorización del momento del reinicio. REG-021 queda sustituido únicamente en la elección de laboratorio; siguen vigentes todos sus resguardos para producción.


### [REG-035] 2026-10-11 | Bandera de piloto REAL protegida y CI completa | CÓDIGO VALIDADO, SIN DESPLIEGUE HP

- **HEAD:** \`0fd63d31f8a61135a070cff58524c962e49ddb9d\` de \`feature/vigia-monitor-review-v1\`, PR #23 DRAFT. Desarrollo operativo solicitado en REG-034 para el **mismo servidor**, no un nuevo laboratorio.
- **Control de activación:** API Monitor cerrada por defecto. En producción exige \`MONITOR_PILOT_ENABLED=true\` + \`MONITOR_PILOT_USER_IDS\` no vacío; peticiones ajenas a la lista 403 y ruta desactivada 404. Cliente requiere URL con \`vigiaMonitorPilot=1\` y bandera confirmada en config pública; los módulos antiguos V2 no se eliminan. Antes de encender bandera son inaccesibles las escrituras nuevas.
- **Pruebas nuevas:** \`v2/test/monitorPilotEnabled.test.js\` (4 casos) de opt-in y fail-closed; \`v2/server/scripts/monitorPilotGateCheck.js\` prueba cierre por defecto, usuario admitido, no admitido y rechazo de activación producción sin allowlist. No requieren acceso a HP.
- **Incidencia CI corregida:** la primera ejecución de rama con bandera habilitada en el job de integración falló únicamente el \`preflightProduction.js\`: heredaba \`MONITOR_PILOT_ENABLED=true\` en contexto de producción, donde correctamente exige allowlist. Se corrigió CI definiendo bandera \`false\` solo para la prueba de preflight de producción.
- **RESULTADO FINAL:** GitHub Actions [run \`38182917596\`](https://github.com/ZeroArtLord/smart-inventory/actions/runs/38182917596), sobre HEAD \`0fd63d31...\`: **629/629 tests cliente aprobados, 0 fallidas**; \`client-tests SUCCESS\`, \`browser-pilot SUCCESS\`, \`server-syntax SUCCESS\`, \`server-integration SUCCESS\`. Integración PostgreSQL efímera, no bases productivas.
- **Diagnóstico para siguiente interacción:** \`docs/VIGIA/VIGIA_HP_PRECHECK_READONLY.ps1\` (branch de desarrollo, commit \`6d2d9034\`), informa servicio Windows, health/ready, espacio, herramientas y respaldo local; no lee ni revela claves DB/Firebase y no escribe sobre VIGÍA. Solo genera un TXT en TEMP. **Aún no ejecutado** en el servidor HP del usuario.
- **Precaución detectada al revisar el repo:** \`v2/server/scripts/backup.js\` realiza purga de backups antiguos por retención (14 días por defecto) tras respaldar. No ejecutar esto a ciegas en el HP antes de revisar copias y preservar íntegramente históricos y colas. Se requiere backup íntegro nuevo sin borrar existentes y comprobación de restauración antes de migrar.
- **NO REALIZADO:** ninguna instalación/reinicio/cambio del \`SmartInventoryV2\` del HP; ninguna migración 020/021 de PostgreSQL productivo; ninguna prueba física de impresora Android/PC o cola offline histórica; ningún borrado de movimientos/IndexedDB/103 conflictos. El usuario debe ejecutar primero precheck y entregar informe. No confundir código preparado con prueba real ya realizada.
- **Próximo paso:** con datos de precheck y recuento del teléfono, elaborar comandos de backup seguro, instalación versionada y habilitación únicamente para los UUID permitidos, coordinando reinicio corto si hace falta. Si un precheck falla, NO instalar, resolverlo primero.


### [REG-036] 2026-10-12 | Preflight real recibido del HP y análisis de versión | SIN DESPLIEGUE / RESPALDO PENDIENTE

- **Fuente:** informe del usuario \`VIGIA_HP_PRECHECK_20261012_090307.txt\`, obtenido por el script de lectura REG-035 el 2026-10-12 09:03:07.
- **Servidor:** host \`SERVIDOR\`, Windows NT 10.0.20348.0; servicio Windows \`SmartInventoryV2\` en \`Running\`, inicio \`Auto\`, PID reportado \`3712\` y wrapper \`C:\SmartInventory\Service\SmartInventoryService.exe\`.
- **Instalación verdadera confirmada por script:** \`C:\SmartInventory\App\`; \`v2\server\`, \`v2\index.html\` y \`v2\sw.js\` existen. \`HOST=127.0.0.1\`, \`PORT=5190\`, \`NODE_ENV=production\`, \`AUTH_MODE=firebase\`; \`/health.ok=True\`, \`/ready.ok=True\`; espacio C: libre \`725,40 GB\`.
- **Git HEAD productivo:** \`067eb9f94e1441836c67f26c97f0c34a5e4745b8\`, commit \`fix(procurement): hide cancelled lines and make removal idempotent\` (verificado en GitHub). **Comparación GitHub:** la rama candidata Monitor HEAD \`0fd63d31f8a61135a070cff58524c962e49ddb9d\` está 84 commits ADELANTE y 0 detrás del commit productivo; difiere en 39 archivos según API compare. Es continuidad compatible a nivel historial Git, NO una prueba de compatibilidad de despliegue o de esquema SQL productivo.
- **Bloqueador respaldos:** \`BACKUP_DIR=F:\SmartInventoryBackups\`, pero el primer script **no verificó existencia, archivos, fechas, tamaño ni restaurabilidad**. \`pg_dump\`, \`pg_restore\`, \`psql\` no aparecen en \`PATH\`; podría ser instalación válida fuera de PATH. \`node\` sí existe en \`C:\Program Files\nodejs\node.exe\`. No asumir falta de PostgreSQL ni backup.
- **Siguiente herramienta segura:** \`docs/VIGIA/VIGIA_HP_BACKUP_DISCOVERY_READONLY.ps1\`, commit \`edbfa1777684606348dfd4e52fefd157eb8f809b\`, rama \`feature/vigia-monitor-review-v1\`. Detecta ejecutables PostgreSQL en rutas usuales y registro, servicios PostgreSQL, fecha y tamaño de dumps en F:, cambios git rastreados; escribe solo informe en TEMP, no lee secretos ni ejecuta backup/restore/migrate ni altera producción. PENDIENTE de que el usuario lo ejecute y envíe su resultado.
- **Riesgo operativo vigente:** historial y ~103 conflictos offline antiguos potencialmente no resueltos en móviles, no observables en el servidor. **No actualizar PWA ni limpiar IndexedDB** sin conocer su estado. No activar módulos que escriben documentos reales antes de verificar respaldo consistente y estrategia de rollback.
- **No realizado:** no se reinició/detuvo el servicio del HP, no se editó \`.env\` real, no se ejecutó \`git pull\` ni migraciones 020/021 en producción, no se borraron colas, archivos ni inventario. Usuario quiere pruebas en servidor real, sin laboratorio separado, manteniendo monitor apagado por defecto hasta activación explícita y protegida.
- **Próximo paso:** obtener informe de respaldo/herramientas, preparar \`pg_dump\` sin purga (evitar \`backup.js\` legado porque elimina respaldos vencidos), verificar capacidad de restauración sin tocar datos, snapshot de archivos; revisar conflictos móviles antes de cambiar JS PWA; después considerar instalación controlada del mismo servidor con piloto limitado a usuario autorizado.


### [REG-037] 2026-10-12 | Herramientas PostgreSQL y respaldos reales localizados | RESPALDOS EXISTEN, RESTAURACIÓN NO COMPROBADA

- **Fuente:** informe del usuario \`VIGIA_PG_BACKUP_DISCOVERY_20261012_093113.txt\` de las 09:31:14.
- **Instalación del HP:** Git HEAD sigue \`067eb9f94e1441836c67f26c97f0c34a5e4745b8\`, **0 archivos rastreados modificados**. No hay conflicto de worktree detectado por el informe.
- **PostgreSQL:** servicio \`postgresql-x64-18\` en Running. Ejecutables identificados \`C:\Program Files\PostgreSQL\18\bin\pg_dump.exe\`, \`pg_restore.exe\`, \`psql.exe\`, todos **18.6**. La ausencia previa del PATH no era ausencia de instalación.
- **Respaldos:** unidad F: con **755,63 GB libres**; directorio \`F:\SmartInventoryBackups\`, **14 dumps candidatos** (script mostró 12 más recientes). Último de 2026-10-12 02:30 local, \`smart_inventory_2026-10-12T06-30-08-108Z.dump\`, tamaño **1,81 MB**. Existencia y tamaños NO acreditan integridad ni restauración exitosa.
- **Revisión del código existente:** \`v2/server/scripts/backup.js\` ejecuta \`pg_dump\` **y después purga** por política de 14 días. Por seguridad, NO usar \`npm run backup\` ahora. \`v2/server/scripts/restoreSmoke.js\` crea una base temporal y la elimina: NO ejecutar aún en producción sin plan y consentimiento para esa operación.
- **Herramienta nueva no destructiva para la copia:** \`docs/VIGIA/VIGIA_HP_BACKUP_MANUAL_SAFE.cjs\`, commit \`3d976b1137cc04c3db0202e115acba11a6b3a915\` en rama Monitor. Lee DATABASE_URL por dotenv instalado de la carpeta real (sin imprimir credenciales), usa \`pg_dump 18.6\` directamente con PGPASSWORD solo en proceso hijo, escribe **nuevo** dump en subdirectorio \`F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\` (fuera de retención de la raíz), no altera/elimina archivos anteriores ni crea/borra bases. Verifica TOC con \`pg_restore --list\` y descomprime a sumidero \`NUL\` sin acceder a una base; calcula SHA256 y comprobante. Borra exclusivamente su \`.partial\` si falla. **La restauración efectiva en otra base todavía quedaría PENDIENTE.**
- **Verificación en CI incorporada:** \`.github/workflows/v2-tests.yml\` contiene \`node --check ../../docs/VIGIA/VIGIA_HP_BACKUP_MANUAL_SAFE.cjs\`, commit \`2c3a1d25fd1c333f2789799c6aefc93481fe96f0\`. No inferir aprobación del job hasta consultar el run \`38256870212\`.
- **Estado real:** script manual creado/commiteado, **NO ejecutado en HP todavía**, no se creó nueva copia, no se probaron restauraciones; producción V2 sigue funcionando sin cambios. La próxima orden será ejecutar la copia manual y mostrar SOLO la salida textual y comprobante SHA, NO adjuntar \`.dump\` ni \`.env\` ni claves.
- **Después:** comprobar estado de colas/conflictos en teléfonos y definir ventana corta para publicación controlada del piloto sobre la misma instalación real, con backup de archivos y rollback, antes de cualquier migración.


### [REG-038] 2026-10-12 | Comprobación automática de helper para respaldo manual | CI OK / NO EJECUTADO EN HP

- GitHub Actions \`38256870212\`, HEAD \`2c3a1d25fd1c333f2789799c6aefc93481fe96f0\` de la rama \`feature/vigia-monitor-review-v1\`: \`server-syntax SUCCESS\`, \`server-integration SUCCESS\`, \`client-tests SUCCESS\`, \`browser-pilot SUCCESS\`.
- El paso de \`server-syntax\` incluye \`node --check ../../docs/VIGIA/VIGIA_HP_BACKUP_MANUAL_SAFE.cjs\`, por lo que se confirmó sintaxis JavaScript. **No prueba ejecutar pg_dump en Windows ni restaurar los bytes del archivo.**
- Mantener ejecución humana explícita del backup manual de REG-037 en servidor, verificar log y SHA256 y conservar todas las copias anteriores. NO usar el script de backups con retención antigua y NO apagar servicio ni ejecutar migraciones hasta siguientes controles.


### [REG-039] 2026-10-12 | Respaldo manual PostgreSQL ejecutado en HP | ARCHIVO COMPROBADO, RESTAURACION PENDIENTE

- El usuario ejecutó el proceso de copia en el servidor SERVIDOR sin parar VIGÍA.
- Archivo generado: F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\vigia_manual_predeploy_2026-10-12T13-40-02-012Z.dump
- Tamaño: 1893531 bytes. SHA256: 3b83bd345a0128810d44e50c154162b2fc5e9fff79c95ec697dbdb33a4f0a0e4.
- Las fases pg_dump, pg_restore --list y lectura/descompresión completa acabaron OK. El recibo declara que no se eliminaron copias anteriores y que no se modificó la base original.
- La restauración completa en otra base NO se ha probado. No inferir que el respaldo es plenamente restaurable.
- Prohibido borrar archivos o actualizar la PWA hasta revisar operaciones pendientes de dispositivos móviles.

### [REG-040] 2026-10-12 | Snapshot de instalación actual, herramienta preparada | CODIGO VERIFICADO EN CI, NO EJECUTADO EN HP

- Script agregado a rama feature/vigia-monitor-review-v1: docs/VIGIA/VIGIA_HP_APP_SNAPSHOT_SAFE.ps1, commit 4df757e4c8fea3a573118cc542d4c9cec7acd230.
- Copia los directorios App y Service a una carpeta nueva en F:, sin detener el servicio, modificar PostgreSQL ni eliminar archivos existentes.
- Comprueba hashes de archivos críticos y produce recibo en el propio servidor. La copia es privada y no debe compartirse.
- CI run 38258025862: los trabajos client-tests, windows-snapshot-parse, server-syntax, browser-pilot y server-integration terminaron SUCCESS.
- El script no se ha ejecutado aún en el servidor. Próximo paso: ejecutar snapshot y compartir solamente el texto de resultados; después comprobar operaciones de cola pendientes y definir despliegue controlado.


### [REG-041] 2026-10-12 | Snapshot real de archivos HP realizado y verificado | OK / PENDIENTES RESTORE Y COLAS

- Usuario ejecutó en el servidor real el script `docs/VIGIA/VIGIA_HP_APP_SNAPSHOT_SAFE.ps1`; salida `SNAPSHOT_OK`.
- `robocopy` copió `C:\SmartInventory\App` y `C:\SmartInventory\Service`; ambos códigos de salida fueron `1` (archivos copiados correctamente).
- SHA-256 de archivos críticos: `app.js`, `index.html`, `sw.js`, `.env` y wrapper del servicio coincidieron con los orígenes, conforme a salida del script.
- Commit respaldado: `067eb9f94e1441836c67f26c97f0c34a5e4745b8`.
- Snapshot privado: `F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\HP_APP_SNAPSHOT_20261012_095434_67ae0e91`; comprobante `VIGIA_SNAPSHOT_RECEIPT.txt` en esa carpeta. **No compartir el snapshot: contiene configuración privada en .env.**
- Junto con el dump de PostgreSQL registrado en REG-039, existen copias de aplicación/servicio y DB anteriores al despliegue nuevo. **Aun NO se ha ejecutado prueba de restauración completa PostgreSQL**; checksum/descompresión no equivalen a restore. Puede haber archivos cambiantes durante una copia en caliente.
- El script no detuvo ni reinició `SmartInventoryV2`; no se aplicaron migraciones y el servidor de producción sigue apuntando al commit anterior según el resultado aportado.
- **Próximo control obligatorio antes de actualizar JS/PWA:** obtener del teléfono/dispositivos las cifras reales de `Configuración > Sincronización > Trabajo pendiente` y de `Conflictos de sincronización`. No pulsar `Usar servidor`, `Reaplicar mi cambio`, ni limpiar datos/cache; los ~103 conflictos pasados no equivalen a un conteo actual verificado.
- Después: confirmar recuperación completa del dump en DB temporal solo para restauración (no un segundo VIGÍA en uso), con alcance/limpieza explícitos y seguro para DB productiva. Posterior instalación versionada, feature flag con usuario permitido y aprobación puntual de reinicio; no activar todavía.


### [REG-042] 2026-10-12 | Conteos reales PC/teléfono y autorización de descartar cola del teléfono | BORRADO TODAVÍA NO EJECUTADO

- Capturas del usuario de VIGÍA actual, versión indicada `shell-64`, mismo almacén principal.
- **PC:** `Configuración > Sincronización > Trabajo pendiente: 0`; sección Conflictos: `No hay conflictos pendientes`; panel del sistema conectado/autorizado sin cambios pendientes.
- **Teléfono Android:** `Configuración > Sincronización > Trabajo pendiente: 165`; panel de estado y Dashboard: `165 conflicto(s)`; sección de conflictos muestra errores `SYNC_CONFLICT` de entidad `document` y versiones de servidor/local potencialmente diferentes. En capturas no se verificó ninguna resolución exitosa de esas operaciones.
- **Autorización del usuario:** indica expresamente que no le importa borrar los datos locales del teléfono para comenzar limpio. **Esto permite descartar deliberadamente los 165 cambios locales y posibles borradores de ese origen**, pero NO demuestra que esos datos estuvieran en PostgreSQL; los que no llegaron al servidor se perderán.
- **Procedimiento acordado:** limpiar exclusivamente los datos del sitio/app VIGÍA en ese teléfono, no la base productiva, no datos de PC, no cachés de otros navegadores ni del teléfono completo. Evitar pulsar `Usar servidor`, `Reaplicar mi cambio` o reintentar/reproducir en masa esos conflictos. Tras reset, iniciar sesión en el mismo almacén y verificar 0 pendientes / 0 conflictos y estado del catálogo; si no coincide, detener el despliegue e investigar.
- **Precaución:** si VIGÍA se instaló como PWA de Chrome, borrar los datos del sitio concreto (no todos los datos de Chrome). Si se instaló como aplicación independiente, borrar solo almacenamiento de esa app, nunca datos del navegador completo. Confirmar origen/dominio antes de borrar.
- **No ejecutado por el asistente:** ningún borrado en teléfono; ni despliegue/migración/reinicio de HP. El snapshot de aplicación REG-041 y dump REG-039 permanecen; la prueba completa de restauración PostgreSQL sigue pendiente.


### [REG-043] 2026-10-12 | Reinicio local del telefono confirmado por usuario; restauracion real preparada | DATOS MOVILES LIMPIOS, HP INTACTO

- El usuario confirmo expresamente: "listo sin conflictos ni nada", tras optar por borrar los datos locales de VIGIA solo en su telefono Android. Se registra como confirmacion del usuario, no como lectura remota independiente.
- En las capturas anteriores el telefono reportaba 165 cambios pendientes y 165 conflictos. Esos registros locales se consideran voluntariamente descartados por el usuario. PC presentaba 0 y no se modifico.
- No inferir que las 165 operaciones estuvieran guardadas en PostgreSQL. Mantener catalogo y movimientos del servidor como fuente de verdad sin reintroducir eventos antiguos.
- Se preparo herramienta `docs/VIGIA/VIGIA_HP_RESTORE_VALIDATE_SAFE.cjs` en rama aislada `feature/vigia-monitor-review-v1` commit `2fe650eaccf178f591a09bbc730d8a3fe58a0961`. Aun NO ejecutada en HP.
- La herramienta exige SHA256 exacto del dump protegido REG-039, crea base temporal aleatoria en el MISMO servicio PostgreSQL, restaura con pg_restore --exit-on-error --single-transaction, valida tablas y registros; cierra conexiones y elimina exclusivamente la base creada por la prueba. No altera smart_inventory ni el servicio VIGIA; si no hay permiso CREATEDB se detiene sin ampliar privilegios.
- El chequeo sintactico de la nueva herramienta se incorporo al CI en commit `24b0af18f86cd97541f7ef04065a2f7b577c0379`. No declarar la restauracion verificada sin salida `VIGIA_RESTORE_REAL_PASS` del propio HP.
- Restan confirmacion del resultado real, ventana breve de reinicio autorizada y despliegue limitado por usuario. Hasta entonces no aplicar migraciones ni publicar nuevos scripts PWA.


### [REG-044] 2026-10-12 | Restauración en base temporal bloqueada por CREATEDB | NO RESTAURADO / NO MODIFICADO

- El usuario ejecutó `VIGIA_HP_RESTORE_VALIDATE_SAFE.cjs` en HP. Etapa [1/5] SHA256 del dump pasó, [2/5] conexión administrativa a base `postgres` con credenciales de app pasó, [3/5] `CREATE DATABASE` fue RECHAZADO: `se ha denegado el permiso para crear la base de datos`.
- El script informó `VIGIA_RESTORE_REAL_FAIL`; no se llegó a `pg_restore`, no se verificaron tablas ni datos restaurados y no se confirmó ninguna base temporal creada. No inferir respaldo dañado: el bloqueo es de privilegios de la cuenta actual.
- No activar Monitor, no hacer migraciones, no reiniciar servicio ni dar a la cuenta de VIGÍA `CREATEDB` o `SUPERUSER` para eludir este control.
- Recuperación segura propuesta: consultar rol de aplicación en modo SOLO LECTURA y confirmar disponibilidad de un administrador PostgreSQL independiente; si existe acceso autorizado, crear exclusivamente una base efímera para restauración con ese administrador sin cambiar roles de aplicación; restaurar y verificar con el mínimo acceso y eliminar únicamente esa base tras la prueba. Nunca realizar `DROP` o `ALTER ROLE` sobre la base/usuario de producción.
- Herramienta nueva en rama `feature/vigia-monitor-review-v1`: `docs/VIGIA/VIGIA_HP_PG_ROLE_READONLY.cjs`, commit `1631f71d17049d1d01d443e482c624fa1a2a2e55`. Lee rol actual, permisos `rolcreatedb`/`rolsuper`, existencia del administrador `postgres` y recuento de bases temporales por prefijo; no modifica base ni imprime secretos.
- Comprobación de sintaxis adicionada en CI con commit `1df9aa0fefa0cd2ad90559bc2a578e5561213342`; pendiente recibir resultado de ejecución y salida del diagnóstico del HP. Usuario afirmó que el teléfono quedó sin conflictos (REG-043).


### [REG-045] 2026-10-12 | Diagnóstico PostgreSQL confirma app sin CREATEDB, administrador existente | PRUEBA ALTERNATIVA PREPARADA

- El usuario ejecutó `VIGIA_HP_PG_ROLE_READONLY.cjs` y obtuvo `VIGIA_PG_ROLE_READONLY_PASS`.
- Base administrativa consultada: `postgres`; rol operativo de servicio `smart_inventory`; `rolcreatedb=false`, `rolsuper=false`; existe rol administrador `postgres`; **0** bases temporales de restauración con prefijo `vigia_restore_probe_%`. No se cambiaron bases, roles, archivos ni servicios.
- El usuario indicó que cree tener la contraseña del rol administrador. **Se compartió una posible contraseña en el chat: no registrarla, repetirla, incluirla en scripts, commits, salidas ni archivos, y recomendar su rotación.** La validez del dato no se comprobó.
- Se programó una prueba alternativa con un rol de DB separado: `docs/VIGIA/VIGIA_HP_RESTORE_ADMIN_SAFE.cjs`, commit `cfbb1727d301ae7d0787fa6656c297f13fbf0ab5`, sobre rama `feature/vigia-monitor-review-v1`. Usa credencial introducida de modo oculto en PowerShell por entorno temporal, valida el SHA256 conocido del dump, conecta a la base administrativa `postgres` como usuario `postgres`, verifica capacidad CREATEDB/superuser, crea exclusivamente `vigia_restore_probe_<aleatorio>`, ejecuta pg_restore sobre esa DB temporal, comprueba objetos y recuentos, y elimina solamente esa DB. NO altera permisos de `smart_inventory`, no restaura sobre `smart_inventory`, no reinicia SmartInventoryV2.
- Sintaxis incluida en CI en commit `a331863bcdbf7b697c1988ede5c7bc30dc22b3eb`; run `38265172617` iniciado, pendiente de confirmar resultado final al registrar la entrada.
- Riesgo operativo: ante fallo de conexión o de `pg_restore` no hay confirmación de restauración y por tanto NO se despliega VIGÍA; si la limpieza de DB temporal fallara, NO borrar nada manualmente sin revisar. No usar ni compartir la credencial administradora del chat.
- Próximo paso: cuando CI cierre correctamente, ejecutar la herramienta de comprobación real con contraseña introducida en consola del HP; solicitar solo la salida sin credenciales ni `.env`. Si supera la restauración, planificar migraciones aditivas y despliegue controlado con autorización puntual sobre el HP actual, usando snapshots REG-039/041 como protección.


### [REG-046] 2026-10-12 | Verificador con administrador independiente: CI aprobada | AUN NO EJECUTADO EN HP

- GitHub Actions `38265172617`, commit de trabajo `a331863bcdbf7b697c1988ede5c7bc30dc22b3eb`: `client-tests SUCCESS`, `windows-snapshot-parse SUCCESS`, `server-syntax SUCCESS`, `server-integration SUCCESS`, `browser-pilot SUCCESS`.
- Se verificó sintaxis de `docs/VIGIA/VIGIA_HP_RESTORE_ADMIN_SAFE.cjs` junto con otras pruebas automatizadas. No significa restauración productiva: ejecución Windows/HP con credencial administrativa todavía pendiente.
- Autorización y limites: rol `postgres` se usará únicamente para crear/llenar/comprobar/eliminar una DB efímera del mismo PostgreSQL. No guardar contraseña en GitHub o chats. Capturarla oculta en PowerShell y eliminar variable del entorno al acabar. Cambiar contraseña administrativa previamente compartida tan pronto como sea viable, coordinando dependencias externas.
- No alterar el rol `smart_inventory`, `smart_inventory` productiva, instalación HP o PWA. Exigir salida `VIGIA_RESTORE_ADMIN_PASS` antes de plantear migraciones.
