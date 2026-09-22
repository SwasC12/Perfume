import { Discount } from './models';

/** One cart line reduced to what the discount engine needs. */
export interface DiscountLine { unitPrice: number; qty: number; }

const round2 = (n: number) => Math.round(n * 100) / 100;

function expand(lines: DiscountLine[]): number[] {
  const units: number[] = [];
  for (const l of lines) for (let i = 0; i < l.qty; i++) units.push(l.unitPrice);
  return units;
}

export function totalUnits(lines: DiscountLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

export function linesSubtotal(lines: DiscountLine[]): number {
  return lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
}

/** Returns an error message if the discount can't be used here, else null. */
export function discountError(
  d: Discount,
  lines: DiscountLine[],
  channel: 'online' | 'pos',
  now = Date.now(),
): string | null {
  const subtotal = linesSubtotal(lines);
  if (!d.active) return 'This code is not active.';
  const scope = d.scope || 'both';
  if (scope !== 'both' && scope !== channel) {
    return channel === 'pos' ? "This code can't be used at the till." : "This code isn't valid online.";
  }
  if (d.expiresAt && now > d.expiresAt) return 'This code has expired.';
  if (d.maxUses != null && (d.usedCount || 0) >= d.maxUses) return 'This code has reached its usage limit.';
  if (d.minSpend && subtotal < d.minSpend) return `Spend at least R${d.minSpend} to use this code.`;
  if ((d.mechanic || 'order') === 'bundle') {
    const n = Math.max(1, d.bundleQty || 1);
    if (totalUnits(lines) < n) return `Add at least ${n} items to use this code.`;
  } else if (computeDiscount(d, lines) <= 0) {
    return 'This code gives no discount on your cart.';
  }
  return null;
}

/**
 * The money value of the discount for these cart lines (capped at subtotal).
 *
 * Mechanics:
 *  - order:  percent/fixed off the whole order.
 *  - item:   percent/fixed off every unit in the cart.
 *  - bundle: multi-buy. Items are grouped into complete sets of `bundleQty`
 *            (most-expensive first); leftover items that don't complete a set
 *            stay full price. Each complete set is rewarded by `bundleReward`:
 *              percent → % off the set     (e.g. "take 2, 20% off the two")
 *              fixed   → R off per set     (e.g. "take 2, R30 off")
 *              price   → set costs a fixed total  (e.g. "2 for R150")
 *              free    → the cheapest `bundleFree` items in each set are free
 *                        (e.g. buy-1-get-1: qty 2, free 1 · 3-for-2: qty 3, free 1)
 */
export function computeDiscount(d: Discount, lines: DiscountLine[]): number {
  const subtotal = linesSubtotal(lines);
  const mech = d.mechanic || 'order';
  let amt = 0;

  if (mech === 'order') {
    amt = d.type === 'percent' ? (subtotal * d.value) / 100 : d.value;
  } else if (mech === 'item') {
    for (const p of expand(lines)) {
      amt += d.type === 'percent' ? (p * d.value) / 100 : Math.min(d.value, p);
    }
  } else if (mech === 'bundle') {
    const n = Math.max(1, d.bundleQty || 1);
    const units = expand(lines).sort((a, b) => b - a); // most expensive first
    const groups = Math.floor(units.length / n);
    if (groups > 0) {
      const participating = units.slice(0, groups * n);
      const partSum = participating.reduce((s, p) => s + p, 0);
      const reward = d.bundleReward || 'percent';
      if (reward === 'percent') amt = (partSum * (d.bundleValue || 0)) / 100;
      else if (reward === 'fixed') amt = groups * (d.bundleValue || 0);
      else if (reward === 'price') amt = Math.max(0, partSum - groups * (d.bundleValue || 0));
      else if (reward === 'free') {
        const k = Math.max(1, d.bundleFree || 1);
        for (let g = 0; g < groups; g++) {
          const group = participating.slice(g * n, g * n + n); // descending
          for (let i = 0; i < k && i < group.length; i++) amt += group[group.length - 1 - i];
        }
      }
    }
  }
  return Math.min(round2(amt), subtotal);
}

/** Short human description of what a code does (for chips / tables). */
export function discountSummary(d: Discount): string {
  const mech = d.mechanic || 'order';
  if (mech === 'order') return d.type === 'percent' ? `${d.value}% off order` : `R${d.value} off order`;
  if (mech === 'item') return d.type === 'percent' ? `${d.value}% off each item` : `R${d.value} off each item`;
  const n = d.bundleQty || 2;
  switch (d.bundleReward || 'percent') {
    case 'percent': return `Buy ${n}: ${d.bundleValue || 0}% off the ${n}`;
    case 'fixed': return `Buy ${n}: R${d.bundleValue || 0} off`;
    case 'price': return `${n} for R${d.bundleValue || 0}`;
    default: return `Buy ${n}, get ${d.bundleFree || 1} free`;
  }
}
