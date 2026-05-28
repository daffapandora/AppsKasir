import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

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

export type CartDiscount = {
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  code?: string;
};

export interface CartState {
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  discounts: CartDiscount[];
}

interface CartActions {
  addItem: (item: CartItem) => void;
  removeItem: (itemId: string) => void;
  updateItem: (itemId: string, updates: Partial<CartItem>) => void;
  incrementQuantity: (itemId: string) => void;
  decrementQuantity: (itemId: string) => void;
  applyDiscount: (type: 'PERCENTAGE' | 'FIXED', value: number, code?: string) => void;
  removeDiscount: (index: number) => void;
  setCustomer: (name: string, phone: string, id?: number) => void;
  clear: () => void;
  calculateTotals: () => void;
}

const TAX_RATE = 0.1;

const initialState: CartState = {
  items: [],
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
  discounts: [],
};

/**
 * Pure helper — single source of truth for all cart total calculations.
 * Tax is applied only on the post-discount base. Discount is capped at subtotal.
 */
export function calculateCartTotals(
  items: CartItem[],
  discounts: CartDiscount[]
): Pick<CartState, 'subtotal' | 'discountAmount' | 'taxAmount' | 'totalAmount'> {
  const subtotal = items.reduce((sum, item) => {
    const lineDiscount = Math.max(0, item.discount || 0);
    return sum + item.quantity * item.unitPrice - lineDiscount;
  }, 0);

  const rawDiscount = discounts.reduce((sum, discount) => {
    if (discount.type === 'PERCENTAGE') {
      return sum + (subtotal * discount.value) / 100;
    }
    return sum + discount.value;
  }, 0);

  const discountAmount = Math.min(subtotal, Math.max(0, rawDiscount));
  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableBase * TAX_RATE;
  const totalAmount = taxableBase + taxAmount;

  return { subtotal, discountAmount, taxAmount, totalAmount };
}

function buildCartState(
  items: CartItem[],
  discounts: CartDiscount[],
  extra?: Partial<CartState>
): Partial<CartState> {
  return {
    items,
    discounts,
    ...calculateCartTotals(items, discounts),
    ...extra,
  };
}

export const useCartStore = create<CartState & CartActions>()(
  devtools(
    persist(
      (set, _get) => ({
        ...initialState,

        addItem: (item) =>
          set((state) => {
            const existingIndex = state.items.findIndex(
              (i) =>
                i.productId === item.productId &&
                i.productVariantId === item.productVariantId
            );

            let newItems: CartItem[];
            if (existingIndex >= 0) {
              newItems = state.items.map((i, idx) =>
                idx === existingIndex
                  ? { ...i, quantity: i.quantity + item.quantity }
                  : i
              );
            } else {
              newItems = [
                ...state.items,
                {
                  ...item,
                  id: item.id || crypto.randomUUID(),
                },
              ];
            }

            return buildCartState(newItems, state.discounts);
          }),

        removeItem: (itemId) =>
          set((state) =>
            buildCartState(
              state.items.filter((i) => i.id !== itemId),
              state.discounts
            )
          ),

        updateItem: (itemId, updates) =>
          set((state) =>
            buildCartState(
              state.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
              state.discounts
            )
          ),

        incrementQuantity: (itemId) =>
          set((state) =>
            buildCartState(
              state.items.map((i) =>
                i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i
              ),
              state.discounts
            )
          ),

        decrementQuantity: (itemId) =>
          set((state) =>
            buildCartState(
              state.items
                .map((i) =>
                  i.id === itemId
                    ? { ...i, quantity: Math.max(1, i.quantity - 1) }
                    : i
                )
                .filter((i) => i.quantity > 0),
              state.discounts
            )
          ),

        applyDiscount: (type, value, code) =>
          set((state) =>
            buildCartState(state.items, [
              ...state.discounts,
              { type, value, code },
            ])
          ),

        removeDiscount: (index) =>
          set((state) =>
            buildCartState(
              state.items,
              state.discounts.filter((_, i) => i !== index)
            )
          ),

        setCustomer: (name, phone, id) =>
          set({
            customerName: name,
            customerPhone: phone,
            customerId: id,
          }),

        clear: () => set(initialState),

        calculateTotals: () =>
          set((state) => calculateCartTotals(state.items, state.discounts)),
      }),
      {
        name: 'cart-store',
        partialize: (state) => ({
          items: state.items,
          customerId: state.customerId,
        }),
      }
    )
  )
);
