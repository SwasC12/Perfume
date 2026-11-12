import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RumiProduct } from '../../models';
import { RumiItem, RumiService } from '../../rumi.service';
import { AuthService } from '../../auth.service';
import { ShopAdminService } from '../../shop-admin.service';
import { LoaderComponent } from '../../shared/loader.component';
import { WishlistService } from '../../wishlist.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { agoLabel, hideBrokenImg, numOrNull } from './personal-util';

/** "Inspired By Al Kabah" and "Al Kabah" both → "al kabah". */
function norm(s: string): string { return s.toLowerCase().replace(/^inspireds+bys+/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

type RumiSort = 'name' | 'price-asc' | 'price-desc' | 'stock';

interface RumiForm {
  name: string;
  fromPrice: number | null;
  imageUrl: string;
  permalink: string;
  inStock: boolean;
  notes: string;
}

const emptyForm = (): RumiForm => ({ name: '', fromPrice: null, imageUrl: '', permalink: '', inStock: true, notes: '' });
const PAGE = 60;

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, IconComponent, SheetComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">Buy from Rumi</h1>
          <p class="page-sub">
            Last synced {{ syncedAgo() }}
            @if (svc.products().length) { · {{ svc.inStockCount() }} in stock of {{ svc.products().length }} }
          </p>
        </div>
        <div class="page-actions">
          <button class="btn" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Manual</button>
          <button class="btn btn-primary" (click)="sync()" [disabled]="svc.loading()">
            <app-icon name="refresh" [size]="16" [class.spin]="svc.loading()" />
            {{ svc.loading() ? 'Syncing…' : 'Sync from Rumi' }}
          </button>
        </div>
      </header>

      @if (svc.progress(); as pr) {
        <div class="card sync-card">
          <kf-loader [size]="34" inline [progress]="pr.total ? pr.done / pr.total : null" />
          <div class="sync-txt">
            <strong>Syncing from Rumi…</strong>
            <span class="small muted">{{ pr.total ? pr.done + " of " + pr.total + " products" : "Reading the catalogue" }}</span>
            <div class="bar"><i [style.width.%]="pr.total ? (pr.done / pr.total) * 100 : 4"></i></div>
          </div>
          <button class="btn btn-ghost btn-sm" (click)="svc.cancel()">Cancel</button>
        </div>
      }
      @if (svc.error()) { <div class="notice danger">{{ svc.error() }}</div> }

      <div class="toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input type="search" placeholder="Search Rumi list…" [value]="search()" (input)="setSearch($any($event.target).value)" />
        </div>
        <select class="sort" [value]="sort()" (change)="setSort($any($event.target).value)" aria-label="Sort">
          <option value="name">Name A–Z</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="stock">In stock first</option>
        </select>
      </div>
      <div class="chips">
        <button class="chip" [class.on]="!inStockOnly()" (click)="setInStock(false)">All <span class="n">{{ svc.products().length }}</span></button>
        <button class="chip" [class.on]="inStockOnly()" (click)="setInStock(true)">In stock <span class="n">{{ svc.inStockCount() }}</span></button>
        @for (c of categories(); track c.name) {
          <button class="chip" [class.on]="category() === c.name" (click)="setCategory(category() === c.name ? '' : c.name)">{{ c.name }} <span class="n">{{ c.count }}</span></button>
        }
      </div>

      @if (svc.loading() && svc.products().length === 0) {
        <kf-loader label="Pouring in Rumi's catalogue…" />
      } @else if (filtered().length === 0) {
        <div class="card">
          <div class="empty">
            <div class="empty-icon"><app-icon name="bag" [size]="26" /></div>
            <h3>{{ search() || inStockOnly() ? 'No matches' : 'Nothing here yet' }}</h3>
            <p>Tap <strong>Sync from Rumi</strong> to pull the live catalogue, or add an item manually.</p>
            <button class="btn btn-primary" (click)="sync()" [disabled]="svc.loading()"><app-icon name="refresh" [size]="16" /> Sync from Rumi</button>
          </div>
        </div>
      } @else {
        <div class="grid rumi-grid">
          @for (p of visible(); track p.id) {
            <article class="card pc" [class.oos]="!p.inStock">
              <div class="pc-img">
                @if (p.imageUrl) {
                  <img [src]="p.imageUrl" [alt]="p.name" width="300" height="300" loading="lazy" decoding="async" (error)="onImgError($event)" />
                } @else {
                  <app-icon name="bag" [size]="36" />
                }
                <div class="pc-tags">
                  <span class="pill" [class.ok]="p.inStock" [class.danger]="!p.inStock">{{ p.inStock ? 'In stock' : 'Out' }}</span>
                  @if (p.source === 'manual') { <span class="pill info plain">Manual</span> }
                </div>
                @let starred = wished().has(p.name.trim().toLowerCase());
                <button type="button" class="star" [class.on]="starred" (click)="toggleWish(p)"
                        [attr.aria-label]="starred ? 'Remove from wishlist' : 'Add to wishlist'" [attr.aria-pressed]="starred">
                  <app-icon name="star" [size]="20" [filled]="starred" />
                </button>
              </div>
              <div class="pc-body">
                <h3 class="pc-name">{{ p.name }}</h3>
                @if (asItem(p).category) { <span class="tiny faint">{{ asItem(p).category }}</span> }
                <p class="small muted">
                  @if (p.fromPrice != null) { from <strong class="num">{{ p.fromPrice | currency:'ZAR':'symbol-narrow':'1.0-2' }}</strong> } @else { No price }
                </p>
                @if (p.notes) { <p class="small pc-notes">{{ p.notes }}</p> }
              </div>
              <div class="pc-foot">
                @if (p.permalink) {
                  <a class="btn btn-soft btn-icon btn-sm" [href]="p.permalink" target="_blank" rel="noopener" aria-label="Open on Rumi" title="Open on Rumi"><app-icon name="link" [size]="15" /></a>
                }
                <span class="spacer"></span>
                @if (isAdmin()) {
                  @if (inShop().has(key(p))) {
                    <span class="pill ok plain" title="Already in your shop">In shop</span>
                  } @else {
                    <button type="button" class="btn btn-primary btn-sm" (click)="addToShop(p)" title="Add to my shop"><app-icon name="plus" [size]="15" /> Shop</button>
                  }
                }
                <button type="button" class="btn btn-ghost btn-icon btn-sm" (click)="openEdit(p)" aria-label="Edit" title="Edit"><app-icon name="edit" [size]="16" /></button>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" (click)="remove(p)" aria-label="Remove" title="Remove"><app-icon name="trash" [size]="16" /></button>
              </div>
            </article>
          }
        </div>
        @if (filtered().length > limit()) {
          <button class="btn btn-block" (click)="limit.set(limit() + ${PAGE})">Show more ({{ filtered().length - limit() }} left)</button>
        }
      }
    </div>

    @if (sheetOpen()) {
      <kf-sheet [title]="editingId ? 'Edit item' : 'Add manual item'" (closed)="sheetOpen.set(false)">
        <form id="rumi-form" class="form" (ngSubmit)="save()">
          <div class="field">
            <label for="r-name">Name</label>
            <input id="r-name" type="text" name="rname" [(ngModel)]="form.name" required autocomplete="off" />
          </div>
          <div class="field-row">
            <div class="field">
              <label for="r-price">From price (R)</label>
              <input id="r-price" type="number" min="0" inputmode="decimal" name="rprice" [(ngModel)]="form.fromPrice" />
            </div>
            <div class="field stock-field">
              <label class="switch"><input type="checkbox" name="rstock" [(ngModel)]="form.inStock" /><span></span> In stock</label>
            </div>
          </div>
          <div class="field">
            <label for="r-img">Image URL</label>
            <input id="r-img" type="url" name="rimg" [(ngModel)]="form.imageUrl" placeholder="https://…" />
          </div>
          <div class="field">
            <label for="r-link">Product link</label>
            <input id="r-link" type="url" name="rlink" [(ngModel)]="form.permalink" placeholder="https://rumifragrances.co.za/…" />
          </div>
          <div class="field">
            <label for="r-notes">Notes</label>
            <textarea id="r-notes" rows="2" name="rnotes" [(ngModel)]="form.notes"></textarea>
          </div>
        </form>
        <ng-container sheet-actions>
          <button type="button" class="btn" (click)="sheetOpen.set(false)">Cancel</button>
          <button type="submit" form="rumi-form" class="btn btn-primary" [disabled]="!form.name.trim()">Save</button>
        </ng-container>
      </kf-sheet>
    }
  `,
  styles: [`
    .sort { width: auto; flex: none; max-width: 200px; }
    .sync-card { display: flex; align-items: center; gap: 14px; padding: 12px 14px; }
    .sync-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    @media (max-width: 559px) {
      .rumi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .rumi-grid .pc-img { height: 120px; }
      .rumi-grid .pc-body { padding: 8px 10px 2px; }
      .rumi-grid .pc-name { font-size: 13.5px; }
      .rumi-grid .pc-foot { padding: 6px 8px 8px; flex-wrap: wrap; }
      .rumi-grid .pc-notes { display: none; }
    }
    .spin { animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .pc { display: flex; flex-direction: column; overflow: hidden; content-visibility: auto; contain-intrinsic-size: auto 330px; }
    .pc-img {
      position: relative; height: 170px; display: grid; place-items: center;
      background: var(--surface-2); color: var(--faint); border-bottom: 1px solid var(--line-2);
    }
    .pc-img img { width: 100%; height: 100%; object-fit: contain; padding: 10px; }
    .oos .pc-img img { opacity: .55; }
    .pc-tags { position: absolute; top: 10px; left: 10px; display: flex; gap: 6px; }
    .star {
      position: absolute; top: 6px; right: 6px; width: 40px; height: 40px; border-radius: 50%;
      display: grid; place-items: center; border: 1px solid var(--line); background: var(--surface);
      color: var(--faint); cursor: pointer;
    }
    .star.on { color: #E5A00D; border-color: #F5D58A; }
    .star:active { transform: scale(.94); }
    .pc-body { padding: 12px 14px 4px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .pc-name { font-size: 15px; font-weight: 650; line-height: 1.3; }
    .pc-notes { color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pc-foot { display: flex; align-items: center; gap: 4px; padding: 8px 10px 10px 14px; }
    .sk-line { height: 14px; margin-bottom: 8px; }
    .sk-line.short { width: 50%; }
    .stock-field { justify-content: flex-end; }
  `],
})
export class RumiPage {
  readonly svc = inject(RumiService);
  private auth = inject(AuthService);
  private shop = inject(ShopAdminService);
  private router = inject(Router);
  readonly isAdmin = computed(() => this.auth.isAdmin);
  readonly category = signal('');

  /** Categories found on Rumi, biggest first. */
  readonly categories = computed(() => {
    const m = new Map<string, number>();
    for (const p of this.svc.products()) { const c = (p as RumiItem).category; if (c) m.set(c, (m.get(c) || 0) + 1); }
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  });

  /** Fragrances already in the Kaua shop (by "inspired by" name). */
  readonly inShop = computed(() => {
    const s = new Set<string>();
    for (const p of this.shop.products()) { s.add(norm(p.inspiredBy || '')); s.add(norm(p.name)); }
    s.delete('');
    return s;
  });

  key(p: RumiProduct): string { return norm(p.name); }
  asItem(p: RumiProduct): RumiItem { return p as RumiItem; }
  setCategory(c: string): void { this.category.set(c); this.limit.set(PAGE); }

  /** Start a new shop product from this Rumi oil. */
  addToShop(p: RumiProduct): void {
    const it = p as RumiItem;
    const inspiredBy = p.name.replace(/^inspireds+bys+/i, '').trim();
    void this.router.navigate(['/products', 'new'], {
      state: { prefill: { name: 'Inspired By ' + inspiredBy, inspiredBy, description: it.description || '', imageUrl: p.imageUrl || '', category: it.category || '' } },
    });
  }
  private wish = inject(WishlistService);
  private ui = inject(UiService);

  readonly search = signal('');
  readonly inStockOnly = signal(false);
  readonly sort = signal<RumiSort>('name');
  readonly limit = signal(PAGE);
  readonly sheetOpen = signal(false);
  readonly skeletons = [1, 2, 3, 4, 5, 6];

  editingId: string | null = null;
  form: RumiForm = emptyForm();

  /** Lower-cased names on the wishlist, for the star state. */
  readonly wished = computed(() => new Set(this.wish.items().map((i) => i.name.trim().toLowerCase())));

  readonly filtered = computed<RumiProduct[]>(() => {
    const q = this.search().trim().toLowerCase();
    const inStockOnly = this.inStockOnly();
    const sort = this.sort();
    const list = this.svc
      .products()
      .filter((p) => (inStockOnly ? p.inStock : true))
      .filter((p) => (this.category() ? (p as RumiItem).category === this.category() : true))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
    const price = (p: RumiProduct) => (p.fromPrice == null ? Number.POSITIVE_INFINITY : p.fromPrice);
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'price-asc': return price(a) - price(b);
        case 'price-desc': return (price(b) === Infinity ? -1 : price(b)) - (price(a) === Infinity ? -1 : price(a));
        case 'stock': return Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name);
        default: return a.name.localeCompare(b.name);
      }
    });
  });

  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  readonly onImgError = hideBrokenImg;

  syncedAgo(): string { return agoLabel(this.svc.lastSynced()); }

  setSearch(v: string): void { this.search.set(v); this.limit.set(PAGE); }
  setSort(v: RumiSort): void { this.sort.set(v); this.limit.set(PAGE); }
  setInStock(v: boolean): void { this.inStockOnly.set(v); this.limit.set(PAGE); }

  async sync(): Promise<void> {
    await this.svc.sync();
    if (!this.svc.error()) this.ui.toast(`Synced ${this.svc.inStockCount()} in stock`, 'ok');
  }

  toggleWish(p: RumiProduct): void {
    if (this.wish.has(p.name)) {
      this.wish.removeByName(p.name);
      this.ui.toast('Removed from wishlist', 'info');
    } else {
      this.wish.addFromRumi(p);
      this.ui.toast('Added to wishlist', 'ok');
    }
  }

  openAdd(): void {
    this.editingId = null;
    this.form = emptyForm();
    this.sheetOpen.set(true);
  }

  openEdit(p: RumiProduct): void {
    this.editingId = p.id;
    this.form = {
      name: p.name,
      fromPrice: p.fromPrice,
      imageUrl: p.imageUrl ?? '',
      permalink: p.permalink ?? '',
      inStock: p.inStock,
      notes: p.notes ?? '',
    };
    this.sheetOpen.set(true);
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) return;
    const payload = {
      name,
      fromPrice: numOrNull(this.form.fromPrice),
      imageUrl: this.form.imageUrl.trim() || undefined,
      permalink: this.form.permalink.trim() || undefined,
      inStock: this.form.inStock,
      notes: this.form.notes.trim() || undefined,
    };
    if (this.editingId) {
      this.svc.update(this.editingId, payload);
      this.ui.toast('Item updated', 'ok');
    } else {
      this.svc.addManual(payload);
      this.ui.toast('Item added', 'ok');
    }
    this.sheetOpen.set(false);
  }

  async remove(p: RumiProduct): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Remove item',
      message: `Remove "${p.name}" from the buy list?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    this.svc.remove(p.id);
    this.ui.toast('Item removed', 'ok');
  }
}
