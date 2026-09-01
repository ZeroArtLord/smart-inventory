import { Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';
import { extractBearerToken } from '../security/authTokens.js';
import { resolveFirebaseIdentity } from '../security/firebaseIdentity.js';

export const authRouter = Router();

authRouter.post('/bootstrap', async (req, res, next) => {
  try {
    if (config.authMode !== 'firebase') {
      return res.status(409).json({
        ok: false,
        code: 'FIREBASE_AUTH_DISABLED',
        message: 'El servidor no está en modo Firebase.'
      });
    }

    const token = extractBearerToken(
      req.header('authorization')
    );

    if (!token) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Bearer token requerido.'
      });
    }

    const identity = await resolveFirebaseIdentity(token);

    const result = await pool.query(
      `SELECT
         w.id,
         w.name,
         w.workspace_key,
         wm.role_code,
         wm.permissions
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
         AND wm.active = true
         AND w.active = true
       ORDER BY w.name, w.id`,
      [identity.userId]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        code: 'NO_ACTIVE_WORKSPACE',
        message: 'El usuario no tiene almacenes activos asignados.'
      });
    }

    res.json({
      ok: true,
      user: {
        id: identity.userId,
        externalAuthId: identity.externalAuthId,
        email: identity.email,
        displayName: identity.displayName
      },
      workspaces: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        workspaceKey: row.workspace_key || null,
        roleCode: row.role_code,
        permissions: row.permissions || []
      }))
    });
  } catch (error) {
    if (error?.code === 'AUTH_TOKEN_INVALID') {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_TOKEN_INVALID',
        message: error.message || 'Token inválido.'
      });
    }

    next(error);
  }
});
