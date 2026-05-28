/**
 * api-client.ts — Centralised HTTP client for all backend API calls.
 *
 * Replaces the incorrect pattern of injecting auth/tenant/outlet context
 * into Next.js middleware RESPONSE headers (which does not affect outgoing
 * browser fetch calls). Instead, every request to the backend is made through
 * `apiFetch`, which attaches the correct headers from cookies.
 *
 * Usage:
 *   import { apiFetch } from '@/lib/api-client';
 *
 *   const data = await apiFetch('/api/v1/cashier/transactions', {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *   });
 */

import Cookies from 'js-cookie';

/**
 * Auth/tenant context read from browser cookies.
 * Cookies are set server-side (HttpOnly where possible) and read here
 * only for injecting outgoing request headers.
 */
export function getAuthContext() {
  return {
    token: Cookies.get('auth_token'),
    tenantId: Cookies.get('tenant_id'),
    outletId: Cookies.get('outlet_id'),
  };
}

/**
 * ApiError — thrown by apiFetch when the server returns a non-2xx status.
 * Callers can catch this and inspect `.status` and `.body` for error handling.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * apiFetch — wrapper around `fetch` that automatically injects:
 *  - Authorization: Bearer <token>
 *  - X-Tenant-ID: <tenantId>
 *  - X-Outlet-ID: <outletId>
 *  - Content-Type: application/json (default, overridable)
 *
 * Throws `ApiError` on non-2xx responses so callers don't need to
 * manually check `response.ok`.
 *
 * @param path  API path relative to NEXT_PUBLIC_API_URL, e.g. '/api/v1/cashier/products'
 * @param init  Standard RequestInit options (method, body, headers, signal, ...)
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { token, tenantId, outletId } = getAuthContext();

  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token    ? { Authorization: `Bearer ${token}` }    : {}),
      ...(tenantId ? { 'X-Tenant-ID': tenantId }             : {}),
      ...(outletId ? { 'X-Outlet-ID': outletId }             : {}),
      // Caller-supplied headers override the defaults above
      ...(init.headers as Record<string, string> | undefined ?? {}),
    },
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(response.status, body);
  }

  // Return parsed JSON; for 204 No Content return null
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}
