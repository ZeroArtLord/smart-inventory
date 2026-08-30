import { Router } from 'express';
import { config } from '../config.js';
import { withTransaction } from '../db.js';

export const devRouter = Router();

devRouter.post('/bootstrap', async (req, res, next) => {
  try {
    if (!config.devAllowHeaderAuth || config.nodeEnv === 'production') {
      return res.status(404).json({ ok: false, message: 'No disponible' });
    }

    const workspaceKey = normalizeKey(req.body?.workspaceKey || 'establo2026');
    const externalUserId = String(req.body?.externalUserId || '').trim();
    const displayName = String(req.body?.displayName || 'Usuario local').trim();

    if (!externalUserId) {
      return res.status(400).json({
        ok: false,
        code: 'EXTERNAL_USER_REQUIRED',
        message: 'Falta externalUserId'
      });
    }

    const result = await withTransaction(async client => {
      const workspaceResult = await client.query(
        `INSERT INTO workspaces (name, workspace_key)
         VALUES ($1, $2)
         ON CONFLICT (workspace_key) DO UPDATE SET
           active = true
         RETURNING id, name, workspace_key`,
        ['Smart Inventory Development', workspaceKey]
      );

      const workspace = workspaceResult.rows[0];

      const userResult = await client.query(
        `INSERT INTO users (external_auth_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (external_auth_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           active = true
         RETURNING id, external_auth_id, display_name`,
        [externalUserId, displayName]
      );

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO workspace_members (
          workspace_id, user_id, role_code, permissions, active
        ) VALUES ($1, $2, 'DEV_ADMIN', '["*"]'::jsonb, true)
        ON CONFLICT (workspace_id, user_id) DO UPDATE SET
          role_code = 'DEV_ADMIN',
          permissions = '["*"]'::jsonb,
          active = true`,
        [workspace.id, user.id]
      );

      return { workspace, user };
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

function normalizeKey(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!key) throw new Error('workspaceKey inválido');
  return key.slice(0, 80);
}
