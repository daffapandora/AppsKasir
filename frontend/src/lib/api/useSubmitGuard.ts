/**
 * useSubmitGuard
 * React hook to prevent duplicate form submissions (double-tap / retry storms).
 *
 * Usage:
 *   const { isSubmitting, guard } = useSubmitGuard();
 *   const handleCheckout = guard(async () => { ... });
 */

import { useState, useCallback, useRef } from 'react';

export function useSubmitGuard() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const guard = useCallback(
    <T>(fn: () => Promise<T>) =>
      async (): Promise<T | undefined> => {
        // Block if already in-flight
        if (inFlightRef.current) return undefined;

        inFlightRef.current = true;
        setIsSubmitting(true);

        try {
          return await fn();
        } finally {
          inFlightRef.current = false;
          setIsSubmitting(false);
        }
      },
    []
  );

  return { isSubmitting, guard };
}
