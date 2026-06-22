const DB_NAME = 'thonk-sources'
const STORE_NAME = 'sources'
const DB_VERSION = 1

export interface SourceRecord {
  sourceId: string
  kind: 'md'
  fullText: string
  chunks: Array<{ id: string; text: string; offset: number }>
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'sourceId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSource(record: SourceRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getSource(sourceId: string): Promise<SourceRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(sourceId)
    req.onsuccess = () => resolve((req.result as SourceRecord) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteSource(sourceId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(sourceId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
