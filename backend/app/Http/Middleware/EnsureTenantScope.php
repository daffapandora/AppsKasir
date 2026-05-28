<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class EnsureTenantScope
{
    /**
     * Enforce tenant and outlet scope on every authenticated request.
     *
     * 1. Injects tenant_id and outlet_id from the authenticated user into the
     *    request so controllers never need to read them from user input.
     * 2. Validates that any X-Tenant-ID or X-Outlet-ID headers sent by the
     *    client actually match the authenticated user, preventing tenant-
     *    hopping attacks where a malicious client sends arbitrary IDs.
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (!Auth::check()) {
            return $next($request);
        }

        $user = Auth::user();

        // --- Header spoofing validation ---
        // Reject requests where the client sends a tenant header that does
        // not match the authenticated user's tenant.
        $requestedTenantId = $request->header('X-Tenant-ID');
        if ($requestedTenantId !== null && (int) $requestedTenantId !== (int) $user->tenant_id) {
            abort(403, 'Forbidden: tenant scope mismatch.');
        }

        // Reject requests where the client sends an outlet header that does
        // not match the user's assigned outlet (if the user is outlet-scoped).
        $requestedOutletId = $request->header('X-Outlet-ID');
        if (
            $user->outlet_id !== null &&
            $requestedOutletId !== null &&
            (int) $requestedOutletId !== (int) $user->outlet_id
        ) {
            abort(403, 'Forbidden: outlet scope mismatch.');
        }

        // --- Inject canonical scope into request ---
        // Always overwrite with values from the authenticated user so that
        // controllers can safely trust $request->tenant_id and outlet_id.
        $request->merge([
            'tenant_id' => $user->tenant_id,
            'outlet_id' => $user->outlet_id ?? $requestedOutletId,
        ]);

        return $next($request);
    }
}
