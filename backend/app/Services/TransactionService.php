<?php

namespace App\Services;

use App\Models\{Transaction, TransactionItem, TransactionDiscount, Payment, Inventory};
use Illuminate\Support\Facades\{DB, Auth, Event};
use App\Exceptions\{InsufficientStockException, InvalidTransactionException};
use App\Events\TransactionCreated;

/**
 * TransactionService - Core POS transaction processing
 * Handles checkout flow with strict ACID transactions and idempotency
 */
class TransactionService
{
    /**
     * Create a new transaction with strict database transaction handling.
     *
     * Idempotency: client_uuid is REQUIRED. If a transaction with the same
     * (tenant_id, client_uuid) already exists, it is returned immediately
     * without any side effects, making retries and offline-sync safe.
     *
     * @param  array $data Transaction data with items, discounts, payment method
     * @return Transaction Created or existing transaction
     * @throws InvalidTransactionException If validation fails
     * @throws InsufficientStockException  If stock is unavailable
     */
    public function createTransaction(array $data): Transaction
    {
        return DB::transaction(function () use ($data) {
            // Step 1: Validate all required fields (including client_uuid)
            $this->validateTransactionData($data);

            $user = Auth::user();
            $clientUuid = $data['client_uuid'];

            // Step 2: Idempotency check — return early if already processed
            // This must happen INSIDE the DB transaction to prevent race conditions.
            $existing = Transaction::where('tenant_id', $user->tenant_id)
                ->where('client_uuid', $clientUuid)
                ->first();

            if ($existing) {
                return $existing->load(['items', 'discounts', 'payments']);
            }

            // Step 3: Create transaction record
            $transaction = Transaction::create([
                'tenant_id'      => $user->tenant_id,
                'outlet_id'      => $data['outlet_id'],
                'shift_id'       => $data['shift_id'] ?? null,
                'client_uuid'    => $clientUuid,
                'created_by'     => $user->id,
                'customer_name'  => $data['customer_name'] ?? null,
                'customer_phone' => $data['customer_phone'] ?? null,
                'customer_id'    => $data['customer_id'] ?? null,
                'payment_method' => $data['payment_method'] ?? 'CASH',
                'status'         => 'PENDING',
                'payment_status' => 'PENDING',
            ]);

            // Step 4: Process items and deduct/reserve inventory
            $totals = $this->processTransactionItems(
                $transaction,
                $data['items'] ?? [],
                (int) $data['outlet_id']
            );

            $subtotal = $totals['subtotal'];

            // Step 5: Apply discounts (pass subtotal explicitly — not from model)
            $discountAmount = 0;
            if (!empty($data['discounts'])) {
                $discountAmount = $this->applyDiscounts(
                    $transaction,
                    $data['discounts'],
                    $subtotal
                );
            }

            // Step 6: Calculate final totals
            $taxRate       = (float) config('app.tax_rate', 0.10);
            $taxableBase   = max(0, $subtotal - $discountAmount);
            $taxAmount     = round($taxableBase * $taxRate, 2);
            $totalAmount   = round($taxableBase + $taxAmount, 2);

            $transaction->update([
                'subtotal_amount' => $subtotal,
                'discount_amount' => $discountAmount,
                'tax_amount'      => $taxAmount,
                'total_amount'    => $totalAmount,
            ]);

            // Step 7: Record payment
            if (!empty($data['payment_method'])) {
                $this->processPayment(
                    $transaction,
                    $data['payment_method'],
                    $totalAmount,
                    $data['payment_details'] ?? []
                );
            }

            // Step 8: Finalize
            $transaction->update([
                'status'         => 'COMPLETED',
                'payment_status' => 'COMPLETED',
                'completed_at'   => now(),
            ]);

            Event::dispatch(new TransactionCreated($transaction));

            return $transaction->load(['items', 'discounts', 'payments']);
        }, 3);
    }

    /**
     * Validate all required fields for transaction creation.
     * client_uuid is mandatory for idempotency.
     */
    private function validateTransactionData(array $data): void
    {
        if (empty($data['outlet_id'])) {
            throw new InvalidTransactionException('Outlet ID is required');
        }

        if (empty($data['client_uuid'])) {
            throw new InvalidTransactionException(
                'client_uuid is required for idempotent transaction creation'
            );
        }

        if (empty($data['items']) || !is_array($data['items']) || count($data['items']) === 0) {
            throw new InvalidTransactionException('Transaction must have at least one item');
        }
    }

    /**
     * Process transaction items: validate stock, create records, reserve inventory.
     *
     * @return array ['subtotal' => float]
     */
    private function processTransactionItems(
        Transaction $transaction,
        array $items,
        int $outletId
    ): array {
        $subtotal = 0;

        foreach ($items as $item) {
            $inventory = Inventory::where('product_id', $item['product_id'])
                ->where('outlet_id', $outletId)
                ->lockForUpdate()
                ->first();

            if (!$inventory) {
                throw new InsufficientStockException(
                    "Product {$item['product_id']} not found in inventory for outlet {$outletId}"
                );
            }

            $available = $inventory->quantity - $inventory->reserved_quantity;
            if ($available < $item['quantity']) {
                throw new InsufficientStockException(
                    "Insufficient stock for product {$item['product_id']}: "
                    . "requested {$item['quantity']}, available {$available}"
                );
            }

            $unitPrice = $item['unit_price'] ?? $inventory->product->price ?? 0;
            $lineTotal = round($unitPrice * $item['quantity'], 2);

            TransactionItem::create([
                'transaction_id'       => $transaction->id,
                'product_id'           => $item['product_id'],
                'product_variant_id'   => $item['product_variant_id'] ?? null,
                'quantity'             => $item['quantity'],
                'unit_price'           => $unitPrice,
                'line_total'           => $lineTotal,
                'notes'                => $item['notes'] ?? null,
            ]);

            // Reserve inventory (deducted after completion in production;
            // here we increment reserved_quantity atomically)
            $inventory->increment('reserved_quantity', $item['quantity']);

            $subtotal += $lineTotal;
        }

        return ['subtotal' => $subtotal];
    }

    /**
     * Apply order-level discounts.
     * Receives explicit $subtotal to avoid reading unset model attribute.
     *
     * @return float Total discount amount (capped at subtotal)
     */
    private function applyDiscounts(
        Transaction $transaction,
        array $discounts,
        float $subtotal
    ): float {
        $totalDiscount = 0;

        foreach ($discounts as $discount) {
            $discountAmount = match ($discount['type']) {
                'PERCENTAGE' => round(($subtotal * $discount['value']) / 100, 2),
                'FIXED'      => (float) $discount['value'],
                default      => 0,
            };

            $discountAmount = max(0, $discountAmount);

            TransactionDiscount::create([
                'transaction_id'  => $transaction->id,
                'discount_code'   => $discount['code'] ?? null,
                'discount_type'   => $discount['type'],
                'discount_value'  => $discount['value'],
                'discount_amount' => $discountAmount,
                'description'     => $discount['description'] ?? null,
            ]);

            $totalDiscount += $discountAmount;
        }

        // Cap total discount at subtotal to prevent negative totals
        return min($subtotal, $totalDiscount);
    }

    /**
     * Record payment for the transaction.
     */
    private function processPayment(
        Transaction $transaction,
        string $method,
        float $amount,
        array $details = []
    ): void {
        Payment::create([
            'transaction_id' => $transaction->id,
            'method'         => $method,
            'amount'         => $amount,
            'reference'      => $details['reference'] ?? null,
            'status'         => 'COMPLETED',
        ]);
    }
}
