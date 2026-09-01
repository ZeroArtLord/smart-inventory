import {
  STORES,
  get,
  requestToPromise,
  runTransaction
} from '../storage/database.js';

const ENTITY_STORES = Object.freeze({
  product: STORES.PRODUCTS,
  category: STORES.CATEGORIES,
  supplier: STORES.SUPPLIERS,
  location: STORES.LOCATIONS,
  document: STORES.DOCUMENTS,
  documentLine: STORES.DOCUMENT_LINES,
  lot: STORES.LOTS,
  replenishment: STORES.REPLENISHMENTS,
  movement: STORES.MOVEMENTS
});

export async function applyRemoteEvents(events = []) {
  let applied = 0;

  for (const event of events) {
    const storeName = ENTITY_STORES[event.entityType];
    if (!storeName || !event.payload?.id) continue;

    if (event.entityType === 'movement') {
      const existing = await get(storeName, event.payload.id);
      if (existing) continue;

      await runTransaction(storeName, 'readwrite', store => {
        return requestToPromise(store.add(event.payload));
      });
      applied += 1;
      continue;
    }

    await runTransaction(storeName, 'readwrite', store => {
      return requestToPromise(store.put(event.payload));
    });
    applied += 1;
  }

  return applied;
}
