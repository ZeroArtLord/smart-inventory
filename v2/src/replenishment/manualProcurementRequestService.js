import {
  listProducts,
  updateProduct
} from '../catalog/catalogService.js';

export async function setManualProcurementRequested(
  productId,
  requested,
  {
    userId = null,
    source = 'COUNT'
  } = {}
) {
  const enabled = requested === true;

  return updateProduct(productId, {
    manualProcurementRequested: enabled,
    manualProcurementRequestedAt:
      enabled
        ? new Date().toISOString()
        : null,
    manualProcurementRequestedBy:
      enabled
        ? (String(userId || '').trim() || null)
        : null,
    manualProcurementRequestedSource:
      enabled
        ? (String(source || 'COUNT').trim() || 'COUNT')
        : null
  });
}

export async function listManualProcurementRequestedProducts() {
  const products = await listProducts();

  return products.filter(product =>
    product?.active !== false &&
    product?.manualProcurementRequested === true
  );
}

export async function clearManualProcurementRequests(
  productIds = [],
  options = {}
) {
  const ids = [...new Set(
    (Array.isArray(productIds) ? productIds : [productIds])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];

  const updated = [];

  for (const productId of ids) {
    updated.push(
      await setManualProcurementRequested(
        productId,
        false,
        options
      )
    );
  }

  return updated;
}
