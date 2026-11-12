import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { EXPENSE_CATEGORIES, Expense, Order, Product } from '../../models';

type Tab = 'month' | 'cashup' | 'expenses';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local (not UTC) yyyy-mm-dd, so late-night entries land on the right day. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthRange(m: string): [number, number] {
  const [y, mo] = m.split('-').map(Number);
  return [new Date(y, mo - 1, 1).getTime(), new Date(y, mo, 1).getTime()];
}
function dayRange(day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v);
}

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .head-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .head-controls input { width: auto; min-width: 160px; }
    .net-pos { color: var(--ok); } .net-neg { color: var(--danger); }
    .cat-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; }
    .cat-row .bar { grid-column: 1 / -1; }
    .method { text-transform: capitalize; }
    @media (max-width: 999px) { .exp-form { order: -1; } }
  `],
  template: `
<div class="page">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Budget</h1>
      <p class="page-sub">Income, costs and cash-ups</p>
    </div>
    <div class="head-controls">
      @if (tab() === 'cashup') {
        <input type="date" aria-label="Cash-up day" [ngModel]="cashupDate()" (ngModelChange)="$event && cashupDate.set($event)" />
      } @else {
        <input type="month" aria-label="Month" [ngModel]="month()" (ngModelChange)="$event && month.set($event)" />
      }
    </div>
  </header>

  <div class="seg block">
    <button [class.on]="tab() === 'month'" (click)="tab.set('month')">Month</button>
    <button [class.on]="tab() === 'cashup'" (click)="tab.set('cashup')">Cash-up</button>
    <button [class.on]="tab() === 'expenses'" (click)="tab.set('expenses')">Expenses</button>
  </div>

  @switch (tab()) {
    @case ('month') {
      <div class="grid-4">
        <div class="card stat"><span class="stat-label">Income</span><span class="stat-value">{{ monthIncome() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span><span class="stat-note">{{ monthOrders().length }} sale{{ monthOrders().length === 1 ? '' : 's' }}</span></div>
        <div class="card stat"><span class="stat-label">Cost of goods</span><span class="stat-value">{{ monthCogs() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span></div>
        <div class="card stat"><span class="stat-label">Expenses</span><span class="stat-value">{{ monthExpensesTotal() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span><span class="stat-note">{{ monthExpenses().length }} logged</span></div>
        <div class="card stat"><span class="stat-label">Net</span><span class="stat-value" [class.net-pos]="monthNet() > 0" [class.net-neg]="monthNet() < 0">{{ monthNet() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span></div>
      </div>

      <div class="split even">
        <div class="card">
          <div class="card-head"><h2>Expenses by category</h2><button class="btn btn-ghost btn-sm" (click)="tab.set('expenses')">Add</button></div>
          <div class="card-body stack">
            @for (c of byCategory(); track c.category) {
              <div class="cat-row">
                <span class="small bold">{{ c.category }}</span>
                <span class="num small">{{ c.amount | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span>
                <div class="bar"><i [style.width.%]="c.pct"></i></div>
              </div>
            } @empty {
              <p class="muted small">No expenses logged for this month yet.</p>
            }
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>All time</h2></div>
            <div class="card-body">
              <dl class="kv">
                <dt>Revenue</dt><dd class="num">{{ revenue() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt>Cost of goods</dt><dd class="num">{{ cogs() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt>Gross profit</dt><dd class="num">{{ revenue() - cogs() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt>Expenses</dt><dd class="num">{{ expensesTotal() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt class="bold">Net profit</dt><dd class="num bold" [class.net-neg]="netProfit() < 0">{{ netProfit() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
              </dl>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Inventory on hand</h2></div>
            <div class="card-body stack-sm">
              <dl class="kv">
                <dt>Cost value</dt><dd class="num">{{ invCost() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt>Retail value</dt><dd class="num">{{ invRetail() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
                <dt>Potential profit</dt><dd class="num">{{ invRetail() - invCost() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</dd>
              </dl>
              <p class="tiny muted">Set a “Cost per unit” on each product for these to be accurate.</p>
            </div>
          </div>
        </div>
      </div>
    }

    @case ('cashup') {
      <div class="grid-2">
        <div class="card stat"><span class="stat-label">Till sales</span><span class="stat-value">{{ cashupOrders().length }}</span><span class="stat-note">{{ cashupDate() | date:'EEE d MMM y' }}</span></div>
        <div class="card stat"><span class="stat-label">Takings</span><span class="stat-value">{{ cashupTotal() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
      </div>

      @if (cashupOrders().length) {
        <div class="split even">
          <div class="card">
            <div class="card-head"><h2>By payment method</h2></div>
            <div class="list" style="border: 0; border-radius: 0 0 var(--r-lg) var(--r-lg)">
              @for (m of cashupByMethod(); track m.method) {
                <div class="list-item">
                  <span class="avatar"><app-icon [name]="m.method === 'cash' ? 'wallet' : 'receipt'" [size]="18" /></span>
                  <div class="li-main"><span class="li-title method">{{ m.method }}</span><span class="li-sub">{{ m.count }} sale{{ m.count === 1 ? '' : 's' }}</span></div>
                  <div class="li-end"><span class="num">{{ m.total | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
                </div>
              }
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Top items</h2></div>
            <div class="list" style="border: 0; border-radius: 0 0 var(--r-lg) var(--r-lg)">
              @for (i of cashupTopItems(); track i.name) {
                <div class="list-item">
                  <div class="li-main"><span class="li-title">{{ i.name }}</span><span class="li-sub">× {{ i.qty }}</span></div>
                  <div class="li-end"><span class="num">{{ i.total | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
                </div>
              }
            </div>
          </div>
        </div>
      } @else {
        <div class="empty">
          <div class="empty-icon"><app-icon name="wallet" [size]="24" /></div>
          <h3>No till sales</h3>
          <p>Nothing was sold at the till on this day.</p>
        </div>
      }
    }

    @case ('expenses') {
      <div class="split">
        <div class="stack">
          <p class="section-title muted">{{ monthLabel() }} · {{ monthExpensesTotal() | currency:'ZAR':'symbol-narrow':'1.0-2' }}</p>
          <div class="list">
            @for (e of monthExpensesShown(); track e.id) {
              <div class="list-item">
                <div class="li-main">
                  <span class="li-title">{{ e.category }}</span>
                  <span class="li-sub">{{ e.date | date:'d MMM' }}{{ e.description ? ' · ' + e.description : '' }}</span>
                </div>
                <div class="li-end"><span class="num">{{ e.amount | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
                <button class="btn btn-ghost btn-icon btn-sm" (click)="removeExpense(e)" aria-label="Delete expense"><app-icon name="trash" [size]="16" /></button>
              </div>
            } @empty {
              <div class="list-empty">No expenses logged for this month yet.</div>
            }
          </div>
          @if (monthExpenses().length > monthExpensesShown().length) {
            <button class="btn btn-block" (click)="expLimit.set(expLimit() + 100)">Show more</button>
          }
        </div>

        <form class="card card-pad form exp-form" (ngSubmit)="addExpense()">
          <h2 class="section-title">Add an expense</h2>
          <div class="field-row">
            <div class="field">
              <label for="e-date">Date</label>
              <input id="e-date" type="date" name="date" [(ngModel)]="expense.date" required />
            </div>
            <div class="field">
              <label for="e-amt">Amount (R)</label>
              <input id="e-amt" type="number" name="amount" min="0" step="0.01" inputmode="decimal" placeholder="0.00" [(ngModel)]="expense.amount" />
            </div>
          </div>
          <div class="field">
            <label for="e-cat">Category</label>
            <select id="e-cat" name="category" [(ngModel)]="expense.category">
              @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="e-desc">Description (optional)</label>
            <input id="e-desc" type="text" name="description" [(ngModel)]="expense.description" placeholder="e.g. 50 bottles" />
          </div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="adding()">{{ adding() ? 'Adding…' : 'Add expense' }}</button>
        </form>
      </div>
    }
  }
</div>
  `,
})
export class BudgetPage {
  readonly shop = inject(ShopAdminService);
  private ui = inject(UiService);

  readonly tab = signal<Tab>('month');
  readonly month = signal(today().slice(0, 7));
  readonly cashupDate = signal(today());
  readonly adding = signal(false);
  readonly expLimit = signal(100);
  readonly categories = EXPENSE_CATEGORIES;

  expense = this.emptyExpense();

  // ---------------------------------------------------------- profit
  private readonly costById = computed(() => {
    const m: Record<string, number> = {};
    for (const p of this.shop.products()) m[p.id] = p.cost ?? 0;
    return m;
  });
  private readonly sold = computed(() =>
    this.shop.orders().filter((o) => o.status === 'paid' || o.status === 'fulfilled' || o.status === 'shipped' || o.status === 'delivered'));
  private orderCogs(o: Order): number {
    const cost = this.costById();
    return (o.items || []).reduce((s, i) => s + (cost[i.productId] ?? 0) * i.qty, 0);
  }
  private effPrice(p: Product): number {
    return p.salePrice != null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
  }

  readonly revenue = computed(() => this.sold().reduce((s, o) => s + (o.total || 0), 0));
  readonly cogs = computed(() => this.sold().reduce((s, o) => s + this.orderCogs(o), 0));
  readonly expensesTotal = computed(() => this.shop.expenses().reduce((s, e) => s + (e.amount || 0), 0));
  readonly netProfit = computed(() => this.revenue() - this.cogs() - this.expensesTotal());
  readonly invCost = computed(() => this.shop.products().reduce((s, p) => s + (p.cost || 0) * (p.stockQty || 0), 0));
  readonly invRetail = computed(() => this.shop.products().reduce((s, p) => s + this.effPrice(p) * (p.stockQty || 0), 0));

  // ----------------------------------------------------------- month
  readonly monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  });
  readonly monthOrders = computed(() => {
    const [s, e] = monthRange(this.month());
    return this.sold().filter((o) => o.createdAt >= s && o.createdAt < e);
  });
  readonly monthExpenses = computed(() => {
    const [s, e] = monthRange(this.month());
    return this.shop.expenses().filter((x) => x.date >= s && x.date < e).sort((a, b) => b.date - a.date);
  });
  readonly monthExpensesShown = computed(() => this.monthExpenses().slice(0, this.expLimit()));
  readonly monthExpensesTotal = computed(() => this.monthExpenses().reduce((s, x) => s + (x.amount || 0), 0));
  readonly monthIncome = computed(() => this.monthOrders().reduce((s, o) => s + (o.total || 0), 0));
  readonly monthCogs = computed(() => this.monthOrders().reduce((s, o) => s + this.orderCogs(o), 0));
  readonly monthNet = computed(() => this.monthIncome() - this.monthCogs() - this.monthExpensesTotal());
  readonly byCategory = computed(() => {
    const map: Record<string, number> = {};
    for (const x of this.monthExpenses()) map[x.category] = (map[x.category] || 0) + (x.amount || 0);
    const rows = Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
    const max = rows[0]?.amount || 1;
    return rows.map((r) => ({ ...r, pct: Math.max(2, (r.amount / max) * 100) }));
  });

  // --------------------------------------------------------- cash-up
  readonly cashupOrders = computed(() => {
    const [s, e] = dayRange(this.cashupDate());
    return this.shop.orders().filter((o) => o.channel === 'pos' && o.createdAt >= s && o.createdAt < e);
  });
  readonly cashupTotal = computed(() => this.cashupOrders().reduce((s, o) => s + (o.total || 0), 0));
  readonly cashupByMethod = computed(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const o of this.cashupOrders()) {
      const k = o.paymentMethod || 'other';
      (map[k] ||= { count: 0, total: 0 });
      map[k].count++; map[k].total += o.total || 0;
    }
    return Object.entries(map).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total);
  });
  readonly cashupTopItems = computed(() => {
    const map: Record<string, { name: string; qty: number; total: number }> = {};
    for (const o of this.cashupOrders()) for (const i of o.items || []) {
      (map[i.productId] ||= { name: i.name, qty: 0, total: 0 });
      map[i.productId].qty += i.qty; map[i.productId].total += i.price * i.qty;
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 8);
  });

  // -------------------------------------------------------- expenses
  private emptyExpense() {
    return { date: today(), category: 'Oils', description: '', amount: null as number | null };
  }

  async addExpense(): Promise<void> {
    const amount = numOrNull(this.expense.amount);
    if (amount == null || amount <= 0) { this.ui.toast('Enter an amount', 'err'); return; }
    if (!this.expense.date) { this.ui.toast('Pick a date', 'err'); return; }
    this.adding.set(true);
    try {
      await this.shop.addExpense({
        date: new Date(this.expense.date + 'T12:00:00').getTime(),
        category: this.expense.category,
        description: this.expense.description.trim() || undefined,
        amount,
      });
      this.ui.toast('Expense added', 'ok');
      this.expense = this.emptyExpense();
    } catch {
      this.ui.toast('Save failed — signed in?', 'err');
    } finally {
      this.adding.set(false);
    }
  }

  async removeExpense(e: Expense): Promise<void> {
    const amt = "R" + (+Number(e.amount || 0).toFixed(2));
    if (!(await this.ui.confirm({ title: 'Delete expense?', message: `Delete this ${amt} ${e.category.toLowerCase()} expense?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await this.shop.deleteExpense(e.id);
      this.ui.toast('Expense deleted', 'ok');
    } catch {
      this.ui.toast('Delete failed', 'err');
    }
  }
}
