import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { ScanService } from '../../core/scan.service';
import { SheetComponent } from '../../shared/sheet.component';
import { IconComponent } from '../../icon.component';
import { productImage } from '../../product-image';
import { SoundManager } from '../../sound/sound-manager';
import { computeDiscount, discountError, DiscountLine } from '../../discount-util';
import {
  Discount, OrderItem, OrderStatus, Product, ProductSize, ProductSizeKey,
  fromPrice, sizeAvailable, sizeEffectivePrice, sizeOptions,
} from '../../models';
import { PosQueueService, PosSale } from './pos-queue.service';

interface PosLine { product: Product; sizeKey?: ProductSizeKey; qty: number; }
type PayMethod = 'cash' | 'card';

interface Tile {
  p: Product;
  img: string;
  from: number;
  multi: boolean;
  opts: { key: ProductSizeKey; size: ProductSize; price: number }[];
  out: boolean;
}

const PAGE = 120;

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, NgTemplateOutlet, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
})
export class PosPage {
  readonly shop = inject(ShopAdminService);
  readonly queue = inject(PosQueueService);
  private ui = inject(UiService);
  private scan = inject(ScanService);

  readonly search = signal('');
  readonly limit = signal(PAGE);
  readonly cart = signal<PosLine[]>([]);
  readonly customer = signal('');
  readonly payment = signal<PayMethod>('cash');
  readonly promo = signal('');
  readonly discount = signal<Discount | null>(null);
  readonly promoError = signal<string | null>(null);
  readonly promoBusy = signal(false);
  readonly cash = signal<number | null>(null);
  readonly cartOpen = signal(false);
  readonly scanning = signal(false);

  /** All sellable products, pre-computed once per catalogue change. */
  private readonly tiles = computed<Tile[]>(() =>
    this.shop.products()
      .filter((p) => p.active !== false)
      .map((p) => {
        const opts = sizeOptions(p).map((o) => ({ ...o, price: sizeEffectivePrice(o.size) }));
        return {
          p,
          img: productImage(p),
          from: fromPrice(p),
          multi: opts.length > 1,
          opts,
          out: opts.length ? !opts.some((o) => sizeAvailable(o.size)) : !p.inStock,
        };
      }),
  );

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.tiles();
    return this.tiles().filter((t) =>
      t.p.name.toLowerCase().includes(q) ||
      (t.p.inspiredBy ?? '').toLowerCase().includes(q) ||
      (t.p.barcode ?? '').toLowerCase() === q);
  });
  readonly shown = computed(() => this.filtered().slice(0, this.limit()));

  /** Units in the cart per product, for the tile badges. */
  readonly inCart = computed(() => {
    const m: Record<string, number> = {};
    for (const l of this.cart()) m[l.product.id] = (m[l.product.id] || 0) + l.qty;
    return m;
  });

  readonly itemCount = computed(() => this.cart().reduce((n, l) => n + l.qty, 0));
  readonly subtotal = computed(() => this.cart().reduce((s, l) => s + this.unit(l) * l.qty, 0));
  readonly discountAmount = computed(() => {
    const d = this.discount();
    return d ? computeDiscount(d, this.lines()) : 0;
  });
  readonly total = computed(() => Math.max(0, this.subtotal() - this.discountAmount()));
  readonly change = computed(() => {
    const c = this.cash();
    return c != null ? Math.max(0, c - this.total()) : 0;
  });
  readonly cashShort = computed(() => {
    const c = this.cash();
    return this.payment() === 'cash' && c != null && c > 0 && c < this.total();
  });
  /** Quick tender buttons: exact, then the next round notes above the total. */
  readonly quickCash = computed(() => {
    const t = this.total();
    if (t <= 0) return [] as number[];
    const out = new Set<number>([Math.round(t * 100) / 100]);
    for (const step of [50, 100, 200]) {
      const v = Math.ceil(t / step) * step;
      if (v > t) out.add(v);
    }
    return [...out].slice(0, 4);
  });

  // ---------------------------------------------------------------- cart
  unit(l: PosLine): number {
    const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
    return s ? sizeEffectivePrice(s) : this.effPrice(l.product);
  }
  private effPrice(p: Product): number {
    return p.salePrice != null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
  }
  private lines(): DiscountLine[] {
    return this.cart().map((l) => ({ unitPrice: this.unit(l), qty: l.qty }));
  }
  sizesOf(p: Product) { return sizeOptions(p); }
  sizeLabel(l: PosLine): string {
    const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
    return s?.size || l.product.size || '';
  }
  lineKey(l: PosLine): string { return l.product.id + '|' + (l.sizeKey || ''); }

  add(p: Product, chosen?: ProductSizeKey): void {
    const sizeKey = chosen ?? sizeOptions(p)[0]?.key;
    this.cart.update((list) => {
      const ex = list.find((l) => l.product.id === p.id && l.sizeKey === sizeKey);
      return ex
        ? list.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l))
        : [...list, { product: p, sizeKey, qty: 1 }];
    });
  }

  setQty(l: PosLine, qty: number): void {
    if (qty <= 0) {
      this.cart.update((list) => list.filter((x) => x !== l));
      if (!this.cart().length) this.cartOpen.set(false);
      return;
    }
    this.cart.update((list) => list.map((x) => (x === l ? { ...x, qty } : x)));
  }

  changeSize(l: PosLine, newKey: ProductSizeKey): void {
    this.cart.update((list) => {
      const same = list.find((x) => x !== l && x.product.id === l.product.id && x.sizeKey === newKey);
      if (same) return list.filter((x) => x !== l).map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x));
      return list.map((x) => (x === l ? { ...x, sizeKey: newKey } : x));
    });
  }

  async clear(): Promise<void> {
    if (this.cart().length && !(await this.ui.confirm({ title: 'Clear sale?', message: 'Remove all items from this sale?', confirmLabel: 'Clear', danger: true }))) return;
    this.reset();
  }

  private reset(): void {
    this.cart.set([]);
    this.customer.set('');
    this.cash.set(null);
    this.discount.set(null);
    this.promo.set('');
    this.promoError.set(null);
    this.cartOpen.set(false);
  }

  // ------------------------------------------------------------- search
  /** Enter in search (or a keyboard-wedge scan): add the barcode match / only hit. */
  onSearchEnter(): void {
    const q = this.search().trim().toLowerCase();
    if (!q) return;
    const list = this.filtered();
    const exact = list.find((t) => (t.p.barcode ?? '').toLowerCase() === q);
    const hit = exact ?? (list.length === 1 ? list[0] : null);
    if (hit) {
      this.add(hit.p);
      this.search.set('');
      SoundManager.feedback('scanSuccess');
    }
  }
  setSearch(v: string): void {
    this.search.set(v);
    this.limit.set(PAGE);
  }

  async scanItems(): Promise<void> {
    this.scanning.set(true);
    try {
      await this.scan.streamProducts((p) => this.add(p.product, p.sizeKey));
    } finally {
      this.scanning.set(false);
    }
  }

  // -------------------------------------------------------------- promo
  async applyPromo(): Promise<void> {
    const code = this.promo().trim().toUpperCase();
    if (!code) return;
    this.promoError.set(null);
    this.promoBusy.set(true);
    try {
      const d = await this.shop.getDiscount(code);
      if (!d) { this.discount.set(null); this.promoError.set('Code not found.'); return; }
      const err = discountError(d, this.lines(), 'pos');
      if (err) { this.discount.set(null); this.promoError.set(err); return; }
      this.discount.set(d);
    } catch {
      this.promoError.set("Couldn't check the code — are you online?");
    } finally {
      this.promoBusy.set(false);
    }
  }
  clearPromo(): void { this.discount.set(null); this.promo.set(''); this.promoError.set(null); }

  // ----------------------------------------------------------- checkout
  checkout(): void {
    const lines = this.cart();
    if (!lines.length) return;
    if (this.cashShort()) { this.ui.toast('Cash received is less than the total', 'err'); return; }
    const items: OrderItem[] = lines.map((l) => {
      const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
      return {
        productId: l.product.id,
        sizeKey: l.sizeKey,
        name: l.product.name,
        size: s?.size || l.product.size,
        price: this.unit(l),
        qty: l.qty,
      };
    });
    const disc = this.discountAmount();
    const sale: PosSale = {
      items, subtotal: this.subtotal(), total: this.total(),
      customerName: this.customer().trim(), paymentMethod: this.payment(),
      status: 'fulfilled' as OrderStatus,
      discountCode: this.discount()?.code, discountAmount: disc,
    };
    const change = this.payment() === 'cash' && this.cash() ? this.change() : 0;
    // The sale object is complete — clear the till now so the next customer
    // isn't kept waiting on the network. The queue never loses the sale.
    this.reset();
    void this.queue.record(sale).then(({ reference, queued }) => {
      const tail = change > 0 ? ` · change R${+change.toFixed(2)}` : '';
      if (queued) this.ui.toast('Saved offline — will sync' + tail, 'info');
      else this.ui.toast(`Sale recorded · ${reference}` + tail, 'ok');
    });
  }

  sync(): void { void this.queue.flush(); }

  onImgError(ev: Event): void { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }
}
