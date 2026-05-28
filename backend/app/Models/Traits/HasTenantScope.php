<?php

namespace App\Models\Traits;

use App\Models\Scopes\TenantScope;

/**
 * HasTenantScope — convenience trait to register TenantScope on any model.
 *
 * Add to any tenant-aware Eloquent model:
 *
 *   use App\Models\Traits\HasTenantScope;
 *
 *   class Transaction extends Model
 *   {
 *       use HasTenantScope;
 *       // ...
 *   }
 *
 * This replaces the boilerplate of manually adding the global scope in boot().
 */
trait HasTenantScope
{
    /**
     * Boot the trait — register TenantScope as a global scope on this model.
     */
    protected static function bootHasTenantScope(): void
    {
        static::addGlobalScope(new TenantScope);
    }
}
