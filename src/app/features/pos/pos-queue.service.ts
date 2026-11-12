import { Injectable, inject, signal } from '@angular/core';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import type { OrderItem, OrderStatus } from '../../models';

export interface PosSale {
  items: OrderItem[];
  subtotal: number;
  total: number;
  customerName: string;
  paymentMethod: string;
  status: OrderStatus;
  discountCode?: string;
  discountAmount?: number;
}

/** A sale plus how far its write got, so a retry never doubles anything. */
interface QueuedSale extends PosSale {
  saleId: string;
  reference: string;
  createdAt: number;
  orderDone?: boolean;
  stockDone?: boolean;
  discountDone?: boolean;
}

const KEY = 'kf_pos_queue';

/**
 * Records POS sales. Offline-first: a sale that can't be written right now is
 * kept on the device and written later. Every sale has a fixed id, and each
 * step (order, stock, promo use) is ticked off, so retries are idempotent.
 */
@Injectable({ providedIn: 'root' })
export class PosQueueService {
  private shop = inject(ShopAdminService);
  private ui = inject(UiService);

  readonly pending = signal(0);
  readonly syncing = signal(false);
  private started = false;

  init(): void {
    if (this.started) return;
    this.started = true;
    this.pending.set(this.read().length);
    window.addEventListener('online', () => void this.flush());
  }

  /** Record a sale. Returns its reference, and whether it is waiting to sync. */
  async record(sale: PosSale): Promise<{ reference: string; queued: boolean }> {
    const q: QueuedSale = {
      ...sale,
      saleId: Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join(''),
      reference: this.newReference(),
      createdAt: Date.now(),
    };
    if (!navigator.onLine) {
      this.push(q);
      return { reference: q.reference, queued: true };
    }
    try {
      await this.commit(q);
      return { reference: q.reference, queued: false };
    } catch {
      this.push(q);
      return { reference: q.reference, queued: true };
    }
  }

  /** Write any sales that were saved offline. */
  async flush(): Promise<void> {
    if (this.syncing() || !navigator.onLine) return;
    const q = this.read();
    if (!q.length) return;
    this.syncing.set(true);
    const remaining: QueuedSale[] = [];
    for (const sale of q) {
      try { await this.commit(sale); } catch { remaining.push(sale); }
      this.write([...remaining, ...q.slice(q.indexOf(sale) + 1)]);
    }
    this.write(remaining);
    this.syncing.set(false);
    const done = q.length - remaining.length;
    if (done > 0) this.ui.toast(`Synced ${done} offline sale${done === 1 ? '' : 's'}`, 'ok');
  }

  private async commit(s: QueuedSale): Promise<void> {
    if (!s.orderDone) {
      await this.shop.createPosOrder({ ...s, saleId: s.saleId, reference: s.reference, createdAt: s.createdAt });
      s.orderDone = true;
    }
    if (!s.stockDone) {
      await this.shop.decrementStockForOrder(s.items);
      s.stockDone = true;
    }
    if (!s.discountDone) {
      if (s.discountCode && (s.discountAmount || 0) > 0) await this.shop.incrementDiscountUse(s.discountCode);
      s.discountDone = true;
    }
  }

  private newReference(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return 'KF-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => chars[b % chars.length]).join('');
  }

  private read(): QueuedSale[] {
    try {
      const list: QueuedSale[] = JSON.parse(localStorage.getItem(KEY) || '[]');
      // Sales queued by the previous version have no id yet: give them one.
      let changed = false;
      for (const s of list) {
        if (!s.saleId) { s.saleId = 'legacy-' + Math.random().toString(36).slice(2, 10); s.reference = s.reference || this.newReference(); s.createdAt = s.createdAt || Date.now(); changed = true; }
      }
      if (changed) localStorage.setItem(KEY, JSON.stringify(list));
      return list;
    } catch { return []; }
  }

  private write(q: QueuedSale[]): void {
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* ignore */ }
    this.pending.set(q.length);
  }

  private push(s: QueuedSale): void {
    this.write([...this.read(), s]);
  }
}
