/**
 * connectivityMonitor.ts
 * Manages browser online/offline event listeners independently of Zustand stores.
 *
 * Extracted from offlineSyncStore.ts to prevent:
 * - Duplicate event listeners on module re-import
 * - Tight coupling between persistence layer and state management
 *
 * Usage (in app root or layout):
 *   import { initConnectivityMonitor } from '@/lib/db/connectivityMonitor';
 *   // Call once in useEffect on app mount
 *   useEffect(() => initConnectivityMonitor(onOnline, onOffline), []);
 */

type ConnectivityCallback = (isOnline: boolean) => void;

let _onOnline: (() => void) | null = null;
let _onOffline: (() => void) | null = null;

/**
 * Attach online/offline listeners. Safe to call multiple times —
 * previous listeners are removed before attaching new ones.
 *
 * @returns cleanup function to remove listeners
 */
export function initConnectivityMonitor(
  onOnline: ConnectivityCallback,
  onOffline: ConnectivityCallback
): () => void {
  // Remove any previously attached listeners
  if (_onOnline)  window.removeEventListener('online',  _onOnline);
  if (_onOffline) window.removeEventListener('offline', _onOffline);

  _onOnline  = () => onOnline(true);
  _onOffline = () => onOffline(false);

  window.addEventListener('online',  _onOnline);
  window.addEventListener('offline', _onOffline);

  // Return cleanup function for useEffect
  return () => {
    if (_onOnline)  window.removeEventListener('online',  _onOnline);
    if (_onOffline) window.removeEventListener('offline', _onOffline);
    _onOnline  = null;
    _onOffline = null;
  };
}

/**
 * Get current connectivity status.
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
