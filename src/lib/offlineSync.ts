import { useState, useEffect } from 'react';
import { apiFetch } from './apiUrl';
import { getPendingSyncQueue, removeSyncOp, getPendingQueueCount, SyncQueueItem } from './offlineStorage';
import toast from 'react-hot-toast';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  syncError: string | null;
}

type SyncListener = (status: SyncStatus) => void;

let currentStatus: SyncStatus = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  syncError: null
};

const listeners = new Set<SyncListener>();

function emitStatus() {
  listeners.forEach(fn => fn({ ...currentStatus }));
}

export function getSyncStatus(): SyncStatus {
  return { ...currentStatus };
}

export function subscribeToSyncStatus(listener: SyncListener): () => void {
  listeners.add(listener);
  listener({ ...currentStatus });
  return () => {
    listeners.delete(listener);
  };
}

export async function updatePendingCount(): Promise<number> {
  const count = await getPendingQueueCount();
  currentStatus.pendingCount = count;
  emitStatus();
  return count;
}

// -------------------------------------------------------------
// Internet Connectivity Checking & Auto-Sync
// -------------------------------------------------------------

let isSyncInProgress = false;

export async function checkServerConnectivity(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerSync(): Promise<void> {
  if (isSyncInProgress) return;
  
  const queue = await getPendingSyncQueue();
  currentStatus.pendingCount = queue.length;
  emitStatus();

  if (queue.length === 0) {
    return;
  }

  // Check if we are really connected to server
  const reachable = await checkServerConnectivity();
  if (!reachable) {
    currentStatus.isOnline = false;
    emitStatus();
    return;
  }

  currentStatus.isOnline = true;
  currentStatus.isSyncing = true;
  currentStatus.syncError = null;
  isSyncInProgress = true;
  emitStatus();

  const totalEntries = queue.length;
  let syncedCount = 0;
  let hadFailure = false;

  console.log(`[OfflineSync] Starting sync of ${totalEntries} pending offline entries...`);

  for (const item of queue) {
    try {
      if (item.opType === 'set' || item.opType === 'add') {
        await apiFetch('/api/db/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collection,
            id: item.docId,
            data: item.data,
            merge: item.merge
          })
        });
      } else if (item.opType === 'update') {
        await apiFetch('/api/db/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collection,
            id: item.docId,
            data: item.data
          })
        });
      } else if (item.opType === 'delete') {
        await apiFetch('/api/db/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: item.collection,
            id: item.docId
          })
        });
      } else if (item.opType === 'batch') {
        await apiFetch('/api/db-batch/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            writes: item.writes
          })
        });
      }

      // Successfully synced this item
      if (item.queueId) {
        await removeSyncOp(item.queueId);
      }
      syncedCount++;
      currentStatus.pendingCount = Math.max(0, currentStatus.pendingCount - 1);
      emitStatus();
    } catch (err: any) {
      console.warn(`[OfflineSync] Item sync error for ${item.collection}/${item.docId}:`, err);
      hadFailure = true;
      currentStatus.syncError = err?.message || 'Sync failed for some items';
      // If server unreachable or network error, stop batch to retry when network is stable
      const isNetworkError = !navigator.onLine || err?.message?.includes('Failed to fetch') || err?.name === 'TypeError';
      if (isNetworkError) {
        currentStatus.isOnline = false;
        break;
      }
    }
  }

  isSyncInProgress = false;
  currentStatus.isSyncing = false;
  currentStatus.lastSyncTime = Date.now();
  currentStatus.pendingCount = await getPendingQueueCount();
  emitStatus();

  if (syncedCount > 0) {
    toast.success(
      `Synced ${syncedCount} offline ${syncedCount === 1 ? 'entry' : 'entries'} to server! / تمام انٹریز سرور پر محفوظ ہو گئیں۔`,
      { duration: 4000 }
    );
    // Notify listeners so UI updates with fresh state
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ais-offline-synced'));
    }
  }

  if (hadFailure && currentStatus.pendingCount > 0) {
    console.warn(`[OfflineSync] ${currentStatus.pendingCount} entries remaining in queue to sync.`);
  }
}

// -------------------------------------------------------------
// Auto-Sync Listeners & Interval Probe
// -------------------------------------------------------------

if (typeof window !== 'undefined') {
  // Initial queue count check
  updatePendingCount();

  const handleOnline = async () => {
    currentStatus.isOnline = true;
    emitStatus();
    const reachable = await checkServerConnectivity();
    if (reachable) {
      triggerSync();
    }
  };

  const handleOffline = () => {
    currentStatus.isOnline = false;
    emitStatus();
    toast("Switched to Offline Mode. Entries will be saved locally. / انٹرنیٹ بند ہے، انٹریز لوکل محفوظ ہوں گی۔", {
      icon: '📶',
      duration: 3500
    });
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Periodic heartbeat every 8 seconds
  setInterval(async () => {
    const isOnlineNow = await checkServerConnectivity();
    if (isOnlineNow !== currentStatus.isOnline) {
      currentStatus.isOnline = isOnlineNow;
      emitStatus();
      if (isOnlineNow && currentStatus.pendingCount > 0) {
        triggerSync();
      }
    } else if (isOnlineNow && currentStatus.pendingCount > 0 && !isSyncInProgress) {
      triggerSync();
    }
  }, 8000);
}

// -------------------------------------------------------------
// React Hook for Components
// -------------------------------------------------------------

export function useSyncStatus(): SyncStatus & { triggerSync: () => Promise<void> } {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());

  useEffect(() => {
    return subscribeToSyncStatus(setStatus);
  }, []);

  return {
    ...status,
    triggerSync
  };
}
