<?php

namespace App\Services;

use App\Models\{Transaction, TransactionItem, TransactionDiscount, Payment, Inventory};
use Illuminate\Support\Facades\{DB, Auth, Event};
use App\Exceptions\{InsufficientStockException, InvalidTransactionException};
use App\Events\TransactionCreated;

/**
 * TransactionService
 * Core POS transaction processing with ACID guarantees and idempotency.
 *
 * IDEMPOTENCY CONTRACT:
 * Every checkout request MUST include a client_uuid (UUID v4) generated on the
 * frontend before submission. If the same UUID is received again (retry/double-tap),
 * the existing transaction is returned immediately — no duplicate is created.
 */
class TransactionService
{
    /**
     * Create (or retrieve existing) transaction.
     * Enforces idempotency via client_uuid unique constraint.
     *
     * @throws InsufficientStockException
     * @throws InvalidTransactionException
     */
    public function createTransaction(array $data): Transaction
    {
        $this->validateTransactionData($data);

        // --- IDEMPOTENCY CHECK ---
        // Must happen OUTSIDE the DB::transaction to avoid unnecessary locking
        $existing = Transaction::where('tenant_id', $data['tenant_id'])
            ->where('client_uuid', $data['client_uuid'])
            ->first();

        if ($existing) {
            // Safe to return: duplicate request, same transaction
            return $existing;
        }

        // Wrap the actual write in an ACID transaction with deadlock retry
        return DB::transaction(function () use ($data) {
            // Re-check inside transaction to handle race conditions
            $existing = Transaction::where('tenant_id', $data['tenant_id'])
                ->where('client_uuid', $data['client_uuid'])
                ->lockForUpdate()
                ->first();

            if ($existing) {
                return $existing;
            }

            // Create transaction record with idempotency key
            $transaction = Transaction::create([
                'tenant_id'       => $data['tenant_id'],
                'outlet_id'       => $data['outlet_id'],
                'shift_id'        => $data['shift_id'] ?? null,
                'created_by'      => Auth::id(),
                'client_uuid'     => $data['client_uuid'],
                'customer_name'   => $data['customer_name'] ?? null,
                'customer_phone'  => $data['customer_phone'] ?? null,
                'customer_id'     => $data['customer_id'] ?? null,
                'payment_method'  => $data['payment_method'] ?? 'CASH',
                'status'          => 'PENDING',
                'payment_status'  => 'PENDING',
            ]);

            // Process line items and verify stock
            $totals = $this->processTransactionItems(
                $transaction,
                $data['items'] ?? [],
                $data['outlet_id']
            );

            // Apply discounts
            $discountAmount = 0;
            if (!empty($data['discounts'])) {
                $discountAmount = $this->applyDiscounts($transaction, $data['discounts'], $totals['subtotal']);
            }

            // Calculate tax
            $taxRate        = floatval(config('app.tax_rate', 0.10));
            $subtotal       = $totals['subtotal'];
            $taxableBase    = max(0, $subtotal - $discountAmount);
            $taxAmount      = $taxableBase * $taxRate;
            $totalAmount    = $taxableBase + $taxAmount;

            // Update transaction totals
            $transaction->update([
                'subtotal_amount' => $subtotal,
                'discount_amount' => $discountAmount,
                'tax_amount'      => $taxAmount,
                'total_amount'    => $totalAmount,
            ]);

            // Record payment
            $this->processPayment(
                $transaction,
                $data['payment_method'],
                $totalAmount,
                $data['payment_details'] ?? []
            );

            // Deduct inventory (after all validation passed)
            $this->deductInventory($transaction);

            // Mark completed
            $transaction->update([
                'status'          => 'COMPLETED',
                'payment_status'  => 'COMPLETED',
                'completed_at'    => now(),
            ]);

            // Broadcast for real-time dashboard / CFD
            Event::dispatch(new TransactionCreated($transaction));

            return $transaction;

        }, attempts: 3);
    }

    /**
     * Validate required top-level fields before any DB work.
     * client_uuid is mandatory to enable idempotency.
     */
    private function validateTransactionData(array $data): void
    {
        if (empty($data['client_uuid'])) {
            throw new InvalidTransactionException(
                'client_uuid is required to ensure transaction idempotency. Generate a UUID v4 on the client before submitting.'
            );
        }

        if (empty($data['tenant_id'])) {
            throw new InvalidTransactionException('tenant_id is missing. Ensure the user is assigned to a tenant.');
        }

        if (empty($data['outlet_id'])) {
            throw new InvalidTransactionException('outlet_id is required.');
        }

        if (empty($data['items']) || !is_array($data['items']) || count($data['items']) === 0) {
            throw new InvalidTransactionException('Transaction must contain at least one item.');
        }
    }

    /**
     * Process transaction items, verify stock, create TransactionItem records.
     * Reserves stock immediately to prevent over-selling under concurrency.
     *
     * @return array{subtotal: float}
     * @throws InsufficientStockException
     */
    private function processTransactionItems(Transaction $transaction, array $items, int $outletId): array
    {
        $subtotal = 0;

        foreach ($items as $item) {
            $inventory = Inventory::where('product_id', $item['product_id'])
                ->where('outlet_id', $outletId)
                ->lockForUpdate()
                ->first();

            if (!$inventory) {
                throw new InsufficientStockException(
                    productId: $item['product_id'],
                    available: 0,
                    requested: $item['quantity']
                );
            }

            $available = $inventory->quantity - $inventory->reserved_quantity;

            if ($available < $item['quantity']) {
                throw new InsufficientStockException(
                    productId: $item['product_id'],
                    available: $available,
                    requested: $item['quantity']
                );
            }

            $product   = $inventory->product;
            $unitPrice = $item['unit_price'] ?? $product->base_price;
            $lineTotal = $unitPrice * $item['quantity'];

            TransactionItem::create([
                'transaction_id'      => $transaction->id,
                'product_id'          => $item['product_id'],
                'product_variant_id'  => $item['product_variant_id'] ?? null,
                'product_name'        => $product->name,
                'product_sku'         => $product->sku,
                'quantity'            => $item['quantity'],
                'unit_price'          => $unitPrice,
                'discount_per_item'   => $item['discount_per_item'] ?? 0,
                'line_total'          => $lineTotal,
                'notes'               => $item['notes'] ?? null,
            ]);

            // Reserve stock immediately to prevent over-selling
            $inventory->increment('reserved_quantity', $item['quantity']);

            $subtotal += $lineTotal;
        }

        return ['subtotal' => $subtotal];
    }

    /**
     * Apply discounts and record each discount line.
     * Fixed discounts are capped at the current subtotal to prevent negative totals.
     */
    private function applyDiscounts(Transaction $transaction, array $discounts, float $subtotal): float
    {
        $totalDiscount = 0;

        foreach ($discounts as $discount) {
            $amount = match ($discount['type']) {
                'PERCENTAGE' => ($subtotal * min(100, $discount['value'])) / 100,
                'FIXED'      => min($discount['value'], $subtotal),
                default      => 0,
            };

            TransactionDiscount::create([
                'transaction_id'  => $transaction->id,
                'discount_code'   => $discount['code'] ?? null,
                'discount_type'   => $discount['type'],
                'discount_value'  => $discount['value'],
                'discount_amount' => $amount,
                'description'     => $discount['description'] ?? null,
            ]);

            $totalDiscount += $amount;
        }

        // Never allow total discount to exceed subtotal
        return min($totalDiscount, $subtotal);
    }

    /**
     * Record payment entry.
     */
    private function processPayment(
        Transaction $transaction,
        string $paymentMethod,
        float $amount,
        array $paymentDetails
    ): void {
        Payment::create([
            'transaction_id'   => $transaction->id,
            'payment_method'   => $paymentMethod,
            'amount'           => $amount,
            'status'           => 'COMPLETED',
            'reference_number' => $paymentDetails['reference_number'] ?? null,
            'gateway_response' => isset($paymentDetails['gateway_response'])
                ? json_encode($paymentDetails['gateway_response'])
                : null,
            'batch_number'     => $paymentDetails['batch_number'] ?? null,
        ]);
    }

    /**
     * Deduct inventory after all validation has passed.
     * Uses lockForUpdate to prevent race conditions.
     */
    private function deductInventory(Transaction $transaction): void
    {
        foreach ($transaction->items as $item) {
            $inventory = Inventory::where('product_id', $item->product_id)
                ->where('outlet_id', $transaction->outlet_id)
                ->lockForUpdate()
                ->first();

            if (!$inventory) {
                throw new InsufficientStockException(
                    productId: $item->product_id,
                    available: 0,
                    requested: $item->quantity
                );
            }

            if ($item->product->is_recipe_based && $item->product->recipe) {
                $this->deductRecipeIngredients($item->product->recipe, $item->quantity, $transaction->outlet_id);
            } else {
                $inventory->decrement('quantity', $item->quantity);
                $inventory->decrement('reserved_quantity', $item->quantity);

                $inventory->movements()->create([
                    'movement_type'    => 'SALE',
                    'quantity_before'  => $inventory->quantity + $item->quantity,
                    'quantity_after'   => $inventory->quantity,
                    'quantity_changed' => -$item->quantity,
                    'reference_id'     => $transaction->id,
                    'reference_type'   => 'Transaction',
                    'reason'           => 'Sale transaction ' . $transaction->order_number,
                    'created_by'       => Auth::id(),
                ]);
            }
        }
    }

    /**
     * Void a transaction and restore inventory.
     */
    public function voidTransaction(Transaction $transaction, string $reason, int $voidedBy): Transaction
    {
        return DB::transaction(function () use ($transaction, $reason, $voidedBy) {
            // Restore inventory
            foreach ($transaction->items as $item) {
                $inventory = Inventory::where('product_id', $item->product_id)
                    ->where('outlet_id', $transaction->outlet_id)
                    ->lockForUpdate()
                    ->first();

                if ($inventory) {
                    $inventory->increment('quantity', $item->quantity);

                    $inventory->movements()->create([
                        'movement_type'    => 'VOID',
                        'quantity_before'  => $inventory->quantity - $item->quantity,
                        'quantity_after'   => $inventory->quantity,
                        'quantity_changed' => $item->quantity,
                        'reference_id'     => $transaction->id,
                        'reference_type'   => 'Transaction',
                        'reason'           => 'Void: ' . $reason,
                        'created_by'       => $voidedBy,
                    ]);
                }
            }

            $transaction->update([
                'status'               => 'VOIDED',
                'payment_status'       => 'FAILED',
                'void_reason'          => $reason,
                'voided_by'            => $voidedBy,
                'voided_at'            => now(),
                'manager_pin_verified' => true,
            ]);

            return $transaction->fresh();
        });
    }

    /**
     * Hold a pending transaction.
     */
    public function holdTransaction(Transaction $transaction): Transaction
    {
        $transaction->update(['status' => 'HELD', 'held_at' => now()]);
        return $transaction->fresh();
    }

    /**
     * Resume a held transaction.
     */
    public function resumeTransaction(Transaction $transaction): Transaction
    {
        $transaction->update(['status' => 'PENDING']);
        return $transaction->fresh();
    }

    /**
     * Process an offline-synced transaction batch.
     * Each transaction is processed individually with idempotency.
     */
    public function processOfflineSync(array $txData, int $tenantId): Transaction
    {
        return $this->createTransaction(array_merge($txData, ['tenant_id' => $tenantId]));
    }

    /**
     * Deduct recipe-based ingredients from inventory.
     * Placeholder: implement per your recipe/BOM data model.
     */
    private function deductRecipeIngredients($recipe, int $quantity, int $outletId): void
    {
        // TODO: Implement recipe ingredient deduction logic
        // Iterate $recipe->ingredients, deduct each ingredient's inventory
    }
}
