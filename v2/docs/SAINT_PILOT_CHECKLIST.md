# Smart Inventory V2 — Piloto controlado de carga SAINT

Este checklist se ejecuta antes de cargar el catálogo completo del negocio. El objetivo es demostrar que catálogo, empaques, apertura de stock, auditoría y sincronización se comportan correctamente con un conjunto pequeño y fácil de verificar manualmente.

## Regla del piloto

No usar el catálogo completo en la primera prueba.

Usar un workspace limpio y un archivo controlado de aproximadamente 5 productos. La apertura debe ejecutarse solamente después de que el preflight del servidor indique `READY_FOR_SAINT_INITIAL_LOAD`.

## Archivo piloto recomendado

| USAR | CÓDIGO SAINT | SKU SMART | PRODUCTO | EXISTENCIA SAINT | UNIDAD BASE | PRESENTACIÓN | UND POR PRESENTACIÓN | PRESENTACIÓN SECUNDARIA | UND SECUNDARIA | MÍNIMO | MÁXIMO | CATEGORÍA | REPOSICIÓN |
| --- | --- | --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | --- |
| SI | PIL001 |  | REFRESCO PILOTO | 485 UND | UND | CAJA | 24 | BULTO | 96 | 5 CAJAS | 10 BULTOS | BEBIDAS | COMPRA |
| SI | PIL002 |  | AGUA PILOTO | 0 UND | UND | CAJA | 12 |  |  | 2 CAJAS | 10 CAJAS | BEBIDAS | COMPRA |
| SI | PIL003 |  | ACEITE PILOTO | 18 UND | UND | CAJA | 6 |  |  | 2 CAJAS | 6 CAJAS | ALIMENTOS | AMBOS |
| SI | PIL004 |  | LIMPIADOR PILOTO | 7,5 LT | LT | GARRAFA | 1,5 |  |  | 3 LT | 15 LT | LIMPIEZA | PEDIDO |
| SI | PIL005 |  | PRODUCTO POR CAJA | 8 CAJA | CAJA |  |  |  |  | 2 CAJA | 12 CAJA | VARIOS | NINGUNA |
| NO | PIL999 |  | PRODUCTO QUE NO SE USA | 999 UND | UND | CAJA | 24 |  |  | 1 CAJA | 5 CAJAS | HISTÓRICO | NINGUNA |

## A. Preflight antes de importar

- [ ] Git/CI de la rama están verdes.
- [ ] Migraciones 010 y 011 están aplicadas.
- [ ] `npm run saint:preflight -- --workspace-key <workspace_key>` devuelve `READY_FOR_SAINT_INITIAL_LOAD`.
- [ ] El workspace tiene 0 movimientos.
- [ ] El workspace tiene 0 aperturas previas.
- [ ] Se tomó backup antes del piloto.

## B. Validación del preview

Al seleccionar el archivo:

- [ ] PIL999 aparece como omitido y no como producto válido.
- [ ] El plan muestra 5 productos a crear si el workspace está vacío.
- [ ] Los SKU Smart vacíos aparecen generados como SM-PIL001, SM-PIL002, etc.
- [ ] El Código SAINT y el SKU Smart se muestran como campos distintos.
- [ ] La existencia SAINT figura como completa.
- [ ] Se muestra la huella SHA-256 cuando el navegador está en contexto seguro.
- [ ] No hay errores de identidad.
- [ ] Se muestran correctamente categorías y empaques.

Equivalencias que deben ser visibles/verificables:

- PIL001: 485 UND = 20 CAJAS + 5 UND.
- PIL002: 0 UND.
- PIL003: 18 UND = 3 CAJAS.
- PIL004: 7,5 LT = 5 GARRAFAS.
- PIL005: 8 CAJA como unidad base.

## C. Pruebas de rechazo antes de abrir stock

Hacer copias del archivo piloto, una prueba por vez. No usar estas copias para la apertura real.

- [ ] Duplicar el Código SAINT PIL001 en otra fila → importación bloqueada.
- [ ] Duplicar un SKU Smart en otra fila → importación bloqueada.
- [ ] Duplicar un código de barras → importación bloqueada.
- [ ] Duplicar el nombre exacto de un producto → importación bloqueada.
- [ ] Usar SKU de un producto y código de barras de otro → importación bloqueada.
- [ ] Poner unidad base desconocida, por ejemplo GR → importación bloqueada.
- [ ] Usar CAJA como principal y secundaria en la misma fila → importación bloqueada.
- [ ] Dejar una existencia SAINT vacía → catálogo puede revisarse/importarse, pero apertura no se prepara.
- [ ] Quitar por completo la columna Existencia SAINT → catálogo no debe interpretar las filas como existencia cero.

## D. Importación de catálogo

Con el archivo piloto correcto:

- [ ] Importar catálogo.
- [ ] No se crea ningún movimiento de stock todavía.
- [ ] Las categorías nuevas se crean.
- [ ] Los empaques quedan guardados.
- [ ] Los mínimos/máximos quedan convertidos internamente a unidad base.
- [ ] El stock sigue en cero antes de la apertura.

## E. Apertura SAINT

- [ ] La tarjeta de apertura muestra 5 productos incluidos.
- [ ] Muestra 4 productos con existencia positiva y 1 en cero.
- [ ] Revisar la muestra de cantidades.
- [ ] Pulsar Aplicar existencia inicial.
- [ ] Confirmar el diálogo.
- [ ] Escribir exactamente `APLICAR SAINT`.
- [ ] El proceso termina sincronizado sin operaciones pendientes.

## F. Resultado obligatorio

Después de la apertura:

- [ ] Existe un documento `ADJUSTMENT` cerrado con metadata `SAINT_INITIAL_LOAD`.
- [ ] Existen líneas para los 5 productos.
- [ ] Existen movimientos solamente para las existencias positivas.
- [ ] PIL001 tiene stock real 485 UND.
- [ ] PIL002 tiene stock real 0 UND.
- [ ] PIL003 tiene stock real 18 UND.
- [ ] PIL004 tiene stock real 7,5 LT.
- [ ] PIL005 tiene stock real 8 CAJA.
- [ ] La auditoría conserva usuario, fecha, archivo fuente, Código SAINT y SHA-256 cuando esté disponible.

## G. Pruebas posteriores que NO deben cambiar stock

- [ ] Reimportar el catálogo cambiando únicamente mínimo/máximo.
- [ ] Cambiar la categoría de PIL001.
- [ ] Cambiar la presentación principal de PIL001 sin cambiar la unidad base.
- [ ] Verificar que PIL001 continúe exactamente en 485 UND.
- [ ] Intentar cambiar la unidad base de PIL001 de UND a KG → debe rechazarse con `BASE_UNIT_LOCKED`.
- [ ] Intentar ejecutar una segunda apertura SAINT → debe rechazarse con `INITIAL_LOAD_ALREADY_APPLIED`.

## H. Multi-dispositivo

Después de validar el servidor:

- [ ] Abrir Smart Inventory en la PC.
- [ ] Abrir Smart Inventory en el teléfono con el mismo workspace.
- [ ] Ambos dispositivos muestran el mismo documento de apertura.
- [ ] Ambos muestran los mismos stocks derivados.
- [ ] PIL001 se muestra como 485 UND / 20 CAJAS + 5 UND.
- [ ] No aparecen conflictos pendientes.

## Criterio de aprobación

El piloto queda aprobado solamente si todas las verificaciones críticas de las secciones D, E, F y G pasan sin corrección manual de base de datos.

Una diferencia de stock, una segunda apertura aceptada, una unidad base reinterpretada o una importación de catálogo que modifique existencia es fallo bloqueante y detiene el despliegue del catálogo completo.
