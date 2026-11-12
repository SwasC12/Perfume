import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { IconComponent } from '../../icon.component';
import { Order } from '../../models';
import { isSold, itemCount, timeAgo, unitCount } from '../orders/order-util';

@Component({
  standalone: true,
  imports: [RouterLink, CurrencyPipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  readonly shop = inject(ShopAdminService);
  readonly ago = timeAgo;
  readonly items = itemCount;

  readonly today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  readonly loading = computed(() => this.shop.loadingOrders() && this.shop.orders().length === 0);

  // ---------------------------------------------------------- needs action
  /** Paid orders waiting to be packed, oldest first. */
  readonly toPack = computed(() => this.shop.orders().filter((o) => o.status === 'paid').slice().reverse());
  readonly awaiting = computed(() => this.shop.orders().filter((o) => o.status === 'pending'));
  /** Active products with 5 or fewer units on hand (incl. sold out), lowest first. */
  readonly lowStockItems = computed(() =>
    this.shop.products()
      .filter((p) => p.active !== false)
      .map((p) => ({ product: p, units: unitCount(p) }))
      .filter((x) => x.units <= 5)
      .sort((a, b) => a.units - b.units || a.product.name.localeCompare(b.product.name)));

  // ---------------------------------------------------------- inventory
  readonly inventoryStats = computed(() => {
    const list = this.shop.products().filter((p) => p.active !== false);
    let units = 0;
    let low = 0;
    let out = 0;
    for (const p of list) {
      const u = unitCount(p);
      units += u;
      if (u <= 0) out++;
      else if (u <= 5) low++;
    }
    return { products: list.length, units, low, out };
  });

  // ---------------------------------------------------------- money / profit
  private readonly costById = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.shop.products()) m.set(p.id, p.cost ?? 0);
    return m;
  });
  private readonly soldOrders = computed(() => this.shop.orders().filter(isSold));
  private orderCogs(o: Order, costs: Map<string, number>): number {
    return (o.items || []).reduce((s, i) => s + (costs.get(i.productId) ?? 0) * i.qty, 0);
  }
  readonly kpiRevenue = computed(() => this.soldOrders().reduce((s, o) => s + (o.total || 0), 0));
  readonly kpiCogs = computed(() => {
    const costs = this.costById();
    return this.soldOrders().reduce((s, o) => s + this.orderCogs(o, costs), 0);
  });
  readonly kpiGrossProfit = computed(() => this.kpiRevenue() - this.kpiCogs());
  readonly expensesTotal = computed(() => this.shop.expenses().reduce((s, e) => s + (e.amount || 0), 0));
  readonly kpiNetProfit = computed(() => this.kpiGrossProfit() - this.expensesTotal());
  readonly inventoryCostValue = computed(() => this.shop.products().reduce((s, p) => s + (p.cost || 0) * (p.stockQty || 0), 0));

  private thisMonth(o: Order): boolean {
    const d = new Date(o.createdAt); const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }
  readonly kpiRevenueMonth = computed(() =>
    this.shop.orders().filter((o) => this.thisMonth(o) && o.status !== 'cancelled').reduce((s, o) => s + o.total, 0));
  readonly kpiOrdersMonth = computed(() => this.shop.orders().filter((o) => this.thisMonth(o)).length);
  readonly kpiPending = computed(() => this.awaiting().length);
  readonly kpiPaid = computed(() => this.toPack().length);

  // ---------------------------------------------------------- lists
  readonly recentOrders = computed(() => this.shop.orders().slice(0, 6));
  readonly topProducts = computed(() => {
    const tally = new Map<string, { id: string; name: string; qty: number }>();
    for (const o of this.shop.orders()) {
      if (o.status === 'cancelled') continue;
      for (const i of o.items || []) {
        const e = tally.get(i.productId) ?? { id: i.productId, name: i.name, qty: 0 };
        e.qty += i.qty; tally.set(i.productId, e);
      }
    }
    return [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  });
  readonly topMax = computed(() => Math.max(1, ...this.topProducts().map((t) => t.qty)));

  /** Reorder / what to mix: tracked flat stock at 5 or fewer, with units sold. */
  readonly reorderList = computed(() => {
    const soldQty: Record<string, number> = {};
    for (const o of this.soldOrders()) for (const i of o.items || []) soldQty[i.productId] = (soldQty[i.productId] || 0) + i.qty;
    return this.shop.products()
      .filter((p) => p.stockQty != null && p.stockQty <= 5)
      .map((p) => ({ product: p, sold: soldQty[p.id] || 0 }))
      .sort((a, b) => (a.product.stockQty! - b.product.stockQty!) || (b.sold - a.sold));
  });

  // ---------------------------------------------------------- charts
  /** Revenue for the last 14 days. */
  readonly revenueSeries = computed(() => {
    const days: { label: string; day: string; total: number; today: boolean }[] = [];
    const now = new Date();
    const orders = this.shop.orders().filter((o) => o.status !== 'cancelled');
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      const start = d.getTime(); const end = start + 86400000;
      const total = orders.filter((o) => o.createdAt >= start && o.createdAt < end).reduce((s, o) => s + o.total, 0);
      days.push({
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        day: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        total,
        today: i === 0,
      });
    }
    return days;
  });
  readonly revenueMax = computed(() => Math.max(1, ...this.revenueSeries().map((d) => d.total)));
  readonly revenue14 = computed(() => this.revenueSeries().reduce((s, d) => s + d.total, 0));

  readonly channelSplit = computed(() => {
    let online = 0, pos = 0;
    for (const o of this.shop.orders()) {
      if (o.status === 'cancelled') continue;
      if (o.channel === 'pos') pos += o.total; else online += o.total;
    }
    return { online, pos, total: online + pos };
  });

  pct(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 100) : 0;
  }
}
