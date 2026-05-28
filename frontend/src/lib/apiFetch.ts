/**
 * Centralized API fetch client.
 * Correctly injects auth, tenant, and outlet context headers on every
 * outgoing request — fixing the middleware.ts false-security pattern
 * where headers were set on the *response* object instead of requests.
 *
 * Usage:
 *   import { apiFetch } from '@/lib/apiFetch';
 *   const res = await apiFetch('/api/v1/cashier/transactions', { method: 'GET' });
 */

import Cookies from 'js-cookie';

export interface AuthContext {
  token: string | undefined;
  tenantId: string | undefined;
  outletId: string | undefined;
}

/**
 * Read auth context from cookies.
 * Cookies are the single source of truth — never localStorage.
 */
export function getAuthContext(): AuthContext {
  return {
    token: Cookies.get('auth_token'),
    tenantId: Cookies.get('tenant_id'),
    outletId: Cookies.get('outlet_id'),
  };
}

/**
 * Thin wrapper around fetch() that automatically attaches auth and
 * multi-tenant context headers from cookies.
 *
 * All API calls in the app should go through this function instead of
 * calling fetch() directly, so headers are always consistent.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const { token, tenantId, outletId } = getAuthContext();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
    ...(outletId ? { 'X-Outlet-ID': outletId } : {}),
    // Allow callers to override any header
    ...(init.headers || {}),
  };

  return fetch(path, {
    ...init,
    headers,
  });
}

/**
 * Convenience wrapper for JSON API calls.
 * Throws on non-2xx responses with a structured error.
 */
export async function apiFetchJson<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}. ${body}`
    );
  }

  return response.json() as Promise<T>;
}
