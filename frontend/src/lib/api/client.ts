/**
 * apiFetch – Central API client for AppsKasir frontend.
 *
 * Attaches Authorization, X-Tenant-ID, and X-Outlet-ID headers
 * from cookies on every outbound request to the Laravel backend.
 *
 * This is the CORRECT pattern for attaching auth context to outgoing
 * requests, replacing the flawed pattern in frontend/middleware.ts that
 * was setting headers on the Next.js response object instead.
 */

import { getCookie } from 'cookies-next';

export interface ApiFetchOptions extends RequestInit {
  /** Skip auth headers (e.g. for login endpoint) */
  public?: boolean;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

/**
 * Retrieve auth context from cookies (client-side).
 */
export function getAuthContext() {
  return {
    token:    getCookie('auth_token') as string | undefined,
    tenantId: getCookie('tenant_id') as string | undefined,
    outletId: getCookie('outlet_id') as string | undefined,
  };
}

/**
 * Fetch wrapper that automatically attaches auth, tenant, and outlet headers.
 *
 * @example
 * const data = await apiFetch('/cashier/transactions', {
 *   method: 'POST',
 *   body: JSON.stringify(payload),
 * });
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { public: isPublic, ...init } = options;
  const { token, tenantId, outletId } = getAuthContext();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (!isPublic) {
    if (token)    headers['Authorization']  = `Bearer ${token}`;
    if (tenantId) headers['X-Tenant-ID']    = tenantId;
    if (outletId) headers['X-Outlet-ID']    = outletId;
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    // Token expired or invalid — clear cookies and redirect to login
    if (typeof window !== 'undefined') {
      document.cookie = 'auth_token=; Max-Age=0; path=/';
      document.cookie = 'tenant_id=; Max-Age=0; path=/';
      document.cookie = 'outlet_id=; Max-Age=0; path=/';
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  const json = await response.json();

  if (!response.ok) {
    const message = json?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}
