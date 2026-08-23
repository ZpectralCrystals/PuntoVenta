const DB_NAME = 'mesa-clara-pos-offline';
const DB_VERSION = 1;
const STORE_NAME = 'sync-state';

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

export async function readOfflineRecord(key) {
  const database = await openDatabase();
  if (!database) return null;
  const transaction = database.transaction(STORE_NAME, 'readonly');
  return requestResult(transaction.objectStore(STORE_NAME).get(key));
}

export async function writeOfflineRecord(key, value) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).put(value, key));
}

export async function deleteOfflineRecord(key) {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).delete(key));
}
