export function allocateLotsFefo(lots, requestedQuantity, { locationId = null } = {}) {
  const quantity = Number(requestedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('La cantidad a surtir debe ser mayor que cero');
  }

  const candidates = (Array.isArray(lots) ? lots : [])
    .filter(lot => Number(lot.remainingQuantity || 0) > 0)
    .filter(lot => {
      if (!locationId) return true;
      return (lot.locationId || null) === locationId;
    })
    .sort(compareFefo);

  let remaining = quantity;
  const allocations = [];

  for (const lot of candidates) {
    if (remaining <= 0) break;

    const available = Number(lot.remainingQuantity || 0);
    if (!(available > 0)) continue;

    const allocated = Math.min(available, remaining);

    allocations.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber || '',
      expiresAt: lot.expiresAt || null,
      quantity: allocated,
      beforeRemaining: available,
      afterRemaining: available - allocated
    });

    remaining -= allocated;
  }

  return {
    requestedQuantity: quantity,
    allocatedQuantity: quantity - remaining,
    untrackedQuantity: remaining,
    allocations
  };
}

export function compareFefo(a, b) {
  const aExpiry = timestampOrInfinity(a?.expiresAt);
  const bExpiry = timestampOrInfinity(b?.expiresAt);

  if (aExpiry !== bExpiry) return aExpiry - bExpiry;

  const aReceived = timestampOrInfinity(a?.receivedAt);
  const bReceived = timestampOrInfinity(b?.receivedAt);

  if (aReceived !== bReceived) return aReceived - bReceived;

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function timestampOrInfinity(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}
