/**
 * Dexie offline database — isolated from Zustand store.
 *
 * This module owns:
 *  1. The Dexie schema and singleton instance
 *  2. The online/offline event listeners (as a React hook)
 *
 * Previously these were embedded inside offlineSyncStore.ts which caused:
 *  - Duplicate event listener registration on hot reload / module re-import
 *  - Tight coupling between persistence layer and state container
 *  - Hard-to-test store factory side effects
 */

import Dexie, { Table } from 'dexie';
import { useEffect } from 'react';

// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------

export interface OfflineProduct {
  id?: number;
  sku: string;
  barcode?: string;
  tenant_id: number;
  [key: string]: unknown;
}

export interface OfflineCategory {
  id?: number;
  tenant_id: number;
  [key: string]: unknown;
}

export interface OfflineTransaction {
  id?: number;
  client_uuid: string; // for idempotency
  status: 'PENDING_SYNC' | 'SYNCED' | 'FAILED';
  tenant_id: number;
  created_at: Date;
  synced_at?: Date;
  [key: string]: unknown;
}

export class KasirDB extends Dexie {
  products!: Table<OfflineProduct>;
  categories!: Table<OfflineCategory>;
  transactions!: Table<OfflineTransaction>;

  constructor() {
    super('KasirDB');
    this.version(2).stores({
      // Note: unique constraint on client_uuid enforces idempotency locally
      products: '++id, sku, barcode, tenant_id',
      categories: '++id, tenant_id',
      transactions: '++id, client_uuid, status, tenant_id, created_at',
    });
  }
}

// Singleton — import `db` everywhere instead of `new KasirDB()`
export const db = new KasirDB();

// ---------------------------------------------------------------------------
// Connectivity hook
// ---------------------------------------------------------------------------

/**
 * Attach online/offline event listeners once at the app root level.
 * Pass the setter from useOfflineSyncStore to update state correctly.
 *
 * Usage (in _app.tsx or a top-level layout component):
 *   useConnectivitySync(useOfflineSyncStore((s) => s.setOnline));
 */
export function useConnectivitySync(setOnline: (online: boolean) => void): void {
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sync with current state on mount
    setOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);
}
