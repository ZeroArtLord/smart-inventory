import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { writeAuditEvent } from '../audit/auditService.js';

export const areasRouter = Router();

areasRouter.get('/', async (req, res, next) => {
  try {
    const includeInactive = ['1', 'true', 'yes'].includes(
      String(req.query.includeInactive || '').toLowerCase()
    );

    const result = await pool.query(
      `SELECT id,name,active,sort_order,created_at,updated_at
       FROM areas
       WHERE workspace_id = $1
         AND ($2::boolean OR active = true)
       ORDER BY sort_order ASC, lower(name) ASC, id ASC`,
      [req.auth.workspaceId, includeInactive]
    );

    res.json({
      ok: true,
      areas: result.rows.map(mapAreaRow)
    });
  } catch (error) {
    next(error);
  }
});

areasRouter.post(
  '/',
  requirePermission(PERMISSIONS.CATALOG_WRITE),
  async (req, res, next) => {
    try {
      const name = normalizeName(req.body?.name);
      const sortOrder = normalizeSortOrder(req.body?.sortOrder);
      const id = `area_${randomUUID()}`;
      const normalized = normalizeSearchText(name);

      const area = await withTransaction(async client => {
        try {
          const result = await client.query(
            `INSERT INTO areas (
               workspace_id,id,name,name_normalized,active,sort_order
             ) VALUES ($1,$2,$3,$4,true,$5)
             RETURNING id,name,active,sort_order,created_at,updated_at`,
            [req.auth.workspaceId, id, name, normalized, sortOrder]
          );

          await writeAuditEvent(client, req.auth, {
            action: 'AREA_CREATED',
            entityType: 'area',
            entityId: id,
            metadata: { name, sortOrder }
          });

          return mapAreaRow(result.rows[0]);
        } catch (error) {
          if (error?.code === '23505') {
            const duplicate = new Error('Ya existe un área con ese nombre');
            duplicate.code = 'AREA_NAME_DUPLICATE';
            duplicate.statusCode = 409;
            throw duplicate;
          }
          throw error;
        }
      });

      res.status(201).json({ ok: true, area });
    } catch (error) {
      if (error?.code === 'AREA_INVALID') {
        error.statusCode = 400;
      }
      next(error);
    }
  }
);

areasRouter.patch(
  '/:areaId',
  requirePermission(PERMISSIONS.CATALOG_WRITE),
  async (req, res, next) => {
    try {
      const areaId = String(req.params.areaId || '').trim();
      if (!areaId) {
        const error = new Error('Área inválida');
        error.code = 'AREA_INVALID';
        error.statusCode = 400;
        throw error;
      }

      const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');
      const hasActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'active');
      const hasSortOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'sortOrder');

      if (!hasName && !hasActive && !hasSortOrder) {
        const error = new Error('No hay cambios para aplicar');
        error.code = 'AREA_INVALID';
        error.statusCode = 400;
        throw error;
      }

      const area = await withTransaction(async client => {
        const current = await client.query(
          `SELECT id,name,active,sort_order
           FROM areas
           WHERE workspace_id = $1 AND id = $2
           FOR UPDATE`,
          [req.auth.workspaceId, areaId]
        );

        if (current.rowCount !== 1) {
          const error = new Error('Área no encontrada');
          error.code = 'AREA_NOT_FOUND';
          error.statusCode = 404;
          throw error;
        }

        const previous = current.rows[0];
        const name = hasName ? normalizeName(req.body.name) : previous.name;
        const active = hasActive ? req.body.active !== false : previous.active;
        const sortOrder = hasSortOrder
          ? normalizeSortOrder(req.body.sortOrder)
          : Number(previous.sort_order || 0);

        try {
          const updated = await client.query(
            `UPDATE areas
             SET name = $3,
                 name_normalized = $4,
                 active = $5,
                 sort_order = $6,
                 updated_at = now()
             WHERE workspace_id = $1 AND id = $2
             RETURNING id,name,active,sort_order,created_at,updated_at`,
            [
              req.auth.workspaceId,
              areaId,
              name,
              normalizeSearchText(name),
              active,
              sortOrder
            ]
          );

          await writeAuditEvent(client, req.auth, {
            action: 'AREA_UPDATED',
            entityType: 'area',
            entityId: areaId,
            metadata: {
              before: {
                name: previous.name,
                active: previous.active,
                sortOrder: Number(previous.sort_order || 0)
              },
              after: { name, active, sortOrder }
            }
          });

          return mapAreaRow(updated.rows[0]);
        } catch (error) {
          if (error?.code === '23505') {
            const duplicate = new Error('Ya existe un área con ese nombre');
            duplicate.code = 'AREA_NAME_DUPLICATE';
            duplicate.statusCode = 409;
            throw duplicate;
          }
          throw error;
        }
      });

      res.json({ ok: true, area });
    } catch (error) {
      if (error?.code === 'AREA_INVALID' && !error.statusCode) {
        error.statusCode = 400;
      }
      next(error);
    }
  }
);

function mapAreaRow(row) {
  return {
    id: row.id,
    name: row.name,
    active: row.active !== false,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    const error = new Error('El nombre del área debe tener entre 2 y 80 caracteres');
    error.code = 'AREA_INVALID';
    throw error;
  }
  return name;
}

function normalizeSortOrder(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 100000) {
    const error = new Error('El orden del área debe ser un entero entre 0 y 100000');
    error.code = 'AREA_INVALID';
    throw error;
  }
  return number;
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
