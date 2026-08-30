const DB_NAME = 'smart_inventory_v2';
const DB_VERSION = 2;

export const STORES = Object.freeze({
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  UNITS: 'units',
  SUPPLIERS: 'suppliers',
  LOCATIONS: 'locations',
  MOVEMENTS: 'movements',
  DOCUMENTS: 'documents',
  LOTS: 'lots',
  SYNC_QUEUE: 'syncQueue',
  SETTINGS: 'settings'
});

let dbPromise = null;

export function openDatabase() {
  if (!dbPromise) dbPromise = createDatabase();
  return dbPromise;
}

function createDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;

      const products = ensureStore(db, tx, STORES.PRODUCTS, 'id');
      ensureIndex(products, 'name', 'name');
      ensureIndex(products, 'nameNormalized', 'nameNormalized');
      ensureIndex(products, 'categoryId', 'categoryId');
      ensureIndex(products, 'barcode', 'barcode');
      ensureIndex(products, 'sku', 'sku');

      const categories = ensureStore(db, tx, STORES.CATEGORIES, 'id');
      ensureIndex(categories, 'nameNormalized', 'nameNormalized');

      const units = ensureStore(db, tx, STORES.UNITS, 'id');
      ensureIndex(units, 'code', 'code');

      const suppliers = ensureStore(db, tx, STORES.SUPPLIERS, 'id');
      ensureIndex(suppliers, 'nameNormalized', 'nameNormalized');

      const locations = ensureStore(db, tx, STORES.LOCATIONS, 'id');
      ensureIndex(locations, 'nameNormalized', 'nameNormalized');

      const movements = ensureStore(db, tx, STORES.MOVEMENTS, 'id');
      ensureIndex(movements, 'productId', 'productId');
      ensureIndex(movements, 'createdAt', 'createdAt');
      ensureIndex(movements, 'documentId', 'documentId');
      ensureIndex(movements, 'type', 'type');
      ensureIndex(movements, 'reversedMovementId', 'reversedMovementId');

      const documents = ensureStore(db, tx, STORES.DOCUMENTS, 'id');
      ensureIndex(documents, 'type', 'type');
      ensureIndex(documents, 'status', 'status');
      ensureIndex(documents, 'createdAt', 'createdAt');
      ensureIndex(documents, 'ownerId', 'ownerId');

      const lots = ensureStore(db, tx, STORES.LOTS, 'id');
      ensureIndex(lots, 'productId', 'productId');
      ensureIndex(lots, 'expiresAt', 'expiresAt');
      ensureIndex(lots, 'lotNumber', 'lotNumber');

      const syncQueue = ensureStore(db, tx, STORES.SYNC_QUEUE, 'id');
      ensureIndex(syncQueue, 'status', 'status');
      ensureIndex(syncQueue, 'createdAt', 'createdAt');
      ensureIndex(syncQueue, 'entityId', 'entityId');

      ensureStore(db, tx, STORES.SETTINGS, 'key');
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
    request.onblocked = () => reject(new Error('La actualización de IndexedDB está bloqueada por otra pestaña'));
  });
}

function ensureStore(db, tx, name, keyPath) {
  if (!db.objectStoreNames.contains(name)) {
    return db.createObjectStore(name, { keyPath });
  }
  return tx.objectStore(name);
}

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

export async function put(storeName, value) {
  return runTransaction(storeName, 'readwrite', store => requestToPromise(store.put(value)));
}

export async function get(storeName, key) {
  return runTransaction(storeName, 'readonly', store => requestToPromise(store.get(key)));
}

export async function getAll(storeName) {
  return runTransaction(storeName, 'readonly', store => requestToPromise(store.getAll()));
}

export async function getAllByIndex(storeName, indexName, key) {
  return runTransaction(storeName, 'readonly', store => {
    return requestToPromise(store.index(indexName).getAll(key));
  });
}

export async function remove(storeName, key) {
  return runTransaction(storeName, 'readwrite', store => requestToPromise(store.delete(key)));
}

export async function runTransaction(storeNames, mode, operation) {
  const db = await openDatabase();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let operationResult;

    try {
      const stores = names.map(name => tx.objectStore(name));
      operationResult = operation(...stores, tx);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }

    tx.oncomplete = async () => {
      try {
        resolve(await operationResult);
      } catch (error) {
        reject(error);
      }
    };
    tx.onerror = () => reject(tx.error || new Error('Error de transacción IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('Transacción IndexedDB cancelada'));
  });
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Operación IndexedDB fallida'));
  });
}
