import { createLocalId } from '../core/ids.js';
import { MOVEMENT_TYPES } from '../core/movementTypes.js';
import {
  STORES,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import { calculateStock } from './stockEngine.js';
import {
  buildMovement,
  buildMovementSyncItem
} from './movementService.js';

export const QUICK_STOCK_CORRECTION_KIND = 'GOD_QUICK_STOCK_CORRECTION';

export async function previewQuickStockCorrection(
  productId,
  {
    targetStock,
    locationId = null
  } = {}
) {
  const id = clean(productId);
  if (!id) throw new Error('Producto no identificado');

  return runTransaction(
    [STORES.PRODUCTS, STORES.MOVEMENTS],
    'readonly',
    async (productStore, movementStore) => {
      const product = await requestToPromise(productStore.get(id));
      assertCorrectableProduct(product);

      const movements = await requestToPromise(
        movementStore.index('productId').getAll(id)
      );
      const currentStock = round(
        calculateStock(movements, id, { locationId })
      );
      const target = nonNegative(targetStock, 'Existencia física');

      return {
        product,
        productId: id,
        locationId: locationId || null,
        currentStock,
        targetStock: target,
        delta: round(target - currentStock),
        changeRatio: correctionRatio(currentStock, target)
      };
    }
  );
}

export async function applyQuickStockCorrection(
  productId,
  {
    targetStock,
    reason,
    userId = null,
    roleCode = null,
    locationId = null,
    context = null
  } = {}
) {
  assertGod(roleCode);
  const id = clean(productId);
  if (!id) throw new Error('Producto no identificado');

  const normalizedReason = clean(reason);
  if (normalizedReason.length < 4) {
    throw new Error('Indica un motivo claro para corregir la existencia');
  }

  const normalizedContext = normalizeContext(context);

  return runTransaction(
    [STORES.PRODUCTS, STORES.MOVEMENTS, STORES.SYNC_QUEUE],
    'readwrite',
    async (productStore, movementStore, queueStore) => {
      const product = await requestToPromise(productStore.get(id));
      assertCorrectableProduct(product);

      const movements = await requestToPromise(
        movementStore.index('productId').getAll(id)
      );
      const currentStock = round(
        calculateStock(movements, id, { locationId })
      );
      const target = nonNegative(targetStock, 'Existencia física');
      const delta = round(target - currentStock);

      if (almostEqual(delta, 0)) {
        throw new Error('La existencia física coincide con el stock VIGÍA; no hace falta ajustar');
      }

      const now = new Date().toISOString();
      const correctionId = createLocalId('quick_stock');
      const movement = buildMovement({
        productId: id,
        type: MOVEMENT_TYPES.ADJUSTMENT,
        quantity: 0,
        delta,
        documentId: null,
        locationId: locationId || null,
        userId,
        effectiveAt: now,
        metadata: {
          quickStockCorrectionKind: QUICK_STOCK_CORRECTION_KIND,
          correctionId,
          reason: normalizedReason,
          authorizedRole: 'GOD',
          stockBeforeDecision: currentStock,
          targetStock: target,
          delta,
          source: normalizedContext?.source || 'CATALOG',
          contextDocumentId: normalizedContext?.documentId || null,
          contextDocumentType: normalizedContext?.documentType || null,
          contextProductId: id,
          correctedAt: now
        }
      });

      await requestToPromise(movementStore.add(movement));
      await requestToPromise(queueStore.add(buildMovementSyncItem(movement)));

      return {
        correctionId,
        movement,
        product,
        productId: id,
        locationId: locationId || null,
        currentStock,
        targetStock: target,
        delta,
        changeRatio: correctionRatio(currentStock, target),
        reason: normalizedReason,
        context: normalizedContext
      };
    }
  );
}

function assertGod(roleCode) {
  if (String(roleCode || '').trim().toUpperCase() !== 'GOD') {
    throw new Error('Solo el rol DIOS puede corregir stock directamente');
  }
}

function assertCorrectableProduct(product) {
  if (!product) throw new Error('Producto no encontrado');
  if (product.saintBridgeSource === true) {
    throw new Error(
      'El producto fuente del puente SAINT es técnico y no admite corrección directa'
    );
  }
  if (product.active === false) {
    throw new Error('El producto está inactivo y no admite corrección directa');
  }
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object') return null;
  return {
    source: clean(context.source || 'CATALOG').toUpperCase(),
    documentId: clean(context.documentId) || null,
    documentType: clean(context.documentType).toUpperCase() || null
  };
}

function nonNegative(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label}: cantidad inválida`);
  }
  return round(number);
}

function correctionRatio(current, target) {
  const before = Math.abs(Number(current || 0));
  const delta = Math.abs(Number(target || 0) - Number(current || 0));
  if (before <= 0.000001) return delta > 0 ? 1 : 0;
  return delta / before;
}

function almostEqual(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= 0.000001;
}

function round(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 1e6) / 1e6;
}

function clean(value) {
  return String(value ?? '').trim();
}
