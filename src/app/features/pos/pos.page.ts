import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { ScanService } from '../../core/scan.service';
import { SheetComponent } from '../../shared/sheet.component';
import { LoaderComponent } from '../../shared/loader.component';
import { IconComponent } from '../../icon.component';
import { isCustomImage, placeholderFor, productImage } from '../../product-image';
import { CustomerDisplayService, DisplayLine } from '../../core/customer-display.service';
import { SoundManager } from '../../sound/sound-manager';
import { computeDiscount, discountError, DiscountLine, posDiscountLine } from '../../discount-util';
import {
  Discount, OrderItem, OrderStatus, Product, ProductSize, ProductSizeKey,
  fromPrice, sizeAvailable, sizeEffectivePrice, sizeOptions,
} from '../../models';
import { LOW_STOCK } from '../products/product-util';
import { PosQueueService, PosSale } from './pos-queue.service';

interface PosLine { product: Product; sizeKey?: ProductSizeKey; qty: number; }
type PayMethod = 'cash' | 'card';
type SheetStep = 'cart' | 'pay';

interface SizeOpt { key: ProductSizeKey; size: ProductSize; price: number; avail: boolean; }

interface Tile {
  p: Product;
  img: string;
  from: number;
  multi: boolean;
  opts: SizeOpt[];
  out: boolean;
  /** Tracked units across sizes, or null when not tracked. */
  qty: number | null;
  gender: string;
  category: string;
  hay: string;
}

/** What the success screen shows after a charge. */
interface DoneSale {
  seq: number;
  total: number;
  change: number;
  method: PayMethod;
  items: number;
  reference: string | null;
  queued: boolean;
}

const PAGE = 120;
/** Body class while the till is open: hides the shell's bottom tab bar on phones. */
const BODY_CLASS = 'kf-pos-till';
const GENDERS = ['Men', 'Women', 'Unisex'];

@Component({
  standalone: true,
  imports: [FormsModule, CurrencyPipe, NgTemplateOutlet, IconComponent, SheetComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
})
export class PosPage implements OnInit, OnDestroy {
  readonly shop = inject(ShopAdminService);
  readonly queue = inject(PosQueueService);
  private ui = inject(UiService);
  private scan = inject(ScanService);
  private display = inject(CustomerDisplayService);

  readonly search = signal('');
  readonly gender = signal('');
  readonly category = signal('');
  readonly limit = signal(PAGE);
  readonly cart = signal<PosLine[]>([]);
  readonly customer = signal('');
  readonly payment = signal<PayMethod>('cash');
  readonly promo = signal('');
  readonly discount = signal<Discount | null>(null);
  readonly promoError = signal<string | null>(null);
  readonly promoBusy = signal(false);
  readonly promoOpen = signal(false);
  readonly customerOpen = signal(false);
  /** Cash tendered, typed on the keypad as text (e.g. "200", "150.5"). */
  readonly tendered = signal('');
  readonly sheet = signal<SheetStep | null>(null);
  readonly picker = signal<Tile | null>(null);
  readonly scanning = signal(false);
  readonly done = signal<DoneSale | null>(null);
  /** Product last added, for a brief tile flash. */
  readonly flash = signal<string | null>(null);

  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private doneUnregister: (() => void) | null = null;
  private seq = 0;

  /** Last line that was added or changed: the customer display shows its bottle. */
  private focusKey: string | null = null;
  private prevQty = new Map<string, number>();
  /** After a sale, keep "Thank you" on the customer display for a moment. */
  private holdIdleUntil = 0;

  constructor() {
    // Mirror the till on the customer display (another phone/tablet on /display).
    effect(() => {
      const cart = this.cart();
      const subtotal = this.subtotal(), discount = this.discountAmount(), total = this.total();
      untracked(() => this.mirror(cart, subtotal, discount, total));
    });
  }


  private displayLine(l: PosLine): DisplayLine {
    const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
    // The 3D bottle is a 100ml: use the 100ml photo, else the product photo, else the 100ml placeholder.
    const own100 = l.product.sizes?.size100?.imageUrl;
    const label = isCustomImage(own100) ? own100! : isCustomImage(l.product.imageUrl) ? l.product.imageUrl! : placeholderFor(l.product.gender, '100ml');
    return {
      productId: l.product.id, name: l.product.name, size: s?.size || l.product.size || '',
      qty: l.qty, price: this.unit(l), gender: l.product.gender || '', label,
    };
  }

  private mirror(cart: PosLine[], subtotal: number, discount: number, total: number): void {
    const now = new Map(cart.map((l) => [this.lineKey(l), l.qty]));
    for (const [k, q] of now) if (q > (this.prevQty.get(k) ?? 0)) this.focusKey = k;
    if (this.focusKey && !now.has(this.focusKey)) this.focusKey = cart.length ? this.lineKey(cart[cart.length - 1]) : null;
    this.prevQty = now;
    if (!cart.length && Date.now() < this.holdIdleUntil) return;
    const lines = cart.map((l) => this.displayLine(l));
    const focusLine = cart.find((l) => this.lineKey(l) === this.focusKey);
    this.display.publish({
      state: cart.length ? 'cart' : 'idle',
      lines, focus: focusLine ? this.displayLine(focusLine) : null,
      subtotal, discount, total,
    });
  }

  ngOnInit(): void { document.body.classList.add(BODY_CLASS); }
  ngOnDestroy(): void {
    document.body.classList.remove(BODY_CLASS);
    this.doneUnregister?.();
    clearTimeout(this.flashTimer);
  }

  // ------------------------------------------------------------ catalogue
  /** All sellable products, pre-computed once per catalogue change. */
  private readonly tiles = computed<Tile[]>(() =>
    this.shop.products()
      .filter((p) => p.active !== false)
      .map((p) => {
        const opts: SizeOpt[] = sizeOptions(p).map((o) => ({
          ...o, price: sizeEffectivePrice(o.size), avail: sizeAvailable(o.size),
        }));
        let qty: number | null = null;
        for (const o of opts) if (o.size.stockQty != null) qty = (qty ?? 0) + Number(o.size.stockQty);
        return {
          p,
          img: productImage(p),
          from: fromPrice(p),
          multi: opts.length > 1,
          opts,
          out: opts.length ? !opts.some((o) => o.avail) : !p.inStock,
          qty,
          gender: (p.gender || '').trim().toLowerCase(),
          category: (p.category || '').trim(),
          hay: [p.name, p.inspiredBy, p.category].filter(Boolean).join(' ').toLowerCase(),
        };
      }),
  );

  /** Gender chips that actually have products. */
  readonly genders = computed(() => {
    const have = new Set(this.tiles().map((t) => t.gender));
    return GENDERS.filter((g) => have.has(g.toLowerCase()));
  });

  /** Category chips, most used first. */
  readonly categories = computed(() => {
    const n = new Map<string, number>();
    for (const t of this.tiles()) if (t.category) n.set(t.category, (n.get(t.category) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([c]) => c);
  });

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const g = this.gender().toLowerCase();
    const c = this.category();
    return this.tiles().filter((t) =>
      (!g || t.gender === g) &&
      (!c || t.category === c) &&
      (!q || t.hay.includes(q) || (t.p.barcode ?? '').toLowerCase() === q));
  });
  readonly shown = computed(() => this.filtered().slice(0, this.limit()));
  readonly filtering = computed(() => !!(this.search().trim() || this.gender() || this.category()));

  /** Units in the cart per product, for the tile badges. */
  readonly inCart = computed(() => {
    const m: Record<string, number> = {};
    for (const l of this.cart()) m[l.product.id] = (m[l.product.id] || 0) + l.qty;
    return m;
  });

  // ---------------------------------------------------------------- totals
  readonly itemCount = computed(() => this.cart().reduce((n, l) => n + l.qty, 0));
  readonly subtotal = computed(() => this.cart().reduce((s, l) => s + this.unit(l) * l.qty, 0));
  readonly discountAmount = computed(() => {
    const d = this.discount();
    return d ? computeDiscount(d, this.lines()) : 0;
  });
  readonly total = computed(() => Math.max(0, this.subtotal() - this.discountAmount()));
  readonly cash = computed<number | null>(() => {
    const t = this.tendered();
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  });
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
    for (const step of [50, 100, 200, 500]) {
      const v = Math.ceil(t / step) * step;
      if (v > t) out.add(v);
    }
    return [...out].slice(0, 4);
  });
  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

  // ---------------------------------------------------------------- cart
  unit(l: PosLine): number {
    const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
    return s ? sizeEffectivePrice(s) : this.effPrice(l.product);
  }
  private effPrice(p: Product): number {
    return p.salePrice != null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
  }
  private lines(): DiscountLine[] {
    // Product details let targeted codes (product / gender / category / size) work at the till.
    return this.cart().map((l) => posDiscountLine(l.product, l.sizeKey, this.unit(l), l.qty));
  }
  sizesOf(p: Product) { return sizeOptions(p); }
  sizeLabel(l: PosLine): string {
    const s = l.sizeKey ? l.product.sizes?.[l.sizeKey] : null;
    return s?.size || l.product.size || '';
  }
  lineKey(l: PosLine): string { return l.product.id + '|' + (l.sizeKey || ''); }

  stockLabel(t: Tile): { text: string; cls: string } | null {
    if (t.out) return { text: 'Out', cls: 'danger' };
    if (t.qty == null) return null;
    return { text: t.qty + ' left', cls: t.qty <= LOW_STOCK ? 'warn' : '' };
  }
  optStock(o: SizeOpt): string {
    if (!o.avail) return 'Out of stock';
    return o.size.stockQty != null ? o.size.stockQty + ' left' : 'In stock';
  }

  /** Tile tap: a single size adds at once, multi-size opens the size picker. */
  tap(t: Tile): void {
    if (t.multi) { this.picker.set(t); return; }
    this.add(t.p);
  }

  pick(t: Tile, key: ProductSizeKey): void {
    this.add(t.p, key);
    this.picker.set(null);
  }

  add(p: Product, chosen?: ProductSizeKey): void {
    const sizeKey = chosen ?? sizeOptions(p)[0]?.key;
    this.cart.update((list) => {
      const ex = list.find((l) => l.product.id === p.id && l.sizeKey === sizeKey);
      return ex
        ? list.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l))
        : [...list, { product: p, sizeKey, qty: 1 }];
    });
    this.revalidatePromo();
    this.flash.set(p.id);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 350);
  }

  setQty(l: PosLine, qty: number): void {
    if (qty <= 0) { this.removeLine(l); return; }
    this.cart.update((list) => list.map((x) => (x === l ? { ...x, qty } : x)));
    this.revalidatePromo();
  }

  removeLine(l: PosLine): void {
    this.cart.update((list) => list.filter((x) => x !== l));
    if (!this.cart().length) this.sheet.set(null);
    this.revalidatePromo();
  }

  changeSize(l: PosLine, newKey: ProductSizeKey): void {
    this.cart.update((list) => {
      const same = list.find((x) => x !== l && x.product.id === l.product.id && x.sizeKey === newKey);
      if (same) return list.filter((x) => x !== l).map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x));
      return list.map((x) => (x === l ? { ...x, sizeKey: newKey } : x));
    });
    this.revalidatePromo();
  }

  /** Drop an applied promo that no longer fits the cart (e.g. below min spend). */
  private revalidatePromo(): void {
    const d = this.discount();
    if (!d || !this.cart().length) return;
    const err = discountError(d, this.lines(), 'pos');
    if (err) { this.discount.set(null); this.promoError.set(err); this.promoOpen.set(true); }
  }

  async clear(): Promise<void> {
    if (this.cart().length && !(await this.ui.confirm({ title: 'Clear sale?', message: 'Remove all items from this sale?', confirmLabel: 'Clear', danger: true }))) return;
    this.reset();
  }

  private reset(): void {
    this.cart.set([]);
    this.customer.set('');
    this.tendered.set('');
    this.discount.set(null);
    this.promo.set('');
    this.promoError.set(null);
    this.promoOpen.set(false);
    this.customerOpen.set(false);
    this.sheet.set(null);
    this.payment.set('cash');
  }

  // ---------------------------------------------------- swipe to remove
  private swipe: { key: string; x: number; y: number; dx: number; locked: boolean | null } | null = null;
  readonly swipeKey = signal<string | null>(null);
  readonly swipeDx = signal(0);

  swipeStart(l: PosLine, ev: PointerEvent): void {
    if (ev.pointerType === 'mouse') return;
    this.swipe = { key: this.lineKey(l), x: ev.clientX, y: ev.clientY, dx: 0, locked: null };
  }
  swipeMove(ev: PointerEvent): void {
    const s = this.swipe;
    if (!s) return;
    const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
    if (s.locked == null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.locked = Math.abs(dx) > Math.abs(dy) * 1.5;
      // Capture only once it's clearly a swipe, so taps on the stepper still click.
      if (s.locked) (ev.currentTarget as Element | null)?.setPointerCapture?.(ev.pointerId);
    }
    if (!s.locked) return;
    s.dx = Math.min(0, dx);
    this.swipeKey.set(s.key);
    this.swipeDx.set(s.dx);
  }
  swipeEnd(l: PosLine): void {
    const s = this.swipe;
    this.swipe = null;
    if (s?.locked && s.dx < -90) this.removeLine(l);
    this.swipeKey.set(null);
    this.swipeDx.set(0);
  }

  // ------------------------------------------------------------- search
  /** Enter in search (or a keyboard-wedge / Bluetooth scanner): add the barcode match / only hit. */
  onSearchEnter(): void {
    const q = this.search().trim().toLowerCase();
    if (!q) return;
    const exact = this.tiles().find((t) => (t.p.barcode ?? '').toLowerCase() === q);
    const list = this.filtered();
    const hit = exact ?? (list.length === 1 ? list[0] : null);
    if (!hit) {
      if (!list.length) { SoundManager.feedback('scanError'); this.ui.toast('No product with that code', 'err'); }
      return;
    }
    this.search.set('');
    if (hit.multi && !exact) { this.picker.set(hit); return; }
    this.add(hit.p);
    SoundManager.feedback('scanSuccess');
  }
  setSearch(v: string): void {
    this.search.set(v);
    this.limit.set(PAGE);
  }
  setGender(g: string): void { this.gender.set(this.gender() === g ? '' : g); this.limit.set(PAGE); }
  setCategory(c: string): void { this.category.set(this.category() === c ? '' : c); this.limit.set(PAGE); }
  clearFilters(): void { this.gender.set(''); this.category.set(''); this.search.set(''); this.limit.set(PAGE); }

  /**
   * Keyboard-wedge / Bluetooth scanners type fast and end with Enter. When no
   * field has focus, collect those keys and add the matching barcode.
   */
  private wedge = { buf: '', at: 0 };
  onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey || this.done() || this.scan.session()) return;
    const now = Date.now();
    if (now - this.wedge.at > 80) this.wedge.buf = '';
    this.wedge.at = now;
    if (ev.key === 'Enter') {
      const code = this.wedge.buf.trim().toLowerCase();
      this.wedge.buf = '';
      if (code.length < 4) return;
      ev.preventDefault();
      const hit = this.tiles().find((x) => (x.p.barcode ?? '').toLowerCase() === code);
      if (hit) { this.add(hit.p); SoundManager.feedback('scanSuccess'); }
      else { SoundManager.feedback('scanError'); this.ui.toast('No product with barcode ' + code, 'err'); }
      return;
    }
    if (ev.key.length === 1) this.wedge.buf += ev.key;
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

  // ------------------------------------------------------------ payment
  openPay(): void {
    if (!this.cart().length) return;
    this.sheet.set('pay');
  }

  /** Payment → Back: phones return to the cart sheet; tablet/laptop already show the cart. */
  backFromPay(): void {
    this.sheet.set(window.matchMedia('(min-width: 768px)').matches ? null : 'cart');
  }

  setPayment(m: PayMethod): void {
    this.payment.set(m);
    if (m === 'card') this.tendered.set('');
  }

  /** Cash keypad. */
  key(k: string): void {
    const t = this.tendered();
    if (k === 'del') { this.tendered.set(t.slice(0, -1)); return; }
    if (k === '.') { if (!t.includes('.')) this.tendered.set((t || '0') + '.'); return; }
    if (t.includes('.') && t.split('.')[1].length >= 2) return;
    if (t.replace('.', '').length >= 7) return;
    this.tendered.set(t === '0' ? k : t + k);
  }
  quick(v: number): void { this.tendered.set(String(v)); }

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
    // Customer display: "Thank you" + confetti for a few seconds.
    this.holdIdleUntil = Date.now() + 8000;
    this.display.publishNow({
      state: 'paid', lines: lines.map((l) => this.displayLine(l)), focus: null,
      subtotal: this.subtotal(), discount: disc, total: this.total(), method: this.payment(), change,
    });
    const seq = ++this.seq;
    const summary: DoneSale = {
      seq, total: this.total(), change, method: this.payment(), items: this.itemCount(), reference: null, queued: false,
    };
    // The sale object is complete — clear the till now so the next customer
    // isn't kept waiting on the network. The queue never loses the sale.
    this.reset();
    this.showDone(summary);
    void this.queue.record(sale).then(({ reference, queued }) => {
      const d = this.done();
      if (d && d.seq === seq) { this.done.set({ ...d, reference, queued }); return; }
      // Success screen already dismissed: fall back to a toast.
      if (queued) this.ui.toast('Saved offline — will sync', 'info');
      else this.ui.toast(`Sale recorded · ${reference}`, 'ok');
    });
  }

  private showDone(d: DoneSale): void {
    this.done.set(d);
    SoundManager.feedback('orderCompleted');
    this.doneUnregister?.();
    this.doneUnregister = this.ui.pushOverlay(() => this.newSale(true));
  }

  /** Close the success screen (button, or Android back). */
  newSale(fromBack = false): void {
    this.done.set(null);
    if (!fromBack) this.doneUnregister?.();
    this.doneUnregister = null;
  }

  sync(): void { void this.queue.flush(); }

  onImgError(ev: Event): void { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }
  /** "Inspired By Armani SI" → "Armani SI" (the full name stays in the aria-label). */
  shortName(name: string): string { return name.replace(/^inspired\s+by\s+/i, '') || name; }
}
