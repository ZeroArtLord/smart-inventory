import { config } from '../config.js';
import { pool } from '../db.js';
import { extractBearerToken } from '../security/authTokens.js';
import { verifyFirebaseIdToken } from '../security/firebaseAuth.js';

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

    const identity = await resolveIdentity(req);

    if (!identity?.userId) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'No se pudo resolver la identidad.'
      });
    }

    const membership = await pool.query(
      `SELECT role_code, permissions
       FROM workspace_members
       WHERE workspace_id = $1
         AND user_id = $2
         AND active = true`,
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

  let decoded;
  try {
    decoded = await verifyFirebaseIdToken(token);
  } catch (cause) {
    const error = new Error('Token Firebase inválido');
    error.code = 'AUTH_TOKEN_INVALID';
    error.cause = cause;
    throw error;
  }

  const userResult = await pool.query(
    `SELECT id, external_auth_id, email
     FROM users
     WHERE external_auth_id = $1
       AND active = true`,
    [decoded.uid]
  );

  if (userResult.rowCount === 0) {
    const error = new Error('Usuario autenticado no provisionado');
    error.code = 'AUTH_TOKEN_INVALID';
    throw error;
  }

  const user = userResult.rows[0];

  return {
    userId: user.id,
    externalAuthId: user.external_auth_id,
    email: user.email || decoded.email || null,
    authMode: 'firebase'
  };
}
