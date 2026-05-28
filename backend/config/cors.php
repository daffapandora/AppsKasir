<?php

/**
 * CORS Configuration
 *
 * Restrict API access to known frontend origins.
 * In production, replace '*' in allowed_origins with your actual domain(s).
 *
 * SECURITY NOTE:
 * - Never set allowed_origins to ['*'] in production
 * - Set allowed_credentials to true only when cookies/auth tokens are required
 * - Only expose headers that the frontend actually needs
 */

return [
    /*
     * Paths that will be CORS-protected.
     */
    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    /*
     * Allowed origins.
     * Override via APP_ALLOWED_ORIGINS env variable (comma-separated).
     * Example: APP_ALLOWED_ORIGINS=https://kasir.yourdomain.com,https://admin.yourdomain.com
     */
    'allowed_origins' => array_filter(
        explode(',', env('APP_ALLOWED_ORIGINS', 'http://localhost:3000'))
    ),

    'allowed_origins_patterns' => [],

    'allowed_headers' => [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Tenant-ID',
        'X-Outlet-ID',
        'Accept',
    ],

    'exposed_headers' => [],

    'max_age' => 86400,

    /*
     * Required for Sanctum cookie-based auth.
     */
    'supports_credentials' => true,
];
