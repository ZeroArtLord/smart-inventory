import { hasPermission } from '../security/permissions.js';

export function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Autenticación requerida.'
      });
    }

    if (!hasPermission(req.auth, permission)) {
      return res.status(403).json({
        ok: false,
        code: 'PERMISSION_DENIED',
        message: `Permiso requerido: ${permission}`
      });
    }

    next();
  };
}
