// Sesión del piloto: siempre prioridad a validación online existente.
// Offline aprovecha EXCLUSIVAMENTE la autorización ya verificada por VIGÍA,
// respetando bloqueo de cierre de sesión, vencimiento y almacén seleccionado.
import { getCurrentSession } from '../admin/adminClient.js';
import { getSyncConfig } from '../sync/syncSettings.js';
import {
  getOfflineLogoutLock,
  readOfflineAccessSnapshot
} from '../auth/offlineAccess.js';

export async function resolveMonitorPilotSession({
  online = () => typeof navigator === 'undefined' || navigator.onLine !== false,
  liveSession = getCurrentSession,
  syncConfig = getSyncConfig,
  logoutLock = getOfflineLogoutLock,
  offlineAccess = readOfflineAccessSnapshot
} = {}) {
  if (online()) {
    const session = await liveSession();
    return requireReviewIdentity(session);
  }

  const config = await syncConfig();
  if (config.authMode !== 'firebase' || !config.workspaceId) {
    throw accessError('El piloto offline requiere una sesión Firebase verificada previamente');
  }

  const locked = await logoutLock();
  if (locked) {
    throw accessError('La sesión fue cerrada en este dispositivo. Conéctate para iniciar sesión');
  }

  // readOfflineAccessSnapshot comprueba vigencia (7 días), pertenencia y
  // caché verificada; nunca usar un token desactualizado para enviar cambios.
  const access = await offlineAccess({workspaceId:config.workspaceId});
  const workspace=access?.selectedWorkspace;
  if (!workspace || String(workspace.id) !== String(config.workspaceId)) {
    throw accessError('El almacén local no coincide con el último almacén autorizado');
  }

  const user=access.user || {};
  const session = {
    workspaceId:workspace.id,
    userId:user.id || user.externalAuthId || null,
    externalAuthId:user.externalAuthId || null,
    roleCode:workspace.roleCode||null,
    permissions:workspace.permissions||[],
    authMode:'firebase',
    cachedOffline:true
  };
  return requireReviewIdentity(session);
}

function requireReviewIdentity(session) {
  if(!session?.workspaceId || !session?.userId) {
    throw accessError('Se requiere una identidad y almacén autorizados');
  }
  const permissions=Array.isArray(session.permissions)?session.permissions:[];
  if(!['*','catalog.view','purchases.write','count.write'].some(p=>permissions.includes(p))) {
    throw accessError('No tienes permiso para consultar la revisión');
  }
  return session;
}
function accessError(message){
  const error=new Error(message);
  error.code='MONITOR_OFFLINE_ACCESS_DENIED';
  return error;
}
