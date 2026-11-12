import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { SheetComponent } from '../../shared/sheet.component';
import { IconComponent } from '../../icon.component';
import { discountSummary } from '../../discount-util';
import { BundleReward, Discount, DiscountMechanic, DiscountScope } from '../../models';

interface DiscountForm {
  code: string; type: 'percent' | 'fixed'; value: number | null; active: boolean;
  scope: DiscountScope; minSpend: number | null; maxUses: number | null; expires: string;
  mechanic: DiscountMechanic;
  bundleQty: number | null; bundleReward: BundleReward;
  bundleValue: number | null; bundleFree: number | null;
}

type Filter = 'all' | 'active' | 'off';

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v);
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="page narrow">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Discounts</h1>
      <p class="page-sub">{{ activeCount() }} active · {{ shop.discounts().length }} code{{ shop.discounts().length === 1 ? '' : 's' }}</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> New code</button>
    </div>
  </header>

  @if (shop.discounts().length) {
    <div class="chips">
      <button class="chip" [class.on]="filter() === 'all'" (click)="filter.set('all')">All <span class="n">{{ shop.discounts().length }}</span></button>
      <button class="chip" [class.on]="filter() === 'active'" (click)="filter.set('active')">Active <span class="n">{{ activeCount() }}</span></button>
      <button class="chip" [class.on]="filter() === 'off'" (click)="filter.set('off')">Off <span class="n">{{ shop.discounts().length - activeCount() }}</span></button>
    </div>

    <div class="list">
      @for (d of list(); track d.code) {
        <button class="list-item" (click)="edit(d)">
          <span class="avatar"><app-icon name="percent" [size]="18" /></span>
          <div class="li-main">
            <span class="li-title">
              <span class="mono">{{ d.code }}</span>
              @if (!d.active) { <span class="pill">off</span> }
              @else if (expired(d)) { <span class="pill danger">expired</span> }
              @else if (usedUp(d)) { <span class="pill warn">used up</span> }
              @else { <span class="pill ok">active</span> }
            </span>
            <span class="li-sub">
              {{ summary(d) }} · {{ scopeLabel(d.scope) }}
              @if (d.minSpend) { · min {{ d.minSpend | currency:'ZAR':'symbol-narrow':'1.0-2' }} }
              @if (d.expiresAt) { · until {{ d.expiresAt | date:'d MMM y' }} }
            </span>
          </div>
          <div class="li-end">
            <span class="num">{{ d.usedCount || 0 }}{{ d.maxUses ? ' / ' + d.maxUses : '' }}</span>
            <span class="tiny muted">used</span>
          </div>
        </button>
      } @empty {
        <div class="list-empty">No codes here.</div>
      }
    </div>
  } @else {
    <div class="empty">
      <div class="empty-icon"><app-icon name="percent" [size]="24" /></div>
      <h3>No discount codes yet</h3>
      <p>Create a code for the shop, the market till, or both.</p>
      <button class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> New code</button>
    </div>
  }
</div>

@if (open()) {
  <kf-sheet size="wide" [title]="existing() ? 'Edit ' + existing()!.code : 'New code'" [subtitle]="preview()" (closed)="open.set(false)">
    <div class="form">
      <div class="field-row">
        <div class="field">
          <label for="d-code">Code</label>
          <input id="d-code" type="text" [(ngModel)]="form.code" (ngModelChange)="tick()" placeholder="WELCOME10"
                 style="text-transform: uppercase" autocomplete="off" [disabled]="!!existing()" />
          @if (existing()) { <span class="hint">Codes can't be renamed — create a new one instead.</span> }
        </div>
        <div class="field">
          <label for="d-scope">Where it works</label>
          <select id="d-scope" [(ngModel)]="form.scope">
            <option value="both">Online &amp; till</option>
            <option value="online">Online only</option>
            <option value="pos">Till only (markets)</option>
          </select>
        </div>
      </div>

      <div class="field">
        <span class="field-label">How it works</span>
        <div class="seg block">
          <button type="button" [class.on]="form.mechanic === 'order'" (click)="form.mechanic = 'order'; tick()">Whole order</button>
          <button type="button" [class.on]="form.mechanic === 'item'" (click)="form.mechanic = 'item'; tick()">Every item</button>
          <button type="button" [class.on]="form.mechanic === 'bundle'" (click)="form.mechanic = 'bundle'; tick()">Multi-buy</button>
        </div>
      </div>

      @if (form.mechanic !== 'bundle') {
        <div class="field-row">
          <div class="field">
            <label for="d-type">Type</label>
            <select id="d-type" [(ngModel)]="form.type" (ngModelChange)="tick()">
              <option value="percent">% off</option>
              <option value="fixed">R off</option>
            </select>
          </div>
          <div class="field">
            <label for="d-val">Value ({{ form.type === 'percent' ? '%' : 'R' }})</label>
            <input id="d-val" type="number" min="0" inputmode="decimal" [(ngModel)]="form.value" (ngModelChange)="tick()" />
          </div>
        </div>
      } @else {
        <div class="field-row">
          <div class="field">
            <label for="d-bq">Bundle size (items)</label>
            <input id="d-bq" type="number" min="2" inputmode="numeric" [(ngModel)]="form.bundleQty" (ngModelChange)="tick()" placeholder="2" />
          </div>
          <div class="field">
            <label for="d-br">Reward for each bundle</label>
            <select id="d-br" [(ngModel)]="form.bundleReward" (ngModelChange)="tick()">
              <option value="percent">% off the bundle</option>
              <option value="fixed">R off the bundle</option>
              <option value="price">Fixed price for the bundle</option>
              <option value="free">Cheapest item(s) free</option>
            </select>
          </div>
        </div>
        @if (form.bundleReward === 'free') {
          <div class="field">
            <label for="d-bf">Cheapest items free (per bundle)</label>
            <input id="d-bf" type="number" min="1" inputmode="numeric" [(ngModel)]="form.bundleFree" (ngModelChange)="tick()" placeholder="1" />
          </div>
        } @else {
          <div class="field">
            <label for="d-bv">{{ form.bundleReward === 'percent' ? '% off the bundle' : form.bundleReward === 'price' ? 'Price for the whole bundle (R)' : 'Amount off the bundle (R)' }}</label>
            <input id="d-bv" type="number" min="0" inputmode="decimal" [(ngModel)]="form.bundleValue" (ngModelChange)="tick()" />
          </div>
        }
        <p class="notice">Applies per complete bundle. Extra items that don't complete a bundle stay full price — e.g. 3 items with a bundle of 2 = one bundle discounted + one full price.</p>
      }

      <div class="field-row">
        <div class="field">
          <label for="d-min">Min spend (R)</label>
          <input id="d-min" type="number" min="0" inputmode="decimal" [(ngModel)]="form.minSpend" placeholder="None" />
        </div>
        <div class="field">
          <label for="d-max">Max uses</label>
          <input id="d-max" type="number" min="0" inputmode="numeric" [(ngModel)]="form.maxUses" placeholder="Unlimited" />
          @if (existing(); as e) { <span class="hint">Used {{ e.usedCount || 0 }} time{{ (e.usedCount || 0) === 1 ? '' : 's' }} so far.</span> }
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="d-exp">Expires (optional)</label>
          <input id="d-exp" type="date" [(ngModel)]="form.expires" />
        </div>
        <div class="field" style="justify-content: flex-end">
          <label class="switch"><input type="checkbox" [(ngModel)]="form.active" /><span></span> Active</label>
        </div>
      </div>

      <div class="notice ok"><app-icon name="tag" [size]="16" /> <span><strong>Preview:</strong> {{ preview() }}</span></div>
    </div>

    <ng-container sheet-actions>
      @if (existing()) {
        <button class="btn btn-danger" (click)="remove(existing()!)" [disabled]="saving()"><app-icon name="trash" [size]="16" /> Delete</button>
      }
      <button class="btn" (click)="open.set(false)">Cancel</button>
      <button class="btn btn-primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save code' }}</button>
    </ng-container>
  </kf-sheet>
}
  `,
})
export class DiscountsPage {
  readonly shop = inject(ShopAdminService);
  private ui = inject(UiService);

  readonly filter = signal<Filter>('all');
  readonly open = signal(false);
  readonly saving = signal(false);
  readonly existing = signal<Discount | null>(null);
  /** Bumped on form edits so the live preview (a signal) recomputes. */
  private readonly rev = signal(0);

  form: DiscountForm = this.emptyForm();

  readonly activeCount = computed(() => this.shop.discounts().filter((d) => d.active).length);
  readonly list = computed(() => {
    const f = this.filter();
    const all = [...this.shop.discounts()].sort((a, b) => a.code.localeCompare(b.code));
    return f === 'all' ? all : all.filter((d) => (f === 'active' ? d.active : !d.active));
  });

  readonly preview = computed(() => {
    this.rev();
    const f = this.form;
    return discountSummary({
      code: f.code, type: f.type, value: f.value ?? 0, active: f.active,
      mechanic: f.mechanic, bundleQty: f.bundleQty ?? 2, bundleReward: f.bundleReward,
      bundleValue: f.bundleValue ?? 0, bundleFree: f.bundleFree ?? 1,
    });
  });

  summary = discountSummary;
  tick(): void { this.rev.update((n) => n + 1); }

  scopeLabel(s?: DiscountScope): string { return s === 'online' ? 'Online' : s === 'pos' ? 'Till' : 'Online & till'; }
  expired(d: Discount): boolean { return !!d.expiresAt && Date.now() > d.expiresAt; }
  usedUp(d: Discount): boolean { return d.maxUses != null && d.maxUses > 0 && (d.usedCount || 0) >= d.maxUses; }

  private emptyForm(): DiscountForm {
    return {
      code: '', type: 'percent', value: null, active: true, scope: 'both',
      minSpend: null, maxUses: null, expires: '',
      mechanic: 'order', bundleQty: 2, bundleReward: 'percent', bundleValue: null, bundleFree: 1,
    };
  }

  openNew(): void {
    this.form = this.emptyForm();
    this.existing.set(null);
    this.tick();
    this.open.set(true);
  }

  edit(d: Discount): void {
    this.form = {
      code: d.code, type: d.type, value: d.value, active: d.active,
      scope: d.scope || 'both', minSpend: d.minSpend || null, maxUses: d.maxUses ?? null,
      expires: d.expiresAt ? localDate(d.expiresAt) : '',
      mechanic: d.mechanic || 'order',
      bundleQty: d.bundleQty ?? 2, bundleReward: d.bundleReward || 'percent',
      bundleValue: d.bundleValue ?? null, bundleFree: d.bundleFree ?? 1,
    };
    this.existing.set(d);
    this.tick();
    this.open.set(true);
  }

  async save(): Promise<void> {
    const f = this.form;
    const code = f.code.trim().toUpperCase();
    if (!code) { this.ui.toast('A code is required', 'err'); return; }
    const existing = this.shop.discounts().find((x) => x.code === code);
    if (existing && !this.existing()) {
      if (!(await this.ui.confirm({ title: 'Code exists', message: `${code} already exists. Replace its settings?`, confirmLabel: 'Replace' }))) return;
    }
    const expiresAt = f.expires ? new Date(f.expires + 'T23:59:59').getTime() : null;

    // Validate per mechanic.
    let value = 0;
    let bundle: Partial<Discount> = {};
    if (f.mechanic === 'bundle') {
      const qty = numOrNull(f.bundleQty);
      if (qty == null || qty < 2) { this.ui.toast('Bundle size must be at least 2', 'err'); return; }
      if (f.bundleReward === 'free') {
        const free = numOrNull(f.bundleFree);
        if (free == null || free < 1 || free >= qty) { this.ui.toast('Free items must be between 1 and bundle size − 1', 'err'); return; }
        bundle = { bundleQty: qty, bundleReward: 'free', bundleFree: free, bundleValue: 0 };
      } else {
        const bv = numOrNull(f.bundleValue);
        if (bv == null) { this.ui.toast('Enter the bundle value', 'err'); return; }
        bundle = { bundleQty: qty, bundleReward: f.bundleReward, bundleValue: bv, bundleFree: 0 };
      }
    } else {
      const v = numOrNull(f.value);
      if (v == null) { this.ui.toast('A value is required', 'err'); return; }
      value = v;
    }

    this.saving.set(true);
    try {
      await this.shop.saveDiscount({
        code, type: f.type, value, active: f.active,
        scope: f.scope, minSpend: numOrNull(f.minSpend) ?? 0,
        maxUses: numOrNull(f.maxUses), expiresAt, usedCount: existing?.usedCount ?? 0,
        mechanic: f.mechanic, ...bundle,
      });
      this.ui.toast('Discount saved', 'ok');
      this.open.set(false);
    } catch {
      this.ui.toast('Save failed — are you signed in?', 'err');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(d: Discount): Promise<void> {
    if (!(await this.ui.confirm({ title: 'Delete code?', message: `Delete discount code ${d.code}? Customers won't be able to use it any more.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await this.shop.deleteDiscount(d.code);
      this.ui.toast('Discount deleted', 'ok');
      this.open.set(false);
    } catch {
      this.ui.toast('Delete failed', 'err');
    }
  }
}
