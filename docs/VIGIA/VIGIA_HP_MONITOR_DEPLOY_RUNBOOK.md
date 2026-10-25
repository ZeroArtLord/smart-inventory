# VIGÍA Monitor — plan de despliegue controlado en el HP real (sin entorno paralelo)

Estado: PREPARADO, NO EJECUTADO EN EL HP. Este documento NO autoriza una intervención en producción.
Fecha: 2026-10-12. Clave: VIGIA-FARO-1011.

## Identidades y versiones verificadas

- Servicio Windows: SmartInventoryV2; raíz: C:\SmartInventory\App; API en C:\SmartInventory\App\v2\server; puerto local: 5190.
- Código actual confirmado: 067eb9f94e1441836c67f26c97f0c34a5e4745b8.
- Candidato Monitor con CI aprobada: e8cdedac21cf372261049543644ec2b1d68cfa9f (rama feature/vigia-monitor-review-v1; PR #23 sigue DRAFT).
- La comparación GitHub de esos dos SHA es fast-forward: 98 commits por delante, 0 por detrás.
- Sin cambios en v2/server/package.json respecto del SHA instalado. No realizar npm install/ci durante la ventana salvo una nueva comprobación formal.
- Backups verificados de DB: F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\vigia_manual_predeploy_2026-10-12T13-40-02-012Z.dump; SHA256: 3b83bd345a0128810d44e50c154162b2fc5e9fff79c95ec697dbdb33a4f0a0e4.
- La restauración de ese dump en base temporal PASÓ y la base efímera fue eliminada. Recuentos restaurados: workspaces 1, products 494, documents 132, document_lines 4196, movements 1019, sync_events 10075, audit_events 11370, migrations 19.
- Snapshot del App y Service antiguo: F:\SmartInventoryBackups\VIGIA_MANUAL_PREDEPLOY\HP_APP_SNAPSHOT_20261012_095434_67ae0e91.
- Preflight de lectura del HP: VIGIA_MONITOR_PREFLIGHT_READONLY_PASS, Git limpio, hashes coincidentes, migraciones 001-019 exactas, CREATE en public permitido; las 020/021 todavía no existen ni se aplicaron.
- PC reportó 0 pendientes/0 conflictos; teléfono tenía 165 conflictos y el usuario confirmó después haber limpiado la cola local. Verificar de nuevo antes de la ventana.

## Condición NO-GO

No aplicar migraciones, no detener SmartInventoryV2, no actualizar archivos del HP ni activar Monitor hasta que el usuario autorice expresamente una ventana de cambio, con el aviso de que puede haber una interrupción del sistema mientras el servicio está detenido.

## Etapa A — preparar paquete (sin detener ni cambiar el runtime)

1. Confirmar que las PC y móviles en uso no tienen colas pendientes; detener operaciones de escritura durante ventana.
2. Verificar de nuevo que Git HEAD actual es el SHA antiguo y que no hay modificaciones rastreadas o archivos ajenos conflictivos.
3. Verificar Git remoto y obtener el branch Monitor. Usar 'git fetch --no-tags origin feature/vigia-monitor-review-v1'. Comparar FETCH_HEAD con el SHA fijado arriba. Si ha cambiado, DETENER y revisar. No hacer git pull.
4. Confirmar fast-forward con 'git merge-base --is-ancestor <SHA-ANTIGUO> <SHA-CANDIDATO>'; no desplegar si devuelve error.
5. Capturar nuevas cifras productivas inmediatamente antes de la ventana (pueden haber cambiado desde el preflight, eso es normal).
6. Con la escritura detenida, crear un NUEVO respaldo sin purga usando el helper VIGIA_HP_BACKUP_MANUAL_SAFE.cjs anclado al commit 3d976b1137cc04c3db0202e115acba11a6b3a915. Exigir pg_dump/pg_restore LIST y DECOMPRESS OK, guardar SHA256. NO usar npm run backup porque backup.js elimina respaldos vencidos.
7. Mantener disponible snapshot App/Service y comprobar espacio libre del disco F:.

## Etapa B — desplegar SOLO después de autorización explícita

1. Anotar fecha/hora, SHA antiguo y nuevo; preparar respuesta de incidencias y personas conectadas.
2. Detener servicio SmartInventoryV2 con Stop-Service y confirmar Status=Stopped. No detener PostgreSQL ni otros servicios.
3. Avanzar Git únicamente por fast-forward al SHA candidato con 'git merge --ff-only <SHA-CANDIDATO>' desde C:\SmartInventory\App. Si Git reporta conflicto o discrepancia, DETENER y revertir la operación.
4. Mantener MONITOR_PILOT_ENABLED desactivado, por defecto false. No introducir MONITOR_PILOT_USER_IDS ni habilitar todavía API/launchers.
5. Desde C:\SmartInventory\App\v2\server, ejecutar el migrador versionado 'node scripts/migrate.js' (aplicará 020/021 solo si faltan; cada archivo se ejecuta dentro de su propia transacción). Si falla, no seguir con código Monitor activo.
6. Verificar tabla schema_migrations: deben existir exactamente 21 nombres previstos. No borrar ni reescribir datos antiguos; 020/021 son tablas auxiliares aditivas.
7. Ejecutar preflight:production y comprobar todas sus condiciones; incluye seguridad de Firebase y readiness SQL.
8. Iniciar SmartInventoryV2, confirmar servicio Running, /health.ok=true y /ready.ok=true. Consultar /api/v1/public/config: monitorPilotEnabled tiene que ser false. Si es true, detener la activación y revisar fuentes de configuración.
9. Comprobar VIGÍA original desde PC y teléfono: autenticación, navegación, catálogo y sincronización sin alterar datos. No tocar los 165 eventos descartados ni borrar IndexedDB de otros dispositivos.
10. Mantener Monitor en OFF hasta una segunda aprobación, elección de UUID/autenticación del usuario de prueba y validación de permisos.

## Etapa C — activación controlada por usuario (separada del despliegue base)

- Configurar MONITOR_PILOT_ENABLED=true y MONITOR_PILOT_USER_IDS con el identificador existente del usuario autorizado. Guardar configuración privada solo en HP.
- El backend protege /api/v1/monitor con la allowlist. En cliente también se exige parámetro ?vigiaMonitorPilot=1, un valor público true y sesión/permiso.
- Esta etapa requiere reinicio controlado separado y verificación del usuario permitido y del no permitido. No habilitar para todos ni exponer credenciales.
- Las listas Comprar/Pedir y los Surtidos Monitor generan registros reales. Hacer pruebas reales acotadas y reversibles a nivel documental, nunca asumir que son datos ficticios. Confirmar comportamiento de impresiones 80 mm físicamente.

## Rollback ante fallo de la Etapa B

- Si el servicio falla o /ready no vuelve a true, detener el servicio VIGÍA y volver al SHA anterior solo si el worktree es exactamente el actualizado por la intervención y no contiene cambios nuevos.
- Un retorno de código puede hacerse con 'git reset --hard 067eb9f94e1441836c67f26c97f0c34a5e4745b8' CON SERVICIO DETENIDO, aprobación específica y previo examen del git status; mejor plan alternativo es restaurar los archivos del snapshot protegido.
- No usar git clean, no borrar .env, IndexedDB, tablas 020/021, movimientos, auditoría ni backups. La migración aditiva puede permanecer, el servidor antiguo la ignorará. NO hacer restore de DB productiva como rollback automático, pues perdería las operaciones posteriores al dump.
- Arrancar el servicio en su versión antigua, verificar /health y /ready, comprobar catálogo/operaciones y reportar el incidente antes de reintentar.

## Estado del plan

- Código Monitor: CI verde, PR #23 DRAFT.
- Dump PostgreSQL: restauración real comprobada.
- Snapshot App/Service: restaurado? NO, hashes de archivos críticos comprobados.
- Preflight HP: PASS. Migraciones 020/021 en HP: NO APLICADAS.
- Despliegue HP: NO EJECUTADO; aprobación para servicio/migraciones todavía PENDIENTE.
- Piloto Monitor para usuario permitido: NO ACTIVADO.

Fin del documento.
