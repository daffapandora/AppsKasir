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
     * Authenticate user and return token.
     * Includes rate limiting: max 5 attempts per minute per email+IP.
     */
    public function login(Request $request)
    {
        $credentials = $request->validate([
            'email'    => 'required|email',
            'password' => 'required|string',
        ]);

        // Rate limiting key: email + IP address
        $throttleKey = Str::lower($request->input('email')) . '|' . $request->ip();

        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);
            return response()->json([
                'success' => false,
                'message' => "Too many login attempts. Please try again in {$seconds} seconds.",
            ], Response::HTTP_TOO_MANY_REQUESTS);
        }

        if (!Auth::attempt($credentials)) {
            RateLimiter::hit($throttleKey, 60);
            return response()->json([
                'success' => false,
                'message' => 'Invalid credentials',
            ], 401);
        }

        // Clear rate limiter on successful login
        RateLimiter::clear($throttleKey);

        $user = Auth::user();

        if (!$user->is_active) {
            Auth::logout();
            return response()->json([
                'success' => false,
                'message' => 'Account is deactivated',
            ], 403);
        }

        $user->update(['last_login_at' => now()]);

        // Only delete current-device tokens on login (preserve other device sessions)
        // Use tokens()->delete() only if single-session is explicitly required.
        // For multi-device support, we just create a new token.
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
                'tenant' => $user->tenant ? [
                    'id'   => $user->tenant->id,
                    'name' => $user->tenant->name,
                ] : null,
                'outlet' => $user->outlet ? [
                    'id'   => $user->outlet->id,
                    'name' => $user->outlet->name,
                ] : null,
            ],
        ]);
    }

    /**
     * Return the authenticated user's profile.
     */
    public function me(Request $request)
    {
        $user = $request->user()->load(['tenant', 'outlet']);

        return response()->json([
            'success' => true,
            'data' => [
                'id'     => $user->id,
                'name'   => $user->name,
                'email'  => $user->email,
                'role'   => $user->role,
                'tenant' => $user->tenant ? [
                    'id'   => $user->tenant->id,
                    'name' => $user->tenant->name,
                ] : null,
                'outlet' => $user->outlet ? [
                    'id'   => $user->outlet->id,
                    'name' => $user->outlet->name,
                ] : null,
            ],
        ]);
    }

    /**
     * Rotate access token (refresh). Only rotates the current device token.
     */
    public function refresh(Request $request)
    {
        $user = $request->user();

        // Delete only the current token, not all tokens (preserve other devices)
        $request->user()->currentAccessToken()?->delete();
        $token = $user->createToken('pos-client')->plainTextToken;

        return response()->json([
            'success' => true,
            'data'    => ['accessToken' => $token],
        ]);
    }

    /**
     * Logout: revoke only the current device token.
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
