import { config } from '../config.js';

export function authContext(req, res, next) {
  if (!config.devAllowHeaderAuth) {
    return res.status(503).json({
      ok: false,
      code: 'AUTH_NOT_CONFIGURED',
      message: 'La autenticación de producción todavía no está configurada.'
    });
  }

  const workspaceId = req.header('x-workspace-id');
  const userId = req.header('x-user-id');

  if (!workspaceId || !userId) {
    return res.status(401).json({
      ok: false,
      code: 'DEV_AUTH_HEADERS_REQUIRED',
      message: 'Faltan x-workspace-id y x-user-id.'
    });
  }

  req.auth = { workspaceId, userId };
  next();
}
