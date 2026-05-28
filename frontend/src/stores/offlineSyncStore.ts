import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import Dexie, { Table } from 'dexie';
import { apiFetch } from '@/lib/apiClient';

// ---------------------------------------------------------------------------
// Dexie DB — defined outside the store to avoid re-instantiation
// ---------------------------------------------------------------------------

export class OfflineDB extends Dexie {
  products!: Table<any>;
  categories!: Table<any>;
  transactions!: Table<any>;

  constructor() {
    super('KasirDB');
    this.version(1).stores({
      products: 'id, sku, barcode, tenant_id',
      categories: 'id, tenant_id',
      transactions: 'id, client_uuid, status, tenant_id, created_at',
    });
  }
}

export const db = new OfflineDB();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncTime?: Date;
  pendingTransactions: number;
  syncError?: string;
  masterDataCached: boolean;
}

interface SyncActions {
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time?: Date) => void;
  setPendingTransactions: (count: number) => void;
  setSyncError: (error?: string) => void;
  setMasterDataCached: (cached: boolean) => void;
  pullMasterData: () => Promise<void>;
  pushPendingTransactions: () => Promise<void>;
  retryFailedSync: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOfflineSyncStore = create<SyncState & SyncActions>()(
  devtools((set, get) => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    lastSyncTime: undefined,
    pendingTransactions: 0,
    syncError: undefined,
    masterDataCached: false,

    setOnline: (online) => set({ isOnline: online }),
    setSyncing: (syncing) => set({ isSyncing: syncing }),
    setLastSyncTime: (time) => set({ lastSyncTime: time }),
    setPendingTransactions: (count) => set({ pendingTransactions: count }),
    setSyncError: (error) => set({ syncError: error }),
    setMasterDataCached: (cached) => set({ masterDataCached: cached }),

    /**
     * Pull master data (products, categories) from server and cache in Dexie.
     * Uses apiFetch() so auth + tenant headers are always attached.
     */
    pullMasterData: async () => {
      set({ isSyncing: true, syncError: undefined });
      try {
        const response = await apiFetch('/api/v1/sync/master-data');
        if (!response.ok) {
          throw new Error(`Failed to pull master data: ${response.statusText}`);
        }

        const data = await response.json();

        await db.transaction('rw', db.products, db.categories, async () => {
          await db.products.clear();
          await db.categories.clear();
          if (Array.isArray(data.categories) && data.categories.length > 0) {
            await db.categories.bulkPut(data.categories);
          }
          if (Array.isArray(data.products) && data.products.length > 0) {
            await db.products.bulkPut(data.products);
          }
        });

        set({ masterDataCached: true, lastSyncTime: new Date(), isSyncing: false });
      } catch (error: any) {
        set({ isSyncing: false, syncError: error?.message ?? 'Failed to pull master data' });
        throw error;
      }
    },

    /**
     * Push PENDING_SYNC transactions to server in batches.
     * Marks each batch as SYNCED on success.
     */
    pushPendingTransactions: async () => {
      set({ isSyncing: true, syncError: undefined });
      try {
        const transactions = await db.transactions
          .where('status')
          .equals('PENDING_SYNC')
          .toArray();

        if (transactions.length === 0) {
          set({ isSyncing: false, pendingTransactions: 0 });
          return;
        }

        const batchSize = 10;
        for (let i = 0; i < transactions.length; i += batchSize) {
          const batch = transactions.slice(i, i + batchSize);

          const response = await apiFetch('/api/v1/sync/transactions', {
            method: 'POST',
            body: JSON.stringify({ transactions: batch }),
          });

          if (!response.ok) {
            throw new Error(`Failed to push transactions: ${response.statusText}`);
          }

          const result = await response.json();
          const syncedIds: number[] = result.synced_ids ?? [];

          if (syncedIds.length > 0) {
            await db.transactions.bulkUpdate(
              syncedIds.map((id) => ({
                key: id,
                changes: { status: 'SYNCED', synced_at: new Date() },
              }))
            );
          }
        }

        const pending = await db.transactions
          .where('status')
          .equals('PENDING_SYNC')
          .count();

        set({ isSyncing: false, lastSyncTime: new Date(), pendingTransactions: pending });
      } catch (error: any) {
        set({ isSyncing: false, syncError: error?.message ?? 'Failed to push transactions' });
        throw error;
      }
    },

    /**
     * Retry failed sync with exponential backoff.
     */
    retryFailedSync: async () => {
      let delay = 1000;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          if (!get().isOnline) throw new Error('Device is offline');
          await get().pushPendingTransactions();
          return;
        } catch {
          attempts += 1;
          if (attempts >= maxAttempts) break;
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }

      set({ syncError: `Failed to sync after ${maxAttempts} attempts` });
    },
  }))
);

// ---------------------------------------------------------------------------
// Connectivity listeners — call once at app root (e.g. in layout.tsx)
// Kept separate to prevent duplicate bindings on hot-reload / re-imports
// ---------------------------------------------------------------------------

let listenersRegistered = false;

export function registerConnectivityListeners(): void {
  if (typeof window === 'undefined' || listenersRegistered) return;

  const { setOnline } = useOfflineSyncStore.getState();
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));

  listenersRegistered = true;
}
