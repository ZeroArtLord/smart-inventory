# VIGÍA Monitor — Comprar/Pedir · Diseño funcional REG-017

**Fecha:** 2026-10-11  
**Estado:** DISEÑO DE PANTALLAS PROPUESTO PARA APROBACIÓN. No implementado ni desplegado.  
**Continuidad:** `VIGIA-FARO-1011`  
**Base:** REG-010 a REG-015 del Registro Maestro y feedback del 2026-10-11.

## Problema a resolver

El empleado debe mirar físicamente los productos de múltiples áreas del almacén y recorrer **todo el catálogo**, sin depender de qué artículos detecte VIGÍA como faltantes. No quiere llevar un segundo inventario, ni escribir cantidades obligatoriamente durante la revisión. Quiere una lista de compra y otra de pedido editables y compartidas, con extras libres, y que puedan imprimirse con cantidades vacías.

## Decisiones de producto confirmadas

1. **Todas las categorías y todos los productos activos** aparecen en la revisión, independientemente del stock y de recomendaciones.
2. Se avanza **producto por producto** y es posible cambiar de categoría; la recomendación VIGÍA es solamente informativa.
3. Estados humanos: **COMPRAR / PEDIR / NO HACE FALTA / PENDIENTE** (aprobación general del prototipo REG-015; cualquier revisión posterior se versionará).
4. **PENDIENTE** salta al siguiente, permanece en bandeja global y no es cantidad cero ni revisión resuelta.
5. **Cantidad opcional** en la primera pasada: número positivo cuando se sabe; `null` cuando aún no se sabe. No transformar `null` en 0.
6. La impresión COMPRAR y PEDIR **permite cantidad vacía**, con un hueco en el papel para escritura manual.
7. **Lista semanal única** por tipo de operación (COMPRA y PEDIDO) y por almacén, editable lunes-jueves; no crear nueva lista cada vez que se añada algo. La regla exacta de cierre después de jueves necesita revisión posterior.
8. La revisión es **colaborativa entre los usuarios autorizados del mismo almacén**, en PC y teléfono; guardar antes de navegar, sincronizar cambios y no perder decisiones simultáneas.
9. **EXTRAS FUERA DE CATÁLOGO** son parte indispensable de COMPRAR/PEDIR: introducir nombre libre, tipo Comprar/Pedir, cantidad opcional, unidad opcional y nota opcional, ej. cinta métrica, guantes o material de oficina. Deben figurar en selección y ticket bajo grupo EXTRAS sin afectar el catálogo ni el stock. No requerir crear antes un producto VIGÍA.
10. **Feedback visual:** el primer prototipo REG-015 gusta en conjunto, pero **la visualización para teléfono quedó deficiente**. Rediseño/responsividad móvil pendiente, sin bloquear validación de la lógica.

## Las seis secciones del nuevo módulo

### 1. Inicio / Revisión semanal

- Encabezado `Comprar / Pedir`, semana activa y sincronización (local / pendiente / sincronizado).
- Cuatro indicadores: revisados, pendientes, por comprar, por pedir; cada uno distingue decisiones humanas de recomendaciones.
- Tarjetas con TODAS las categorías del catálogo, progreso por categoría, pendientes y salto a continuar por el siguiente producto sin revisar.
- Accesos: `Continuar revisión`, `Pendientes`, `Seleccionados`, `Mis listas` y `Agregar extra`.
- No se piden entradas/stock ni se muestran alertas basadas en un inventario paralelo como requisito.

### 2. Revisión por categoría

- Nombre de categoría y ficha visible de un solo producto, nombre/código/medida, progreso general y de categoría.
- Sugerencia VIGÍA visible discretamente: no oculta ningún producto, no obliga a aceptarla.
- Cuatro acciones táctiles de decisión: `COMPRAR`, `PEDIR`, `NO HACE FALTA`, `PENDIENTE`. Guardan y avanzan.
- Cantidad opcional: dejar vacía `null` sin error; unidad/presentación y nota opcional.
- Botones anterior/siguiente, búsqueda y cambio de categoría; corrección de decisión posterior.
- Debe ser operable cómodamente con una mano en móvil, sin desbordes, botones grandes y foco visible.

### 3. Pendientes

- Bandeja de todos los productos saltados, agrupable por categoría y con búsqueda.
- Botón `Revisar ahora` para resolverlos uno por uno.
- Un pendiente no se cuenta como `NO HACE FALTA`, no desaparece silenciosamente de la revisión ni es una compra confirmada.
- Puede haber pendientes cuando se imprime: NO aparecen en lista COMPRAR/PEDIR salvo que se clasifiquen.

### 4. Seleccionados / Prelista

- Dos subtotales: COMPRAR y PEDIR; mostrar también ítems con `cantidad:null` y un contador `por completar`.
- Corregir nombre para extras, tipo, cantidad, presentación, nota, y clasificación; desmarcar sin perder trazabilidad.
- Botón `+ Agregar extra` accesible aquí; no solo en catálogo.
- Guardar a una sola revisión/lista semanal compartida, aplicando cambios por identidad para evitar repetición de líneas.

### 5. Extras

- Formulario deliberadamente simple: **nombre o descripción obligatoria**, `Comprar/Pedir` obligatorio, cantidad opcional, unidad opcional y observación opcional.
- El extra puede ser un consumible, herramienta o material inexistente en VIGÍA: `Cinta métrica`, `Guantes`, etc.
- No crea producto del catálogo, no genera stock, no exige mínimo/máximo, y aparece en `Seleccionados` + en la lista/ticket como `EXTRAS`.
- Puede corregirse, quitarse o cambiar Compra/Pedido; guardar historial cuando se integre en backend.
- Evitar crear el mismo extra duplicado por reintentos o repetición accidental.

### 6. Mis listas / Impresión

- Dos listas semanales: `COMPRAR` y `PEDIR`, editables durante la semana.
- Renglones agrupados por categoría, y `EXTRAS` al final; fecha, responsable o autores, notas.
- Vista previa del ticket de 80 mm, con cantidades reales cuando existan y `________` para cantidades desconocidas; dos copias: COMPRAR = CHÓFER + DEPÓSITO; PEDIR = PROVEEDOR + DEPÓSITO.
- La vista previa y la impresión directa ESC/POS deberán coincidir. La impresión de la lista **no debe asumir cierre** de la misma; se podrá seguir editando tras imprimir (comportamiento propuesto, por validar con usuario). El valor manuscrito no se convierte en cantidad digital automáticamente.
- **Pendiente de decisión final:** política de marcar `REALIZADA` con cantidades aún vacías y cierre de semana.

## Reglas técnicas obligatorias para implementación futura

- Crear un **modelo de decisión de revisión** separado del stock. No reaprovechar CONTEO/cierres de ADJUSTMENT ni movimientos SUPPLY.
- El backend actual de `replenishment` rechaza cantidades no positivas: no enviarle ítems con cantidad `null` hasta diseñar almacenamiento alternativo o nueva versión contractual que lo soporte. No usar `0` ficticio.
- Trabajar por identidad de ítem y período para evitar duplicar listas y extras; estado compartido por almacén.
- Diseñar sincronización que respete los dispositivos offline, loguee auditoría y resuelva cambios concurrentes; **no sobrescribir silenciosamente** y no tocar los antiguos 103 conflictos sin diagnóstico.
- Recuperar borradores tras recarga/salida/corte eléctrico. Respetar datos y permisos existentes. No limpiar IndexedDB/localStorage en dispositivos reales.
- Mantener frontend VIGÍA actual y backend productivo intactos hasta validar un piloto y contar con backup y rollback.

## Criterios de aceptación de la primera implementación

1. Un producto activo sin recomendación aparece en el recorrido.
2. `COMPRAR` o `PEDIR` sin cantidad se guarda y puede imprimirse en blanco.
3. PENDIENTE se recupera tras navegación y cambio de dispositivo con conexión; no se cuenta revisado.
4. Se edita una decisión, se cambia COMPRAR ↔ PEDIR y no aparecen duplicados.
5. `NO HACE FALTA` no aparece en las listas.
6. Se agrega `Cinta métrica` sin catálogo, sin cantidad, y sale en EXTRAS del ticket de compra.
7. Se imprime con copias y huecos, sin afectar stock, aunque existan pendientes por revisar.
8. Dos empleados autorizados pueden continuar la misma semana sin repetir toda la revisión.
9. Pruebas de cortes de conexión, reinicio, pérdida de energía simulada y conflictos, sin pérdida de datos.
10. Móvil con tamaño de texto legible, botones grandes, sin desplazamiento horizontal, y navegación práctica en 360–430 px.

**Aprobación funcional de este conjunto de pantallas:** PENDIENTE de confirmación explícita del usuario. No autoriza desarrollo/despliegue automático.
