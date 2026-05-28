<?php
namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    /**
     * Authenticate user and return Sanctum token.
     * Hardened: rate-limited to 5 attempts per minute per email+IP.
     */
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'email'    => 'required|email|max:255',
            'password' => 'required|string|min:6|max:128',
        ]);

        // Throttle: 5 attempts per email+IP per 60 seconds
        $throttleKey = Str::lower($request->input('email')) . '|' . $request->ip();
        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return response()->json([
                'success' => false,
                'message' => "Too many login attempts. Please try again in {$seconds} seconds.",
            ], 429);
        }

        if (!Auth::attempt($request->only('email', 'password'))) {
            RateLimiter::hit($throttleKey, 60);
            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials',
            ], 401);
        }

        // Clear throttle on success
        RateLimiter::clear($throttleKey);

        $user = Auth::user();

        if (!$user->is_active) {
            return response()->json([
                'success' => false,
                'message' => 'Account is deactivated. Contact your administrator.',
            ], 403);
        }

        $user->update(['last_login_at' => now()]);

        // Create named token per device — do NOT revoke all tokens (multi-device support)
        $deviceName = $request->input('device_name', 'pos-client');
        $token = $user->createToken($deviceName)->plainTextToken;

        return response()->json([
            'success' => true,
            'data' => [
                'accessToken' => $token,
                'user' => [
                    'id'    => $user->id,
                    'name'  => $user->name,
                    'email' => $user->email,
                    'role'  => $user->role,
                ],
                'tenant' => $user->tenant_id ? [
                    'id'   => $user->tenant->id,
                    'name' => $user->tenant->name,
                ] : null,
                'outlet' => $user->outlet_id ? [
                    'id'   => $user->outlet->id,
                    'name' => $user->outlet->name,
                ] : null,
                'tenantId' => $user->tenant_id,
                'outletId' => $user->outlet_id,
            ]
        ]);
    }

    /**
     * Get current authenticated user with tenant and outlet context.
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load(['tenant', 'outlet']);

        return response()->json([
            'success' => true,
            'data' => [
                'user' => [
                    'id'    => $user->id,
                    'name'  => $user->name,
                    'email' => $user->email,
                    'role'  => $user->role,
                ],
                'tenant' => $user->tenant_id ? [
                    'id'   => $user->tenant->id,
                    'name' => $user->tenant->name,
                ] : null,
                'outlet' => $user->outlet_id ? [
                    'id'   => $user->outlet->id,
                    'name' => $user->outlet->name,
                ] : null,
                'tenantId' => $user->tenant_id,
                'outletId' => $user->outlet_id,
            ]
        ]);
    }

    /**
     * Rotate the current access token (issue new, revoke old).
     */
    public function refresh(Request $request): JsonResponse
    {
        $user  = $request->user();
        $oldId = $user->currentAccessToken()->id;
        $name  = $user->currentAccessToken()->name ?? 'pos-client';

        // Create new token first, then revoke old one atomically
        $newToken = $user->createToken($name)->plainTextToken;
        $user->tokens()->where('id', $oldId)->delete();

        return response()->json([
            'success' => true,
            'data' => ['accessToken' => $newToken],
        ]);
    }

    /**
     * Revoke the current token (logout this device only).
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json([
            'success' => true,
            'message' => 'Logged out successfully',
        ]);
    }
}
