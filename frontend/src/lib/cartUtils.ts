/**
 * Pure cart calculation utilities.
 *
 * Extracted from cartStore.ts where the same subtotal/discount/tax
 * logic was duplicated across 7 actions (addItem, removeItem,
 * updateItem, incrementQuantity, decrementQuantity, applyDiscount,
 * removeDiscount, calculateTotals).
 *
 * Being a pure function with no side effects makes it trivial to
 * unit-test all edge cases: negative discounts, discounts > subtotal,
 * zero-item carts, multiple stacked discounts, etc.
 */

export interface CartItem {
  id: string;
  productId: number;
  productVariantId?: number;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  notes?: string;
  image?: string;
}

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface CartDiscount {
  type: DiscountType;
  value: number;
  code?: string;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

/** Tax rate — change in one place if it ever moves from 10% */
const TAX_RATE = 0.1;

/**
 * Calculate cart totals from items and applied discounts.
 *
 * Rules:
 *  - PERCENTAGE discounts apply against the subtotal
 *  - FIXED discounts are absolute deductions
 *  - taxable base is floored at 0 (discounts can never make tax negative)
 *  - rounding is NOT applied here — handle presentation-layer rounding
 *    in the component to avoid compounding rounding errors in state
 */
export function calculateCartTotals(
  items: CartItem[],
  discounts: CartDiscount[]
): CartTotals {
  const subtotal = items.reduce(
    (sum, i) => sum + i.quantity * i.unitPrice,
    0
  );

  const discountAmount = discounts.reduce((sum, d) => {
    if (d.type === 'PERCENTAGE') {
      return sum + (subtotal * d.value) / 100;
    }
    return sum + d.value;
  }, 0);

  // Guard: taxable base cannot go below 0
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableBase * TAX_RATE;
  const totalAmount = taxableBase + taxAmount;

  return { subtotal, discountAmount, taxAmount, totalAmount };
}
