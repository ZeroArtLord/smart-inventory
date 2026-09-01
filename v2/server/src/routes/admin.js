import { Router } from 'express';
import { pool } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import {
  resolveMemberPermissions,
  validateRoleCode
} from '../security/roles.js';
import { requirePermission } from '../middleware/requirePermission.js';

export const adminRouter = Router();

adminRouter.use(requirePermission(PERMISSIONS.USERS_MANAGE));

adminRouter.get('/members', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         wm.user_id,
         u.external_auth_id,
         u.email,
         u.display_name,
         u.active AS user_active,
         wm.role_code,
         wm.permissions,
         wm.active AS membership_active,
         wm.created_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY COALESCE(u.display_name, u.email, u.external_auth_id)`,
      [req.auth.workspaceId]
    );

    res.json({
      ok: true,
      members: result.rows.map(row => ({
        userId: row.user_id,
        externalAuthId: row.external_auth_id,
        email: row.email,
        displayName: row.display_name,
        userActive: row.user_active,
        roleCode: row.role_code,
        permissions: row.permissions || [],
        membershipActive: row.membership_active,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/members/:userId', async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const roleCode = validateRoleCode(req.body?.roleCode);
    const permissions = resolveMemberPermissions({
      roleCode,
      permissions: req.body?.permissions
    });
    const active = req.body?.active !== false;

    if (
      targetUserId === req.auth.userId &&
      !active
    ) {
      return res.status(400).json({
        ok: false,
        code: 'SELF_DISABLE_BLOCKED',
        message: 'No puedes desactivar tu propia membresía desde esta sesión.'
      });
    }

    if (
      targetUserId === req.auth.userId &&
      !permissions.includes('*') &&
      !permissions.includes(PERMISSIONS.USERS_MANAGE)
    ) {
      return res.status(400).json({
        ok: false,
        code: 'SELF_LOCKOUT_BLOCKED',
        message: 'No puedes quitarte tu propio permiso users.manage.'
      });
    }

    const result = await pool.query(
      `UPDATE workspace_members
       SET role_code = $3,
           permissions = $4::jsonb,
           active = $5
       WHERE workspace_id = $1
         AND user_id = $2
       RETURNING workspace_id, user_id, role_code, permissions, active`,
      [
        req.auth.workspaceId,
        targetUserId,
        roleCode,
        JSON.stringify(permissions),
        active
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        code: 'MEMBER_NOT_FOUND',
        message: 'Miembro no encontrado en este almacén.'
      });
    }

    const row = result.rows[0];
    res.json({
      ok: true,
      member: {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        roleCode: row.role_code,
        permissions: row.permissions || [],
        active: row.active
      }
    });
  } catch (error) {
    if (
      error?.message === 'Rol inválido' ||
      error?.message?.startsWith('Permiso')
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_ROLE_OR_PERMISSIONS',
        message: error.message
      });
    }

    next(error);
  }
});
