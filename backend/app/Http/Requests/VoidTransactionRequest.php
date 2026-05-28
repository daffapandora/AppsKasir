<?php
namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Form Request for voiding a POS transaction.
 */
class VoidTransactionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'manager_pin' => 'required|string|regex:/^\d{4,6}$/',
            'reason'      => 'required|string|min:5|max:500',
        ];
    }

    public function messages(): array
    {
        return [
            'manager_pin.required' => 'Manager PIN is required to void a transaction.',
            'manager_pin.regex'    => 'PIN must be 4-6 digits.',
            'reason.required'      => 'A void reason is required for audit trail.',
            'reason.min'           => 'Please provide a more detailed void reason (min 5 characters).',
        ];
    }
}
