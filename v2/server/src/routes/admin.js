import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import {
  ROLE_CODES,
  resolveMemberPermissions,
  validateRoleCode
} from '../security/roles.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { writeAuditEvent } from '../audit/auditService.js';

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
      members: result.rows.map(mapMemberRow)
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/members', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const externalAuthId = normalizeOptionalText(req.body?.externalAuthId);
    const displayName = normalizeOptionalText(req.body?.displayName);
    const roleCode = validateRoleCode(req.body?.roleCode || 'WAREHOUSE');
    const permissions = resolveMemberPermissions({
      roleCode,
      permissions: req.body?.permissions
    });

    if (
      roleCode === ROLE_CODES.GOD &&
      req.auth.roleCode !== ROLE_CODES.GOD
    ) {
      return res.status(403).json({
        ok: false,
        code: 'GOD_ROLE_REQUIRED',
        message: 'Solo una cuenta DIOS puede otorgar el rol DIOS.'
      });
    }

    if (!email && !externalAuthId) {
      return res.status(400).json({
        ok: false,
        code: 'IDENTITY_REQUIRED',
        message: 'Indica email o externalAuthId para provisionar al usuario.'
      });
    }

    const member = await withTransaction(async client => {
      let userResult;

      if (externalAuthId) {
        userResult = await client.query(
          `INSERT INTO users (
             external_auth_id,email,display_name,active
           ) VALUES ($1,$2,$3,true)
           ON CONFLICT (external_auth_id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, users.email),
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             active = true
           RETURNING id, external_auth_id, email, display_name, active, created_at`,
          [externalAuthId, email, displayName]
        );
      } else {
        const existing = await client.query(
          `SELECT id, external_auth_id, email, display_name, active, created_at
           FROM users
           WHERE lower(email) = lower($1)
           ORDER BY created_at ASC
           LIMIT 1`,
          [email]
        );

        if (existing.rowCount > 0) {
          userResult = existing;
          await client.query(
            `UPDATE users
             SET display_name = COALESCE($2, display_name),
                 active = true
             WHERE id = $1`,
            [existing.rows[0].id, displayName]
          );
        } else {
          userResult = await client.query(
            `INSERT INTO users (email,display_name,active)
             VALUES ($1,$2,true)
             RETURNING id, external_auth_id, email, display_name, active, created_at`,
            [email, displayName]
          );
        }
      }

      const user = userResult.rows[0];

      const membership = await client.query(
        `INSERT INTO workspace_members (
           workspace_id,user_id,role_code,permissions,active
         ) VALUES ($1,$2,$3,$4::jsonb,true)
         ON CONFLICT (workspace_id,user_id) DO UPDATE SET
           role_code = EXCLUDED.role_code,
           permissions = EXCLUDED.permissions,
           active = true
         RETURNING role_code, permissions, active, created_at`,
        [
          req.auth.workspaceId,
          user.id,
          roleCode,
          JSON.stringify(permissions)
        ]
      );

      await writeAuditEvent(client, req.auth, {
        action: 'MEMBER_PROVISIONED',
        entityType: 'workspaceMember',
        entityId: user.id,
        metadata: {
          roleCode,
          active: true
        }
      });

      return {
        userId: user.id,
        externalAuthId: user.external_auth_id,
        email: user.email,
        displayName: displayName || user.display_name,
        userActive: true,
        roleCode: membership.rows[0].role_code,
        permissions: membership.rows[0].permissions || [],
        membershipActive: membership.rows[0].active,
        createdAt: membership.rows[0].created_at
      };
    });

    res.status(201).json({ ok: true, member });
  } catch (error) {
    if (
      error?.message === 'Rol inválido' ||
      error?.message === 'Email inválido' ||
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

    const member = await withTransaction(async client => {
      const current = await client.query(
        `SELECT role_code
         FROM workspace_members
         WHERE workspace_id = $1
           AND user_id = $2
         FOR UPDATE`,
        [
          req.auth.workspaceId,
          targetUserId
        ]
      );

      if (current.rowCount === 0) return null;

      const currentRole =
        current.rows[0].role_code;

      if (
        currentRole === ROLE_CODES.GOD &&
        req.auth.roleCode !== ROLE_CODES.GOD
      ) {
        const error = new Error(
          'Una cuenta Administrador no puede modificar una cuenta DIOS.'
        );
        error.code = 'GOD_ROLE_REQUIRED';
        error.statusCode = 403;
        throw error;
      }

      if (
        roleCode === ROLE_CODES.GOD &&
        req.auth.roleCode !== ROLE_CODES.GOD
      ) {
        const error = new Error(
          'Solo una cuenta DIOS puede otorgar el rol DIOS.'
        );
        error.code = 'GOD_ROLE_REQUIRED';
        error.statusCode = 403;
        throw error;
      }

      if (
        targetUserId === req.auth.userId &&
        currentRole === ROLE_CODES.GOD &&
        roleCode !== ROLE_CODES.GOD
      ) {
        const error = new Error(
          'La cuenta DIOS no puede degradarse desde la interfaz; usa la consola del servidor para un cambio deliberado.'
        );
        error.code = 'GOD_SELF_DEMOTION_BLOCKED';
        error.statusCode = 400;
        throw error;
      }

      const result = await client.query(
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

      const row = result.rows[0];

      await writeAuditEvent(client, req.auth, {
        action: 'MEMBER_UPDATED',
        entityType: 'workspaceMember',
        entityId: targetUserId,
        metadata: {
          previousRoleCode: currentRole,
          roleCode: row.role_code,
          active: row.active,
          permissions: row.permissions || []
        }
      });

      return {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        roleCode: row.role_code,
        permissions: row.permissions || [],
        active: row.active
      };
    });

    if (!member) {
      return res.status(404).json({
        ok: false,
        code: 'MEMBER_NOT_FOUND',
        message: 'Miembro no encontrado en este almacén.'
      });
    }

    res.json({ ok: true, member });
  } catch (error) {
    if (error?.statusCode && error?.code) {
      return res.status(error.statusCode).json({
        ok: false,
        code: error.code,
        message: error.message
      });
    }

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

function mapMemberRow(row) {
  return {
    userId: row.user_id,
    externalAuthId: row.external_auth_id,
    email: row.email,
    displayName: row.display_name,
    userActive: row.user_active,
    roleCode: row.role_code,
    permissions: row.permissions || [],
    membershipActive: row.membership_active,
    createdAt: row.created_at
  };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email inválido');
  }

  return email;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}
