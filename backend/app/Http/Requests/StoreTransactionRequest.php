<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request for creating a new POS transaction.
 * Centralizes validation and authorization away from the controller.
 */
class StoreTransactionRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Authorization is handled by auth:sanctum + tenant middleware
        return true;
    }

    public function rules(): array
    {
        return [
            'client_uuid'                  => 'required|uuid',
            'outlet_id'                    => 'required|integer|exists:outlets,id',
            'shift_id'                     => 'nullable|integer|exists:shifts,id',
            'items'                        => 'required|array|min:1',
            'items.*.product_id'           => 'required|integer|exists:products,id',
            'items.*.quantity'             => 'required|integer|min:1|max:9999',
            'items.*.unit_price'           => 'nullable|numeric|min:0',
            'items.*.product_variant_id'   => 'nullable|integer|exists:product_variants,id',
            'items.*.discount_per_item'    => 'nullable|numeric|min:0',
            'items.*.notes'                => 'nullable|string|max:255',
            'discounts'                    => 'nullable|array|max:10',
            'discounts.*.type'             => 'required|in:PERCENTAGE,FIXED',
            'discounts.*.value'            => 'required|numeric|min:0|max:100',
            'discounts.*.code'             => 'nullable|string|max:50',
            'payment_method'               => 'required|in:CASH,CARD,QRIS,MIXED,OFFLINE',
            'payment_details'              => 'nullable|array',
            'customer_id'                  => 'nullable|integer|exists:customers,id',
            'customer_name'                => 'nullable|string|max:100',
            'customer_phone'               => 'nullable|string|max:20',
        ];
    }

    public function messages(): array
    {
        return [
            'client_uuid.required' => 'A unique transaction ID (client_uuid) is required to prevent duplicates.',
            'client_uuid.uuid'     => 'The client_uuid must be a valid UUID v4.',
            'items.required'       => 'A transaction must contain at least one item.',
            'items.min'            => 'A transaction must contain at least one item.',
            'payment_method.in'    => 'Payment method must be one of: CASH, CARD, QRIS, MIXED, OFFLINE.',
        ];
    }
}
