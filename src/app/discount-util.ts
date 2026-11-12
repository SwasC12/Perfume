import { Discount, Product, ProductSizeKey } from './models';

// NOTE: this file is mirrored in the admin app (src/app/discount-util.ts) and in
// the Worker (worker/index.js: computeDiscount / discountError). Keep all three
// in exact agreement — the Worker is the one that actually charges.

/**
 * One cart line reduced to what the discount engine needs. Only unitPrice/qty
 * are required; the rest is used to match targeted codes (product / gender /
 * category / size). A line without that info never matches a targeted code.
 */
export interface DiscountLine {
  unitPrice: number;
  qty: number;
  productId?: string;
  sizeKey?: string | null; // size30 | size50 | size100
  size?: string | null;    // label like "50ml" (used when there is no sizeKey)
  gender?: string | null;  // Product.gender (Men | Women | Unisex)
  category?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Dec 2026" in South African time (same output on every device and in the Worker). */
export function fmtDay(ms: number): string {
  const d = new Date(Number(ms) + 2 * 3600 * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

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

/** size30/size50/size100 for a line (from its sizeKey, else from a "50ml" label). */
export function lineSizeKey(l: DiscountLine): string {
  if (l.sizeKey) return String(l.sizeKey);
  const m = /(\d+)\s*ml/i.exec(String(l.size || ''));
  return m && ['30', '50', '100'].includes(m[1]) ? 'size' + m[1] : '';
}

/** True when the code is limited to some products / gender / category / sizes. */
export function hasTargeting(d: Discount): boolean {
  return !!((d.productIds && d.productIds.length) || norm(d.gender) || norm(d.category) || (d.sizeKeys && d.sizeKeys.length));
}

export function lineMatches(d: Discount, l: DiscountLine): boolean {
  if (d.productIds && d.productIds.length && !d.productIds.includes(String(l.productId || ''))) return false;
  if (norm(d.gender) && norm(l.gender) !== norm(d.gender)) return false;
  if (norm(d.category) && norm(l.category) !== norm(d.category)) return false;
  if (d.sizeKeys && d.sizeKeys.length && !d.sizeKeys.includes(lineSizeKey(l))) return false;
  return true;
}

/** The lines the code applies to (all lines for an untargeted code). */
export function matchingLines(d: Discount, lines: DiscountLine[]): DiscountLine[] {
  return hasTargeting(d) ? lines.filter((l) => lineMatches(d, l)) : lines;
}

/**
 * Returns an error message if the discount can't be used here, else null.
 * Per-customer rules (oncePerCustomer / firstOrderOnly) need order history and
 * are checked by the Worker only; the till ignores them.
 */
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
  if (d.startsAt && now < d.startsAt) return `This code is only valid from ${fmtDay(d.startsAt)}.`;
  if (d.expiresAt && now > d.expiresAt) return 'This code has expired.';
  if (d.maxUses != null && (d.usedCount || 0) >= d.maxUses) return 'This code has reached its usage limit.';
  if (d.minSpend && subtotal < d.minSpend) return `Spend at least R${d.minSpend} to use this code.`;
  const targeted = hasTargeting(d);
  const units = totalUnits(matchingLines(d, lines));
  if (targeted && units === 0) return "This code isn't valid for the items in your cart.";
  const what = targeted ? 'qualifying items' : 'items';
  if (d.minQty && units < d.minQty) return `Add at least ${d.minQty} ${what} to use this code.`;
  if ((d.mechanic || 'order') === 'bundle') {
    const n = Math.max(1, d.bundleQty || 1);
    if (units < n) return `Add at least ${n} ${what} to use this code.`;
  } else if (computeDiscount(d, lines) <= 0) {
    if (!d.freeDelivery) return 'This code gives no discount on your cart.';
    if (channel === 'pos') return 'This code only gives free delivery on online orders.';
  }
  return null;
}

/**
 * The money value of the discount for these cart lines (capped at the
 * subtotal of the lines it applies to, and at `maxDiscount` when set).
 * Free delivery is not money off the items — the checkout zeroes the fee.
 *
 * Mechanics (only lines matching the targeting count):
 *  - order:  percent/fixed off the (matching) subtotal.
 *  - item:   percent/fixed off every (matching) unit.
 *  - bundle: multi-buy. Items are grouped into complete sets of `bundleQty`
 *            (most-expensive first); leftover items that don't complete a set
 *            stay full price. Each complete set is rewarded by `bundleReward`:
 *              percent → % off the set     (e.g. "take 2, 20% off the two")
 *              fixed   → R off per set     (e.g. "take 2, R30 off")
 *              price   → set costs a fixed total  (e.g. "2 for R150")
 *              free    → the cheapest `bundleFree` items in each set are free,
 *                        or `bundleFreePercent`% off when set (buy X get Y):
 *                        buy 2 get 1 free = qty 3, free 1
 *                        buy 3 get 1 half price = qty 4, free 1, 50%
 */
export function computeDiscount(d: Discount, lines: DiscountLine[]): number {
  const matching = matchingLines(d, lines);
  const base = linesSubtotal(matching);
  const mech = d.mechanic || 'order';
  const value = Number(d.value || 0);
  let amt = 0;

  if (mech === 'order') {
    amt = d.type === 'percent' ? (base * value) / 100 : value;
  } else if (mech === 'item') {
    for (const p of expand(matching)) {
      amt += d.type === 'percent' ? (p * value) / 100 : Math.min(value, p);
    }
  } else if (mech === 'bundle') {
    const n = Math.max(1, d.bundleQty || 1);
    const units = expand(matching).sort((a, b) => b - a); // most expensive first
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
        const pct = freePercent(d);
        for (let g = 0; g < groups; g++) {
          const group = participating.slice(g * n, g * n + n); // descending
          for (let i = 0; i < k && i < group.length; i++) amt += (group[group.length - 1 - i] * pct) / 100;
        }
      }
    }
  }
  amt = round2(amt);
  if (d.maxDiscount != null && d.maxDiscount > 0) amt = Math.min(amt, d.maxDiscount);
  return Math.min(round2(amt), base);
}

/** % off the "free" items of a buy-X-get-Y set (100 = free). */
function freePercent(d: Discount): number {
  const p = Number(d.bundleFreePercent);
  return p > 0 && p < 100 ? p : 100;
}

/** True when the code makes delivery free (online, delivery orders only). */
export function givesFreeDelivery(d: Discount | null | undefined): boolean {
  return !!d && d.freeDelivery === true;
}

const GENDER_LABEL: Record<string, string> = { men: 'men’s', women: 'women’s', unisex: 'unisex' };
const SIZE_LABEL: Record<string, string> = { size30: '30ml', size50: '50ml', size100: '100ml' };

/** Short label for what a targeted code applies to ("3 products · 50ml"), '' if untargeted. */
export function targetLabel(d: Discount, productName?: (id: string) => string | undefined): string {
  const parts: string[] = [];
  const ids = d.productIds || [];
  if (ids.length) {
    const names = productName ? ids.map((id) => productName(id)).filter((n): n is string => !!n) : [];
    parts.push(names.length === ids.length && ids.length <= 2 ? names.join(' & ') : `${ids.length} product${ids.length === 1 ? '' : 's'}`);
  }
  if (norm(d.gender)) parts.push(GENDER_LABEL[norm(d.gender)] || String(d.gender));
  if (norm(d.category)) parts.push(String(d.category).trim());
  if (d.sizeKeys && d.sizeKeys.length) parts.push(d.sizeKeys.map((k) => SIZE_LABEL[k] || k).join('/'));
  return parts.join(' · ');
}

/** Short human description of what a code does (for chips / tables). */
export function discountSummary(d: Discount, productName?: (id: string) => string | undefined): string {
  const mech = d.mechanic || 'order';
  const cap = d.maxDiscount != null && d.maxDiscount > 0 ? ` (max R${d.maxDiscount})` : '';
  let s: string;
  if (mech === 'order') {
    if (d.freeDelivery && !(Number(d.value) > 0)) s = 'Free delivery';
    else s = d.type === 'percent' ? `${d.value}% off order${cap}` : `R${d.value} off order`;
  } else if (mech === 'item') {
    s = d.type === 'percent' ? `${d.value}% off each item${cap}` : `R${d.value} off each item`;
  } else {
    const n = d.bundleQty || 2;
    switch (d.bundleReward || 'percent') {
      case 'percent': s = `Buy ${n}: ${d.bundleValue || 0}% off the ${n}${cap}`; break;
      case 'fixed': s = `Buy ${n}: R${d.bundleValue || 0} off`; break;
      case 'price': s = `${n} for R${d.bundleValue || 0}`; break;
      default: {
        const k = d.bundleFree || 1;
        const pct = freePercent(d);
        s = `Buy ${Math.max(1, n - k)}, get ${k} ${pct === 100 ? 'free' : pct === 50 ? 'half price' : pct + '% off'}${cap}`;
      }
    }
  }
  if (d.freeDelivery && s !== 'Free delivery') s += ' + free delivery';
  return hasTargeting(d) ? `${s} — ${targetLabel(d, productName)}` : s;
}

// ---------------------------------------------------------------------------
// Admin-only helpers (not mirrored in the storefront).

/**
 * Builds a full DiscountLine for a till line so targeted codes (products /
 * gender / category / size) can match. The POS can switch its `lines()` to
 * `cart.map(l => posDiscountLine(l.product, l.sizeKey, unit(l), l.qty))`;
 * plain `{ unitPrice, qty }` lines still work for untargeted codes.
 */
export function posDiscountLine(product: Product, sizeKey: ProductSizeKey | undefined | null, unitPrice: number, qty: number): DiscountLine {
  const s = sizeKey ? product.sizes?.[sizeKey] : null;
  return {
    unitPrice, qty,
    productId: product.id,
    sizeKey: sizeKey || null,
    size: s?.size || product.size || null,
    gender: product.gender || null,
    category: product.category || null,
  };
}

export type DiscountStatus = 'off' | 'scheduled' | 'expired' | 'used up' | 'active';

/** Where a code stands right now (for list rows). */
export function discountStatus(d: Discount, now = Date.now()): DiscountStatus {
  if (!d.active) return 'off';
  if (d.expiresAt && now > d.expiresAt) return 'expired';
  if (d.maxUses != null && d.maxUses > 0 && (d.usedCount || 0) >= d.maxUses) return 'used up';
  if (d.startsAt && now < d.startsAt) return 'scheduled';
  return 'active';
}

/** One plain-language sentence describing the whole rule (editor live summary). */
export function describeDiscount(d: Discount, productName?: (id: string) => string | undefined): string {
  const head = discountSummary({ ...d, productIds: [], gender: null, category: null, sizeKeys: [] });
  const parts: string[] = [head];
  if (hasTargeting(d)) {
    const ids = d.productIds || [];
    const bits: string[] = [];
    if (ids.length) {
      const names = productName ? ids.map((id) => productName(id) || 'a removed product') : [];
      bits.push(names.length && names.length <= 4 ? names.join(', ') : `${ids.length} selected product${ids.length === 1 ? '' : 's'}`);
    }
    const t = targetLabel({ ...d, productIds: [] } as Discount);
    if (t) bits.push(t);
    parts.push(`only on ${bits.join(' · ')}`);
  }
  const cond: string[] = [];
  if (d.minSpend) cond.push(`min spend R${d.minSpend}`);
  if (d.minQty) cond.push(`at least ${d.minQty} ${hasTargeting(d) ? 'qualifying ' : ''}item${d.minQty === 1 ? '' : 's'}`);
  if (d.startsAt && d.expiresAt) cond.push(`${fmtDay(d.startsAt)} – ${fmtDay(d.expiresAt)}`);
  else if (d.startsAt) cond.push(`from ${fmtDay(d.startsAt)}`);
  else if (d.expiresAt) cond.push(`until ${fmtDay(d.expiresAt)}`);
  if (d.oncePerCustomer) cond.push('once per customer');
  if (d.firstOrderOnly) cond.push('first order only');
  if (d.maxUses) cond.push(`${d.maxUses} use${d.maxUses === 1 ? '' : 's'} in total`);
  const scope = d.scope || 'both';
  cond.push(scope === 'online' ? 'online only' : scope === 'pos' ? 'till only' : 'online & till');
  if (d.freeDelivery && scope !== 'online') cond.push('free delivery applies online only');
  return parts.join(', ') + ' — ' + cond.join(', ') + '.';
}
