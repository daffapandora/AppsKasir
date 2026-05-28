<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration: Add client_uuid column and composite unique index to transactions.
 *
 * This enforces idempotency at the database level:
 * - client_uuid is generated on the client (frontend) before checkout
 * - The unique index on (tenant_id, client_uuid) prevents duplicate financial
 *   records even if a retry, network error, or offline-sync fires the same
 *   request twice
 *
 * The column is nullable to allow gradual rollout without breaking existing rows.
 * New rows must always supply client_uuid (enforced in TransactionService).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            // Add client_uuid if it doesn't exist yet
            if (!Schema::hasColumn('transactions', 'client_uuid')) {
                $table->uuid('client_uuid')->nullable()->after('id');
            }

            // Composite unique index: one client_uuid per tenant
            // Allows different tenants to reuse UUIDs independently
            $table->unique(['tenant_id', 'client_uuid'], 'transactions_tenant_client_uuid_unique');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropUnique('transactions_tenant_client_uuid_unique');

            if (Schema::hasColumn('transactions', 'client_uuid')) {
                $table->dropColumn('client_uuid');
            }
        });
    }
};
