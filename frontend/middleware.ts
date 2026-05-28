import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Middleware: Authentication + Role-Based Route Protection
 *
 * FIX: This middleware previously wrote auth/tenant headers onto the
 * response object, which does NOT attach them to outbound API fetch calls.
 * Auth headers are now handled by frontend/src/lib/api/client.ts (apiFetch).
 *
 * This middleware is now responsible ONLY for:
 * 1. Redirecting unauthenticated users to /login
 * 2. Redirecting authenticated users away from /login
 * 3. Role-based route protection (cashier cannot access /dashboard)
 */

// Routes that do not require authentication
const PUBLIC_ROUTES = ['/login', '/forgot-password', '/'];

// Role-based route access map
// Format: { '/path-prefix': ['allowed', 'roles'] }
const ROLE_PROTECTED_ROUTES: Record<string, string[]> = {
  '/dashboard': ['owner', 'manager'],
  '/reports':   ['owner', 'manager'],
  '/settings':  ['owner'],
  '/users':     ['owner'],
};

export function middleware(request: NextRequest) {
  const pathname  = request.nextUrl.pathname;
  const authToken = request.cookies.get('auth_token')?.value;
  const userRole  = request.cookies.get('user_role')?.value;

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // 1. Unauthenticated user trying to access protected route
  if (!isPublicRoute && !authToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Authenticated user trying to access login page
  if (authToken && pathname === '/login') {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  // 3. Role-based route protection
  // Prevents cashiers from accessing manager/owner-only routes via URL manipulation
  for (const [protectedPath, allowedRoles] of Object.entries(ROLE_PROTECTED_ROUTES)) {
    if (pathname.startsWith(protectedPath)) {
      if (!userRole || !allowedRoles.includes(userRole)) {
        // Role cookie not set or insufficient — redirect to POS (cashier default)
        return NextResponse.redirect(new URL('/pos', request.url));
      }
      break;
    }
  }

  // NOTE: Do NOT set auth/tenant/outlet headers here.
  // Use apiFetch() from frontend/src/lib/api/client.ts for all API calls.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js).*)',
  ],
};
