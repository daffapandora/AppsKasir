<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add client_uuid for idempotency and ensure tenant_id is on transactions.
 *
 * client_uuid: client-generated UUID sent with every checkout request.
 *   Combined with tenant_id, it guarantees that duplicate offline submissions
 *   or rapid retries never create duplicate financial records.
 *
 * unique index on (tenant_id, client_uuid) enforces this at the DB level —
 *   even if application-layer checks race under concurrent load.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            // Add tenant_id if it doesn't already exist
            if (!Schema::hasColumn('transactions', 'tenant_id')) {
                $table->unsignedBigInteger('tenant_id')->after('id')->nullable();
            }

            // Add client_uuid for idempotency
            if (!Schema::hasColumn('transactions', 'client_uuid')) {
                $table->uuid('client_uuid')->after('tenant_id')->nullable();
            }

            // Composite unique index: one transaction per (tenant, client UUID)
            // Use ->ignore() pattern: only add if index doesn't exist
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
