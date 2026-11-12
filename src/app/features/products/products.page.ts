import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { EmailService } from '../../email.service';
import { UiService } from '../../core/ui.service';
import { ScanService } from '../../core/scan.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { STARTER_CATALOGUE } from '../../starter-catalogue';
import { isCustomImage, productImage } from '../../product-image';
import { Product, fromPrice, sizeOptions } from '../../models';
import {
  LOW_STOCK, hideBrokenImg, notifyPendingRestock, numOrNull, pendingRestockCount, productInStock, trackedStock,
} from './product-util';

type Filter = 'all' | 'low' | 'out' | 'hidden' | 'waiting';
type BulkKey = 'size30' | 'size50' | 'size100';

interface Row {
  p: Product;
  img: string;
  from: number;
  multi: boolean;
  sizes: string;
  inStock: boolean;
  qty: number | null;
  low: boolean;
  waiting: number;
  hay: string;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, CurrencyPipe, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.page.html',
  styleUrl: './products.page.scss',
})
export class ProductsPage {
  readonly shop = inject(ShopAdminService);
  private readonly email = inject(EmailService);
  private readonly ui = inject(UiService);
  private readonly scan = inject(ScanService);
  private readonly router = inject(Router);

  readonly search = signal('');
  readonly filter = signal<Filter>('all');
  readonly limit = signal(100);
  readonly toolsOpen = signal(false);
  readonly busy = signal<string | null>(null);
  readonly hideImg = hideBrokenImg;

  /** Precomputed once per products/restock change so filtering is cheap. */
  readonly rows = computed<Row[]>(() => {
    const waitingBy = new Map<string, number>();
    for (const r of this.shop.restockRequests()) {
      if (!r.notified) waitingBy.set(r.productId, (waitingBy.get(r.productId) ?? 0) + 1);
    }
    return this.shop.products().map((p) => {
      const opts = sizeOptions(p);
      const inStock = productInStock(p);
      const qty = trackedStock(p);
      return {
        p,
        img: productImage(p),
        from: fromPrice(p),
        multi: opts.length > 1,
        sizes: opts.map((o) => o.size.size).join(' · ') || '—',
        inStock,
        qty,
        low: inStock && qty != null && qty <= LOW_STOCK,
        waiting: waitingBy.get(p.id) ?? 0,
        hay: [p.name, p.inspiredBy, p.barcode, p.category, p.gender].filter(Boolean).join(' ').toLowerCase(),
      };
    });
  });

  readonly counts = computed<Record<Filter, number>>(() => {
    const r = this.rows();
    return {
      all: r.length,
      low: r.filter((x) => x.low).length,
      out: r.filter((x) => !x.inStock).length,
      hidden: r.filter((x) => !x.p.active).length,
      waiting: r.filter((x) => x.waiting > 0).length,
    };
  });

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    return this.rows().filter((x) => {
      if (f === 'low' && !x.low) return false;
      if (f === 'out' && x.inStock) return false;
      if (f === 'hidden' && x.p.active) return false;
      if (f === 'waiting' && !x.waiting) return false;
      return !q || x.hay.includes(q);
    });
  });
  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'low', label: 'Low stock' },
    { key: 'out', label: 'Out of stock' },
    { key: 'hidden', label: 'Hidden' },
    { key: 'waiting', label: 'Waiting' },
  ];

  setFilter(f: Filter): void { this.filter.set(f); this.limit.set(100); }
  setSearch(q: string): void { this.search.set(q); this.limit.set(100); }

  async scanFind(): Promise<void> {
    const picked = await this.scan.pickProduct();
    if (picked) void this.router.navigate(['/products', picked.product.id]);
  }

  async toggleActive(p: Product, ev?: Event): Promise<void> {
    try {
      await this.shop.updateProduct(p.id, { active: !p.active });
      this.ui.toast(p.active ? 'Hidden from shop' : 'Now live on shop', 'ok');
    } catch {
      if (ev) (ev.target as HTMLInputElement).checked = p.active;
      this.ui.toast('Update failed', 'err');
    }
  }

  async notifyRestock(p: Product): Promise<void> {
    const n = pendingRestockCount(this.shop, p.id);
    if (!n) return;
    if (!(await this.ui.confirm({
      title: 'Back in stock?',
      message: `Mark "${p.name}" in stock and email the ${n} ${n === 1 ? 'person' : 'people'} waiting?`,
      confirmLabel: 'Notify',
    }))) return;
    this.busy.set('notify-' + p.id);
    try {
      if (!p.inStock) await this.shop.updateProduct(p.id, { inStock: true });
      const sent = await notifyPendingRestock(this.shop, this.email, p.id, p.name);
      this.ui.toast(`Marked in stock · notified ${sent}`, 'ok');
    } catch { this.ui.toast('Notify failed', 'err'); }
    finally { this.busy.set(null); }
  }

  // ---------------- Tools: bulk price per size ----------------
  readonly bulkRows: { key: BulkKey; label: string }[] = [
    { key: 'size30', label: '30 ml' },
    { key: 'size50', label: '50 ml' },
    { key: 'size100', label: '100 ml' },
  ];
  readonly bulkPrice = signal<Record<BulkKey, number | null>>(this.loadBulkPrices());

  private loadBulkPrices(): Record<BulkKey, number | null> {
    try {
      const raw = localStorage.getItem('kf.bulkPrices');
      if (raw) {
        const p = JSON.parse(raw) as Record<string, number | null>;
        return { size30: p['size30'] ?? null, size50: p['size50'] ?? null, size100: p['size100'] ?? null };
      }
    } catch { /* ignore */ }
    return { size30: null, size50: null, size100: null };
  }

  setBulkPrice(key: BulkKey, value: unknown): void {
    const n = numOrNull(value);
    this.bulkPrice.update((p) => {
      const next = { ...p, [key]: n };
      try { localStorage.setItem('kf.bulkPrices', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  async applyBulkPrice(key: BulkKey, label: string): Promise<void> {
    const price = Number(this.bulkPrice()[key]);
    if (!(price > 0)) { this.ui.toast('Enter a price first', 'err'); return; }
    if (!(await this.ui.confirm({
      title: `Set every ${label} price?`,
      message: `Every product with a ${label} size will cost R${price}. Individual and sale prices stay editable.`,
      confirmLabel: 'Apply',
    }))) return;
    this.busy.set(key);
    try {
      const n = await this.shop.setAllSizePrices(key, price);
      this.ui.toast(n ? n + ' product' + (n === 1 ? '' : 's') + ' updated' : 'No products have that size', n ? 'ok' : 'info');
    } catch {
      this.ui.toast('Could not update prices', 'err');
    } finally {
      this.busy.set(null);
    }
  }

  // ---------------- Tools: bulk cost ----------------
  bulkCostValue: number | null = null;
  bulkCostOnlyMissing = true;

  async applyBulkCost(): Promise<void> {
    const cost = numOrNull(this.bulkCostValue);
    if (cost == null || cost < 0) { this.ui.toast('Enter a cost', 'err'); return; }
    const targets = this.shop.products().filter((p) => (this.bulkCostOnlyMissing ? p.cost == null : true));
    if (!targets.length) { this.ui.toast('Nothing to update', 'info'); return; }
    this.busy.set('cost');
    let done = 0;
    try {
      for (const p of targets) {
        try { await this.shop.updateProduct(p.id, { cost }); done++; } catch { /* skip */ }
      }
      this.bulkCostValue = null;
      this.ui.toast(`Set cost on ${done} product${done === 1 ? '' : 's'}`, 'ok');
    } finally { this.busy.set(null); }
  }

  // ---------------- Tools: starter catalogue ----------------
  readonly starterCount = STARTER_CATALOGUE.length;

  async importStarter(): Promise<void> {
    if (!(await this.ui.confirm({
      title: 'Import starter fragrances',
      confirmLabel: 'Import',
      message: `Import ${STARTER_CATALOGUE.length} starter fragrances (15 men + 15 ladies) into your shop? Products with the same name are skipped. Prices are Rumi's — adjust them after importing.`,
    }))) return;
    this.busy.set('starter');
    const existing = new Set(this.shop.products().map((p) => p.name.trim().toLowerCase()));
    let added = 0;
    try {
      for (const s of STARTER_CATALOGUE) {
        if (existing.has(s.name.trim().toLowerCase())) continue;
        try {
          await this.shop.addProduct({
            name: s.name, price: s.price, salePrice: null, stockQty: null,
            inStock: true, active: true, featured: false,
            gender: s.gender, inspiredBy: s.inspiredBy,
          });
          added++;
        } catch { /* skip failures */ }
      }
    } finally { this.busy.set(null); }
    this.ui.toast(added ? `Imported ${added} fragrances` : 'All already imported', added ? 'ok' : 'info');
  }

  // ---------------- Tools: clear old Rumi image links ----------------
  readonly rumiImageCount = computed(
    () => this.shop.products().filter((p) => p.imageUrl && !isCustomImage(p.imageUrl)).length,
  );

  async cleanRumiImages(): Promise<void> {
    const n = this.rumiImageCount();
    if (!n) return;
    if (!(await this.ui.confirm({
      title: 'Use placeholders?',
      message: `Remove the old Rumi image links from ${n} product${n === 1 ? '' : 's'}? They'll show the branded placeholder until you add your own photo.`,
      confirmLabel: 'Remove links',
    }))) return;
    this.busy.set('clean');
    let done = 0;
    try {
      for (const p of this.shop.products()) {
        if (p.imageUrl && !isCustomImage(p.imageUrl)) {
          try { await this.shop.updateProduct(p.id, { imageUrl: '' }); done++; } catch { /* skip */ }
        }
      }
      this.ui.toast(`Cleared ${done} image link${done === 1 ? '' : 's'}`, 'ok');
    } finally {
      this.busy.set(null);
    }
  }
}
