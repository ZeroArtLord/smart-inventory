import { Router } from 'express';

export const sessionRouter = Router();

sessionRouter.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    session: {
      workspaceId: req.auth.workspaceId,
      userId: req.auth.userId,
      externalAuthId: req.auth.externalAuthId || null,
      email: req.auth.email || null,
      roleCode: req.auth.roleCode,
      permissions: req.auth.permissions || [],
      authMode: req.auth.authMode
    }
  });
});
