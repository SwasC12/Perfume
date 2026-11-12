import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { ScanService } from '../../core/scan.service';
import { IconComponent } from '../../icon.component';
import { Order, OrderStatus } from '../../models';
import { DocKind } from '../../order-docs';
import { ORDER_STATUSES, deliveryLine, itemCount, timeAgo } from './order-util';
import { runDocs } from './doc-actions';

type Filter = 'all' | OrderStatus;

@Component({
  standalone: true,
  imports: [RouterLink, CurrencyPipe, NgTemplateOutlet, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="page">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Orders</h1>
      <p class="page-sub">{{ subtitle() }}</p>
    </div>
    <div class="page-actions">
      @if (shop.orders().length) {
        <button class="btn" [class.btn-soft]="selecting()" (click)="toggleSelecting()">
          <app-icon name="printer" [size]="16" /> {{ selecting() ? 'Done' : 'Select' }}
        </button>
        <button class="btn" (click)="exportCsv()"><app-icon name="download" [size]="16" /> <span class="hide-phone">Export </span>CSV</button>
      }
      <button class="btn btn-primary" (click)="scanOrder()"><app-icon name="qr" [size]="16" /> Scan order</button>
    </div>
  </header>

  <div class="toolbar">
    <div class="search">
      <app-icon name="search" [size]="16" />
      <input type="search" placeholder="Search reference, customer, email, phone…" aria-label="Search orders"
             [value]="search()" (input)="onSearch($any($event.target).value)" />
    </div>
  </div>

  <div class="chips" aria-label="Filter by status">
    @for (f of filters; track f) {
      <button class="chip" [class.on]="filter() === f" (click)="setFilter(f)">
        {{ f === 'all' ? 'All' : f }} <span class="n">{{ counts()[f] }}</span>
      </button>
    }
  </div>

  @if (shop.loadingOrders() && shop.orders().length === 0) {
    <div class="list">
      @for (i of [1, 2, 3, 4, 5]; track i) {
        <div class="list-item"><div class="li-main"><div class="skeleton" style="height:14px;width:40%"></div><div class="skeleton" style="height:12px;width:65%"></div></div></div>
      }
    </div>
  } @else if (filtered().length === 0) {
    <div class="card">
      <div class="empty">
        <span class="empty-icon"><app-icon name="receipt" [size]="24" /></span>
        <h3>No orders</h3>
        <p>{{ search() ? 'Nothing matches your search.' : filter() === 'all' ? 'Orders placed on your shop will appear here in real time.' : 'No ' + filter() + ' orders.' }}</p>
      </div>
    </div>
  } @else {
    @if (selecting()) {
      <div class="row between small muted">
        <span>Tap orders to select them for printing.</span>
        <button class="btn btn-ghost btn-sm" (click)="selectAllVisible()">Select all shown</button>
      </div>
    }
    <div class="list">
      @for (o of visible(); track o.id) {
        @if (selecting()) {
          <button type="button" class="list-item" [class.selected]="selected().has(o.id)" (click)="toggle(o.id)" [attr.aria-pressed]="selected().has(o.id)">
            <span class="tick" [class.on]="selected().has(o.id)" aria-hidden="true">@if (selected().has(o.id)) { <app-icon name="check" [size]="14" /> }</span>
            <ng-container *ngTemplateOutlet="row; context: { $implicit: o }" />
          </button>
        } @else {
          <a class="list-item" [routerLink]="['/orders', o.id]">
            <ng-container *ngTemplateOutlet="row; context: { $implicit: o }" />
          </a>
        }
      }
    </div>
    @if (filtered().length > limit()) {
      <button class="btn btn-block" (click)="limit.set(limit() + 100)">Show more ({{ filtered().length - limit() }} left)</button>
    }
  }

  <ng-template #row let-o>
    <div class="li-main">
      <span class="li-title">
        <span class="mono">{{ o.reference }}</span>
        <span class="pill" [attr.data-status]="o.status">{{ o.status }}</span>
        @if (o.channel === 'pos') { <span class="pill plain">POS</span> }
      </span>
      <span class="li-sub">
        {{ o.customer?.name || 'Walk-in' }} · {{ items(o) }} item{{ items(o) === 1 ? '' : 's' }}@if (o.stage && o.stage !== 'placed' && o.status === 'paid') { · {{ o.stage }}}@if (o.referralRewardApplied) { · free 30 ml gift}@if (o.referralCode) { · ref {{ o.referralCode }}}
      </span>
    </div>
    <div class="li-end">
      <span class="num">{{ o.total | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span>
      <span class="tiny muted">{{ ago(o.createdAt) }}</span>
    </div>
  </ng-template>

  @if (selected().size > 0) {
    <div class="action-bar batch">
      <span class="bold batch-count">{{ selected().size }} selected</span>
      <div class="seg" aria-label="Document type">
        <button type="button" [class.on]="batchKind() === 'slip'" (click)="batchKind.set('slip')">Slips</button>
        <button type="button" [class.on]="batchKind() === 'invoice'" (click)="batchKind.set('invoice')">Invoices</button>
      </div>
      <span class="spacer hide-phone"></span>
      <button class="btn btn-ghost" (click)="clearSelection()">Clear</button>
      <button class="btn" [disabled]="!!busy()" (click)="batch('share')"><app-icon name="share" [size]="16" /> {{ busy() === 'share' ? 'Preparing…' : 'Share' }}</button>
      <button class="btn btn-primary" [disabled]="!!busy()" (click)="batch('print')"><app-icon name="printer" [size]="16" /> {{ busy() === 'print' ? 'Preparing…' : 'Print' }}</button>
    </div>
  }
</div>
  `,
  styles: [`
    .tick {
      flex: none; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center;
      border: 1.5px solid #CBD5E1; background: var(--surface); color: #fff;
    }
    .tick.on { background: var(--primary); border-color: var(--primary); }
    .action-bar.batch { flex-wrap: wrap; align-items: center; }
    @media (max-width: 767px) {
      .action-bar.batch .batch-count { flex: 1; }
      .action-bar.batch > .btn-ghost { flex: 0 0 auto; }
    }
  `],
})
export class OrdersPage {
  readonly shop = inject(ShopAdminService);
  private ui = inject(UiService);
  private scan = inject(ScanService);
  private router = inject(Router);

  readonly filters: Filter[] = ['all', ...ORDER_STATUSES];
  readonly filter = signal<Filter>('all');
  readonly search = signal('');
  readonly limit = signal(100);

  readonly selecting = signal(false);
  readonly selected = signal<Set<string>>(new Set());
  readonly batchKind = signal<DocKind>('slip');
  readonly busy = signal<'print' | 'share' | null>(null);

  readonly counts = computed(() => {
    const c: Record<string, number> = { all: 0 };
    for (const s of ORDER_STATUSES) c[s] = 0;
    for (const o of this.shop.orders()) { c['all']++; c[o.status] = (c[o.status] || 0) + 1; }
    return c;
  });

  readonly filtered = computed<Order[]>(() => {
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    let list = f === 'all' ? this.shop.orders() : this.shop.orders().filter((o) => o.status === f);
    if (q) {
      list = list.filter((o) =>
        [o.reference, o.customer?.name, o.customer?.email, o.customer?.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  });

  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  readonly subtitle = computed(() => {
    const c = this.counts();
    if (!c['all']) return 'No orders yet';
    const bits: string[] = [];
    if (c['paid']) bits.push(`${c['paid']} to pack`);
    if (c['pending']) bits.push(`${c['pending']} awaiting payment`);
    return bits.length ? bits.join(' · ') : 'All caught up';
  });

  readonly items = itemCount;
  readonly ago = timeAgo;

  onSearch(v: string): void { this.search.set(v); this.limit.set(100); }
  setFilter(f: Filter): void { this.filter.set(f); this.limit.set(100); }

  toggleSelecting(): void {
    const next = !this.selecting();
    this.selecting.set(next);
    if (!next) this.clearSelection();
  }
  toggle(id: string): void {
    this.selected.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  selectAllVisible(): void {
    this.selected.update((s) => { const n = new Set(s); for (const o of this.visible()) n.add(o.id); return n; });
  }
  clearSelection(): void { this.selected.set(new Set()); }

  async batch(action: 'print' | 'share'): Promise<void> {
    if (this.busy()) return;
    const ids = this.selected();
    const orders = this.shop.orders().filter((o) => ids.has(o.id));
    this.busy.set(action);
    try {
      const outcome = await runDocs(action, this.batchKind(), orders, this.shop.settings(), (t, k) => this.ui.toast(t, k));
      if (outcome && outcome !== 'cancelled') { this.clearSelection(); this.selecting.set(false); }
    } finally {
      this.busy.set(null);
    }
  }

  async scanOrder(): Promise<void> {
    const o = await this.scan.pickOrder();
    if (o) void this.router.navigate(['/orders', o.id]);
  }

  exportCsv(): void {
    const rows = [['Reference', 'Date', 'Status', 'Customer', 'Email', 'Phone', 'Method', 'Delivery', 'Items', 'Total']];
    for (const o of this.shop.orders()) {
      rows.push([
        o.reference,
        new Date(o.createdAt).toISOString().slice(0, 10),
        o.status,
        o.customer?.name ?? '',
        o.customer?.email ?? '',
        o.customer?.phone ?? '',
        o.deliveryMethod ?? '',
        deliveryLine(o),
        (o.items || []).map((i) => `${i.qty}x ${i.name}${i.size ? ' (' + i.size + ')' : ''}`).join('; '),
        String(o.total),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaua-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.ui.toast('Orders exported', 'ok');
  }
}
