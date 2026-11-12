import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { CustomerProfile, Order } from '../../models';
import { addressText, initials, orderDate } from '../orders/order-util';

type CustomerRow = CustomerProfile & { orders: number; spent: number };
type Sort = 'spent' | 'orders' | 'name';

@Component({
  standalone: true,
  imports: [RouterLink, CurrencyPipe, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="page">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Customers</h1>
      <p class="page-sub">{{ stats().length }} registered · {{ buyers() }} with orders</p>
    </div>
  </header>

  @if (stats().length === 0) {
    <div class="card">
      <div class="empty">
        <span class="empty-icon"><app-icon name="users" [size]="24" /></span>
        <h3>No registered customers yet</h3>
        <p>Customers who create an account on the shop appear here.</p>
      </div>
    </div>
  } @else {
    <div class="toolbar">
      <div class="search">
        <app-icon name="search" [size]="16" />
        <input type="search" placeholder="Search name, email, phone…" aria-label="Search customers"
               [value]="search()" (input)="onSearch($any($event.target).value)" />
      </div>
      <div class="seg" aria-label="Sort">
        <button type="button" [class.on]="sort() === 'spent'" (click)="sort.set('spent')">Top spend</button>
        <button type="button" [class.on]="sort() === 'orders'" (click)="sort.set('orders')">Orders</button>
        <button type="button" [class.on]="sort() === 'name'" (click)="sort.set('name')">Name</button>
      </div>
    </div>

    @if (filtered().length === 0) {
      <div class="list"><div class="list-empty">Nothing matches your search.</div></div>
    } @else {
      <div class="list">
        @for (c of visible(); track c.uid) {
          <button type="button" class="list-item" (click)="selectedUid.set(c.uid)">
            <span class="avatar">{{ ini(c.name || c.email) }}</span>
            <div class="li-main">
              <span class="li-title">{{ c.name || 'No name' }}</span>
              <span class="li-sub">{{ c.email }}@if (c.phone) { · {{ c.phone }}}</span>
            </div>
            <div class="li-end">
              <span class="num">{{ c.spent | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span>
              <span class="tiny muted">{{ c.orders }} order{{ c.orders === 1 ? '' : 's' }}</span>
            </div>
          </button>
        }
      </div>
      @if (filtered().length > limit()) {
        <button class="btn btn-block" (click)="limit.set(limit() + 100)">Show more ({{ filtered().length - limit() }} left)</button>
      }
    }
  }

  @if (selected(); as c) {
    <kf-sheet [title]="c.name || 'Customer'" [subtitle]="c.email" size="wide" (closed)="selectedUid.set(null)">
      <div class="stack-lg">
        <div class="grid-3">
          <div class="card stat"><span class="stat-label">Orders</span><span class="stat-value">{{ c.orders }}</span></div>
          <div class="card stat"><span class="stat-label">Spent</span><span class="stat-value">{{ c.spent | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span></div>
          <div class="card stat"><span class="stat-label">Average order</span><span class="stat-value">{{ (c.orders ? c.spent / c.orders : 0) | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span></div>
        </div>

        <dl class="kv">
          <dt>Email</dt><dd><a [href]="'mailto:' + c.email">{{ c.email }}</a></dd>
          <dt>Phone</dt><dd>@if (c.phone) { <a [href]="'tel:' + c.phone">{{ c.phone }}</a> } @else { — }</dd>
          <dt>Delivery address</dt><dd>{{ addr(c.delivery) || '—' }}</dd>
          <dt>Billing address</dt><dd>{{ addr(c.billing) || '—' }}</dd>
        </dl>

        <div class="stack-sm">
          <h3 class="section-title muted">Orders ({{ selectedOrders().length }})</h3>
          @if (selectedOrders().length === 0) {
            <div class="list"><div class="list-empty">No orders yet.</div></div>
          } @else {
            <div class="list">
              @for (o of selectedOrders(); track o.id) {
                <a class="list-item" [routerLink]="['/orders', o.id]">
                  <div class="li-main">
                    <span class="li-title"><span class="mono">{{ o.reference }}</span> <span class="pill" [attr.data-status]="o.status">{{ o.status }}</span></span>
                    <span class="li-sub">{{ date(o.createdAt) }}</span>
                  </div>
                  <div class="li-end"><span class="num">{{ o.total | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
                </a>
              }
            </div>
          }
        </div>
      </div>
      <ng-container sheet-actions>
        <button class="btn" (click)="selectedUid.set(null)">Close</button>
      </ng-container>
    </kf-sheet>
  }
</div>
  `,
})
export class CustomersPage {
  readonly shop = inject(ShopAdminService);

  readonly search = signal('');
  readonly sort = signal<Sort>('spent');
  readonly limit = signal(100);
  readonly selectedUid = signal<string | null>(null);

  readonly ini = initials;
  readonly addr = addressText;
  readonly date = orderDate;

  /** Customers with order stats (cancelled orders don't count). */
  readonly stats = computed<CustomerRow[]>(() => {
    const byUid = new Map<string, { orders: number; spent: number }>();
    for (const o of this.shop.orders()) {
      if (!o.uid || o.status === 'cancelled') continue;
      const e = byUid.get(o.uid) ?? { orders: 0, spent: 0 };
      e.orders += 1; e.spent += o.total; byUid.set(o.uid, e);
    }
    return this.shop.customers().map((c) => ({ ...c, ...(byUid.get(c.uid) ?? { orders: 0, spent: 0 }) }));
  });

  readonly buyers = computed(() => this.stats().filter((c) => c.orders > 0).length);

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    let list = this.stats();
    if (q) list = list.filter((c) => [c.name, c.email, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
    const s = this.sort();
    return [...list].sort((a, b) =>
      s === 'name' ? (a.name || a.email || '').localeCompare(b.name || b.email || '')
        : s === 'orders' ? b.orders - a.orders || b.spent - a.spent
          : b.spent - a.spent);
  });
  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  readonly selected = computed(() => {
    const uid = this.selectedUid();
    return uid ? this.stats().find((c) => c.uid === uid) ?? null : null;
  });
  readonly selectedOrders = computed<Order[]>(() => {
    const uid = this.selectedUid();
    return uid ? this.shop.orders().filter((o) => o.uid === uid) : [];
  });

  onSearch(v: string): void { this.search.set(v); this.limit.set(100); }
}
