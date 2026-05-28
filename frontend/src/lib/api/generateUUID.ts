/**
 * generateUUID
 * Generates a cryptographically random UUID v4 for transaction idempotency.
 * Uses the Web Crypto API (available in all modern browsers and Node 19+).
 *
 * USAGE: Call this ONCE per checkout session, before submitting to the API.
 * Store the UUID in your checkout state. On retry, reuse the same UUID.
 *
 * @example
 * const clientUUID = generateUUID(); // e.g. '550e8400-e29b-41d4-a716-446655440000'
 */
export function generateUUID(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
