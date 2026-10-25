import { config } from '../config.js';

// Fail-closed: despliegue de código no equivale a activar escrituras Monitor.
// Producción exige una lista explícita de usuarios internos autorizados.
export function monitorPilotGate(req, res, next) {
  if (!config.monitorPilotEnabled) {
    return res.status(404).json({
      ok:false,code:'MONITOR_PILOT_DISABLED',
      message:'VIGÍA Monitor todavía no está activado'
    });
  }
  const identity=String(req.auth?.userId||'').trim().toLowerCase();
  const external=String(req.auth?.externalAuthId||'').trim().toLowerCase();
  const list=config.monitorPilotUserIds.map(x=>String(x).toLowerCase());
  if (list.length && !list.includes(identity) && !list.includes(external)) {
    return res.status(403).json({
      ok:false,code:'MONITOR_PILOT_NOT_ALLOWED',
      message:'El piloto todavía no está autorizado para este usuario'
    });
  }
  next();
}
