import { Address, Order, OrderStatus, Product } from '../../models';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled'];

/** Statuses that count as a sale (revenue, profit, referral uses). */
export function isSold(o: Order): boolean {
  return o.status === 'paid' || o.status === 'fulfilled' || o.status === 'shipped' || o.status === 'delivered';
}

export function addressText(a: Partial<Address> | null | undefined): string {
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.province, a.postalCode, a.country].filter(Boolean).join(', ');
}

export function deliveryLine(o: Order): string {
  return addressText(o.delivery);
}

export function orderDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function orderDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "just now", "5m ago", "3h ago", "2d ago", else a short date. */
export function timeAgo(ms: number): string {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function itemCount(o: Order): number {
  return (o.items || []).reduce((n, i) => n + (i.qty || 0), 0);
}

/** Payment method as plain text (old orders may still say 'eft'). */
export function paymentText(o: Order): string {
  const m = (o.paymentMethod || '').toLowerCase();
  if (!m) return o.channel === 'pos' ? 'Cash' : '—';
  const map: Record<string, string> = { yoco: 'Card (online)', card: 'Card', cash: 'Cash', eft: 'EFT' };
  return map[m] ?? m.toUpperCase();
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] || '' : '')).toUpperCase();
}

/** Units on hand for one product (sum of size stock, else flat stock). */
export function unitCount(p: Product): number {
  const sizes = (p as { sizes?: Record<string, { stockQty?: number | null } | undefined> }).sizes;
  if (sizes) {
    return Object.keys(sizes).reduce((n, k) => {
      const s = sizes[k];
      return n + (s && s.stockQty != null ? Number(s.stockQty) : 0);
    }, 0);
  }
  return p.stockQty != null ? Number(p.stockQty) : 0;
}

/**
 * Warnings the storefront backend can put on an order. These fields are not in
 * the model yet, so they are read loosely.
 */
export function orderFlags(o: Order): string[] {
  const x = o as unknown as Record<string, unknown>;
  const out: string[] = [];
  if (x['paymentReceivedWhileCancelled']) {
    out.push('Payment was received after this order was cancelled. Refund the customer or revive the order.');
  }
  const sf = x['stockShortfall'];
  if (sf) {
    let detail = '';
    if (Array.isArray(sf)) {
      detail = sf.map((s: any) => (typeof s === 'string' ? s : [s?.name || s?.productName || s?.productId, s?.size, s?.short != null ? `short ${s.short}` : s?.qty != null ? `x${s.qty}` : ''].filter(Boolean).join(' '))).filter(Boolean).join('; ');
    } else if (typeof sf === 'string') {
      detail = sf;
    }
    out.push('Stock shortfall: not enough stock was available for this order' + (detail ? ` (${detail})` : '') + '.');
  }
  if (x['revivedAfterExpiry']) {
    out.push('This order expired and was revived when a late payment came in. Check stock before packing.');
  }
  return out;
}
