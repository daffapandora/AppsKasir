import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware — route protection only.
 *
 * WHAT THIS FILE DOES:
 *  - Redirects unauthenticated users to /login
 *  - Redirects authenticated users away from /login and /register
 *  - Stubs role-aware guard (TODO: expand as role cookie is implemented)
 *
 * WHAT THIS FILE DOES NOT DO (and should not do):
 *  - Set auth/tenant/outlet headers on API requests
 *    → That is handled by apiFetch() in src/lib/apiFetch.ts
 *    → Middleware runs on the *response* object; headers set here are
 *      NOT inherited by subsequent browser fetch() calls.
 *
 * TOKEN VALIDATION NOTE:
 *  Currently we only check for cookie *presence*. A future improvement
 *  is to verify the token with a lightweight server-side check here
 *  (e.g., calling /api/v1/auth/verify) so expired tokens redirect to
 *  login before the user sees protected UI. Tracked in GitHub Issue.
 */
export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Routes that do not require authentication
  const publicRoutes = [
    '/login',
    '/register',
    '/forgot-password',
    '/',
    '/api/auth',
  ];
  const isPublicRoute = publicRoutes.some((route) =>
    pathname.startsWith(route)
  );

  const authToken = request.cookies.get('auth_token')?.value;
  const userRole = request.cookies.get('user_role')?.value;

  // 1. Redirect unauthenticated users away from protected routes
  if (!isPublicRoute && !authToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Redirect authenticated users away from auth pages
  if (
    isPublicRoute &&
    authToken &&
    (pathname === '/login' || pathname === '/register')
  ) {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  // 3. Role-based route guards
  //    Expand this as manager/owner/admin routes are implemented.
  const managerRoutes = ['/manager', '/reports', '/settings/users'];
  const ownerRoutes = ['/owner', '/settings/outlets', '/settings/billing'];

  const isManagerRoute = managerRoutes.some((r) => pathname.startsWith(r));
  const isOwnerRoute = ownerRoutes.some((r) => pathname.startsWith(r));

  if (isManagerRoute && userRole === 'CASHIER') {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  if (isOwnerRoute && userRole !== 'OWNER') {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  // Allow the request to proceed — do NOT set headers on response here.
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js).*)',
  ],
};
