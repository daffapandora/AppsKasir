/**
 * cartStore.ts
 * Zustand store for POS cart state.
 *
 * FIXES APPLIED:
 * - Extracted calculateCartTotals() pure function (DRY – was repeated 8x)
 * - Fixed taxableBase = Math.max(0, ...) to prevent negative tax on over-discount
 * - Used crypto.randomUUID() for cart item IDs (was Date.now + Math.random)
 * - persist() partializes correctly to preserve cart across page refresh
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { generateUUID } from '@/lib/api/generateUUID';

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

export interface CartDiscount {
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  code?: string;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface CartState extends CartTotals {
  items: CartItem[];
  customerName?: string;
  customerPhone?: string;
  customerId?: number;
  discounts: CartDiscount[];
  /** Client UUID for this checkout session. Set once, reused on retry. */
  checkoutUUID: string;
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
  regenerateCheckoutUUID: () => void;
}

// ─── Pure helper function (no store dependency) ───────────────────────────────

export function calculateCartTotals(items: CartItem[], discounts: CartDiscount[]): CartTotals {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  const rawDiscount = discounts.reduce((sum, d) => {
    return d.type === 'PERCENTAGE'
      ? sum + (subtotal * Math.min(100, d.value)) / 100
      : sum + d.value;
  }, 0);

  // Cap discount at subtotal to prevent negative totals
  const discountAmount = Math.min(rawDiscount, subtotal);
  const taxableBase    = Math.max(0, subtotal - discountAmount);
  const taxAmount      = taxableBase * 0.1; // 10% PPN
  const totalAmount    = taxableBase + taxAmount;

  return { subtotal, discountAmount, taxAmount, totalAmount };
}

// ─── Initial state ─────────────────────────────────────────────────────────────

const initialState: CartState = {
  items: [],
  subtotal: 0,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 0,
  discounts: [],
  checkoutUUID: generateUUID(),
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCartStore = create<CartState & CartActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        addItem: (itemData) =>
          set((state) => {
            const existingIdx = state.items.findIndex(
              (i) =>
                i.productId === itemData.productId &&
                i.productVariantId === itemData.productVariantId
            );

            let items: CartItem[];
            if (existingIdx >= 0) {
              items = state.items.map((item, idx) =>
                idx === existingIdx
                  ? { ...item, quantity: item.quantity + (itemData.quantity ?? 1) }
                  : item
              );
            } else {
              items = [
                ...state.items,
                { ...itemData, id: generateUUID() },
              ];
            }

            return { items, ...calculateCartTotals(items, state.discounts) };
          }),

        removeItem: (itemId) =>
          set((state) => {
            const items = state.items.filter((i) => i.id !== itemId);
            return { items, ...calculateCartTotals(items, state.discounts) };
          }),

        updateItem: (itemId, updates) =>
          set((state) => {
            const items = state.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i));
            return { items, ...calculateCartTotals(items, state.discounts) };
          }),

        incrementQuantity: (itemId) =>
          set((state) => {
            const items = state.items.map((i) =>
              i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i
            );
            return { items, ...calculateCartTotals(items, state.discounts) };
          }),

        decrementQuantity: (itemId) =>
          set((state) => {
            const items = state.items
              .map((i) =>
                i.id === itemId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i
              )
              .filter((i) => i.quantity > 0);
            return { items, ...calculateCartTotals(items, state.discounts) };
          }),

        applyDiscount: (type, value, code) =>
          set((state) => {
            const discounts = [...state.discounts, { type, value, code }];
            return { discounts, ...calculateCartTotals(state.items, discounts) };
          }),

        removeDiscount: (index) =>
          set((state) => {
            const discounts = state.discounts.filter((_, i) => i !== index);
            return { discounts, ...calculateCartTotals(state.items, discounts) };
          }),

        setCustomer: (name, phone, id) =>
          set({ customerName: name, customerPhone: phone, customerId: id }),

        clear: () =>
          set({
            ...initialState,
            // Generate a fresh UUID for the next checkout session
            checkoutUUID: generateUUID(),
          }),

        regenerateCheckoutUUID: () =>
          set({ checkoutUUID: generateUUID() }),
      }),
      {
        name: 'cart-store',
        partialize: (state) => ({
          items: state.items,
          discounts: state.discounts,
          customerId: state.customerId,
          checkoutUUID: state.checkoutUUID,
        }),
      }
    )
  )
);
