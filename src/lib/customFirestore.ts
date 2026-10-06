import { apiFetch } from './apiUrl';
import {
  saveDocLocally,
  getDocLocally,
  deleteDocLocally,
  saveQueryLocally,
  getQueryLocally,
  enqueueSyncOp
} from './offlineStorage';
import { updatePendingCount } from './offlineSync';

export function generateFirestoreId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export class MockTimestamp {
  seconds: number;
  nanoseconds: number;
  
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  
  static now() {
    const ms = Date.now();
    return new MockTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1000000);
  }
  
  static fromDate(date: Date) {
    const ms = date.getTime();
    return new MockTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1000000);
  }
  
  static fromMillis(ms: number) {
    return new MockTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1000000);
  }
  
  toDate() {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1000000));
  }
  
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1000000);
  }
  
  toISOString() {
    return this.toDate().toISOString();
  }
  
  toString() {
    return this.toDate().toString();
  }

  toJSON() {
    return {
      seconds: this.seconds,
      nanoseconds: this.nanoseconds
    };
  }
}

export { MockTimestamp as Timestamp };

function convertTimestamps(val: any): any {
  if (!val) return val;
  if (typeof val === 'object') {
    if (typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
      return new MockTimestamp(val.seconds, val.nanoseconds);
    }
    if (Array.isArray(val)) {
      return val.map(convertTimestamps);
    }
    const result: any = {};
    for (const key of Object.keys(val)) {
      result[key] = convertTimestamps(val[key]);
    }
    return result;
  }
  return val;
}

export class MockDocumentSnapshot {
  id: string;
  private _data: any;
  private _exists: boolean;
  ref: MockDocumentReference;
  
  constructor(id: string, data: any, exists: boolean = true, collectionName: string = '') {
    this.id = id;
    this._data = convertTimestamps(data);
    this._exists = exists;
    this.ref = new MockDocumentReference(collectionName, id);
  }
  
  exists() {
    return this._exists;
  }
  
  data() {
    return this._data;
  }
}

export class MockQuerySnapshot {
  docs: MockDocumentSnapshot[];
  empty: boolean;
  
  constructor(docs: MockDocumentSnapshot[]) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
  
  forEach(callback: (doc: MockDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

export class MockCollectionReference {
  type = 'collection' as const;
  collectionName: string;
  
  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }
}

export class MockDocumentReference {
  type = 'document' as const;
  collectionName: string;
  id: string;
  
  constructor(collectionName: string, id: string) {
    this.collectionName = collectionName;
    this.id = id;
  }
}

export class MockQuery {
  type = 'query' as const;
  collectionName: string;
  filters: { field: string, op: string, val: any }[] = [];
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
  limitVal?: number;
  
  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }
}

export function collection(dbOrDoc: any, path: string, ...pathSegments: string[]): MockCollectionReference {
  return new MockCollectionReference(path);
}

export function doc(dbOrCol: any, path?: string, ...pathSegments: string[]): MockDocumentReference {
  if (dbOrCol && dbOrCol.type === 'collection') {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomId = Array.from({length: 20}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return new MockDocumentReference(dbOrCol.collectionName, path || randomId);
  }
  const colName = path || '';
  const id = pathSegments[0] || '';
  return new MockDocumentReference(colName, id);
}

export function query(queryOrCol: any, ...queryConstraints: any[]): MockQuery {
  const collectionName = queryOrCol.collectionName;
  const q = new MockQuery(collectionName);
  
  if (queryOrCol.type === 'query') {
    q.filters = [...queryOrCol.filters];
    q.orderByField = queryOrCol.orderByField;
    q.orderByDirection = queryOrCol.orderByDirection;
    q.limitVal = queryOrCol.limitVal;
  }
  
  queryConstraints.forEach(constraint => {
    if (constraint.type === 'where') {
      q.filters.push({ field: constraint.field, op: constraint.op, val: constraint.val });
    } else if (constraint.type === 'orderBy') {
      q.orderByField = constraint.field;
      q.orderByDirection = constraint.direction;
    } else if (constraint.type === 'limit') {
      q.limitVal = constraint.limitValue;
    }
  });
  
  return q;
}

export function where(field: string, op: string, val: any) {
  return { type: 'where' as const, field, op, val };
}

export function orderBy(field: string, direction?: 'asc' | 'desc') {
  return { type: 'orderBy' as const, field, direction: direction || 'asc' };
}

export function limit(limitValue: number) {
  return { type: 'limit' as const, limitValue };
}

export function getFirestore() {
  return { type: 'firestore' };
}

// In-flight deduplication & short-lived memory cache to prevent 429 rate limit errors
const inFlightQueries = new Map<string, Promise<any>>();
const queryCache = new Map<string, { data: any[]; timestamp: number }>();
const inFlightDocs = new Map<string, Promise<any>>();
const docCache = new Map<string, { data: any; timestamp: number }>();

const QUERY_CACHE_TTL_MS = 2500; // 2.5 seconds cache deduplication
const DOC_CACHE_TTL_MS = 2500;

function getQueryKey(collectionName: string, filters: any[], orderByField?: string, orderByDirection?: string, limitVal?: number): string {
  return `${collectionName}::${JSON.stringify(filters || [])}::${orderByField || ''}::${orderByDirection || ''}::${limitVal || ''}`;
}

export function invalidateCache(collectionName?: string) {
  if (!collectionName) {
    queryCache.clear();
    docCache.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (key.startsWith(`${collectionName}::`)) {
      queryCache.delete(key);
    }
  }
  for (const key of docCache.keys()) {
    if (key.startsWith(`${collectionName}::`)) {
      docCache.delete(key);
    }
  }
}

export async function getDocs(queryOrCol: any): Promise<MockQuerySnapshot> {
  const collectionName = queryOrCol.collectionName;
  const filters = queryOrCol.filters || [];
  const orderByField = queryOrCol.orderByField;
  const orderByDirection = queryOrCol.orderByDirection;
  const limitVal = queryOrCol.limitVal;
  
  const cacheKey = getQueryKey(collectionName, filters, orderByField, orderByDirection, limitVal);
  const now = Date.now();
  
  const cached = queryCache.get(cacheKey);
  if (cached && now - cached.timestamp < QUERY_CACHE_TTL_MS) {
    const docs = cached.data.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
    return new MockQuerySnapshot(docs);
  }

  // If offline, directly query local IndexedDB without waiting
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    try {
      const localDocs = await getQueryLocally(collectionName, filters, orderByField, orderByDirection, limitVal, cacheKey);
      const docs = localDocs.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
      return new MockQuerySnapshot(docs);
    } catch (err) {
      console.warn(`[Firestore Offline] Failed to read ${collectionName} locally:`, err);
      if (cached) {
        const docs = cached.data.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
        return new MockQuerySnapshot(docs);
      }
      return new MockQuerySnapshot([]);
    }
  }

  if (inFlightQueries.has(cacheKey)) {
    try {
      const data = await inFlightQueries.get(cacheKey)!;
      const docs = data.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
      return new MockQuerySnapshot(docs);
    } catch {
      // In case the in-flight request fails, proceed to try fresh
    }
  }
  
  const fetchPromise = (async () => {
    try {
      const data = await apiFetch('/api/db/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: collectionName,
          filters,
          orderByField,
          orderByDirection,
          limitVal
        })
      });
      queryCache.set(cacheKey, { data, timestamp: Date.now() });
      const nowTs = Date.now();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.id) {
            docCache.set(`${collectionName}::${item.id}`, { data: { ...item.data, id: item.id }, timestamp: nowTs });
          }
        }
      }
      // Asynchronously cache in IndexedDB for offline use
      saveQueryLocally(collectionName, cacheKey, data).catch(() => {});
      return data;
    } catch (err: any) {
      const isExpectedAuthOrRateLimit =
        err?.name === 'AuthSessionError' ||
        err?.message?.includes('Authentication session') ||
        err?.message?.includes('__cookie_check') ||
        err?.message?.includes('429') ||
        err?.message === 'Failed to fetch' ||
        err?.message?.includes('cookie is missing');

      if (!isExpectedAuthOrRateLimit) {
        console.warn(`[Firestore] Query notice for collection "${collectionName}":`, err?.message || err);
      }
      throw err;
    } finally {
      inFlightQueries.delete(cacheKey);
    }
  })();

  inFlightQueries.set(cacheKey, fetchPromise);

  try {
    const data = await fetchPromise;
    const docs = data.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
    return new MockQuerySnapshot(docs);
  } catch (err: any) {
    // 1. If memory cached data is available, return it gracefully
    if (cached) {
      const docs = cached.data.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
      return new MockQuerySnapshot(docs);
    }
    // 2. Seamlessly fall back to IndexedDB local storage
    try {
      const localDocs = await getQueryLocally(collectionName, filters, orderByField, orderByDirection, limitVal, cacheKey);
      if (localDocs && localDocs.length > 0) {
        const docs = localDocs.map((doc: any) => new MockDocumentSnapshot(doc.id, doc.data, true, collectionName));
        return new MockQuerySnapshot(docs);
      }
    } catch (localErr) {
      console.warn(`[Firestore] Local fallback failed for ${collectionName}:`, localErr);
    }

    // 3. If network failed or offline, return empty snapshot instead of throwing
    const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'TypeError';
    if (isNetworkError) {
      return new MockQuerySnapshot([]);
    }

    throw err;
  }
}

export async function getDoc(docRef: any): Promise<MockDocumentSnapshot> {
  const collectionName = docRef.collectionName;
  const id = docRef.id;
  
  // If offline, check local cache & IndexedDB immediately
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    const cached = docCache.get(`${collectionName}::${id}`);
    if (cached) {
      return new MockDocumentSnapshot(id, cached.data, true, collectionName);
    }
    const localData = await getDocLocally(collectionName, id);
    if (localData) {
      return new MockDocumentSnapshot(id, localData, true, collectionName);
    }
    return new MockDocumentSnapshot(id, null, false, collectionName);
  }

  try {
    const data = await getDocFromServer(collectionName, id);
    if (!data) {
      return new MockDocumentSnapshot(id, null, false, collectionName);
    }
    return new MockDocumentSnapshot(id, data, true, collectionName);
  } catch (err: any) {
    // Fallback to local IndexedDB on network error
    try {
      const localData = await getDocLocally(collectionName, id);
      if (localData) {
        return new MockDocumentSnapshot(id, localData, true, collectionName);
      }
    } catch {}

    const isExpectedAuthOrRateLimit =
      err?.name === 'AuthSessionError' ||
      err?.message?.includes('Authentication session') ||
      err?.message?.includes('__cookie_check') ||
      err?.message?.includes('429') ||
      err?.message === 'Failed to fetch' ||
      err?.message?.includes('cookie is missing');

    if (!isExpectedAuthOrRateLimit) {
      console.warn(`[Firestore] Doc notice for "${id}" in "${collectionName}":`, err?.message || err);
    }
    throw err;
  }
}

async function getDocFromServer(collectionName: string, id: string): Promise<any> {
  const cacheKey = `${collectionName}::${id}`;
  const now = Date.now();
  const cached = docCache.get(cacheKey);
  if (cached && now - cached.timestamp < DOC_CACHE_TTL_MS) {
    return cached.data;
  }

  if (inFlightDocs.has(cacheKey)) {
    try {
      return await inFlightDocs.get(cacheKey)!;
    } catch {
      // Fall through
    }
  }

  const fetchPromise = (async () => {
    try {
      const result = await apiFetch('/api/db/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: collectionName, id })
      });
      const data = result?.data || null;
      docCache.set(cacheKey, { data, timestamp: Date.now() });
      if (data) {
        saveDocLocally(collectionName, id, data).catch(() => {});
      }
      return data;
    } catch (err: any) {
      if (err.message && err.message.includes('status 404')) {
        return null;
      }
      throw err;
    } finally {
      inFlightDocs.delete(cacheKey);
    }
  })();

  inFlightDocs.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } catch (err: any) {
    if (cached) return cached.data;
    const localData = await getDocLocally(collectionName, id);
    if (localData) return localData;
    throw err;
  }
}

export async function getDocsFromCache(queryRef: any) {
  return await getDocs(queryRef);
}

const activeListeners = new Set<{ queryOrCol: any; run: () => void }>();

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && window.BroadcastChannel) {
  broadcastChannel = new BroadcastChannel('db-mutation-channel');
  broadcastChannel.onmessage = (event) => {
    const col = event.data?.collectionName;
    invalidateCache(col);
    activeListeners.forEach((listener) => {
      const listenerCol = listener.queryOrCol?.collectionName;
      if (!col || !listenerCol || listenerCol === col) {
        listener.run();
      }
    });
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('ais-offline-synced', () => {
    notifyListeners();
  });
}

export function notifyListeners(collectionName?: string) {
  invalidateCache(collectionName);
  activeListeners.forEach((listener) => {
    const col = listener.queryOrCol?.collectionName;
    if (!collectionName || !col || col === collectionName) {
      listener.run();
    }
  });

  if (broadcastChannel) {
    broadcastChannel.postMessage({ collectionName });
  }
}

export async function addDoc(colRef: any, data: any): Promise<MockDocumentReference> {
  const collectionName = colRef.collectionName;
  const id = generateFirestoreId();
  const docData = { ...data, id };
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const saveLocalAndQueue = async () => {
    await saveDocLocally(collectionName, id, docData);
    docCache.set(`${collectionName}::${id}`, { data: docData, timestamp: Date.now() });
    await enqueueSyncOp({
      opType: 'set',
      collection: collectionName,
      docId: id,
      data: docData,
      merge: false,
      timestamp: Date.now()
    });
    await updatePendingCount();
    notifyListeners(collectionName);
    return new MockDocumentReference(collectionName, id);
  };

  if (isOffline) {
    return await saveLocalAndQueue();
  }

  try {
    const result = await apiFetch('/api/db/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, data: docData })
    });
    const realId = result?.id || id;
    saveDocLocally(collectionName, realId, docData).catch(() => {});
    docCache.set(`${collectionName}::${realId}`, { data: docData, timestamp: Date.now() });
    notifyListeners(collectionName);
    return new MockDocumentReference(collectionName, realId);
  } catch (err: any) {
    const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'TypeError';
    if (isNetworkError) {
      return await saveLocalAndQueue();
    }
    console.error("Add doc failed:", err);
    throw err;
  }
}

export async function setDoc(docRef: any, data: any, options?: any): Promise<void> {
  const collectionName = docRef.collectionName;
  const id = docRef.id;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const saveLocalAndQueue = async () => {
    let toSave = data;
    if (options?.merge) {
      const existing = (await getDocLocally(collectionName, id)) || docCache.get(`${collectionName}::${id}`)?.data;
      toSave = { ...(existing || {}), ...data };
    }
    await saveDocLocally(collectionName, id, toSave);
    docCache.set(`${collectionName}::${id}`, { data: toSave, timestamp: Date.now() });
    await enqueueSyncOp({
      opType: 'set',
      collection: collectionName,
      docId: id,
      data,
      merge: options?.merge,
      timestamp: Date.now()
    });
    await updatePendingCount();
    notifyListeners(collectionName);
  };

  if (isOffline) {
    await saveLocalAndQueue();
    return;
  }

  try {
    await apiFetch('/api/db/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, id, data, merge: options?.merge })
    });
    let toSave = data;
    if (options?.merge) {
      const existing = (await getDocLocally(collectionName, id)) || docCache.get(`${collectionName}::${id}`)?.data;
      toSave = { ...(existing || {}), ...data };
    }
    saveDocLocally(collectionName, id, toSave).catch(() => {});
    docCache.set(`${collectionName}::${id}`, { data: toSave, timestamp: Date.now() });
    notifyListeners(collectionName);
  } catch (err: any) {
    const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'TypeError';
    if (isNetworkError) {
      await saveLocalAndQueue();
      return;
    }
    console.error("Set doc failed:", err);
    throw err;
  }
}

export async function updateDoc(docRef: any, data: any): Promise<void> {
  const collectionName = docRef.collectionName;
  const id = docRef.id;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const saveLocalAndQueue = async () => {
    const existing = (await getDocLocally(collectionName, id)) || docCache.get(`${collectionName}::${id}`)?.data;
    const merged = { ...(existing || {}), ...data };
    await saveDocLocally(collectionName, id, merged);
    docCache.set(`${collectionName}::${id}`, { data: merged, timestamp: Date.now() });
    await enqueueSyncOp({
      opType: 'update',
      collection: collectionName,
      docId: id,
      data,
      timestamp: Date.now()
    });
    await updatePendingCount();
    notifyListeners(collectionName);
  };

  if (isOffline) {
    await saveLocalAndQueue();
    return;
  }

  try {
    await apiFetch('/api/db/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, id, data })
    });
    const existing = (await getDocLocally(collectionName, id)) || docCache.get(`${collectionName}::${id}`)?.data;
    const merged = { ...(existing || {}), ...data };
    saveDocLocally(collectionName, id, merged).catch(() => {});
    docCache.set(`${collectionName}::${id}`, { data: merged, timestamp: Date.now() });
    notifyListeners(collectionName);
  } catch (err: any) {
    const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'TypeError';
    if (isNetworkError) {
      await saveLocalAndQueue();
      return;
    }
    console.error("Update doc failed:", err);
    throw err;
  }
}

export async function deleteDoc(docRef: any): Promise<void> {
  const collectionName = docRef.collectionName;
  const id = docRef.id;
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const deleteLocalAndQueue = async () => {
    await deleteDocLocally(collectionName, id);
    docCache.delete(`${collectionName}::${id}`);
    await enqueueSyncOp({
      opType: 'delete',
      collection: collectionName,
      docId: id,
      timestamp: Date.now()
    });
    await updatePendingCount();
    notifyListeners(collectionName);
  };

  if (isOffline) {
    await deleteLocalAndQueue();
    return;
  }

  try {
    await apiFetch('/api/db/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: collectionName, id })
    });
    deleteDocLocally(collectionName, id).catch(() => {});
    docCache.delete(`${collectionName}::${id}`);
    notifyListeners(collectionName);
  } catch (err: any) {
    const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
      err?.message?.includes('Failed to fetch') ||
      err?.name === 'TypeError';
    if (isNetworkError) {
      await deleteLocalAndQueue();
      return;
    }
    console.error("Delete doc failed:", err);
    throw err;
  }
}

export function onSnapshot(queryOrCol: any, onNext: (snapshot: any) => void, onError?: (error: any) => void) {
  let active = true;
  let intervalId: any = null;
  let hasSucceeded = false;
  let currentGeneration = 0;
  
  async function run() {
    if (!active) return;
    // If browser tab is hidden in background, don't waste requests
    if (typeof document !== 'undefined' && document.hidden) return;

    currentGeneration++;
    const thisGeneration = currentGeneration;
    try {
      const snap = (queryOrCol.type === 'document') ? await getDoc(queryOrCol) : await getDocs(queryOrCol);
      if (active && thisGeneration === currentGeneration) {
        hasSucceeded = true;
        onNext(snap);
      }
    } catch (e: any) {
      if (active && thisGeneration === currentGeneration) {
        if (onError && !hasSucceeded) {
          const isExpectedAuthOrRateLimit =
            e?.name === 'AuthSessionError' ||
            e?.message?.includes('Authentication session') ||
            e?.message?.includes('__cookie_check') ||
            e?.message?.includes('429') ||
            e?.message === 'Failed to fetch' ||
            e?.message?.includes('cookie is missing');
          if (!isExpectedAuthOrRateLimit) {
            onError(e);
          }
        }
      }
    }
  }

  const listenerItem = { queryOrCol, run };
  activeListeners.add(listenerItem);
  
  // Initial immediate fetch
  run();
  
  // Refresh on window focus / visibility change
  const onVisibilityOrFocus = () => {
    if (active && typeof document !== 'undefined' && !document.hidden) {
      run();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
  }

  // Gentle background poll interval (12 seconds)
  intervalId = setInterval(() => {
    if (active) {
      run();
    }
  }, 12000);
  
  return () => {
    active = false;
    activeListeners.delete(listenerItem);
    if (intervalId) {
      clearInterval(intervalId);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    }
  };
}

class MockTransaction {
  private writes: { type: 'set' | 'update' | 'delete', collection: string, id: string, data?: any, merge?: boolean }[] = [];
  
  async get(docRef: any) {
    const colName = docRef.collectionName;
    const id = docRef.id;
    let data: any = null;
    const cacheKey = `${colName}::${id}`;
    if (docCache.has(cacheKey)) {
      data = docCache.get(cacheKey)!.data;
    }
    if (!data && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        data = await getDocFromServer(colName, id);
      } catch (err) {}
    }
    if (!data) {
      data = await getDocLocally(colName, id);
    }
    if (!data) {
      // Also check any active queryCache entries for this collection
      for (const [qKey, qVal] of queryCache.entries()) {
        if (qKey.startsWith(`${colName}::`) && Array.isArray(qVal.data)) {
          const found = qVal.data.find((d: any) => String(d.id) === String(id) || String(d.data?.id) === String(id));
          if (found) {
            data = { ...(found.data || {}), id: found.id };
            break;
          }
        }
      }
    }
    return new MockDocumentSnapshot(id, data, !!data, colName);
  }
  
  set(docRef: any, data: any, options?: any) {
    this.writes.push({
      type: 'set',
      collection: docRef.collectionName,
      id: docRef.id,
      data,
      merge: options?.merge
    });
  }
  
  update(docRef: any, data: any) {
    this.writes.push({
      type: 'update',
      collection: docRef.collectionName,
      id: docRef.id,
      data
    });
  }
  
  delete(docRef: any) {
    this.writes.push({
      type: 'delete',
      collection: docRef.collectionName,
      id: docRef.id
    });
  }
  
  async commit() {
    if (this.writes.length === 0) return;
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const applyLocallyAndQueue = async () => {
      for (const op of this.writes) {
        if (op.type === 'set') {
          let toSave = op.data;
          if (op.merge) {
            const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
            toSave = { ...(existing || {}), ...op.data };
          }
          await saveDocLocally(op.collection, op.id, toSave);
          docCache.set(`${op.collection}::${op.id}`, { data: toSave, timestamp: Date.now() });
        } else if (op.type === 'update') {
          const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
          const merged = { ...(existing || {}), ...op.data };
          await saveDocLocally(op.collection, op.id, merged);
          docCache.set(`${op.collection}::${op.id}`, { data: merged, timestamp: Date.now() });
        } else if (op.type === 'delete') {
          await deleteDocLocally(op.collection, op.id);
          docCache.delete(`${op.collection}::${op.id}`);
        }
      }
      await enqueueSyncOp({
        opType: 'batch',
        collection: 'batch',
        docId: 'batch',
        writes: this.writes,
        timestamp: Date.now()
      });
      await updatePendingCount();
      const colNames = Array.from(new Set(this.writes.map(w => w.collection)));
      colNames.forEach(col => notifyListeners(col));
    };

    if (isOffline) {
      await applyLocallyAndQueue();
      return;
    }

    try {
      await apiFetch('/api/db-batch/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: this.writes })
      });
      // Mirror locally into IndexedDB
      for (const op of this.writes) {
        if (op.type === 'set') {
          let toSave = op.data;
          if (op.merge) {
            const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
            toSave = { ...(existing || {}), ...op.data };
          }
          saveDocLocally(op.collection, op.id, toSave).catch(() => {});
          docCache.set(`${op.collection}::${op.id}`, { data: toSave, timestamp: Date.now() });
        } else if (op.type === 'update') {
          const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
          const merged = { ...(existing || {}), ...op.data };
          saveDocLocally(op.collection, op.id, merged).catch(() => {});
          docCache.set(`${op.collection}::${op.id}`, { data: merged, timestamp: Date.now() });
        } else if (op.type === 'delete') {
          deleteDocLocally(op.collection, op.id).catch(() => {});
          docCache.delete(`${op.collection}::${op.id}`);
        }
      }
      const colNames = Array.from(new Set(this.writes.map(w => w.collection)));
      colNames.forEach(col => notifyListeners(col));
    } catch (err: any) {
      const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err?.message?.includes('Failed to fetch') ||
        err?.name === 'TypeError';
      if (isNetworkError) {
        await applyLocallyAndQueue();
        return;
      }
      console.error("Transaction commit failed:", err);
      throw err;
    }
  }
}

export async function runTransaction(db: any, updateFunction: (transaction: MockTransaction) => Promise<any>) {
  const transaction = new MockTransaction();
  const result = await updateFunction(transaction);
  await transaction.commit();
  return result;
}

class MockWriteBatch {
  private writes: any[] = [];
  
  set(docRef: any, data: any, options?: any) {
    this.writes.push({
      type: 'set',
      collection: docRef.collectionName,
      id: docRef.id,
      data,
      merge: options?.merge
    });
  }
  
  update(docRef: any, data: any) {
    this.writes.push({
      type: 'update',
      collection: docRef.collectionName,
      id: docRef.id,
      data
    });
  }
  
  delete(docRef: any) {
    this.writes.push({
      type: 'delete',
      collection: docRef.collectionName,
      id: docRef.id
    });
  }
  
  async commit() {
    if (this.writes.length === 0) return;
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const applyLocallyAndQueue = async () => {
      for (const op of this.writes) {
        if (op.type === 'set') {
          let toSave = op.data;
          if (op.merge) {
            const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
            toSave = { ...(existing || {}), ...op.data };
          }
          await saveDocLocally(op.collection, op.id, toSave);
          docCache.set(`${op.collection}::${op.id}`, { data: toSave, timestamp: Date.now() });
        } else if (op.type === 'update') {
          const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
          const merged = { ...(existing || {}), ...op.data };
          await saveDocLocally(op.collection, op.id, merged);
          docCache.set(`${op.collection}::${op.id}`, { data: merged, timestamp: Date.now() });
        } else if (op.type === 'delete') {
          await deleteDocLocally(op.collection, op.id);
          docCache.delete(`${op.collection}::${op.id}`);
        }
      }
      await enqueueSyncOp({
        opType: 'batch',
        collection: 'batch',
        docId: 'batch',
        writes: this.writes,
        timestamp: Date.now()
      });
      await updatePendingCount();
      const colNames = Array.from(new Set(this.writes.map(w => w.collection)));
      colNames.forEach(col => notifyListeners(col));
    };

    if (isOffline) {
      await applyLocallyAndQueue();
      return;
    }

    try {
      await apiFetch('/api/db-batch/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: this.writes })
      });
      // Mirror locally into IndexedDB
      for (const op of this.writes) {
        if (op.type === 'set') {
          let toSave = op.data;
          if (op.merge) {
            const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
            toSave = { ...(existing || {}), ...op.data };
          }
          saveDocLocally(op.collection, op.id, toSave).catch(() => {});
          docCache.set(`${op.collection}::${op.id}`, { data: toSave, timestamp: Date.now() });
        } else if (op.type === 'update') {
          const existing = (await getDocLocally(op.collection, op.id)) || docCache.get(`${op.collection}::${op.id}`)?.data;
          const merged = { ...(existing || {}), ...op.data };
          saveDocLocally(op.collection, op.id, merged).catch(() => {});
          docCache.set(`${op.collection}::${op.id}`, { data: merged, timestamp: Date.now() });
        } else if (op.type === 'delete') {
          deleteDocLocally(op.collection, op.id).catch(() => {});
          docCache.delete(`${op.collection}::${op.id}`);
        }
      }
      const colNames = Array.from(new Set(this.writes.map(w => w.collection)));
      colNames.forEach(col => notifyListeners(col));
    } catch (err: any) {
      const isNetworkError = (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err?.message?.includes('Failed to fetch') ||
        err?.name === 'TypeError';
      if (isNetworkError) {
        await applyLocallyAndQueue();
        return;
      }
      console.error("Batch commit failed:", err);
      throw err;
    }
  }
}

export function writeBatch(db: any) {
  return new MockWriteBatch();
}

/**
 * Pre-cache critical reference collections into IndexedDB
 * so user has complete inventory, customers, vendors, branches offline.
 */
export async function warmUpOfflineCache(branchId?: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const targetCols = [
    'branches',
    'customers',
    'vendors',
    'employees',
    'settings',
    'salesmen',
    'counters',
    'expenseAccountHeads',
    'onlineSalesEmployees'
  ];

  for (const col of targetCols) {
    try {
      await getDocs(collection(null, col));
    } catch {}
  }

  // Preload branch-scoped operational collections so offline pages have data ready
  const branchScopedCols = ['inventory', 'sales', 'ledger', 'purchases', 'expenses'];
  for (const col of branchScopedCols) {
    try {
      if (branchId) {
        await getDocs(query(collection(null, col), where('branchId', '==', branchId)));
      } else {
        await getDocs(collection(null, col));
      }
    } catch {}
  }
}

export async function enableIndexedDbPersistence() {
  // Safe no-op
}

export function registerFirebaseRefs(db: any, config: any) {}
export function isNeonOnly(): boolean { return true; }
export function isQuotaExceeded(): boolean { return true; }
export function setQuotaExceeded(exceeded: boolean) {}
export function setNeonOnly(exceeded: boolean) {}
