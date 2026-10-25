// Proyección SOLO LECTURA de la semana Monitor en Comprar/Pedir tradicional.
// Nunca genera reposiciones V2 ni movimientos de stock. Fuente: Monitor PostgreSQL;
// sobre esa foto se superponen exclusivamente las ediciones locales todavía en cola.
export function projectMonitorToNormal({ serverItems = [], localState = null, products = [], categories = [], weekStart = '', round = 1 } = {}) {
  const byProduct = new Map(products.map(p => [String(p.id), p]));
  const byCategory = new Map(categories.map(c => [String(c.id), c]));
  const merged = new Map();
  for (const item of serverItems) {
    if (item && typeof item.itemKey === 'string') merged.set(item.itemKey, item);
  }

  // El estado local puede contener una copia remota antigua: NO usarla para
  // reemplazar el servidor. Solo superponer operaciones pendientes/conflictivas.
  const localChanges = (localState?.items || []).filter(x => x?.localOnly === true);
  for (const item of localChanges) {
    if (item && typeof item.itemKey === 'string') {
      merged.set(item.itemKey, item);
    }
  }

  const lists = { PURCHASE: [], ORDER: [], INQUIRY: [] };
  const counts = { pendingLocal: 0, conflicts: 0, unresolvedProducts: 0,
    reviewed: 0, pending: 0, asking: 0, notNeeded: 0, totalProducts: products.length };
  for (const item of merged.values()) {
    if (item.deleted === true) continue;
    if (item.kind === 'PRODUCT') {
      if (['BUY', 'ORDER', 'NOT_NEEDED'].includes(item.decision)) counts.reviewed++;
      if (item.decision === 'PENDING') counts.pending++;
      if (item.decision === 'ASK') counts.asking++;
      if (item.decision === 'NOT_NEEDED') counts.notNeeded++;
    }
    if (!['BUY', 'ORDER', 'ASK'].includes(item.decision)) continue;
    const isExtra = item.kind === 'EXTRA';
    const product = isExtra ? null : byProduct.get(String(item.productId));
    const category = isExtra ? 'EXTRAS' : (
      byCategory.get(String(product?.categoryId || ''))?.name || 'SIN CATEGORÍA'
    );
    if (!isExtra && !product) counts.unresolvedProducts++;
    const quantity = item.quantity === null || item.quantity === '' || item.quantity === undefined
      ? null : Number(item.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      // No imprimir una cantidad alterada o errónea: fallar con aviso, sin modificar origen.
      throw new Error('Cantidad Monitor inválida en ' + item.itemKey);
    }
    const row = {
      itemKey: item.itemKey,
      kind: item.kind,
      productId: item.productId || null,
      description: isExtra ? String(item.description || '') : String(product?.name || '[PRODUCTO NO EN CATÁLOGO] ' + item.productId),
      category: String(category),
      quantity,
      unit: String(item.unit || product?.unitCode || ''),
      notes: String(item.notes || ''),
      updatedAt: item.updatedAt || null,
      version: item.version || 0,
      localOnly: item.localOnly === true,
      localStatus: item.localStatus || null
    };
    if (row.localOnly) {
      if (row.localStatus === 'CONFLICT') counts.conflicts++;
      else counts.pendingLocal++;
    }
    lists[item.decision === 'BUY' ? 'PURCHASE' : item.decision === 'ORDER' ? 'ORDER' : 'INQUIRY'].push(row);
  }
  // La cola también puede contener NO HACE FALTA o PENDIENTE sin figurar
  // en tickets. Cualquier cambio no enviado impide declarar la copia "sincronizada".
  if (Number.isSafeInteger(localState?.pendingCount)) {
    counts.pendingLocal = localState.pendingCount;
  }
  if (Number.isSafeInteger(localState?.conflictCount)) {
    counts.conflicts = localState.conflictCount;
  }
  for (const list of Object.values(lists)) {
    list.sort((a, b) => a.category.localeCompare(b.category, 'es') ||
      a.description.localeCompare(b.description, 'es') ||
      a.itemKey.localeCompare(b.itemKey));
  }
  return {
    weekStart,round,lists, counts,
    source: 'monitor-weekly-review',
    readOnly: true
  };
}
