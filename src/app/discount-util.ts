import { Discount } from './models';

/** Returns an error message if the discount can't be used here, else null. */
export function discountError(
  d: Discount,
  subtotal: number,
  channel: 'online' | 'pos',
  now = Date.now(),
): string | null {
  if (!d.active) return 'This code is not active.';
  const scope = d.scope || 'both';
  if (scope !== 'both' && scope !== channel) {
    return channel === 'pos' ? "This code can't be used at the till." : "This code isn't valid online.";
  }
  if (d.expiresAt && now > d.expiresAt) return 'This code has expired.';
  if (d.minSpend && subtotal < d.minSpend) return `Minimum spend R${d.minSpend} not met.`;
  if (d.maxUses != null && (d.usedCount || 0) >= d.maxUses) return 'This code has reached its usage limit.';
  return null;
}

/** The money value of the discount for a given subtotal (capped at subtotal). */
export function discountAmountFor(d: Discount, subtotal: number): number {
  const amt = d.type === 'percent' ? (subtotal * d.value) / 100 : d.value;
  return Math.min(Math.round(amt * 100) / 100, subtotal);
}
