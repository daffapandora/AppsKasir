import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware for authentication and route protection.
 * Auth/tenant context is NOT injected here — use apiFetch() from src/lib/apiClient.ts
 * for all browser-originated API requests instead.
 */

const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password'];
const PUBLIC_PREFIXES = ['/api/auth'];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((route) => pathname.startsWith(route));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authToken = request.cookies.get('auth_token')?.value;

  // Redirect unauthenticated users away from protected routes
  if (!isPublicRoute(pathname) && !authToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (
    authToken &&
    (pathname === '/login' || pathname === '/register' || pathname === '/')
  ) {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js).*)',
  ],
};
