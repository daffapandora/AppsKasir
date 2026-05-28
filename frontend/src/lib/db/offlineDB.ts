/**
 * offlineDB.ts
 * Standalone Dexie (IndexedDB) database instance for offline-first POS storage.
 *
 * Extracted from offlineSyncStore.ts to:
 * - Prevent re-instantiation on store hydration
 * - Enable independent import without triggering store side-effects
 * - Support easier unit testing
 */

import Dexie, { type Table } from 'dexie';

export interface OfflineProduct {
  id?: number;
  sku: string;
  barcode?: string;
  tenant_id: number;
  updated_at: string;
  [key: string]: unknown;
}

export interface OfflineCategory {
  id?: number;
  tenant_id: number;
  updated_at: string;
  [key: string]: unknown;
}

export interface OfflineTransaction {
  id?: number;
  client_uuid: string;
  status: 'PENDING_SYNC' | 'SYNCED' | 'FAILED';
  tenant_id: number;
  created_at: string;
  payload: string; // JSON-serialized transaction payload
}

export class OfflineDB extends Dexie {
  products!: Table<OfflineProduct>;
  categories!: Table<OfflineCategory>;
  transactions!: Table<OfflineTransaction>;

  constructor() {
    super('KasirDB');
    this.version(2).stores({
      // Compound index for multi-tenant isolation
      products:     '++id, sku, barcode, tenant_id, updated_at',
      categories:   '++id, tenant_id, updated_at',
      // client_uuid is the primary deduplication key
      transactions: '++id, &client_uuid, status, tenant_id, created_at',
    });
  }
}

// Singleton instance — import this throughout the app
export const db = new OfflineDB();
