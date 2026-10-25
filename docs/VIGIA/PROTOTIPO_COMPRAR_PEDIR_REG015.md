# VIGÍA MONITOR — Prototipo visual interactivo de Comprar/Pedir (REG-015)

Fecha: 2026-10-11
Estado: **PROTOTIPO HTML AISLADO Y PROBADO EN NAVEGADOR; NO DESPLEGADO**
Clave: `VIGIA-FARO-1011`
Fuente: REG-010, REG-011, REG-012, REG-013 y REG-014 de `docs/VIGIA/REGISTRO_MAESTRO.md`.

## Objetivo

Mostrar un diseño de revisión semanal por categorías **sin depender del stock ni exigir cantidades**, mientras se mantienen las listas de compra/pedido y una bandeja de pendientes.

El prototipo se entregó al usuario como archivo autónomo `VIGIA_Prototipo_Comprar_Pedir_REG015.html` en la conversación. SHA-256 del HTML exacto: `53ce66a09a3b342a6119702223c5802217e255541b24a22c069943f295796598`.

**Aclaración:** el HTML de ejemplo no fue integrado en el directorio ejecutable `v2/` ni implementa servidor. El documento GitHub registra el contrato visual y de interacción, no significa que la app real ya haga esto.

## Pantallas del prototipo

1. **Inicio:** progreso global, cantidad de marcados COMPRAR, PEDIR, PENDIENTE, selector de 6 categorías con barra de progreso y acceso rápido a pendientes, seleccionados y listas.
2. **Revisar productos:** ficha grande de un producto por vez con código, categoría y unidad, sugerencia ilustrativa no vinculante, cuatro acciones COMPRAR/PEDIR/NO HACE FALTA/PENDIENTE, campo cantidad opcional (`null` si vacío), unidad, observación, navegación anterior/siguiente y selector de categoría. Al marcar, guarda la decisión y continúa con el siguiente sin revisar de la categoría.
3. **Pendientes:** lista independiente de productos saltados; volver a una ficha para resolver su estado sin repetir productos ya revisados.
4. **Seleccionados:** lista conjunta de compras/pedidos, edición de cantidad vacía o positiva, cambio entre comprar/pedir, quitar de selección (volver a SIN_REVISAR en la demo), añadir extra manual fuera del catálogo con cantidad opcional.
5. **Mis listas:** vistas independientes para Comprar y Pedir, agrupación por categoría; previsualización del ticket 80mm, dos copias (COMPRA: chófer y depósito; PEDIDO: proveedor y depósito), campos de cantidad en blanco como `________` para completar manualmente; botón imprimir que abre diálogo del navegador, NO la impresora física.

## Interacciones y tecnología del prototipo

- HTML/CSS/JavaScript autocontenido y sin dependencias; diseño responsive desktop/móvil, tema oscuro de navegación + paneles claros.
- **33 productos completamente SIMULADOS** en 6 categorías, sin relación con catálogos ni existencias reales.
- Las decisiones se guardan en una **clave aislada de localStorage del navegador donde se abre la demo** (`vigia.reg015.demo.v1`) para probar la recuperación local.
- El ejemplo **NO implementa** PC↔teléfono, PostgreSQL, Firebase, IndexedDB de producción, cola de sincronización, conflictos reales, creación de documentos, movimientos de stock, impresora ESC/POS o listas persistentes reales. No sugerir al usuario que esto ya funciona en producción.
- Toda cantidad no definida permanece `null`, jamás 0; sólo valores numéricos positivos si se informan.

## Pruebas de prototipo ejecutadas localmente

Validación visual con Chromium/Playwright headless, vista escritorio y móvil; verificación de sintaxis JavaScript con `node --check`.

- Home carga 6 categorías; no hubo errores JavaScript.
- Recorrido de Bebidas, marca PEDIR con cantidad opcional (incluye 3 como caso), navegación automática; marca PENDIENTE y aparece en bandeja.
- Se retoma un pendiente y pasa a COMPRAR, decrementando pendientes.
- Se abre Seleccionados, se añade extra sin cantidad, se genera la vista de compra.
- Vista de ticket contiene dos copias y líneas `________` para cantidad faltante.
- Layout móvil de 390px no presenta desbordamiento horizontal.
- **Resultado:** pruebas interactivas de las rutas anteriores pasaron sin errores JS.
- **Limitaciones de prueba:** no son pruebas de producción, no prueban impresión ESC/POS real, reinicio offline entre dispositivos ni persistencia en servidor.

## Decisiones pendientes antes de integrar

- Validar estilo visual con usuario.
- Confirmar si al **Marcar realizada** en la app real las cantidades pueden seguir vacías; REG-012 aprueba impresión con cantidades en blanco, no aprobación automática del cierre transaccional.
- Definir ciclo de vida de revisión y listas al cambiar de semana.
- Implementar colaboración por almacén con control de concurrencia, persistencia segura y reintentos idempotentes.
- Mantener aislados los 103 conflictos existentes y no borrar almacenamiento local/IndexedDB.
- Sólo después: desarrollo funcional en rama nueva, pruebas completas, respaldo y despliegue autorizado.

## Cambio en producción

**NINGUNO.** El prototipo y esta especificación son entregables de diseño para revisión, no un reemplazo de la versión operativa.
