<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreTransactionRequest;
use App\Http\Requests\VoidTransactionRequest;
use App\Models\Transaction;
use App\Services\TransactionService;
use App\Exceptions\{InsufficientStockException, InvalidTransactionException};
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

/**
 * TransactionController
 * Thin controller: delegates business logic to TransactionService.
 * Validation: StoreTransactionRequest / VoidTransactionRequest.
 */
class TransactionController extends Controller
{
    public function __construct(private TransactionService $transactionService) {}

    /**
     * POST /cashier/transactions
     * Create a new POS transaction (checkout).
     * Idempotent: duplicate client_uuid returns the existing transaction.
     */
    public function store(StoreTransactionRequest $request): JsonResponse
    {
        // Enforce outlet access: cashiers scoped to one outlet cannot transact on another
        $user = $request->user();
        if ($user->outlet_id && (int) $user->outlet_id !== (int) $request->validated('outlet_id')) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized outlet access',
            ], 403);
        }

        try {
            $transaction = $this->transactionService->createTransaction(
                array_merge($request->validated(), ['tenant_id' => $user->tenant_id])
            );

            return response()->json([
                'success' => true,
                'message' => 'Transaction completed successfully',
                'data' => [
                    'id'             => $transaction->id,
                    'order_number'   => $transaction->order_number,
                    'total_amount'   => $transaction->total_amount,
                    'payment_method' => $transaction->payment_method,
                    'status'         => $transaction->status,
                    'created_at'     => $transaction->created_at,
                ]
            ], 201);

        } catch (InsufficientStockException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Insufficient stock for one or more items',
                'errors'  => [
                    'product_id' => $e->productId,
                    'available'  => $e->available,
                    'requested'  => $e->requested,
                ]
            ], 422);

        } catch (InvalidTransactionException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);

        } catch (\Exception $e) {
            \Log::error('Transaction creation failed', [
                'user_id'    => Auth::id(),
                'tenant_id'  => Auth::user()->tenant_id,
                'outlet_id'  => Auth::user()->outlet_id,
                'error'      => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'An unexpected error occurred. Please try again.',
            ], 500);
        }
    }

    /**
     * GET /cashier/transactions
     * List recent transactions for the authenticated cashier's outlet.
     */
    public function index(Request $request): JsonResponse
    {
        $user  = $request->user();
        $query = Transaction::where('tenant_id', $user->tenant_id)
            ->when($user->outlet_id, fn($q) => $q->where('outlet_id', $user->outlet_id))
            ->with(['items'])
            ->orderByDesc('created_at')
            ->limit(50);

        return response()->json([
            'success' => true,
            'data'    => $query->get(),
        ]);
    }

    /**
     * GET /cashier/transactions/{transaction}
     * Get full receipt/details of a transaction.
     * Eager loads items and customer to prevent N+1 queries.
     */
    public function show(Transaction $transaction): JsonResponse
    {
        // Tenant isolation check
        if ((int) $transaction->tenant_id !== (int) Auth::user()->tenant_id) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        // Outlet isolation check for non-owner roles
        $user = Auth::user();
        if ($user->outlet_id && (int) $user->outlet_id !== (int) $transaction->outlet_id) {
            return response()->json(['success' => false, 'message' => 'Unauthorized access'], 403);
        }

        // Eager load to prevent N+1
        $transaction->load(['items', 'customer', 'payments']);

        return response()->json([
            'success' => true,
            'data' => [
                'id'              => $transaction->id,
                'order_number'    => $transaction->order_number,
                'status'          => $transaction->status,
                'payment_status'  => $transaction->payment_status,
                'subtotal_amount' => $transaction->subtotal_amount,
                'discount_amount' => $transaction->discount_amount,
                'tax_amount'      => $transaction->tax_amount,
                'total_amount'    => $transaction->total_amount,
                'payment_method'  => $transaction->payment_method,
                'customer' => $transaction->customer ? [
                    'id'    => $transaction->customer->id,
                    'name'  => $transaction->customer->name,
                    'phone' => $transaction->customer->phone,
                ] : null,
                'items' => $transaction->items->map(fn($item) => [
                    'product_name' => $item->product_name,
                    'sku'          => $item->product_sku,
                    'quantity'     => $item->quantity,
                    'unit_price'   => $item->unit_price,
                    'line_total'   => $item->line_total,
                ]),
                'created_at'   => $transaction->created_at,
                'completed_at' => $transaction->completed_at,
            ]
        ]);
    }

    /**
     * POST /cashier/transactions/{transaction}/void
     * Void a completed transaction. Requires manager PIN.
     */
    public function void(VoidTransactionRequest $request, Transaction $transaction): JsonResponse
    {
        $user = Auth::user();

        // Tenant + outlet isolation
        if ((int) $transaction->tenant_id !== (int) $user->tenant_id) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }
        if ($user->outlet_id && (int) $user->outlet_id !== (int) $transaction->outlet_id) {
            return response()->json(['success' => false, 'message' => 'Unauthorized access'], 403);
        }

        if (!in_array($transaction->status, ['COMPLETED'])) {
            return response()->json([
                'success' => false,
                'message' => 'Only completed transactions can be voided',
            ], 422);
        }

        // Verify manager/owner PIN
        if (!in_array($user->role, ['owner', 'manager'])) {
            return response()->json([
                'success' => false,
                'message' => 'Only managers or owners can void transactions',
            ], 403);
        }

        if (!$user->pin_hash || !Hash::check($request->validated('manager_pin'), $user->pin_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid manager PIN',
            ], 401);
        }

        try {
            $voided = $this->transactionService->voidTransaction(
                $transaction,
                $request->validated('reason'),
                $user->id
            );

            return response()->json([
                'success' => true,
                'message' => 'Transaction voided successfully',
                'data'    => [
                    'id'           => $voided->id,
                    'order_number' => $voided->order_number,
                    'status'       => $voided->status,
                    'voided_at'    => $voided->voided_at,
                ]
            ]);

        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to void transaction: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /cashier/transactions/{transaction}/hold
     */
    public function hold(Transaction $transaction): JsonResponse
    {
        $user = Auth::user();
        if ((int) $transaction->tenant_id !== (int) $user->tenant_id) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        if (!in_array($transaction->status, ['PENDING'])) {
            return response()->json([
                'success' => false,
                'message' => 'Only pending transactions can be held',
            ], 422);
        }

        $held = $this->transactionService->holdTransaction($transaction);

        return response()->json([
            'success' => true,
            'message' => 'Transaction held',
            'data'    => ['id' => $held->id, 'status' => $held->status],
        ]);
    }

    /**
     * POST /cashier/transactions/{transaction}/resume
     */
    public function resume(Transaction $transaction): JsonResponse
    {
        $user = Auth::user();
        if ((int) $transaction->tenant_id !== (int) $user->tenant_id) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        if (!in_array($transaction->status, ['HELD'])) {
            return response()->json([
                'success' => false,
                'message' => 'Only held transactions can be resumed',
            ], 422);
        }

        $resumed = $this->transactionService->resumeTransaction($transaction);

        return response()->json([
            'success' => true,
            'message' => 'Transaction resumed',
            'data'    => ['id' => $resumed->id, 'status' => $resumed->status],
        ]);
    }
}
