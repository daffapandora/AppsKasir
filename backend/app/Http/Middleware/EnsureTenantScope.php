<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\Auth;

/**
 * EnsureTenantScope
 *
 * Validates that the authenticated user belongs to a tenant and injects
 * tenant/outlet context into the request for downstream controllers.
 *
 * IMPORTANT: This middleware is a convenience helper only.
 * Actual data isolation MUST be enforced via:
 *   - Model global scopes (TenantScope)
 *   - Policy authorization checks
 *   - Service-layer tenant_id filters
 *
 * Never rely solely on request attributes for security.
 */
class EnsureTenantScope
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!Auth::check()) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $user = Auth::user();

        // Reject requests from users without a tenant assignment
        if (!$user->tenant_id) {
            return response()->json([
                'success' => false,
                'message' => 'User is not assigned to a tenant. Contact your administrator.',
            ], 403);
        }

        // Inject tenant/outlet context for controller convenience
        // WARNING: Do NOT use these values as the sole authorization check.
        // Always re-verify against Auth::user()->tenant_id in queries.
        $request->merge([
            'tenant_id' => $user->tenant_id,
            'outlet_id' => $user->outlet_id,
        ]);

        return $next($request);
    }
}
