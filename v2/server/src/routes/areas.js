import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { PERMISSIONS } from '../security/permissions.js';
import { assertOperationalDocumentOwnership } from '../security/operationalOwnership.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { writeAuditEvent } from '../audit/auditService.js';

export const areasRouter = Router();
const EPSILON = 0.000001;

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

areasRouter.get('/deliveries', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    if (from && !Number.isFinite(from.getTime())) {
      return res.status(400).json({
        ok: false,
        code: 'AREA_DELIVERY_DATE_INVALID',
        message: 'Fecha inicial inválida'
      });
    }

    const result = await pool.query(
      `SELECT delivery_token,delivery_id,parent_cart_id,payload,closed_at,
              created_by,created_at,updated_at
       FROM supply_area_deliveries
       WHERE workspace_id = $1
         AND ($2::timestamptz IS NULL OR closed_at >= $2::timestamptz)
       ORDER BY closed_at DESC
       LIMIT 5000`,
      [req.auth.workspaceId, from ? from.toISOString() : null]
    );

    res.json({
      ok: true,
      deliveries: result.rows.map(mapDeliveryRow)
    });
  } catch (error) {
    next(error);
  }
});

areasRouter.post(
  '/deliveries',
  requirePermission(PERMISSIONS.SUPPLY_WRITE),
  async (req, res, next) => {
    try {
      const delivery = await normalizeDeliveryPayload(req.body, req.auth.workspaceId);

      const saved = await withTransaction(async client => {
        const current = await client.query(
          `SELECT delivery_token,delivery_id,parent_cart_id,payload,closed_at,
                  created_by,created_at,updated_at
           FROM supply_area_deliveries
           WHERE workspace_id = $1 AND delivery_token = $2
           FOR UPDATE`,
          [req.auth.workspaceId, delivery.deliveryToken]
        );

        if (current.rowCount === 1) {
          const existing = mapDeliveryRow(current.rows[0]);
          if (canonicalDelivery(existing) !== canonicalDelivery(delivery)) {
            const error = new Error(
              'Ese token de entrega ya tiene otra distribución por áreas'
            );
            error.code = 'AREA_DELIVERY_TOKEN_MISMATCH';
            error.statusCode = 409;
            throw error;
          }
          return existing;
        }

        const result = await client.query(
          `INSERT INTO supply_area_deliveries (
             workspace_id,delivery_token,delivery_id,parent_cart_id,payload,
             closed_at,created_by
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
           RETURNING delivery_token,delivery_id,parent_cart_id,payload,closed_at,
                     created_by,created_at,updated_at`,
          [
            req.auth.workspaceId,
            delivery.deliveryToken,
            delivery.deliveryId,
            delivery.parentCartId,
            JSON.stringify({ rows: delivery.rows }),
            delivery.closedAt,
            req.auth.userId || null
          ]
        );

        await writeAuditEvent(client, req.auth, {
          action: 'SUPPLY_AREA_ALLOCATION_RECORDED',
          entityType: 'supplyAreaDelivery',
          entityId: delivery.deliveryToken,
          metadata: {
            deliveryId: delivery.deliveryId,
            parentCartId: delivery.parentCartId,
            rowCount: delivery.rows.length,
            allocationCount: delivery.rows.reduce(
              (sum, row) => sum + row.allocations.length,
              0
            )
          }
        });

        return mapDeliveryRow(result.rows[0]);
      });

      res.status(201).json({ ok: true, delivery: saved });
    } catch (error) {
      next(error);
    }
  }
);

areasRouter.get(
  '/drafts',
  requirePermission(PERMISSIONS.SUPPLY_WRITE),
  async (req, res, next) => {
    try {
      const parentCartId = requiredText(
        req.query.parentCartId,
        'Surtido requerido para consultar distribuciones pendientes',
        220
      );

      await assertOperationalDocumentOwnership(pool, req.auth, parentCartId, {
        expectedType: 'SUPPLY'
      });

      const result = await pool.query(
        `SELECT parent_cart_id,product_id,product_name,quantity,allocations,
                updated_by,created_at,updated_at
         FROM supply_area_drafts
         WHERE workspace_id = $1 AND parent_cart_id = $2
         ORDER BY updated_at ASC, product_id ASC`,
        [req.auth.workspaceId, parentCartId]
      );

      res.json({
        ok: true,
        drafts: result.rows.map(mapDraftRow)
      });
    } catch (error) {
      next(error);
    }
  }
);

areasRouter.put(
  '/drafts/:parentCartId/:productId',
  requirePermission(PERMISSIONS.SUPPLY_WRITE),
  async (req, res, next) => {
    try {
      const parentCartId = requiredText(
        req.params.parentCartId,
        'Surtido requerido para guardar distribución',
        220
      );

      await assertOperationalDocumentOwnership(pool, req.auth, parentCartId, {
        expectedType: 'SUPPLY'
      });

      const draft = await normalizeAreaDraftPayload(
        {
          ...req.body,
          parentCartId,
          productId: req.params.productId
        },
        req.auth.workspaceId
      );

      const saved = await withTransaction(async client => {
        const result = await client.query(
          `INSERT INTO supply_area_drafts (
             workspace_id,parent_cart_id,product_id,product_name,quantity,
             allocations,updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           ON CONFLICT (workspace_id,parent_cart_id,product_id)
           DO UPDATE SET
             product_name = EXCLUDED.product_name,
             quantity = EXCLUDED.quantity,
             allocations = EXCLUDED.allocations,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
           RETURNING parent_cart_id,product_id,product_name,quantity,allocations,
                     updated_by,created_at,updated_at`,
          [
            req.auth.workspaceId,
            draft.parentCartId,
            draft.productId,
            draft.productName,
            draft.quantity,
            JSON.stringify(draft.allocations),
            req.auth.userId || null
          ]
        );

        await writeAuditEvent(client, req.auth, {
          action: 'SUPPLY_AREA_DRAFT_SAVED',
          entityType: 'supplyAreaDraft',
          entityId: `${draft.parentCartId}:${draft.productId}`,
          metadata: {
            parentCartId: draft.parentCartId,
            productId: draft.productId,
            quantity: draft.quantity,
            allocationCount: draft.allocations.length
          }
        });

        return mapDraftRow(result.rows[0]);
      });

      res.json({ ok: true, draft: saved });
    } catch (error) {
      next(error);
    }
  }
);

areasRouter.delete(
  '/drafts',
  requirePermission(PERMISSIONS.SUPPLY_WRITE),
  async (req, res, next) => {
    try {
      const parentCartId = requiredText(
        req.body?.parentCartId,
        'Surtido requerido para limpiar distribuciones pendientes',
        220
      );

      await assertOperationalDocumentOwnership(pool, req.auth, parentCartId, {
        expectedType: 'SUPPLY'
      });

      const productIds = [...new Set(
        (Array.isArray(req.body?.productIds) ? req.body.productIds : [])
          .map(value => requiredText(value, 'Producto inválido', 220))
      )];

      if (!productIds.length || productIds.length > 250) {
        throw badDelivery('Indica entre 1 y 250 productos para limpiar');
      }

      const deleted = await withTransaction(async client => {
        const result = await client.query(
          `DELETE FROM supply_area_drafts
           WHERE workspace_id = $1
             AND parent_cart_id = $2
             AND product_id = ANY($3::text[])
           RETURNING product_id`,
          [req.auth.workspaceId, parentCartId, productIds]
        );

        if (result.rowCount > 0) {
          await writeAuditEvent(client, req.auth, {
            action: 'SUPPLY_AREA_DRAFT_DELETED',
            entityType: 'supplyAreaDraft',
            entityId: parentCartId,
            metadata: {
              parentCartId,
              productIds: result.rows.map(row => row.product_id),
              deletedCount: result.rowCount
            }
          });
        }

        return result.rowCount;
      });

      res.json({ ok: true, deleted });
    } catch (error) {
      next(error);
    }
  }
);

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

async function normalizeDeliveryPayload(body = {}, workspaceId) {
  const deliveryToken = requiredText(body.deliveryToken, 'Token de entrega requerido', 220);
  const deliveryId = requiredText(body.deliveryId, 'Entrega requerida', 220);
  const parentCartId = requiredText(body.parentCartId, 'Carrito padre requerido', 220);
  const closedAtDate = new Date(body.closedAt);
  if (!Number.isFinite(closedAtDate.getTime())) {
    throw badDelivery('Fecha de entrega inválida');
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > 250) {
    throw badDelivery('La distribución debe contener entre 1 y 250 productos');
  }

  const areaIds = new Set();
  const normalizedRows = rows.map(row => {
    const productId = requiredText(row?.productId, 'Producto requerido', 220);
    const productName = requiredText(row?.productName || productId, 'Producto inválido', 240);
    const quantity = positiveNumber(row?.quantity, 'Cantidad de producto inválida');
    const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
    if (!allocations.length || allocations.length > 100) {
      throw badDelivery(`Distribución inválida para ${productName}`);
    }

    const uniqueAreas = new Set();
    const normalizedAllocations = allocations.map(item => {
      const areaId = requiredText(item?.areaId, 'Área requerida', 220);
      if (uniqueAreas.has(areaId)) {
        throw badDelivery(`Área repetida en ${productName}`);
      }
      uniqueAreas.add(areaId);
      areaIds.add(areaId);
      return {
        areaId,
        areaName: '',
        quantity: positiveNumber(item?.quantity, 'Cantidad de área inválida')
      };
    });

    const total = normalizedAllocations.reduce((sum, item) => sum + item.quantity, 0);
    if (Math.abs(total - quantity) > EPSILON) {
      throw badDelivery(`Las áreas de ${productName} deben sumar ${quantity}`);
    }

    return { productId, productName, quantity, allocations: normalizedAllocations };
  });

  const areaResult = await pool.query(
    `SELECT id,name,active
     FROM areas
     WHERE workspace_id = $1 AND id = ANY($2::text[])`,
    [workspaceId, [...areaIds]]
  );
  const areaById = new Map(areaResult.rows.map(area => [area.id, area]));

  for (const row of normalizedRows) {
    for (const allocation of row.allocations) {
      const area = areaById.get(allocation.areaId);
      if (!area || area.active !== true) {
        throw badDelivery(`El área ${allocation.areaId} no está activa en este workspace`);
      }
      allocation.areaName = area.name;
    }
  }

  return {
    deliveryToken,
    deliveryId,
    parentCartId,
    closedAt: closedAtDate.toISOString(),
    rows: normalizedRows
  };
}

async function normalizeAreaDraftPayload(body = {}, workspaceId) {
  const parentCartId = requiredText(
    body.parentCartId,
    'Surtido requerido para guardar distribución',
    220
  );
  const productId = requiredText(body.productId, 'Producto requerido', 220);
  const productName = requiredText(
    body.productName || productId,
    'Nombre de producto inválido',
    240
  );
  const quantity = positiveNumber(body.quantity, 'Cantidad de surtido inválida');
  const sourceAllocations = Array.isArray(body.allocations) ? body.allocations : [];
  if (sourceAllocations.length > 100) {
    throw badDelivery(`Demasiadas áreas para ${productName}`);
  }

  const areaIds = new Set();
  const allocations = sourceAllocations.map(item => {
    const areaId = requiredText(item?.areaId, 'Área requerida', 220);
    if (areaIds.has(areaId)) {
      throw badDelivery(`Área repetida en ${productName}`);
    }
    areaIds.add(areaId);
    return {
      areaId,
      areaName: '',
      quantity: positiveNumber(item?.quantity, 'Cantidad de área inválida')
    };
  });

  if (areaIds.size) {
    const areaResult = await pool.query(
      `SELECT id,name,active
       FROM areas
       WHERE workspace_id = $1 AND id = ANY($2::text[])`,
      [workspaceId, [...areaIds]]
    );
    const areaById = new Map(areaResult.rows.map(area => [area.id, area]));

    for (const allocation of allocations) {
      const area = areaById.get(allocation.areaId);
      if (!area || area.active !== true) {
        throw badDelivery(`El área ${allocation.areaId} no está activa en este workspace`);
      }
      allocation.areaName = area.name;
    }
  }

  return {
    parentCartId,
    productId,
    productName,
    quantity,
    allocations
  };
}

function mapDeliveryRow(row) {
  return {
    deliveryToken: row.delivery_token,
    deliveryId: row.delivery_id,
    parentCartId: row.parent_cart_id,
    rows: Array.isArray(row.payload?.rows) ? row.payload.rows : [],
    closedAt: row.closed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDraftRow(row) {
  return {
    parentCartId: row.parent_cart_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    allocations: Array.isArray(row.allocations) ? row.allocations : [],
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function canonicalDelivery(delivery) {
  const rows = (delivery.rows || [])
    .map(row => ({
      productId: row.productId,
      quantity: Number(row.quantity),
      allocations: (row.allocations || [])
        .map(item => ({ areaId: item.areaId, quantity: Number(item.quantity) }))
        .sort((a, b) => a.areaId.localeCompare(b.areaId))
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return JSON.stringify({
    deliveryId: delivery.deliveryId,
    parentCartId: delivery.parentCartId,
    rows
  });
}

function badDelivery(message) {
  const error = new Error(message);
  error.code = 'AREA_DELIVERY_INVALID';
  error.statusCode = 400;
  return error;
}

function requiredText(value, message, maxLength) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw badDelivery(message);
  return text;
}

function positiveNumber(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw badDelivery(message);
  return number;
}

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
