/**
 * Offline sync state store.
 *
 * IMPORTANT: This store no longer owns the Dexie DB schema or the
 * online/offline event listeners. Those now live in `@/lib/db.ts`.
 *
 * To wire up connectivity detection, call useConnectivitySync() from
 * `@/lib/db.ts` once in your top-level layout component:
 *
 *   import { useConnectivitySync } from '@/lib/db';
 *   import { useOfflineSyncStore } from '@/stores/offlineSyncStore';
 *
 *   export default function RootLayout({ children }) {
 *     const setOnline = useOfflineSyncStore((s) => s.setOnline);
 *     useConnectivitySync(setOnline);
 *     return <>{children}</>;
 *   }
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { db } from '@/lib/db';
import { apiFetch } from '@/lib/apiFetch';

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
  setLastSyncTime: (time: Date) => void;
  setPendingTransactions: (count: number) => void;
  setSyncError: (error?: string) => void;
  setMasterDataCached: (cached: boolean) => void;
  pullMasterData: () => Promise<void>;
  pushPendingTransactions: () => Promise<void>;
  retryFailedSync: () => Promise<void>;
}

export const useOfflineSyncStore = create<SyncState & SyncActions>()(
  devtools((set, get) => ({
    // Initial state — no side effects here (listeners moved to lib/db.ts)
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
     * Auth/tenant headers are injected automatically by apiFetch().
     */
    pullMasterData: async () => {
      set({ isSyncing: true, syncError: undefined });

      try {
        const response = await apiFetch('/api/v1/sync/master-data');

        if (!response.ok) {
          throw new Error(`Failed to pull master data: ${response.statusText}`);
        }

        const { data } = await response.json();

        await db.transaction('rw', db.products, db.categories, async () => {
          await db.products.clear();
          await db.categories.clear();

          if (data.categories?.length > 0) {
            await db.categories.bulkAdd(data.categories);
          }
          if (data.products?.length > 0) {
            await db.products.bulkAdd(data.products);
          }
        });

        set({
          masterDataCached: true,
          lastSyncTime: new Date(),
          isSyncing: false,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        set({ isSyncing: false, syncError: message });
        throw error;
      }
    },

    /**
     * Push PENDING_SYNC transactions to server in batches.
     * Auth/tenant headers injected by apiFetch().
     */
    pushPendingTransactions: async () => {
      set({ isSyncing: true, syncError: undefined });

      try {
        const transactions = await db.transactions
          .where('status')
          .equals('PENDING_SYNC')
          .toArray();

        if (transactions.length === 0) {
          set({ isSyncing: false });
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

          const { synced_ids } = await response.json();

          await db.transactions.bulkUpdate(
            synced_ids.map((id: number) => ({
              key: id,
              changes: { status: 'SYNCED', synced_at: new Date() },
            }))
          );
        }

        const pending = await db.transactions
          .where('status')
          .equals('PENDING_SYNC')
          .count();

        set({
          isSyncing: false,
          lastSyncTime: new Date(),
          pendingTransactions: pending,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        set({ isSyncing: false, syncError: message });
        throw error;
      }
    },

    /**
     * Retry failed sync with exponential backoff.
     * No longer reads from localStorage — tenant context comes from cookies via apiFetch.
     */
    retryFailedSync: async () => {
      let delay = 1000;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          if (get().isOnline) {
            await get().pushPendingTransactions();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          attempts++;
        } catch {
          attempts++;
        }
      }

      set({ syncError: `Failed to sync after ${maxAttempts} attempts` });
    },
  }))
);
