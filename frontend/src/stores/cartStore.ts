import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import {
  calculateCartTotals,
  CartItem,
  CartDiscount,
  CartTotals,
} from '@/lib/cartUtils';

// Re-export CartItem so existing imports don't break
export type { CartItem };

export interface CartState extends CartTotals {
  items: CartItem[];
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  discounts: CartDiscount[];
}

interface CartActions {
  addItem: (item: Omit<CartItem, 'id'>) => void;
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

const EMPTY_TOTALS: CartTotals = {
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
};

const initialState: CartState = {
  items: [],
  discounts: [],
  ...EMPTY_TOTALS,
};

export const useCartStore = create<CartState & CartActions>()(
  devtools(
    persist(
      (set, get) => ({
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
              newItems = [...state.items];
              newItems[existingIndex] = {
                ...newItems[existingIndex],
                quantity: newItems[existingIndex].quantity + item.quantity,
              };
            } else {
              // Use crypto UUID — safe for deduplication and audit sync flows
              newItems = [...state.items, { ...item, id: uuidv4() }];
            }

            return {
              items: newItems,
              ...calculateCartTotals(newItems, state.discounts),
            };
          }),

        removeItem: (itemId) =>
          set((state) => {
            const newItems = state.items.filter((i) => i.id !== itemId);
            return {
              items: newItems,
              ...calculateCartTotals(newItems, state.discounts),
            };
          }),

        updateItem: (itemId, updates) =>
          set((state) => {
            const newItems = state.items.map((i) =>
              i.id === itemId ? { ...i, ...updates } : i
            );
            return {
              items: newItems,
              ...calculateCartTotals(newItems, state.discounts),
            };
          }),

        incrementQuantity: (itemId) =>
          set((state) => {
            const newItems = state.items.map((i) =>
              i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i
            );
            return {
              items: newItems,
              ...calculateCartTotals(newItems, state.discounts),
            };
          }),

        decrementQuantity: (itemId) =>
          set((state) => {
            const newItems = state.items
              .map((i) =>
                i.id === itemId
                  ? { ...i, quantity: Math.max(1, i.quantity - 1) }
                  : i
              )
              .filter((i) => i.quantity > 0);
            return {
              items: newItems,
              ...calculateCartTotals(newItems, state.discounts),
            };
          }),

        applyDiscount: (type, value, code) =>
          set((state) => {
            const newDiscounts = [...state.discounts, { type, value, code }];
            return {
              discounts: newDiscounts,
              ...calculateCartTotals(state.items, newDiscounts),
            };
          }),

        removeDiscount: (index) =>
          set((state) => {
            const newDiscounts = state.discounts.filter((_, i) => i !== index);
            return {
              discounts: newDiscounts,
              ...calculateCartTotals(state.items, newDiscounts),
            };
          }),

        setCustomer: (name, phone, id) =>
          set({
            customerName: name,
            customerPhone: phone,
            customerId: id,
          }),

        clear: () => set(initialState),

        calculateTotals: () =>
          set((state) => ({
            ...calculateCartTotals(state.items, state.discounts),
          })),
      }),
      {
        name: 'cart-store',
        partialize: (state) => ({
          items: state.items,
          discounts: state.discounts,
          customerId: state.customerId,
        }),
      }
    )
  )
);
