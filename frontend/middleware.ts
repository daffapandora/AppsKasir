import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * PUBLIC_ROUTES — paths that never require authentication.
 * All other paths redirect to /login if the token is missing or expired.
 */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password'];

/**
 * AUTH_API_PREFIXES — API paths that are themselves part of the auth flow
 * and must be callable without a valid token.
 */
const AUTH_API_PREFIXES = ['/api/auth'];

/**
 * isTokenExpired — decode the JWT payload (without verification — that is
 * the backend's job) and check whether the `exp` claim is in the past.
 *
 * Returns true  → token is definitely expired or malformed.
 * Returns false → token is present and not yet expired (backend still
 *                 verifies signature and revocation).
 */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;

    // Base64url → Base64 → JSON
    const payload = JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf-8')
    );

    if (typeof payload.exp !== 'number') {
      // No expiry claim — treat as non-expiring (Sanctum opaque tokens)
      return false;
    }

    // Add a 30-second clock-skew buffer
    return Date.now() / 1000 > payload.exp - 30;
  } catch {
    // Malformed token — treat as expired
    return true;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes
  if (PUBLIC_ROUTES.some((r) => pathname === r)) {
    return NextResponse.next();
  }

  // Always allow auth API endpoints
  if (AUTH_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow Next.js internals and static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  const authToken = request.cookies.get('auth_token')?.value;

  // No token at all → redirect to login
  if (!authToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Token present but expired → redirect to login with session-expired flag
  if (isTokenExpired(authToken)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    loginUrl.searchParams.set('reason', 'session_expired');
    const response = NextResponse.redirect(loginUrl);
    // Clear the stale cookie so the login page doesn't loop
    response.cookies.delete('auth_token');
    return response;
  }

  // Token looks valid — allow the request through.
  // Do NOT inject auth headers onto the response object here;
  // outgoing API fetch calls must attach headers via the apiFetch helper
  // in frontend/src/lib/api-client.ts.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
