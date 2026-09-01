import { config } from '../config.js';
import { pool } from '../db.js';
import { extractBearerToken } from '../security/authTokens.js';
import { resolveFirebaseIdentity } from '../security/firebaseIdentity.js';

export async function authContext(req, res, next) {
  try {
    const workspaceId = req.header('x-workspace-id');

    if (!workspaceId) {
      return res.status(401).json({
        ok: false,
        code: 'WORKSPACE_REQUIRED',
        message: 'Falta x-workspace-id.'
      });
    }

    if (!isUuid(workspaceId)) {
      return res.status(400).json({
        ok: false,
        code: 'WORKSPACE_INVALID',
        message: 'x-workspace-id no es un UUID válido.'
      });
    }

    const identity = await resolveIdentity(req);

    if (!identity?.userId) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'No se pudo resolver la identidad.'
      });
    }

    const membership = await pool.query(
      `SELECT
         wm.role_code,
         wm.permissions
       FROM workspace_members wm
       JOIN workspaces w
         ON w.id = wm.workspace_id
       WHERE wm.workspace_id = $1
         AND wm.user_id = $2
         AND wm.active = true
         AND w.active = true`,
      [workspaceId, identity.userId]
    );

    if (membership.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        code: 'WORKSPACE_ACCESS_DENIED',
        message: 'El usuario no pertenece a este almacén.'
      });
    }

    req.auth = {
      workspaceId,
      userId: identity.userId,
      externalAuthId: identity.externalAuthId || null,
      email: identity.email || null,
      roleCode: membership.rows[0].role_code,
      permissions: membership.rows[0].permissions || [],
      authMode: identity.authMode
    };

    next();
  } catch (error) {
    if (error?.code === 'AUTH_TOKEN_INVALID') {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Token inválido o vencido.'
      });
    }

    next(error);
  }
}

async function resolveIdentity(req) {
  const canUseDevHeaders =
    config.authMode === 'dev' &&
    config.nodeEnv !== 'production' &&
    config.devAllowHeaderAuth;

  if (canUseDevHeaders) {
    const userId = req.header('x-user-id');

    if (!userId) {
      const error = new Error('Falta x-user-id');
      error.code = 'AUTH_TOKEN_INVALID';
      throw error;
    }

    return {
      userId,
      externalAuthId: null,
      email: null,
      authMode: 'dev'
    };
  }

  if (config.authMode !== 'firebase') {
    const error = new Error(
      'Modo de autenticación no configurado para producción'
    );
    error.code = 'AUTH_TOKEN_INVALID';
    throw error;
  }

  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    const error = new Error('Bearer token requerido');
    error.code = 'AUTH_TOKEN_INVALID';
    throw error;
  }

  const identity = await resolveFirebaseIdentity(token);

  return {
    ...identity,
    authMode: 'firebase'
  };
}


function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || '').trim());
}
