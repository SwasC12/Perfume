import { EmailService } from '../../email.service';
import { Product, sizeAvailable, sizeOptions } from '../../models';
import { ShopAdminService } from '../../shop-admin.service';

/** Unnotified back-in-stock requests waiting on a product. */
export function pendingRestockCount(shop: ShopAdminService, productId: string): number {
  return shop.restockRequests().filter((r) => r.productId === productId && !r.notified).length;
}

/** Email everyone waiting on this product and mark their request notified. Returns count sent. */
export async function notifyPendingRestock(
  shop: ShopAdminService, email: EmailService, productId: string, productName: string,
): Promise<number> {
  const reqs = shop.restockRequests().filter((r) => r.productId === productId && !r.notified);
  let sent = 0;
  for (const r of reqs) {
    try { await email.restock(r.email, productName); await shop.markRestockNotified(r.id); sent++; } catch { /* skip */ }
  }
  return sent;
}

/** Whether a product is actually sellable (in stock and, if tracked, has quantity). */
export function isSellable(p: { inStock: boolean; stockQty: number | null }): boolean {
  return !!p.inStock && (p.stockQty == null || p.stockQty > 0);
}

/** In stock if any size is available (or the legacy single-size flag). */
export function productInStock(p: Product): boolean {
  const opts = sizeOptions(p);
  return opts.length ? opts.some((o) => sizeAvailable(o.size)) : p.inStock;
}

/** Total tracked units across sizes, or null when no size tracks quantity. */
export function trackedStock(p: Product): number | null {
  const opts = sizeOptions(p);
  let total: number | null = null;
  for (const o of opts) {
    if (o.size.stockQty != null) total = (total ?? 0) + Number(o.size.stockQty);
  }
  if (!opts.length && p.stockQty != null) total = p.stockQty;
  return total;
}

export const LOW_STOCK = 5;

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' || isNaN(v as number) ? null : Number(v);
}

/** Bulk per-size prices the Products → Tools sheet remembers (localStorage 'kf.bulkPrices'). */
export function loadBulkPrices(): Record<'size30' | 'size50' | 'size100', number | null> {
  const out: Record<'size30' | 'size50' | 'size100', number | null> = { size30: null, size50: null, size100: null };
  try {
    const raw = localStorage.getItem('kf.bulkPrices');
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      for (const k of ['size30', 'size50', 'size100'] as const) {
        const n = numOrNull(p[k]);
        out[k] = n != null && n > 0 ? n : null;
      }
    }
  } catch { /* ignore */ }
  return out;
}

export function marginLabel(price: number | null, cost: number | null): string {
  const pr = Number(price) || 0, c = Number(cost) || 0;
  if (!pr) return '—';
  const profit = pr - c;
  return `R${profit.toFixed(0)} profit (${Math.round((profit / pr) * 100)}%)`;
}

export function isDataUrl(s: string | undefined): boolean { return !!s && s.startsWith('data:'); }

export function hideBrokenImg(ev: Event): void {
  (ev.target as HTMLImageElement).style.visibility = 'hidden';
}
