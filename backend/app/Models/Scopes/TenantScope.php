<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Support\Facades\Auth;

/**
 * TenantScope — Global Eloquent scope for multi-tenant data isolation.
 *
 * When registered on a model, every SELECT, UPDATE, and DELETE automatically
 * receives a WHERE tenant_id = <authenticated user tenant> clause.
 *
 * This prevents accidental cross-tenant data leakage even if a controller
 * forgets to add an explicit tenant filter.
 *
 * Usage — add to model boot():
 *   protected static function booted(): void
 *   {
 *       static::addGlobalScope(new TenantScope);
 *   }
 *
 * Or use the HasTenantScope trait (recommended — same result, less boilerplate).
 *
 * Bypassing for admin/CLI:
 *   Transaction::withoutGlobalScope(TenantScope::class)->get();
 *   // or
 *   Transaction::withoutGlobalScopes()->get();
 */
class TenantScope implements Scope
{
    /**
     * Apply the scope to a given Eloquent query builder.
     */
    public function apply(Builder $builder, Model $model): void
    {
        // Only apply when there is an authenticated user with a tenant
        if (Auth::check() && Auth::user()->tenant_id !== null) {
            $builder->where(
                $model->getTable() . '.tenant_id',
                Auth::user()->tenant_id
            );
        }
    }
}
