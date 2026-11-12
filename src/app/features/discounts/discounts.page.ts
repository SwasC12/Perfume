import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { SheetComponent } from '../../shared/sheet.component';
import { IconComponent } from '../../icon.component';
import { describeDiscount, discountStatus, discountSummary, DiscountStatus, fmtDay, hasTargeting } from '../../discount-util';
import { Discount, DiscountScope, Product, ProductSizeKey } from '../../models';

/** The plain-language "type" picked up front; each maps onto the shared engine. */
type Preset = 'pct_order' | 'fixed_order' | 'free_delivery' | 'bxgy' | 'multibuy' | 'pct_selected' | 'per_item';
type MultiReward = 'price' | 'percent' | 'fixed';

interface PresetInfo { id: Preset; icon: string; title: string; sub: string; }

const PRESETS: PresetInfo[] = [
  { id: 'pct_order', icon: 'percent', title: '% off everything', sub: 'e.g. 10% off the whole order' },
  { id: 'fixed_order', icon: 'wallet', title: 'R off order', sub: 'e.g. R50 off the order' },
  { id: 'free_delivery', icon: 'truck', title: 'Free delivery', sub: 'Online delivery fee becomes R0' },
  { id: 'bxgy', icon: 'bag', title: 'Buy X get Y', sub: 'e.g. buy 2 get 1 free' },
  { id: 'multibuy', icon: 'layers', title: 'Multi-buy price', sub: 'e.g. any 2 for R500' },
  { id: 'pct_selected', icon: 'target', title: '% off selected products', sub: 'Pick products, gender, category or size' },
  { id: 'per_item', icon: 'tag', title: 'Off every item', sub: '% or R off each bottle' },
];

interface DiscountForm {
  code: string; active: boolean; scope: DiscountScope;
  // reward
  value: number | null; itemType: 'percent' | 'fixed'; maxDiscount: number | null; alsoFreeDelivery: boolean;
  buyQty: number | null; getQty: number | null; getPercent: number | null;
  bundleQty: number | null; multiReward: MultiReward; bundleValue: number | null;
  // conditions
  starts: string; expires: string; minSpend: number | null; minQty: number | null; maxUses: number | null;
  oncePerCustomer: boolean; firstOrderOnly: boolean;
  gender: string; category: string;
}

type Filter = 'all' | 'active' | 'off';

const SIZE_OPTS: { key: ProductSizeKey; label: string }[] = [
  { key: 'size30', label: '30ml' }, { key: 'size50', label: '50ml' }, { key: 'size100', label: '100ml' },
];

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v);
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Best-fitting preset for a stored code (older codes included). */
function presetOf(d: Discount): Preset {
  const mech = d.mechanic || 'order';
  if (mech === 'bundle') return d.bundleReward === 'free' ? 'bxgy' : 'multibuy';
  if (mech === 'item') return d.type === 'percent' && hasTargeting(d) ? 'pct_selected' : 'per_item';
  if (d.freeDelivery && !(Number(d.value) > 0)) return 'free_delivery';
  return d.type === 'percent' ? 'pct_order' : 'fixed_order';
}

@Component({
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .types { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
    .type { display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px; border: 1px solid var(--line);
      border-radius: var(--r); background: var(--surface); cursor: pointer; font: inherit; color: inherit; }
    .type:hover { border-color: var(--primary); }
    .type strong { display: block; font-size: 14px; }
    .type small { color: var(--muted); font-size: 12px; }
    .chosen { display: flex; align-items: center; gap: 10px; }
    .cond-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 12px 0;
      border: 0; border-top: 1px solid var(--line); background: none; font: inherit; color: inherit; cursor: pointer; }
    .cond-toggle .rot { transform: rotate(180deg); }
    .pick { max-height: 220px; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--r); padding: 4px 10px; margin-top: 6px; }
    .inline-checks { display: flex; flex-wrap: wrap; gap: 4px 16px; }
  `],
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
          <span class="avatar"><app-icon [name]="iconOf(d)" [size]="18" /></span>
          <div class="li-main">
            <span class="li-title">
              <span class="mono">{{ d.code }}</span>
              <span class="pill" [class.ok]="status(d) === 'active'" [class.info]="status(d) === 'scheduled'"
                    [class.danger]="status(d) === 'expired'" [class.warn]="status(d) === 'used up'">{{ status(d) }}</span>
            </span>
            <span class="li-sub ellipsis">{{ rowSub(d) }}</span>
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

<!-- Targeting block: in the main area for "% off selected products", else inside Conditions. -->
<ng-template #targeting>
  <div class="field">
    <span class="field-label">Products @if (selected().length) { <span class="muted">· {{ selected().length }} selected</span> }</span>
    <div class="search"><app-icon name="search" [size]="16" /><input type="search" placeholder="Search products…" aria-label="Search products" [ngModel]="productQuery()" (ngModelChange)="productQuery.set($event)" /></div>
    <div class="pick">
      @for (p of pickList(); track p.id) {
        <label class="check">
          <input type="checkbox" [checked]="isSelected(p.id)" (change)="toggleProduct(p.id)" />
          <span class="ellipsis">{{ p.name }} <span class="tiny muted">{{ productMeta(p) }}</span></span>
        </label>
      } @empty { <div class="small muted" style="padding: 8px 0">No products match.</div> }
      @if (pickMore() > 0) { <div class="tiny muted" style="padding: 6px 0">{{ pickMore() }} more — refine the search.</div> }
    </div>
    <span class="hint">None ticked = all products.
      @if (selected().length) { <button type="button" class="btn btn-ghost btn-sm" (click)="clearProducts()">Clear</button> }
    </span>
  </div>
  <div class="field-row">
    <div class="field">
      <label for="d-gender">Gender</label>
      <select id="d-gender" [(ngModel)]="form.gender" (ngModelChange)="tick()">
        <option value="">Any</option>
        <option value="men">Men</option>
        <option value="women">Women</option>
        <option value="unisex">Unisex</option>
      </select>
    </div>
    <div class="field">
      <label for="d-cat">Category</label>
      <select id="d-cat" [(ngModel)]="form.category" (ngModelChange)="tick()">
        <option value="">Any</option>
        @for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }
      </select>
    </div>
  </div>
  <div class="field">
    <span class="field-label">Sizes</span>
    <div class="inline-checks">
      @for (s of sizeOpts; track s.key) {
        <label class="check"><input type="checkbox" [checked]="sizes().includes(s.key)" (change)="toggleSize(s.key)" /> {{ s.label }}</label>
      }
    </div>
    <span class="hint">None ticked = every size.</span>
  </div>
</ng-template>

<ng-template #capField>
  <div class="field">
    <label for="d-cap">Max discount (R)</label>
    <input id="d-cap" type="number" min="1" inputmode="decimal" [(ngModel)]="form.maxDiscount" (ngModelChange)="tick()" placeholder="No cap" />
  </div>
</ng-template>

@if (open()) {
  <kf-sheet size="wide" [title]="existing() ? 'Edit ' + existing()!.code : 'New code'" [subtitle]="subtitle()" (closed)="open.set(false)">
    @if (!preset()) {
      <div class="stack-sm">
        <p class="small muted">What kind of discount?</p>
        <div class="types">
          @for (p of presets; track p.id) {
            <button type="button" class="type" (click)="choose(p.id)">
              <span class="avatar"><app-icon [name]="p.icon" [size]="18" /></span>
              <span><strong>{{ p.title }}</strong><small>{{ p.sub }}</small></span>
            </button>
          }
        </div>
      </div>
    } @else {
      <div class="form">
        <div class="row between">
          <span class="chosen"><span class="avatar"><app-icon [name]="presetInfo()!.icon" [size]="18" /></span><strong>{{ presetInfo()!.title }}</strong></span>
          <button type="button" class="btn btn-ghost btn-sm" (click)="preset.set(null)">Change type</button>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="d-code">Code</label>
            <input id="d-code" type="text" [(ngModel)]="form.code" (ngModelChange)="tick()" placeholder="WELCOME10"
                   style="text-transform: uppercase" autocomplete="off" [disabled]="!!existing()" />
            @if (existing()) { <span class="hint">Codes can't be renamed — create a new one instead.</span> }
          </div>
          <div class="field">
            <label for="d-scope">Where it works</label>
            <select id="d-scope" [(ngModel)]="form.scope" (ngModelChange)="tick()">
              <option value="both">Online &amp; till</option>
              <option value="online">Online only</option>
              <option value="pos">Till only (markets)</option>
            </select>
          </div>
        </div>

        @switch (preset()) {
          @case ('pct_order') {
            <div class="field-row">
              <div class="field"><label for="d-val">% off</label><input id="d-val" type="number" min="1" max="100" inputmode="decimal" [(ngModel)]="form.value" (ngModelChange)="tick()" placeholder="10" /></div>
              <ng-container [ngTemplateOutlet]="capField" />
            </div>
          }
          @case ('fixed_order') {
            <div class="field"><label for="d-val">Rand off the order</label><input id="d-val" type="number" min="1" inputmode="decimal" [(ngModel)]="form.value" (ngModelChange)="tick()" placeholder="50" /></div>
          }
          @case ('free_delivery') {
            <p class="notice"><app-icon name="truck" [size]="16" /> <span>The delivery fee becomes R0 on online delivery orders. No effect at the till or on collection.</span></p>
          }
          @case ('bxgy') {
            <div class="field-row three">
              <div class="field"><label for="d-buy">Buy</label><input id="d-buy" type="number" min="1" inputmode="numeric" [(ngModel)]="form.buyQty" (ngModelChange)="tick()" placeholder="2" /></div>
              <div class="field"><label for="d-get">Get</label><input id="d-get" type="number" min="1" inputmode="numeric" [(ngModel)]="form.getQty" (ngModelChange)="tick()" placeholder="1" /></div>
              <div class="field">
                <label for="d-at">At</label>
                <select id="d-at" [(ngModel)]="form.getPercent" (ngModelChange)="tick()">
                  <option [ngValue]="100">Free</option>
                  <option [ngValue]="50">Half price</option>
                  <option [ngValue]="25">25% off</option>
                </select>
              </div>
            </div>
            <span class="hint">The cheapest items get the deal. Buy 2 get 1 free: 3 bottles → cheapest free; 6 bottles → two free.</span>
          }
          @case ('multibuy') {
            <div class="field-row three">
              <div class="field"><label for="d-bq">Any</label><input id="d-bq" type="number" min="2" inputmode="numeric" [(ngModel)]="form.bundleQty" (ngModelChange)="tick()" placeholder="2" /></div>
              <div class="field">
                <label for="d-br">Deal</label>
                <select id="d-br" [(ngModel)]="form.multiReward" (ngModelChange)="tick()">
                  <option value="price">for R…</option>
                  <option value="percent">% off them</option>
                  <option value="fixed">R off them</option>
                </select>
              </div>
              <div class="field"><label for="d-bv">{{ form.multiReward === 'percent' ? '%' : 'R' }}</label><input id="d-bv" type="number" min="0" inputmode="decimal" [(ngModel)]="form.bundleValue" (ngModelChange)="tick()" /></div>
            </div>
            @if (form.multiReward === 'percent') { <ng-container [ngTemplateOutlet]="capField" /> }
            <span class="hint">Applies per complete set. Extra items that don't complete a set stay full price.</span>
          }
          @case ('pct_selected') {
            <div class="field-row">
              <div class="field"><label for="d-val">% off each matching item</label><input id="d-val" type="number" min="1" max="100" inputmode="decimal" [(ngModel)]="form.value" (ngModelChange)="tick()" placeholder="15" /></div>
              <ng-container [ngTemplateOutlet]="capField" />
            </div>
            <p class="section-title muted">Which products</p>
            <ng-container [ngTemplateOutlet]="targeting" />
          }
          @case ('per_item') {
            <div class="field-row">
              <div class="field">
                <span class="field-label">Off each item</span>
                <div class="seg block">
                  <button type="button" [class.on]="form.itemType === 'percent'" (click)="form.itemType = 'percent'; tick()">%</button>
                  <button type="button" [class.on]="form.itemType === 'fixed'" (click)="form.itemType = 'fixed'; tick()">R</button>
                </div>
              </div>
              <div class="field"><label for="d-val">{{ form.itemType === 'percent' ? '% off' : 'Rand off' }}</label><input id="d-val" type="number" min="1" inputmode="decimal" [(ngModel)]="form.value" (ngModelChange)="tick()" /></div>
            </div>
            @if (form.itemType === 'percent') { <ng-container [ngTemplateOutlet]="capField" /> }
          }
        }

        @if (preset() !== 'free_delivery') {
          <label class="switch"><input type="checkbox" [(ngModel)]="form.alsoFreeDelivery" (ngModelChange)="tick()" /><span></span> Also free delivery (online)</label>
        }

        <button type="button" class="cond-toggle" (click)="condOpen.set(!condOpen())" [attr.aria-expanded]="condOpen()">
          <span><strong>Conditions</strong> <span class="muted small">· {{ condCount() ? condCount() + ' set' : 'none' }}</span></span>
          <app-icon name="chevron-down" [size]="18" [class.rot]="condOpen()" />
        </button>
        @if (condOpen()) {
          <div class="field-row">
            <div class="field"><label for="d-start">Starts</label><input id="d-start" type="date" [(ngModel)]="form.starts" (ngModelChange)="tick()" /></div>
            <div class="field"><label for="d-exp">Ends</label><input id="d-exp" type="date" [(ngModel)]="form.expires" (ngModelChange)="tick()" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="d-min">Min spend (R)</label><input id="d-min" type="number" min="0" inputmode="decimal" [(ngModel)]="form.minSpend" (ngModelChange)="tick()" placeholder="None" /></div>
            <div class="field"><label for="d-minq">Min items</label><input id="d-minq" type="number" min="1" inputmode="numeric" [(ngModel)]="form.minQty" (ngModelChange)="tick()" placeholder="None" /></div>
          </div>
          <div class="field">
            <label for="d-max">Total uses allowed</label>
            <input id="d-max" type="number" min="0" inputmode="numeric" [(ngModel)]="form.maxUses" (ngModelChange)="tick()" placeholder="Unlimited" />
            @if (existing(); as e) { <span class="hint">Used {{ e.usedCount || 0 }} time{{ (e.usedCount || 0) === 1 ? '' : 's' }} so far.</span> }
          </div>
          <label class="switch"><input type="checkbox" [(ngModel)]="form.oncePerCustomer" (ngModelChange)="tick()" /><span></span> Once per customer</label>
          <label class="switch"><input type="checkbox" [(ngModel)]="form.firstOrderOnly" (ngModelChange)="tick()" /><span></span> First order only</label>
          @if (form.oncePerCustomer || form.firstOrderOnly) { <span class="hint">Checked online by the customer's account and email. The till ignores these two.</span> }
          @if (preset() !== 'pct_selected') {
            <p class="section-title muted">Only for (optional)</p>
            <ng-container [ngTemplateOutlet]="targeting" />
          }
        }

        <label class="switch"><input type="checkbox" [(ngModel)]="form.active" (ngModelChange)="tick()" /><span></span> Active</label>

        <div class="notice ok"><app-icon name="tag" [size]="16" /> <span>{{ sentence() }}</span></div>
      </div>
    }

    <ng-container sheet-actions>
      @if (existing()) {
        <button class="btn btn-danger" (click)="remove(existing()!)" [disabled]="saving()"><app-icon name="trash" [size]="16" /> Delete</button>
      }
      <button class="btn" (click)="open.set(false)">Cancel</button>
      @if (preset()) {
        <button class="btn btn-primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save code' }}</button>
      }
    </ng-container>
  </kf-sheet>
}
  `,
})
export class DiscountsPage {
  readonly shop = inject(ShopAdminService);
  private ui = inject(UiService);

  readonly presets = PRESETS;
  readonly sizeOpts = SIZE_OPTS;

  readonly filter = signal<Filter>('all');
  readonly open = signal(false);
  readonly saving = signal(false);
  readonly existing = signal<Discount | null>(null);
  readonly preset = signal<Preset | null>(null);
  readonly condOpen = signal(false);
  readonly selected = signal<string[]>([]);
  readonly sizes = signal<ProductSizeKey[]>([]);
  readonly productQuery = signal('');
  /** Bumped on form edits so the live summary (a signal) recomputes. */
  private readonly rev = signal(0);

  form: DiscountForm = this.emptyForm();

  readonly activeCount = computed(() => this.shop.discounts().filter((d) => d.active).length);
  readonly list = computed(() => {
    const f = this.filter();
    const all = [...this.shop.discounts()].sort((a, b) => a.code.localeCompare(b.code));
    return f === 'all' ? all : all.filter((d) => (f === 'active' ? d.active : !d.active));
  });

  private readonly names = computed(() => new Map(this.shop.products().map((p) => [p.id, p.name])));
  readonly nameOf = (id: string): string | undefined => this.names().get(id);

  readonly categories = computed(() => {
    this.rev();
    const set = new Set<string>();
    for (const p of this.shop.products()) if (p.category?.trim()) set.add(p.category.trim());
    if (this.form.category) set.add(this.form.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  private readonly pickAll = computed(() => {
    const q = this.productQuery().trim().toLowerCase();
    const sel = new Set(this.selected());
    const list = this.shop.products().filter((p) => !q || p.name.toLowerCase().includes(q)
      || (p.inspiredBy || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    // Ticked products first, so the selection is always visible.
    return list.sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)));
  });
  readonly pickList = computed(() => this.pickAll().slice(0, 60));
  readonly pickMore = computed(() => Math.max(0, this.pickAll().length - 60));

  readonly presetInfo = computed(() => PRESETS.find((p) => p.id === this.preset()) || null);

  /** The code as it would be saved (lenient — used for the live summary). */
  private readonly draftDiscount = computed(() => {
    this.rev();
    this.selected();
    this.sizes();
    const r = this.build(false);
    return typeof r === 'string' ? null : r;
  });
  readonly sentence = computed(() => {
    const d = this.draftDiscount();
    return d ? describeDiscount(d, this.nameOf) : 'Fill in the details above.';
  });
  readonly subtitle = computed(() => {
    const d = this.draftDiscount();
    return d && this.preset() ? discountSummary(d, this.nameOf) : 'Choose a type';
  });
  readonly condCount = computed(() => {
    this.rev();
    const f = this.form;
    let n = 0;
    if (f.starts) n++;
    if (f.expires) n++;
    if (numOrNull(f.minSpend)) n++;
    if (numOrNull(f.minQty)) n++;
    if (numOrNull(f.maxUses)) n++;
    if (f.oncePerCustomer) n++;
    if (f.firstOrderOnly) n++;
    if (this.preset() !== 'pct_selected' && (this.selected().length || f.gender || f.category || this.sizes().length)) n++;
    return n;
  });

  tick(): void { this.rev.update((n) => n + 1); }

  status(d: Discount): DiscountStatus { return discountStatus(d); }
  iconOf(d: Discount): string { return PRESETS.find((p) => p.id === presetOf(d))?.icon || 'percent'; }
  scopeLabel(s?: DiscountScope): string { return s === 'online' ? 'Online' : s === 'pos' ? 'Till' : 'Online & till'; }
  rowSub(d: Discount): string {
    const bits = [discountSummary(d, this.nameOf), this.scopeLabel(d.scope)];
    if (d.minSpend) bits.push(`min R${d.minSpend}`);
    if (d.minQty) bits.push(`${d.minQty}+ items`);
    if (d.oncePerCustomer) bits.push('1 per customer');
    if (d.firstOrderOnly) bits.push('first order');
    if (d.startsAt && Date.now() < d.startsAt) bits.push(`from ${fmtDay(d.startsAt)}`);
    if (d.expiresAt) bits.push(`until ${fmtDay(d.expiresAt)}`);
    return bits.join(' · ');
  }
  productMeta(p: Product): string { return [p.gender, p.category].filter(Boolean).join(' · '); }

  isSelected(id: string): boolean { return this.selected().includes(id); }
  toggleProduct(id: string): void {
    this.selected.update((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    this.tick();
  }
  clearProducts(): void { this.selected.set([]); this.tick(); }
  toggleSize(k: ProductSizeKey): void {
    this.sizes.update((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    this.tick();
  }

  private emptyForm(): DiscountForm {
    return {
      code: '', active: true, scope: 'both',
      value: null, itemType: 'percent', maxDiscount: null, alsoFreeDelivery: false,
      buyQty: 2, getQty: 1, getPercent: 100,
      bundleQty: 2, multiReward: 'price', bundleValue: null,
      starts: '', expires: '', minSpend: null, minQty: null, maxUses: null,
      oncePerCustomer: false, firstOrderOnly: false, gender: '', category: '',
    };
  }

  openNew(): void {
    this.form = this.emptyForm();
    this.selected.set([]);
    this.sizes.set([]);
    this.existing.set(null);
    this.preset.set(null);
    this.productQuery.set('');
    this.condOpen.set(false);
    this.tick();
    this.open.set(true);
  }

  choose(p: Preset): void {
    // Free delivery only does something online.
    if (p === 'free_delivery' && this.form.scope === 'both' && !this.existing()) this.form.scope = 'online';
    this.preset.set(p);
    this.tick();
  }

  edit(d: Discount): void {
    const p = presetOf(d);
    const bq = d.bundleQty ?? 2;
    const free = d.bundleFree ?? 1;
    this.form = {
      code: d.code, active: d.active, scope: d.scope || 'both',
      value: p === 'free_delivery' ? null : d.value, itemType: d.type || 'percent',
      maxDiscount: d.maxDiscount ?? null,
      alsoFreeDelivery: p !== 'free_delivery' && d.freeDelivery === true,
      buyQty: p === 'bxgy' ? Math.max(1, bq - free) : 2, getQty: p === 'bxgy' ? free : 1,
      getPercent: d.bundleFreePercent && d.bundleFreePercent < 100 ? d.bundleFreePercent : 100,
      bundleQty: bq, multiReward: d.bundleReward === 'percent' || d.bundleReward === 'fixed' ? d.bundleReward : 'price',
      bundleValue: d.bundleValue ?? null,
      starts: d.startsAt ? localDate(d.startsAt) : '', expires: d.expiresAt ? localDate(d.expiresAt) : '',
      minSpend: d.minSpend || null, minQty: d.minQty ?? null, maxUses: d.maxUses ?? null,
      oncePerCustomer: d.oncePerCustomer === true, firstOrderOnly: d.firstOrderOnly === true,
      gender: (d.gender || '').toLowerCase(), category: d.category || '',
    };
    this.selected.set([...(d.productIds || [])]);
    this.sizes.set([...(d.sizeKeys || [])] as ProductSizeKey[]);
    this.existing.set(d);
    this.preset.set(p);
    this.productQuery.set('');
    this.tick();
    this.condOpen.set(this.condCount() > 0);
    this.open.set(true);
  }

  /**
   * Turns the form into a Discount. Strict mode returns an error message for
   * the first problem; lenient mode fills gaps with zeros for the live summary.
   */
  private build(strict: boolean): Discount | string {
    const f = this.form;
    const p = this.preset();
    if (!p) return 'Choose a type';
    const code = f.code.trim().toUpperCase();
    if (strict && !code) return 'A code is required';

    const d: Discount = {
      code: code || 'CODE', type: 'percent', value: 0, active: f.active, scope: f.scope,
      mechanic: 'order', usedCount: this.existing()?.usedCount ?? 0,
    };
    const percentValue = (): string | null => {
      const v = numOrNull(f.value);
      if (strict && (v == null || v <= 0 || v > 100)) return 'Enter a % between 1 and 100';
      d.value = v ?? 0;
      return null;
    };
    const randValue = (): string | null => {
      const v = numOrNull(f.value);
      if (strict && (v == null || v <= 0)) return 'Enter the rand amount off';
      d.value = v ?? 0;
      return null;
    };
    const cap = () => {
      const c = numOrNull(f.maxDiscount);
      if (c != null && c > 0) d.maxDiscount = c;
    };
    let err: string | null = null;
    switch (p) {
      case 'pct_order':
        d.type = 'percent'; err = percentValue(); cap(); break;
      case 'fixed_order':
        d.type = 'fixed'; err = randValue(); break;
      case 'free_delivery':
        d.type = 'fixed'; d.value = 0; d.freeDelivery = true;
        if (strict && f.scope === 'pos') err = 'Free delivery only works online — choose "Online only"';
        break;
      case 'bxgy': {
        const buy = numOrNull(f.buyQty); const get = numOrNull(f.getQty);
        if (strict && (buy == null || buy < 1 || get == null || get < 1)) { err = 'Enter how many to buy and how many they get'; break; }
        const b = Math.max(1, Math.floor(buy ?? 2)); const g = Math.max(1, Math.floor(get ?? 1));
        d.mechanic = 'bundle'; d.bundleQty = b + g; d.bundleReward = 'free'; d.bundleFree = g; d.bundleValue = 0;
        const pct = numOrNull(f.getPercent) ?? 100;
        if (pct > 0 && pct < 100) d.bundleFreePercent = pct;
        break;
      }
      case 'multibuy': {
        const n = numOrNull(f.bundleQty); const v = numOrNull(f.bundleValue);
        if (strict && (n == null || n < 2)) { err = 'A multi-buy needs at least 2 items'; break; }
        if (strict && (v == null || v <= 0)) { err = 'Enter the deal amount'; break; }
        if (strict && f.multiReward === 'percent' && (v ?? 0) > 100) { err = 'Enter a % between 1 and 100'; break; }
        d.mechanic = 'bundle'; d.bundleQty = Math.max(2, Math.floor(n ?? 2)); d.bundleReward = f.multiReward;
        d.bundleValue = v ?? 0; d.bundleFree = 0;
        if (f.multiReward === 'percent') cap();
        break;
      }
      case 'pct_selected':
        d.mechanic = 'item'; d.type = 'percent'; err = percentValue(); cap(); break;
      case 'per_item':
        d.mechanic = 'item'; d.type = f.itemType;
        if (f.itemType === 'percent') { err = percentValue(); cap(); } else err = randValue();
        break;
    }
    if (err) return err;
    if (p !== 'free_delivery' && f.alsoFreeDelivery) d.freeDelivery = true;

    // Conditions.
    const startsAt = f.starts ? new Date(f.starts + 'T00:00:00').getTime() : null;
    const expiresAt = f.expires ? new Date(f.expires + 'T23:59:59').getTime() : null;
    if (strict && startsAt && expiresAt && startsAt > expiresAt) return 'The start date is after the end date';
    d.startsAt = startsAt;
    d.expiresAt = expiresAt;
    d.minSpend = numOrNull(f.minSpend) ?? 0;
    const minQty = numOrNull(f.minQty);
    d.minQty = minQty && minQty > 0 ? Math.floor(minQty) : null;
    d.maxUses = numOrNull(f.maxUses);
    d.oncePerCustomer = f.oncePerCustomer;
    d.firstOrderOnly = f.firstOrderOnly;
    d.productIds = [...this.selected()];
    d.gender = f.gender || null;
    d.category = f.category || null;
    d.sizeKeys = [...this.sizes()];
    if (strict && p === 'pct_selected' && !hasTargeting(d)) return 'Pick at least one product, gender, category or size';
    return d;
  }

  async save(): Promise<void> {
    const built = this.build(true);
    if (typeof built === 'string') { this.ui.toast(built, 'err'); return; }
    const existing = this.shop.discounts().find((x) => x.code === built.code);
    if (existing && !this.existing()) {
      if (!(await this.ui.confirm({ title: 'Code exists', message: `${built.code} already exists. Replace its settings?`, confirmLabel: 'Replace' }))) return;
    }
    built.usedCount = existing?.usedCount ?? 0;

    this.saving.set(true);
    try {
      await this.shop.saveDiscount(built);
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
