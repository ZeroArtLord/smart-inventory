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
