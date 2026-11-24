// Browser-only IndexedDB storage for an optional host-provided Final Jeopardy music file.
// Audio files never leave the host's browser.

const DB_NAME = 'jeopardy-audio-db';
const DB_VERSION = 1;
const STORE_NAME = 'audio';
const THINK_MUSIC_KEY = 'fj-think-music';

export interface CustomThinkMusicRecord {
  name: string;
  type: string;
  blob: Blob;
  savedAt: string;
}

type ChangeListener = (record: CustomThinkMusicRecord | null) => void;
const listeners = new Set<ChangeListener>();

function notifyListeners(record: CustomThinkMusicRecord | null): void {
  for (const listener of listeners) {
    listener(record);
  }
}

export function subscribeCustomThinkMusicChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open audio database.'));
  });
}

export async function loadCustomThinkMusic(): Promise<CustomThinkMusicRecord | null> {
  try {
    const db = await openDb();
    return await new Promise<CustomThinkMusicRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(THINK_MUSIC_KEY);
      req.onsuccess = () => {
        const val = req.result as CustomThinkMusicRecord | undefined;
        resolve(val && val.blob instanceof Blob ? val : null);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to load custom music.'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function saveCustomThinkMusic(file: File): Promise<CustomThinkMusicRecord> {
  const record: CustomThinkMusicRecord = {
    name: file.name,
    type: file.type || 'audio/mpeg',
    blob: file,
    savedAt: new Date().toISOString(),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record, THINK_MUSIC_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save custom music file.'));
    };
  });

  notifyListeners(record);
  return record;
}

export async function clearCustomThinkMusic(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(THINK_MUSIC_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('Failed to clear custom music file.'));
      };
    });
  } finally {
    notifyListeners(null);
  }
}
