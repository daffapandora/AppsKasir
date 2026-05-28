<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AuthController extends Controller
{
    /**
     * Authenticate user and return Sanctum token.
     *
     * Rate limited: max 5 attempts per email+IP per 60 seconds.
     * Does NOT revoke other active tokens — multi-device sessions are preserved.
     * To enforce single-session-per-device, the client should call /auth/logout
     * on the previous device before logging in on a new one.
     */
    public function login(Request $request)
    {
        $credentials = $request->validate([
            'email'    => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $throttleKey = Str::lower($request->input('email')) . '|' . $request->ip();

        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json([
                'success' => false,
                'message' => "Too many login attempts. Please try again in {$seconds} seconds.",
                'retry_after' => $seconds,
            ], Response::HTTP_TOO_MANY_REQUESTS);
        }

        if (!Auth::attempt($credentials)) {
            RateLimiter::hit($throttleKey, 60);

            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials.',
            ], Response::HTTP_UNAUTHORIZED);
        }

        RateLimiter::clear($throttleKey);

        $user = Auth::user();

        if (!$user->is_active) {
            Auth::logout();

            return response()->json([
                'success' => false,
                'message' => 'Account is deactivated.',
            ], Response::HTTP_FORBIDDEN);
        }

        $user->update(['last_login_at' => now()]);

        // Create token — existing tokens from other devices are preserved
        $token = $user->createToken('pos-client')->plainTextToken;

        $user->load(['tenant', 'outlet']);

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
            ],
        ]);
    }

    /**
     * Get current authenticated user.
     */
    public function me(Request $request)
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
            ],
        ]);
    }

    /**
     * Refresh the access token (rotate current token only).
     */
    public function refresh(Request $request)
    {
        $user = $request->user();
        $user->currentAccessToken()?->delete();
        $token = $user->createToken('pos-client')->plainTextToken;

        return response()->json([
            'success' => true,
            'data' => [
                'accessToken' => $token,
            ],
        ]);
    }

    /**
     * Logout user (revoke current device token only).
     */
    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json([
            'success' => true,
            'message' => 'Logged out successfully.',
        ]);
    }
}
