/**
 * Central API client — attaches auth token + tenant/outlet context
 * to every outgoing browser fetch request.
 *
 * Use apiFetch() everywhere instead of raw fetch() for API calls.
 */

type CookieName = 'auth_token' | 'tenant_id' | 'outlet_id';

function getCookie(name: CookieName): string | undefined {
  if (typeof document === 'undefined') return undefined;

  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.split('=')[1]) : undefined;
}

export function getAuthContext() {
  return {
    token: getCookie('auth_token'),
    tenantId: getCookie('tenant_id'),
    outletId: getCookie('outlet_id'),
  };
}

export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const { token, tenantId, outletId } = getAuthContext();

  const headers = new Headers(init.headers || {});

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (tenantId) headers.set('X-Tenant-ID', tenantId);
  if (outletId) headers.set('X-Outlet-ID', outletId);

  return fetch(path, {
    ...init,
    headers,
  });
}
