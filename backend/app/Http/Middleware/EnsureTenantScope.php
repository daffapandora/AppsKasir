<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class EnsureTenantScope
{
    /**
     * Validate inbound tenant/outlet context and inject into request.
     *
     * - Rejects requests where X-Tenant-ID header doesn't match the
     *   authenticated user's tenant, preventing cross-tenant requests.
     * - Rejects requests where X-Outlet-ID header doesn't match the
     *   user's outlet (for outlet-scoped users such as cashiers).
     * - Merges verified tenant_id and outlet_id into the request payload
     *   so downstream controllers and services can rely on them.
     *
     * NOTE: This middleware is a first layer of defence. For full protection,
     * models should also use global query scopes or repository boundaries
     * that enforce tenant_id on every query. See TODO in GitHub Issues.
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (!Auth::check()) {
            return $next($request);
        }

        $user = Auth::user();

        // Validate inbound X-Tenant-ID if present
        $requestedTenantId = $request->header('X-Tenant-ID');
        if ($requestedTenantId !== null && (int) $requestedTenantId !== (int) $user->tenant_id) {
            abort(Response::HTTP_FORBIDDEN, 'Tenant scope mismatch.');
        }

        // Validate inbound X-Outlet-ID if present and user is outlet-scoped
        $requestedOutletId = $request->header('X-Outlet-ID');
        if (
            $user->outlet_id !== null &&
            $requestedOutletId !== null &&
            (int) $requestedOutletId !== (int) $user->outlet_id
        ) {
            abort(Response::HTTP_FORBIDDEN, 'Outlet scope mismatch.');
        }

        // Merge verified scope into request — downstream code can trust these values
        $request->merge([
            'tenant_id' => $user->tenant_id,
            'outlet_id' => $user->outlet_id ?? ($requestedOutletId ? (int) $requestedOutletId : null),
        ]);

        return $next($request);
    }
}
