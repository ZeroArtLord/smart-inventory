const DB_NAME = 'smart_inventory_v2';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  PRODUCTS: 'products',
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

      createStore(db, STORES.PRODUCTS, 'id', [
        ['name', 'name'],
        ['categoryId', 'categoryId'],
        ['barcode', 'barcode', { unique: false }]
      ]);

      createStore(db, STORES.MOVEMENTS, 'id', [
        ['productId', 'productId'],
        ['createdAt', 'createdAt'],
        ['documentId', 'documentId'],
        ['type', 'type']
      ]);

      createStore(db, STORES.DOCUMENTS, 'id', [
        ['type', 'type'],
        ['status', 'status'],
        ['createdAt', 'createdAt'],
        ['ownerId', 'ownerId']
      ]);

      createStore(db, STORES.LOTS, 'id', [
        ['productId', 'productId'],
        ['expiresAt', 'expiresAt']
      ]);

      createStore(db, STORES.SYNC_QUEUE, 'id', [
        ['status', 'status'],
        ['createdAt', 'createdAt']
      ]);

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
    request.onblocked = () => reject(new Error('La actualización de IndexedDB está bloqueada por otra pestaña'));
  });
}

function createStore(db, name, keyPath, indexes = []) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, { keyPath });

  indexes.forEach(([indexName, key, options = {}]) => {
    store.createIndex(indexName, key, options);
  });
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

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Operación IndexedDB fallida'));
  });
}
