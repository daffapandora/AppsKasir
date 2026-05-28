<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration: Add client_uuid to transactions table.
 *
 * Enables idempotency: the same client_uuid from a given tenant
 * cannot create two transaction records. This prevents duplicate orders
 * from retry storms, double-taps, and offline sync replay.
 *
 * The unique constraint is COMPOSITE (tenant_id + client_uuid) so that
 * different tenants can use the same UUID space independently.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            // client_uuid is nullable to support rows created before this migration
            $table->uuid('client_uuid')->nullable()->after('id');

            // Composite unique index: prevents duplicate transactions per tenant
            // Also ensures multi-tenant correctness (different tenants can share UUID space)
            $table->unique(['tenant_id', 'client_uuid'], 'transactions_tenant_client_uuid_unique');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropUnique('transactions_tenant_client_uuid_unique');
            $table->dropColumn('client_uuid');
        });
    }
};
