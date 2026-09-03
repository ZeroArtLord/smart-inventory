import {
  STORES,
  get,
  requestToPromise,
  runTransaction
} from '../storage/database.js';
import {
  reconstructSaintInitialLoad
} from '../catalog/saintInitialLoad.js';

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
    if (
      event.entityType === 'initialLoad' &&
      event.payload?.id
    ) {
      applied += await applyInitialLoadRemoteEvent(event);
      continue;
    }

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

async function applyInitialLoadRemoteEvent(event) {
  const {
    document,
    lines,
    movements
  } = reconstructSaintInitialLoad(event);

  let applied = 0;

  await runTransaction(
    [
      STORES.DOCUMENTS,
      STORES.DOCUMENT_LINES,
      STORES.MOVEMENTS
    ],
    'readwrite',
    async (
      documentStore,
      lineStore,
      movementStore
    ) => {
      await requestToPromise(
        documentStore.put(document)
      );

      for (const line of lines) {
        await requestToPromise(
          lineStore.put(line)
        );
      }

      for (const movement of movements) {
        const existing = await requestToPromise(
          movementStore.get(movement.id)
        );

        if (existing) continue;

        await requestToPromise(
          movementStore.add(movement)
        );
      }
    }
  );

  applied += 1;
  return applied;
}
