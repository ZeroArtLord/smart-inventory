# VIGÍA Monitor — ciclos, Preguntar y buscador en el HP

Estado: candidato en PR #25. No hay ejecución remota documentada en el HP. Aplicar solo tras obtener el SHA real y un prechequeo PASS.

## Alcance

- Se conserva la revisión 2026-10-19 y puede abrirse desde el selector aun después del lunes 2026-10-26.
- El cierre archiva la revisión completa y abre un ciclo vacío; Preguntar se imprime en una copia y debe resolverse antes de cerrar.
- Migración 022 crea tablas de ciclo/archivo y amplía las decisiones a ASK. No altera existencias ni movimientos.
- La impresora RC-8002, las listas Comprar/Pedir, el acceso exclusivo DIOS y la configuración privada se mantienen.

## Preparación en el HP

1. Abrir PowerShell 5.1 como administrador. Confirmar que SmartInventoryV2 y PostgreSQL 18 están Running, que la VPN y el cliente DIOS acceden, y que todos los dispositivos muestran cero cambios Monitor pendientes o conflictos. El indicador «Local» por sí solo no basta para confirmar sincronización.
2. Obtener la rama `feature/vigia-monitor-ciclos-preguntar-busqueda-20261025` sin cambiar el checkout. Copiar `docs/VIGIA/VIGIA_HP_MONITOR_CYCLES_DEPLOY_SAFE.ps1` del SHA candidato exacto a una ruta local confiable. Registrar `git -C C:\SmartInventory\App rev-parse HEAD` como `ExpectedBaseSha`. El script exige que esa versión contenga el HEAD del PR #24; si no, detener y revisar el salto de versiones.
3. Ejecutar el script **sin** `-Deploy`, pasando `-ExpectedBaseSha` y `-TargetSha` (los 40 caracteres reales). Debe terminar `VIGIA_MONITOR_CYCLES_PRECHECK_PASS` y `PRECHECK_OK`. No usa respaldo viejo ni modifica la base.
4. Con el trabajo de usuarios pausado, ejecutar el mismo script **con** `-Deploy`. Pide confirmación de colas, crea un dump nuevo sin purga, copia App/Service en F:, restaura el dump en una base temporal con la cuenta administrativa y solo después pide la palabra `DESPLEGAR`. La clave administrativa no se pasa en argumentos y se elimina del entorno del proceso al terminar la restauración.

## Verificación posterior

- El script debe mostrar `VIGIA_MONITOR_CYCLES_POSTCHECK_PASS` y `VIGIA_MONITOR_CYCLES_DEPLOY_PASS`, con 22 migraciones y la 022 aplicada una sola vez. Guardar la salida completa y las rutas del respaldo y snapshot.
- En la cuenta DIOS, abrir semana `2026-10-19`: deben verse las 494 decisiones existentes (salvo cambios posteriores reales). Comprobar que otra cuenta no entra al piloto. No cerrar esa lista durante la mera prueba del despliegue.
- Probar búsqueda local por nombre y código; marcar un producto de prueba de la revisión **nueva** como Preguntar, ver el ticket de 80 mm de una copia y resolverlo a Comprar/Pedir. Evitar imprimir físicamente tickets de prueba si operaciones no lo autorizó; validar la vista previa primero.
- Solo después, cuando el usuario quiera cerrar la revisión real, verificar cero pendientes/conflictos y resolver todos los Preguntar. Cerrar una vez, revisar el historial y confirmar que el ciclo siguiente está vacío. Reabrir el piloto y verificar persistencia.

## Fallo y reversión

Si falla después de detener SmartInventoryV2, el script detiene solo ese servicio, vuelve al SHA anterior **solo si** Git sigue exactamente en el candidato y limpio, y reinicia/verifica la API. La migración aditiva 022 queda instalada; el código anterior la ignora. No se restauran ni borran automáticamente datos productivos, colas IndexedDB, respaldos ni `monitor_review_archives`. Si el rollback automático no puede demostrar esas condiciones, imprime `RECUPERACION_MANUAL_REQUERIDA` y se detiene.

El respaldo nuevo debe restaurarse exclusivamente en una base temporal durante el prechequeo. No restaurarlo sobre `smart_inventory` después de que hayan ocurrido operaciones, pues se perderían los cambios posteriores.
