import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OilsService } from './oils.service';
import { RumiService } from './rumi.service';
import { WishlistService } from './wishlist.service';
import { SyncService } from './sync.service';
import { AuthService } from './auth.service';
import { ShopAdminService } from './shop-admin.service';
import { EmailService } from './email.service';
import { IconComponent } from './icon.component';
import { STARTER_CATALOGUE } from './starter-catalogue';
import { compressImage } from './image-util';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { FULFIL_STAGES, FulfilStage } from './models';
import { discountError, computeDiscount, discountSummary, DiscountLine } from './discount-util';
import { productImage, isCustomImage, setPlaceholderOverrides, placeholderFor } from './product-image';
import { Oil, RumiProduct, WishlistItem, Product, Order, OrderItem, OrderStatus, SiteContent, Banner, StoreSettings, CustomerProfile, Discount, Expense, EXPENSE_CATEGORIES, Review } from './models';

type Tab = 'oils' | 'wishlist' | 'rumi' | 'products' | 'orders' | 'content' | 'dashboard' | 'settings' | 'pos' | 'customers' | 'discounts' | 'images' | 'budget' | 'reviews';

interface PosLine { product: Product; qty: number; }
interface PosSale {
  items: OrderItem[]; subtotal: number; total: number;
  customerName: string; paymentMethod: string; status: OrderStatus;
  discountCode?: string; discountAmount?: number;
}
interface DiscountForm {
  code: string; type: 'percent' | 'fixed'; value: number | null; active: boolean;
  scope: 'online' | 'pos' | 'both'; minSpend: number | null; maxUses: number | null; expires: string;
  mechanic: 'order' | 'item' | 'bundle';
  bundleQty: number | null; bundleReward: 'percent' | 'fixed' | 'price' | 'free';
  bundleValue: number | null; bundleFree: number | null;
}

interface OilForm {
  name: string;
  imageUrl: string;
  amountMl: number | null;
  capacityMl: number | null;
  lowThresholdMl: number | null;
  notes: string;
}

interface RumiForm {
  name: string;
  fromPrice: number | null;
  imageUrl: string;
  permalink: string;
  inStock: boolean;
  notes: string;
}

interface WishForm {
  name: string;
  price: number | null;
  imageUrl: string;
  permalink: string;
  notes: string;
}

interface ProductForm {
  name: string;
  description: string;
  size: string;
  price: number | null;
  salePrice: number | null;
  cost: number | null;
  stockQty: number | null;
  inStock: boolean;
  active: boolean;
  featured: boolean;
  imageUrl: string;
  gallery: string[];
  category: string;
  gender: string;
  inspiredBy: string;
  notesTop: string;
  notesHeart: string;
  notesBase: string;
  longDescription: string;
}

@Component({
  selector: 'app-root',
  imports: [FormsModule, IconComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly oilsSvc = inject(OilsService);
  readonly rumiSvc = inject(RumiService);
  readonly wishSvc = inject(WishlistService);
  readonly syncSvc = inject(SyncService);
  readonly authSvc = inject(AuthService);
  readonly shopSvc = inject(ShopAdminService);
  readonly emailSvc = inject(EmailService);

  readonly tab = signal<Tab>('oils');
  readonly menuOpen = signal(false);
  readonly oilSearch = signal('');
  readonly wishSearch = signal('');
  readonly rumiSearch = signal('');
  readonly rumiInStockOnly = signal(false);
  readonly rumiSort = signal<'name' | 'price-asc' | 'price-desc' | 'stock'>('name');
  readonly productSearch = signal('');
  readonly orderFilter = signal<'all' | OrderStatus>('all');

  // ---- Admin auth ----
  adminLoginOpen = signal(false);
  loginEmail = '';
  loginPassword = '';
  showLoginPw = signal(false);

  // ---- Product modal ----
  productModalOpen = signal(false);
  editingProductId: string | null = null;
  productForm: ProductForm = this.emptyProductForm();

  // ---- Storefront content (CMS) ----
  contentForm: SiteContent = { banners: [] };
  private contentLoaded = false;
  contentSaving = signal(false);

  // ---- Store settings ----
  settingsForm: StoreSettings = {};
  private settingsLoaded = false;
  settingsSaving = signal(false);

  // ---- Image Manager (male/female placeholders) ----
  readonly imageSlots = [
    { key: 'men' as const, label: 'Men / Unisex placeholder' },
    { key: 'women' as const, label: 'Women placeholder' },
  ];
  imageForm: { men: string; women: string } = { men: '', women: '' };
  private imagesLoaded = false;
  imagesSaving = signal(false);
  /** Current preview for a slot: the pending upload, else the live placeholder (default or custom). */
  placeholderPreview(which: 'men' | 'women'): string {
    const pending = which === 'men' ? this.imageForm.men : this.imageForm.women;
    return pending || placeholderFor(which === 'men' ? 'Men' : 'Women');
  }
  hasCustomPlaceholder(which: 'men' | 'women'): boolean {
    const v = which === 'men' ? this.imageForm.men : this.imageForm.women;
    return this.isDataUrl(v);
  }
  async onPlaceholderFile(which: 'men' | 'women', ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 900, 0.85);
      if (which === 'men') this.imageForm.men = dataUrl; else this.imageForm.women = dataUrl;
    } catch { this.showToast('Could not read that image'); }
    input.value = '';
  }
  resetPlaceholder(which: 'men' | 'women'): void {
    if (which === 'men') this.imageForm.men = ''; else this.imageForm.women = '';
  }
  async saveImages(): Promise<void> {
    this.imagesSaving.set(true);
    try {
      await this.shopSvc.updateStoreSettings({
        placeholderMen: this.imageForm.men || '',
        placeholderWomen: this.imageForm.women || '',
      });
      this.showToast('Placeholder images saved');
    } catch { this.showToast('Save failed — are you signed in?'); }
    finally { this.imagesSaving.set(false); }
  }

  // ---- Bulk: set every product price ----
  askSetAllPrices(): void {
    const n = this.shopSvc.products().length;
    if (!n) { this.showToast('No products yet'); return; }
    this.confirm.set({
      title: 'Set all prices?',
      message: `Set the price of all ${n} products to R200? You can still edit individual prices afterwards.`,
      confirmLabel: 'Set to R200',
      danger: false,
      action: async () => {
        let done = 0;
        for (const p of this.shopSvc.products()) {
          try { await this.shopSvc.updateProduct(p.id, { price: 200 }); done++; } catch { /* skip */ }
        }
        this.showToast(`Updated ${done} price${done === 1 ? '' : 's'}`);
      },
    });
  }

  // ---- Order detail ----
  selectedOrder = signal<Order | null>(null);
  qrDataUrl = signal<string | null>(null);
  readonly stages = FULFIL_STAGES;

  // ---- POS ----
  readonly posCart = signal<PosLine[]>([]);
  readonly posSearch = signal('');
  posCustomer = '';
  readonly posPayment = signal<'cash' | 'card' | 'eft'>('cash');

  posPromo = '';
  readonly posDiscount = signal<Discount | null>(null);
  readonly posPromoError = signal<string | null>(null);
  posCash: number | null = null;

  readonly posProducts = computed<Product[]>(() => {
    const q = this.posSearch().trim().toLowerCase();
    return this.shopSvc.products()
      .filter((p) => p.active !== false)
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || (p.inspiredBy ?? '').toLowerCase().includes(q) : true));
  });
  readonly posSubtotal = computed(() => this.posCart().reduce((s, l) => s + this.effPrice(l.product) * l.qty, 0));
  private posLines(): DiscountLine[] {
    return this.posCart().map((l) => ({ unitPrice: this.effPrice(l.product), qty: l.qty }));
  }
  readonly posDiscountAmount = computed(() => {
    const d = this.posDiscount();
    return d ? computeDiscount(d, this.posLines()) : 0;
  });
  discountSummary = discountSummary;
  readonly posTotal = computed(() => Math.max(0, this.posSubtotal() - this.posDiscountAmount()));
  readonly posChange = computed(() => (this.posCash != null ? Math.max(0, this.posCash - this.posTotal()) : 0));

  constructor() {
    // Start/stop the shop's live listeners with the admin session.
    effect(() => {
      if (this.authSvc.isAdmin) this.shopSvc.start();
      else this.shopSvc.stop();
    });
    // Load site content into the editable form once it arrives.
    effect(() => {
      const sc = this.shopSvc.siteContent();
      if (sc && !this.contentLoaded) {
        this.contentForm = { banners: [], ...JSON.parse(JSON.stringify(sc)) };
        if (!this.contentForm.banners) this.contentForm.banners = [];
        this.contentLoaded = true;
      }
    });
    // Load store settings into the editable form once they arrive.
    effect(() => {
      const s = this.shopSvc.settings();
      if (s && !this.settingsLoaded) {
        this.settingsForm = { ...this.defaultSettings(), ...JSON.parse(JSON.stringify(s)) };
        this.settingsLoaded = true;
      }
    });
    // Keep placeholder overrides + the Image Manager form in sync with live settings.
    effect(() => {
      const s = this.shopSvc.settings();
      setPlaceholderOverrides(s?.placeholderMen, s?.placeholderWomen);
      if (s && !this.imagesLoaded) {
        this.imageForm = { men: s.placeholderMen || '', women: s.placeholderWomen || '' };
        this.imagesLoaded = true;
      }
    });

    // Offline POS queue: reflect any pending sales, and flush when back online.
    this.pendingSyncCount.set(this.readQueue().length);
    window.addEventListener('online', () => this.flushPosQueue());
    effect(() => { if (this.authSvc.isAdmin && this.shopSvc.products().length) this.flushPosQueue(); });
  }

  go(t: Tab): void { this.tab.set(t); this.menuOpen.set(false); }

  // ---------- Discounts ----------
  discountForm: DiscountForm = this.emptyDiscountForm();
  private emptyDiscountForm(): DiscountForm {
    return {
      code: '', type: 'percent', value: null, active: true, scope: 'both',
      minSpend: null, maxUses: null, expires: '',
      mechanic: 'order', bundleQty: 2, bundleReward: 'percent', bundleValue: null, bundleFree: 1,
    };
  }
  resetDiscountForm(): void { this.discountForm = this.emptyDiscountForm(); }
  editDiscount(d: Discount): void {
    this.discountForm = {
      code: d.code, type: d.type, value: d.value, active: d.active,
      scope: d.scope || 'both', minSpend: d.minSpend ?? null, maxUses: d.maxUses ?? null,
      expires: d.expiresAt ? new Date(d.expiresAt).toISOString().slice(0, 10) : '',
      mechanic: d.mechanic || 'order',
      bundleQty: d.bundleQty ?? 2, bundleReward: d.bundleReward || 'percent',
      bundleValue: d.bundleValue ?? null, bundleFree: d.bundleFree ?? 1,
    };
  }
  editingExisting(code: string): boolean { return this.shopSvc.discounts().some((d) => d.code === code.trim().toUpperCase()); }
  /** Live preview of the code being built, for the form footer. */
  discountFormSummary(): string {
    const f = this.discountForm;
    return discountSummary({
      code: f.code, type: f.type, value: f.value ?? 0, active: f.active,
      mechanic: f.mechanic, bundleQty: f.bundleQty ?? 2, bundleReward: f.bundleReward,
      bundleValue: f.bundleValue ?? 0, bundleFree: f.bundleFree ?? 1,
    });
  }
  async saveDiscountForm(): Promise<void> {
    const f = this.discountForm;
    const code = f.code.trim().toUpperCase();
    if (!code) { this.showToast('A code is required'); return; }
    const existing = this.shopSvc.discounts().find((x) => x.code === code);
    const expiresAt = f.expires ? new Date(f.expires + 'T23:59:59').getTime() : null;

    // Validate per mechanic.
    let value = 0;
    let bundle: Partial<Discount> = {};
    if (f.mechanic === 'bundle') {
      const qty = this.numOrNull(f.bundleQty);
      if (qty == null || qty < 2) { this.showToast('Bundle size must be at least 2'); return; }
      if (f.bundleReward === 'free') {
        const free = this.numOrNull(f.bundleFree);
        if (free == null || free < 1 || free >= qty) { this.showToast('Free items must be between 1 and bundle size − 1'); return; }
        bundle = { bundleQty: qty, bundleReward: 'free', bundleFree: free, bundleValue: 0 };
      } else {
        const bv = this.numOrNull(f.bundleValue);
        if (bv == null) { this.showToast('Enter the bundle value'); return; }
        bundle = { bundleQty: qty, bundleReward: f.bundleReward, bundleValue: bv, bundleFree: 0 };
      }
    } else {
      const v = this.numOrNull(f.value);
      if (v == null) { this.showToast('A value is required'); return; }
      value = v;
    }

    try {
      await this.shopSvc.saveDiscount({
        code, type: f.type, value, active: f.active,
        scope: f.scope, minSpend: this.numOrNull(f.minSpend) ?? 0,
        maxUses: this.numOrNull(f.maxUses), expiresAt, usedCount: existing?.usedCount ?? 0,
        mechanic: f.mechanic, ...bundle,
      });
      this.showToast('Discount saved');
      this.resetDiscountForm();
    } catch { this.showToast('Save failed — are you signed in?'); }
  }
  askDeleteDiscount(d: Discount): void {
    this.confirm.set({
      message: `Delete discount code ${d.code}?`,
      action: async () => { try { await this.shopSvc.deleteDiscount(d.code); this.showToast('Discount deleted'); } catch { this.showToast('Delete failed'); } },
    });
  }

  // ---------- POS ----------
  effPrice(p: Product): number {
    return p.salePrice != null && p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
  }
  posAdd(p: Product): void {
    this.posCart.update((list) => {
      const ex = list.find((l) => l.product.id === p.id);
      return ex ? list.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...list, { product: p, qty: 1 }];
    });
  }
  posSetQty(id: string, qty: number): void {
    if (qty <= 0) { this.posCart.update((l) => l.filter((x) => x.product.id !== id)); return; }
    this.posCart.update((l) => l.map((x) => (x.product.id === id ? { ...x, qty } : x)));
  }
  posClear(): void {
    this.posCart.set([]); this.posCustomer = ''; this.posCash = null;
    this.posDiscount.set(null); this.posPromo = ''; this.posPromoError.set(null);
  }

  async applyPosPromo(): Promise<void> {
    const code = this.posPromo.trim().toUpperCase();
    if (!code) return;
    this.posPromoError.set(null);
    const d = await this.shopSvc.getDiscount(code);
    if (!d) { this.posDiscount.set(null); this.posPromoError.set('Code not found.'); return; }
    const err = discountError(d, this.posLines(), 'pos');
    if (err) { this.posDiscount.set(null); this.posPromoError.set(err); return; }
    this.posDiscount.set(d);
  }
  clearPosPromo(): void { this.posDiscount.set(null); this.posPromo = ''; this.posPromoError.set(null); }

  async posCheckout(): Promise<void> {
    const lines = this.posCart();
    if (!lines.length) return;
    const items = lines.map((l) => ({ productId: l.product.id, name: l.product.name, size: l.product.size, price: this.effPrice(l.product), qty: l.qty }));
    const disc = this.posDiscountAmount();
    const sale = {
      items, subtotal: this.posSubtotal(), total: this.posTotal(),
      customerName: this.posCustomer.trim(), paymentMethod: this.posPayment(),
      status: 'fulfilled' as OrderStatus,
      discountCode: this.posDiscount()?.code, discountAmount: disc,
    };
    // Offline-first: if there's no connection, queue the sale and keep trading.
    if (!navigator.onLine) {
      this.queuePosSale(sale);
      this.showToast('Offline — sale saved, will sync');
      this.posClear();
      return;
    }
    try {
      const ref = await this.commitPosSale(sale);
      this.showToast(`Sale recorded · ${ref}`);
      this.posClear();
    } catch {
      // Network hiccup mid-sale — don't lose it.
      this.queuePosSale(sale);
      this.showToast('Saved offline — will sync when back online');
      this.posClear();
    }
  }

  /** Actually write a POS sale (order + stock + discount use). */
  private async commitPosSale(sale: PosSale): Promise<string> {
    const ref = await this.shopSvc.createPosOrder(sale);
    await this.shopSvc.decrementStockForOrder(sale.items);
    if (sale.discountCode && (sale.discountAmount || 0) > 0) await this.shopSvc.incrementDiscountUse(sale.discountCode);
    return ref;
  }

  // ---- Offline POS queue ----
  private readonly POS_QUEUE_KEY = 'kf_pos_queue';
  readonly pendingSyncCount = signal(0);
  readonly syncing = signal(false);
  private readQueue(): PosSale[] {
    try { return JSON.parse(localStorage.getItem(this.POS_QUEUE_KEY) || '[]'); } catch { return []; }
  }
  private writeQueue(q: PosSale[]): void {
    try { localStorage.setItem(this.POS_QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ }
    this.pendingSyncCount.set(q.length);
  }
  private queuePosSale(sale: PosSale): void {
    const q = this.readQueue(); q.push(sale); this.writeQueue(q);
  }
  async flushPosQueue(): Promise<void> {
    if (this.syncing() || !navigator.onLine) return;
    let q = this.readQueue();
    if (!q.length) return;
    this.syncing.set(true);
    const remaining: PosSale[] = [];
    for (const sale of q) {
      try { await this.commitPosSale(sale); } catch { remaining.push(sale); }
    }
    this.writeQueue(remaining);
    this.syncing.set(false);
    const done = q.length - remaining.length;
    if (done > 0) this.showToast(`Synced ${done} offline sale${done === 1 ? '' : 's'}`);
  }

  // ==================== Money / profit ====================
  productCost(id: string): number {
    return this.shopSvc.products().find((x) => x.id === id)?.cost ?? 0;
  }
  marginLabel(price: number | null, cost: number | null): string {
    const pr = Number(price) || 0, c = Number(cost) || 0;
    if (!pr) return '—';
    const profit = pr - c;
    return `R${profit.toFixed(0)} (${Math.round((profit / pr) * 100)}%)`;
  }
  private soldOrders(): Order[] {
    return this.shopSvc.orders().filter((o) => o.status === 'paid' || o.status === 'fulfilled');
  }
  private orderCogs(o: Order): number {
    return (o.items || []).reduce((s, i) => s + this.productCost(i.productId) * i.qty, 0);
  }
  readonly kpiRevenue = computed(() => this.soldOrders().reduce((s, o) => s + (o.total || 0), 0));
  readonly kpiCogs = computed(() => this.soldOrders().reduce((s, o) => s + this.orderCogs(o), 0));
  readonly kpiGrossProfit = computed(() => this.kpiRevenue() - this.kpiCogs());
  readonly expensesTotal = computed(() => this.shopSvc.expenses().reduce((s, e) => s + (e.amount || 0), 0));
  readonly kpiNetProfit = computed(() => this.kpiGrossProfit() - this.expensesTotal());
  readonly inventoryCostValue = computed(() => this.shopSvc.products().reduce((s, p) => s + (p.cost || 0) * (p.stockQty || 0), 0));
  readonly inventoryRetailValue = computed(() => this.shopSvc.products().reduce((s, p) => s + this.effPrice(p) * (p.stockQty || 0), 0));

  // ==================== Budgeting ====================
  expenseCategories = EXPENSE_CATEGORIES;
  budgetMonth = signal(new Date().toISOString().slice(0, 7)); // YYYY-MM
  expenseForm: { date: string; category: string; description: string; amount: number | null } = this.emptyExpenseForm();
  private emptyExpenseForm() {
    return { date: new Date().toISOString().slice(0, 10), category: 'Oils', description: '', amount: null as number | null };
  }
  private monthRange(m: string): [number, number] {
    const [y, mo] = m.split('-').map(Number);
    return [new Date(y, mo - 1, 1).getTime(), new Date(y, mo, 1).getTime()];
  }
  readonly monthExpensesList = computed(() => {
    const [s, e] = this.monthRange(this.budgetMonth());
    return this.shopSvc.expenses().filter((x) => x.date >= s && x.date < e);
  });
  readonly monthExpensesTotal = computed(() => this.monthExpensesList().reduce((s, x) => s + (x.amount || 0), 0));
  readonly monthIncome = computed(() => {
    const [s, e] = this.monthRange(this.budgetMonth());
    return this.soldOrders().filter((o) => o.createdAt >= s && o.createdAt < e).reduce((sum, o) => sum + (o.total || 0), 0);
  });
  readonly monthCogs = computed(() => {
    const [s, e] = this.monthRange(this.budgetMonth());
    return this.soldOrders().filter((o) => o.createdAt >= s && o.createdAt < e).reduce((sum, o) => sum + this.orderCogs(o), 0);
  });
  readonly monthNet = computed(() => this.monthIncome() - this.monthCogs() - this.monthExpensesTotal());
  readonly monthExpenseByCategory = computed(() => {
    const map: Record<string, number> = {};
    for (const x of this.monthExpensesList()) map[x.category] = (map[x.category] || 0) + (x.amount || 0);
    return Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  });
  async addExpense(): Promise<void> {
    const amount = this.numOrNull(this.expenseForm.amount);
    if (amount == null || amount <= 0) { this.showToast('Enter an amount'); return; }
    try {
      await this.shopSvc.addExpense({
        date: new Date(this.expenseForm.date + 'T12:00:00').getTime(),
        category: this.expenseForm.category,
        description: this.expenseForm.description.trim() || undefined,
        amount,
      });
      this.showToast('Expense added');
      this.expenseForm = this.emptyExpenseForm();
    } catch { this.showToast('Save failed — signed in?'); }
  }
  askDeleteExpense(e: Expense): void {
    this.confirm.set({
      message: `Delete this ${this.price(e.amount)} expense?`,
      action: async () => { try { await this.shopSvc.deleteExpense(e.id); this.showToast('Expense deleted'); } catch { this.showToast('Delete failed'); } },
    });
  }

  // ==================== Market cash-up ====================
  cashupDate = signal(new Date().toISOString().slice(0, 10));
  private cashupRange(): [number, number] {
    const [y, m, d] = this.cashupDate().split('-').map(Number);
    return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
  }
  readonly cashupOrders = computed(() => {
    const [s, e] = this.cashupRange();
    return this.shopSvc.orders().filter((o) => o.channel === 'pos' && o.createdAt >= s && o.createdAt < e);
  });
  readonly cashupTotal = computed(() => this.cashupOrders().reduce((s, o) => s + (o.total || 0), 0));
  readonly cashupByMethod = computed(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const o of this.cashupOrders()) {
      const k = o.paymentMethod || 'other';
      (map[k] ||= { count: 0, total: 0 });
      map[k].count++; map[k].total += o.total || 0;
    }
    return Object.entries(map).map(([method, v]) => ({ method, ...v }));
  });
  readonly cashupTopItems = computed(() => {
    const map: Record<string, { name: string; qty: number; total: number }> = {};
    for (const o of this.cashupOrders()) for (const i of o.items || []) {
      (map[i.productId] ||= { name: i.name, qty: 0, total: 0 });
      map[i.productId].qty += i.qty; map[i.productId].total += i.price * i.qty;
    }
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 8);
  });

  // ==================== Reorder / what to mix ====================
  readonly reorderList = computed(() => {
    const soldQty: Record<string, number> = {};
    for (const o of this.soldOrders()) for (const i of o.items || []) soldQty[i.productId] = (soldQty[i.productId] || 0) + i.qty;
    return this.shopSvc.products()
      .filter((p) => p.stockQty != null && p.stockQty <= 5)
      .map((p) => ({ product: p, sold: soldQty[p.id] || 0 }))
      .sort((a, b) => (a.product.stockQty! - b.product.stockQty!) || (b.sold - a.sold));
  });

  // ==================== Batch packing slips ====================
  selectedForPrint = signal<Set<string>>(new Set());
  isSelectedForPrint(id: string): boolean { return this.selectedForPrint().has(id); }
  toggleSelectForPrint(id: string): void {
    this.selectedForPrint.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  clearPrintSelection(): void { this.selectedForPrint.set(new Set()); }
  async batchPrintSlips(): Promise<void> {
    const ids = this.selectedForPrint();
    const orders = this.shopSvc.orders().filter((o) => ids.has(o.id));
    if (!orders.length) { this.showToast('Select orders to print'); return; }
    const slips: string[] = [];
    for (const o of orders) {
      let qr = '';
      try { qr = await QRCode.toDataURL(`KF-ORDER:${o.reference}`, { margin: 1, width: 120, color: { dark: '#141210', light: '#ffffff' } }); } catch { /* no qr */ }
      slips.push(this.slipHtml(o, qr));
    }
    const w = window.open('', '_blank');
    if (!w) { this.showToast('Allow pop-ups to print slips'); return; }
    w.document.write(`<!doctype html><html><head><title>Packing slips</title><style>
      *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
      .slip{padding:18px;border-bottom:2px dashed #999;page-break-after:always}
      .top{display:flex;justify-content:space-between;align-items:flex-start}
      h2{margin:0 0 2px;font-size:18px}.ref{font-size:13px;color:#555}
      table{width:100%;border-collapse:collapse;margin:10px 0}
      td,th{text-align:left;padding:4px 0;border-bottom:1px solid #eee;font-size:13px}
      .tot{font-weight:bold}.qr{width:96px;height:96px}
      .cust{font-size:13px;margin:6px 0;color:#333}
    </style></head><body>${slips.join('')}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
    this.clearPrintSelection();
  }
  private slipHtml(o: Order, qr: string): string {
    const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
    const rows = (o.items || []).map((i) => `<tr><td>${esc(i.name)}${i.size ? ' (' + esc(i.size) + ')' : ''}</td><td>${i.qty}</td><td>R${(i.price * i.qty).toFixed(0)}</td></tr>`).join('');
    const c = o.customer || { name: '', email: '', phone: '' } as any;
    return `<div class="slip"><div class="top"><div>
      <h2>Kauā Fragrances</h2><div class="ref">Order ${esc(o.reference)} · ${new Date(o.createdAt).toLocaleDateString()}</div>
      <div class="cust">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}<br>${esc(c.email)}</div>
      </div>${qr ? `<img class="qr" src="${qr}" />` : ''}</div>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Line</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">Total: R${(o.total || 0).toFixed(0)} · ${esc(o.deliveryMethod === 'collection' ? 'Collection' : 'Delivery')}</div>
    </div>`;
  }

  // ==================== Review moderation ====================
  readonly pendingReviews = computed(() => this.shopSvc.reviews().filter((r) => !r.approved));
  readonly approvedReviews = computed(() => this.shopSvc.reviews().filter((r) => r.approved));
  reviewProductName(id: string): string {
    return this.shopSvc.products().find((p) => p.id === id)?.name ?? 'Unknown product';
  }
  reviewStars(n: number): number[] { return [1, 2, 3, 4, 5].map((s) => (s <= n ? 1 : 0)); }
  async approveReview(r: Review): Promise<void> {
    try { await this.shopSvc.approveReview(r); this.showToast('Review approved'); }
    catch { this.showToast('Approve failed — signed in?'); }
  }
  askDeleteReview(r: Review): void {
    this.confirm.set({
      message: `Delete this review by ${r.name}?`,
      action: async () => { try { await this.shopSvc.deleteReview(r); this.showToast('Review deleted'); } catch { this.showToast('Delete failed'); } },
    });
  }

  // ==================== Bulk cost ====================
  readonly bulkCostOpen = signal(false);
  bulkCostValue: number | null = null;
  bulkCostOnlyMissing = true;
  openBulkCost(): void { this.bulkCostValue = null; this.bulkCostOnlyMissing = true; this.bulkCostOpen.set(true); }
  async applyBulkCost(): Promise<void> {
    const cost = this.numOrNull(this.bulkCostValue);
    if (cost == null || cost < 0) { this.showToast('Enter a cost'); return; }
    const targets = this.shopSvc.products().filter((p) => (this.bulkCostOnlyMissing ? p.cost == null : true));
    if (!targets.length) { this.showToast('Nothing to update'); this.bulkCostOpen.set(false); return; }
    let done = 0;
    for (const p of targets) {
      try { await this.shopSvc.updateProduct(p.id, { cost }); done++; } catch { /* skip */ }
    }
    this.showToast(`Set cost on ${done} product${done === 1 ? '' : 's'}`);
    this.bulkCostOpen.set(false);
  }

  tabTitle(): string {
    switch (this.tab()) {
      case 'dashboard': return 'Dashboard';
      case 'budget': return 'Budgeting';
      case 'oils': return 'My Oils';
      case 'wishlist': return 'Wishlist';
      case 'rumi': return 'Buy from Rumi';
      case 'products': return 'Products';
      case 'orders': return 'Orders';
      case 'content': return 'Storefront';
      case 'settings': return 'Settings';
      case 'pos': return 'Point of Sale';
      case 'customers': return 'Customers';
      case 'discounts': return 'Discounts';
      case 'images': return 'Image Manager';
      case 'reviews': return 'Reviews';
      default: return '';
    }
  }

  // ---------- Dashboard ----------
  private thisMonth(o: Order): boolean {
    const d = new Date(o.createdAt); const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }
  readonly kpiRevenueMonth = computed(() =>
    this.shopSvc.orders().filter((o) => this.thisMonth(o) && o.status !== 'cancelled').reduce((s, o) => s + o.total, 0));
  readonly kpiOrdersMonth = computed(() => this.shopSvc.orders().filter((o) => this.thisMonth(o)).length);
  readonly kpiPending = computed(() => this.shopSvc.orders().filter((o) => o.status === 'pending').length);
  readonly kpiPaid = computed(() => this.shopSvc.orders().filter((o) => o.status === 'paid').length);
  readonly lowStock = computed(() => this.shopSvc.products().filter((p) => p.stockQty != null && p.stockQty <= 5));
  readonly recentOrders = computed(() => this.shopSvc.orders().slice(0, 6));
  readonly topProducts = computed(() => {
    const tally = new Map<string, { name: string; qty: number }>();
    for (const o of this.shopSvc.orders()) {
      if (o.status === 'cancelled') continue;
      for (const i of o.items) {
        const e = tally.get(i.productId) ?? { name: i.name, qty: 0 };
        e.qty += i.qty; tally.set(i.productId, e);
      }
    }
    return [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  });

  // Revenue for the last 14 days (bar chart).
  readonly revenueSeries = computed(() => {
    const days: { label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      const start = d.getTime(); const end = start + 86400000;
      const total = this.shopSvc.orders()
        .filter((o) => o.status !== 'cancelled' && o.createdAt >= start && o.createdAt < end)
        .reduce((s, o) => s + o.total, 0);
      days.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, total });
    }
    return days;
  });
  readonly revenueMax = computed(() => Math.max(1, ...this.revenueSeries().map((d) => d.total)));
  readonly channelSplit = computed(() => {
    let online = 0, pos = 0;
    for (const o of this.shopSvc.orders()) {
      if (o.status === 'cancelled') continue;
      if (o.channel === 'pos') pos += o.total; else online += o.total;
    }
    return { online, pos, total: online + pos };
  });

  // Customers with order stats.
  readonly customerStats = computed(() => {
    const byUid = new Map<string, { orders: number; spent: number }>();
    for (const o of this.shopSvc.orders()) {
      if (!o.uid || o.status === 'cancelled') continue;
      const e = byUid.get(o.uid) ?? { orders: 0, spent: 0 };
      e.orders += 1; e.spent += o.total; byUid.set(o.uid, e);
    }
    return this.shopSvc.customers().map((c) => ({ ...c, ...(byUid.get(c.uid) ?? { orders: 0, spent: 0 }) }))
      .sort((a, b) => b.spent - a.spent);
  });

  // ---- Oil modal ----
  oilModalOpen = signal(false);
  editingOilId: string | null = null;
  oilForm: OilForm = this.emptyOilForm();

  // ---- Rumi modal ----
  rumiModalOpen = signal(false);
  editingRumiId: string | null = null;
  rumiForm: RumiForm = this.emptyRumiForm();

  // ---- Wishlist modal ----
  wishModalOpen = signal(false);
  editingWishId: string | null = null;
  wishForm: WishForm = this.emptyWishForm();

  // ---- Sync ----
  syncModalOpen = signal(false);
  syncCodeInput = '';

  // ---- Confirm + toast ----
  confirm = signal<{ message: string; action: () => void; title?: string; confirmLabel?: string; danger?: boolean } | null>(null);
  toast = signal<string | null>(null);
  private toastTimer: any = null;

  readonly filteredOils = computed<Oil[]>(() => {
    const q = this.oilSearch().trim().toLowerCase();
    const list = this.oilsSvc.sorted();
    return q ? list.filter((o) => o.name.toLowerCase().includes(q)) : list;
  });

  readonly filteredWishlist = computed<WishlistItem[]>(() => {
    const q = this.wishSearch().trim().toLowerCase();
    const list = this.wishSvc.sorted();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  });

  readonly filteredRumi = computed<RumiProduct[]>(() => {
    const q = this.rumiSearch().trim().toLowerCase();
    const inStockOnly = this.rumiInStockOnly();
    const sort = this.rumiSort();
    const list = this.rumiSvc
      .products()
      .filter((p) => (inStockOnly ? p.inStock : true))
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

  readonly filteredProducts = computed<Product[]>(() => {
    const q = this.productSearch().trim().toLowerCase();
    const list = this.shopSvc.products();
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  });

  readonly filteredOrders = computed<Order[]>(() => {
    const f = this.orderFilter();
    const list = this.shopSvc.orders();
    return f === 'all' ? list : list.filter((o) => o.status === f);
  });

  // ---------- Oils ----------
  openAddOil(): void {
    this.editingOilId = null;
    this.oilForm = this.emptyOilForm();
    this.oilModalOpen.set(true);
  }

  openEditOil(o: Oil): void {
    this.editingOilId = o.id;
    this.oilForm = {
      name: o.name,
      imageUrl: o.imageUrl ?? '',
      amountMl: o.amountMl,
      capacityMl: o.capacityMl,
      lowThresholdMl: o.lowThresholdMl,
      notes: o.notes ?? '',
    };
    this.oilModalOpen.set(true);
  }

  saveOil(): void {
    const name = this.oilForm.name.trim();
    if (!name) return;
    const payload = {
      name,
      imageUrl: this.oilForm.imageUrl.trim() || undefined,
      amountMl: this.numOrNull(this.oilForm.amountMl),
      capacityMl: this.numOrNull(this.oilForm.capacityMl),
      lowThresholdMl: this.numOrNull(this.oilForm.lowThresholdMl),
      notes: this.oilForm.notes.trim() || undefined,
    };
    if (this.editingOilId) {
      this.oilsSvc.update(this.editingOilId, payload);
      this.showToast('Oil updated');
    } else {
      this.oilsSvc.add(payload);
      this.showToast('Oil added');
    }
    this.oilModalOpen.set(false);
  }

  askDeleteOil(o: Oil): void {
    this.confirm.set({
      message: `Delete "${o.name}" from your oils?`,
      action: () => {
        this.oilsSvc.remove(o.id);
        this.showToast('Oil deleted');
      },
    });
  }

  // ---------- Rumi ----------
  async sync(): Promise<void> {
    await this.rumiSvc.sync();
    if (!this.rumiSvc.error()) {
      this.showToast(`Synced ${this.rumiSvc.inStockCount()} in stock`);
    }
  }

  openAddRumi(): void {
    this.editingRumiId = null;
    this.rumiForm = this.emptyRumiForm();
    this.rumiModalOpen.set(true);
  }

  openEditRumi(p: RumiProduct): void {
    this.editingRumiId = p.id;
    this.rumiForm = {
      name: p.name,
      fromPrice: p.fromPrice,
      imageUrl: p.imageUrl ?? '',
      permalink: p.permalink ?? '',
      inStock: p.inStock,
      notes: p.notes ?? '',
    };
    this.rumiModalOpen.set(true);
  }

  saveRumi(): void {
    const name = this.rumiForm.name.trim();
    if (!name) return;
    const payload = {
      name,
      fromPrice: this.numOrNull(this.rumiForm.fromPrice),
      imageUrl: this.rumiForm.imageUrl.trim() || undefined,
      permalink: this.rumiForm.permalink.trim() || undefined,
      inStock: this.rumiForm.inStock,
      notes: this.rumiForm.notes.trim() || undefined,
    };
    if (this.editingRumiId) {
      this.rumiSvc.update(this.editingRumiId, payload);
      this.showToast('Item updated');
    } else {
      this.rumiSvc.addManual(payload);
      this.showToast('Item added');
    }
    this.rumiModalOpen.set(false);
  }

  askDeleteRumi(p: RumiProduct): void {
    this.confirm.set({
      message: `Remove "${p.name}" from the buy list?`,
      action: () => {
        this.rumiSvc.remove(p.id);
        this.showToast('Item removed');
      },
    });
  }

  toggleRumiWishlist(p: RumiProduct): void {
    if (this.wishSvc.has(p.name)) {
      this.wishSvc.removeByName(p.name);
      this.showToast('Removed from wishlist');
    } else {
      this.wishSvc.addFromRumi(p);
      this.showToast('Added to wishlist');
    }
  }

  isOnWishlist(name: string): boolean {
    return this.wishSvc.has(name);
  }

  // ---------- Wishlist ----------
  openAddWish(): void {
    this.editingWishId = null;
    this.wishForm = this.emptyWishForm();
    this.wishModalOpen.set(true);
  }

  openEditWish(i: WishlistItem): void {
    this.editingWishId = i.id;
    this.wishForm = {
      name: i.name,
      price: i.price,
      imageUrl: i.imageUrl ?? '',
      permalink: i.permalink ?? '',
      notes: i.notes ?? '',
    };
    this.wishModalOpen.set(true);
  }

  saveWish(): void {
    const name = this.wishForm.name.trim();
    if (!name) return;
    const payload = {
      name,
      price: this.numOrNull(this.wishForm.price),
      imageUrl: this.wishForm.imageUrl.trim() || undefined,
      permalink: this.wishForm.permalink.trim() || undefined,
      notes: this.wishForm.notes.trim() || undefined,
    };
    if (this.editingWishId) {
      this.wishSvc.update(this.editingWishId, payload);
      this.showToast('Wishlist item updated');
    } else {
      this.wishSvc.add(payload);
      this.showToast('Added to wishlist');
    }
    this.wishModalOpen.set(false);
  }

  askDeleteWish(i: WishlistItem): void {
    this.confirm.set({
      message: `Remove "${i.name}" from your wishlist?`,
      action: () => {
        this.wishSvc.remove(i.id);
        this.showToast('Removed from wishlist');
      },
    });
  }

  moveWishToOils(i: WishlistItem): void {
    this.oilsSvc.add({
      name: i.name,
      imageUrl: i.imageUrl,
      amountMl: null,
      capacityMl: null,
      lowThresholdMl: null,
      notes: i.permalink ? `From Rumi: ${i.permalink}` : undefined,
    });
    this.wishSvc.remove(i.id);
    this.showToast('Got it! Moved to My Oils');
    this.tab.set('oils');
  }

  // ---------- Sync ----------
  openSync(): void {
    this.syncCodeInput = this.syncSvc.code() ?? '';
    this.syncModalOpen.set(true);
  }

  async connectSync(): Promise<void> {
    const code = this.syncCodeInput.trim();
    if (!code) return;
    if (code.length < 6) {
      this.showToast('Use a code of at least 6 characters');
      return;
    }
    await this.syncSvc.connect(code);
    this.showToast(this.syncSvc.status() === 'synced' ? 'Syncing across devices' : 'Sync failed');
  }

  generateSync(): void {
    this.syncCodeInput = this.syncSvc.generateCode();
  }

  disconnectSync(): void {
    this.syncSvc.disconnect();
    this.syncCodeInput = '';
    this.showToast('Sync turned off');
  }

  syncStatusLabel(): string {
    switch (this.syncSvc.status()) {
      case 'synced': return 'Synced';
      case 'connecting': return 'Connecting…';
      case 'error': return 'Sync error';
      default: return 'Not syncing';
    }
  }

  // ---------- Admin auth ----------
  openAdminLogin(): void {
    this.loginEmail = '';
    this.loginPassword = '';
    this.authSvc.error.set(null);
    this.adminLoginOpen.set(true);
  }

  async doLogin(): Promise<void> {
    if (!this.loginEmail.trim() || !this.loginPassword) return;
    const ok = await this.authSvc.signIn(this.loginEmail, this.loginPassword);
    if (ok) {
      this.adminLoginOpen.set(false);
      this.showToast('Signed in');
    }
  }

  doLogout(): void {
    this.confirm.set({
      title: 'Sign out',
      confirmLabel: 'Sign out',
      danger: false,
      message: 'Sign out of the admin?',
      action: async () => {
        await this.authSvc.signOut();
        if (this.tab() === 'products' || this.tab() === 'orders') this.tab.set('oils');
        this.showToast('Signed out');
      },
    });
  }

  // ---------- Products ----------
  openAddProduct(): void {
    this.editingProductId = null;
    this.productForm = this.emptyProductForm();
    this.productModalOpen.set(true);
  }

  openEditProduct(p: Product): void {
    this.editingProductId = p.id;
    this.productForm = {
      name: p.name,
      description: p.description ?? '',
      size: p.size ?? '',
      price: p.price,
      salePrice: p.salePrice ?? null,
      cost: p.cost ?? null,
      stockQty: p.stockQty,
      inStock: p.inStock,
      active: p.active,
      featured: !!p.featured,
      imageUrl: p.imageUrl ?? '',
      gallery: [...(p.gallery ?? [])],
      category: p.category ?? '',
      gender: p.gender ?? '',
      inspiredBy: p.inspiredBy ?? '',
      notesTop: p.notesTop ?? '',
      notesHeart: p.notesHeart ?? '',
      notesBase: p.notesBase ?? '',
      longDescription: p.longDescription ?? '',
    };
    this.productModalOpen.set(true);
  }

  async saveProduct(): Promise<void> {
    const name = this.productForm.name.trim();
    const price = this.numOrNull(this.productForm.price);
    if (!name || price == null) {
      this.showToast('Name and price are required');
      return;
    }
    const gallery = this.productForm.gallery.filter(Boolean);
    const payload = {
      name,
      description: this.productForm.description.trim() || undefined,
      size: this.productForm.size.trim() || undefined,
      price,
      salePrice: this.numOrNull(this.productForm.salePrice),
      cost: this.numOrNull(this.productForm.cost),
      stockQty: this.numOrNull(this.productForm.stockQty),
      inStock: this.productForm.inStock,
      active: this.productForm.active,
      featured: this.productForm.featured,
      imageUrl: this.productForm.imageUrl.trim() || undefined,
      gallery: gallery.length ? gallery : undefined,
      category: this.productForm.category.trim() || undefined,
      gender: this.productForm.gender.trim() || undefined,
      inspiredBy: this.productForm.inspiredBy.trim() || undefined,
      notesTop: this.productForm.notesTop.trim() || undefined,
      notesHeart: this.productForm.notesHeart.trim() || undefined,
      notesBase: this.productForm.notesBase.trim() || undefined,
      longDescription: this.productForm.longDescription.trim() || undefined,
    };
    // Guard against Firestore's ~1MB per-document limit (uploaded images are stored inline).
    if (JSON.stringify(payload).length > 950000) {
      this.showToast('Images too large — remove a gallery image or use smaller photos');
      return;
    }
    try {
      if (this.editingProductId) {
        const prev = this.shopSvc.products().find((x) => x.id === this.editingProductId);
        const wasSellable = prev ? this.isSellable(prev) : false;
        const nowSellable = this.isSellable(payload);
        const editedId = this.editingProductId;
        await this.shopSvc.updateProduct(editedId, payload);
        // Auto-notify anyone waiting if this product just came back in stock.
        if (!wasSellable && nowSellable && this.pendingRestock(editedId)) {
          const sent = await this.notifyPendingRestock(editedId, name);
          this.showToast(sent ? `Product updated · notified ${sent} waiting` : 'Product updated');
        } else {
          this.showToast('Product updated');
        }
      } else {
        await this.shopSvc.addProduct(payload);
        this.showToast('Product added');
      }
      this.productModalOpen.set(false);
    } catch {
      this.showToast('Save failed — are you signed in?');
    }
  }

  // ---------- Product image uploads (in-browser compress → data URL) ----------
  isDataUrl(s: string | undefined): boolean { return !!s && s.startsWith('data:'); }

  async onMainImageFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.productForm.imageUrl = await compressImage(file, 900, 0.82);
    } catch {
      this.showToast('Could not process that image');
    }
    input.value = '';
  }

  async onGalleryFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const url = await compressImage(file, 800, 0.72);
      this.productForm.gallery = [...this.productForm.gallery, url];
    } catch {
      this.showToast('Could not process that image');
    }
    input.value = '';
  }

  addGalleryUrl(url: string): void {
    const u = url.trim();
    if (u) this.productForm.gallery = [...this.productForm.gallery, u];
  }
  removeGalleryImage(i: number): void {
    this.productForm.gallery = this.productForm.gallery.filter((_, idx) => idx !== i);
  }

  importingStarter = signal(false);
  askImportStarter(): void {
    this.confirm.set({
      title: 'Import starter fragrances',
      confirmLabel: 'Import',
      danger: false,
      message: `Import ${STARTER_CATALOGUE.length} starter fragrances (15 men + 15 ladies) into your shop? Products with the same name are skipped. Prices are Rumi's — adjust them after importing.`,
      action: async () => {
        this.importingStarter.set(true);
        const existing = new Set(this.shopSvc.products().map((p) => p.name.trim().toLowerCase()));
        let added = 0;
        for (const s of STARTER_CATALOGUE) {
          if (existing.has(s.name.trim().toLowerCase())) continue;
          try {
            await this.shopSvc.addProduct({
              name: s.name, price: s.price, salePrice: null, stockQty: null,
              inStock: true, active: true, featured: false,
              gender: s.gender, inspiredBy: s.inspiredBy,
            });
            added++;
          } catch { /* skip failures */ }
        }
        this.importingStarter.set(false);
        this.showToast(added ? `Imported ${added} fragrances` : 'All already imported');
      },
    });
  }

  // Show branded placeholder for products with no own image (incl. old Rumi cover URLs).
  prodImg = productImage;
  readonly cleaningImages = signal(false);
  readonly rumiImageCount = computed(
    () => this.shopSvc.products().filter((p) => p.imageUrl && !isCustomImage(p.imageUrl)).length,
  );

  askCleanRumiImages(): void {
    const n = this.rumiImageCount();
    if (!n) return;
    this.confirm.set({
      title: 'Use placeholders?',
      message: `Remove the old Rumi image links from ${n} product${n === 1 ? '' : 's'}? They'll show the branded placeholder until you add your own photo.`,
      confirmLabel: 'Remove links',
      danger: false,
      action: async () => {
        this.cleaningImages.set(true);
        let done = 0;
        try {
          for (const p of this.shopSvc.products()) {
            if (p.imageUrl && !isCustomImage(p.imageUrl)) {
              try { await this.shopSvc.updateProduct(p.id, { imageUrl: '' }); done++; } catch { /* skip */ }
            }
          }
          this.showToast(`Cleared ${done} image link${done === 1 ? '' : 's'}`);
        } finally {
          this.cleaningImages.set(false);
        }
      },
    });
  }

  pendingRestock(productId: string): number {
    return this.shopSvc.restockRequests().filter((r) => r.productId === productId && !r.notified).length;
  }
  async notifyRestock(p: Product): Promise<void> {
    if (!this.pendingRestock(p.id)) return;
    try {
      if (!p.inStock) await this.shopSvc.updateProduct(p.id, { inStock: true });
      const sent = await this.notifyPendingRestock(p.id, p.name);
      this.showToast(`Marked in stock · notified ${sent}`);
    } catch { this.showToast('Notify failed'); }
  }

  /** Whether a product is actually sellable (in stock and, if tracked, has quantity). */
  private isSellable(p: { inStock: boolean; stockQty: number | null }): boolean {
    return !!p.inStock && (p.stockQty == null || p.stockQty > 0);
  }

  /** Email everyone waiting on this product and mark their request notified. Returns count sent. */
  private async notifyPendingRestock(productId: string, productName: string): Promise<number> {
    const reqs = this.shopSvc.restockRequests().filter((r) => r.productId === productId && !r.notified);
    let sent = 0;
    for (const r of reqs) {
      try { await this.emailSvc.restock(r.email, productName); await this.shopSvc.markRestockNotified(r.id); sent++; } catch { /* skip */ }
    }
    return sent;
  }

  async toggleProductActive(p: Product): Promise<void> {
    try {
      await this.shopSvc.updateProduct(p.id, { active: !p.active });
      this.showToast(p.active ? 'Hidden from shop' : 'Now live on shop');
    } catch {
      this.showToast('Update failed');
    }
  }

  askDeleteProduct(p: Product): void {
    this.confirm.set({
      message: `Delete "${p.name}" from the shop? This can't be undone.`,
      action: async () => {
        try { await this.shopSvc.deleteProduct(p.id); this.showToast('Product deleted'); }
        catch { this.showToast('Delete failed'); }
      },
    });
  }

  // ---------- Order QR scanner (dispatch) ----------
  readonly scannerOpen = signal(false);
  readonly scanError = signal<string | null>(null);
  scanManual = '';
  private scanStream?: MediaStream;
  private scanRAF?: number;
  private scanCanvas?: HTMLCanvasElement;
  private scanPaused = false;

  async openScanner(): Promise<void> {
    this.scanError.set(null);
    this.scanManual = '';
    this.scanPaused = false;
    this.scannerOpen.set(true);
    await new Promise((r) => setTimeout(r, 0)); // let the modal render
    if (!navigator.mediaDevices?.getUserMedia) {
      this.scanError.set('Camera not available on this device — enter the reference below.');
      return;
    }
    try {
      this.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      this.scanError.set('Camera blocked — allow access, or enter the reference below.');
      return;
    }
    const video = document.getElementById('scanVideo') as HTMLVideoElement | null;
    if (!video) return;
    video.srcObject = this.scanStream;
    video.setAttribute('playsinline', 'true');
    try { await video.play(); } catch { /* ignore */ }
    this.scanLoop(video);
  }

  private scanLoop(video: HTMLVideoElement): void {
    const canvas = this.scanCanvas ?? (this.scanCanvas = document.createElement('canvas'));
    const tick = () => {
      if (!this.scannerOpen()) return;
      if (!this.scanPaused && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) { this.onScanResult(code.data); }
        }
      }
      this.scanRAF = requestAnimationFrame(tick);
    };
    this.scanRAF = requestAnimationFrame(tick);
  }

  private parseOrderRef(text: string): string | null {
    const t = (text || '').trim();
    const m = t.match(/^KF-ORDER:(.+)$/i);
    if (m) return m[1].trim().toUpperCase();
    if (/^KF-[A-Z0-9]+$/i.test(t)) return t.toUpperCase();
    return null;
  }

  private onScanResult(text: string): void {
    const ref = this.parseOrderRef(text);
    const order = ref ? this.shopSvc.orders().find((o) => o.reference === ref) : null;
    if (!order) {
      // Pause briefly so we don't spam the same failed read every frame.
      this.scanPaused = true;
      this.scanError.set(`No order found for "${ref || text.slice(0, 24)}".`);
      setTimeout(() => { this.scanPaused = false; }, 1500);
      return;
    }
    this.closeScanner();
    this.openOrderDetail(order);
    this.showToast(`Order ${order.reference}`);
  }

  submitManualScan(): void {
    const ref = this.parseOrderRef(this.scanManual) || this.scanManual.trim().toUpperCase();
    if (!ref) { this.scanError.set('Enter an order reference.'); return; }
    const order = this.shopSvc.orders().find((o) => o.reference === ref);
    if (!order) { this.scanError.set(`No order found for "${ref}".`); return; }
    this.closeScanner();
    this.openOrderDetail(order);
  }

  closeScanner(): void {
    this.scannerOpen.set(false);
    if (this.scanRAF) cancelAnimationFrame(this.scanRAF);
    this.scanRAF = undefined;
    this.scanStream?.getTracks().forEach((t) => t.stop());
    this.scanStream = undefined;
  }

  // ---------- Orders ----------
  async setOrderStatus(o: Order, status: OrderStatus): Promise<void> {
    // Safety gate: never fulfil until every fulfilment step has been worked through.
    if (status === 'fulfilled' && o.stage !== 'shipped') {
      this.showToast('Work through all fulfilment steps first');
      this.openOrderDetail(o);
      return;
    }
    try {
      await this.shopSvc.setOrderStatus(o, status);
      if (status === 'paid') await this.shopSvc.decrementStockForOrder(o.items);
      if (status === 'paid' || status === 'fulfilled') this.emailSvc.status(o, status);
      this.showToast(`Order marked ${status}`);
    } catch {
      this.showToast('Update failed');
    }
  }

  askDeleteOrder(o: Order): void {
    this.confirm.set({
      message: `Delete order ${o.reference}? This can't be undone.`,
      action: async () => {
        try { await this.shopSvc.deleteOrder(o.id); this.showToast('Order deleted'); }
        catch { this.showToast('Delete failed'); }
      },
    });
  }

  orderDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------- Storefront content (CMS) ----------
  addBanner(): void {
    if (!this.contentForm.banners) this.contentForm.banners = [];
    this.contentForm.banners.push({
      id: 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '', subtitle: '', imageUrl: '', ctaText: '', ctaLink: '', active: true,
    });
  }

  removeBanner(b: Banner): void {
    this.contentForm.banners = (this.contentForm.banners ?? []).filter((x) => x.id !== b.id);
  }

  async saveContent(): Promise<void> {
    this.contentSaving.set(true);
    try {
      await this.shopSvc.saveSiteContent(this.contentForm);
      this.showToast('Storefront updated');
    } catch {
      this.showToast('Save failed — are you signed in?');
    } finally {
      this.contentSaving.set(false);
    }
  }

  deliveryLine(o: Order): string {
    const d = o.delivery;
    if (!d) return '';
    return [d.line1, d.line2, d.city, d.province, d.postalCode, d.country].filter(Boolean).join(', ');
  }

  orderDateTime(ms: number): string {
    return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Store settings ----------
  private defaultSettings(): StoreSettings {
    return {
      storeOpen: true, deliveryEnabled: true, collectionEnabled: true,
      deliveryFee: 60, freeDeliveryThreshold: 500,
    };
  }

  async saveSettings(): Promise<void> {
    this.settingsSaving.set(true);
    try {
      await this.shopSvc.saveStoreSettings(this.settingsForm);
      this.showToast('Settings saved');
    } catch {
      this.showToast('Save failed — are you signed in?');
    } finally {
      this.settingsSaving.set(false);
    }
  }

  // ---------- Order detail / export ----------
  openOrderDetail(o: Order): void {
    this.selectedOrder.set(o);
    this.qrDataUrl.set(null);
    QRCode.toDataURL(`KF-ORDER:${o.reference}`, { margin: 1, width: 200, color: { dark: '#141210', light: '#ffffff' } })
      .then((url) => this.qrDataUrl.set(url))
      .catch(() => {});
  }
  printInvoice(): void { setTimeout(() => window.print(), 50); }

  stageIndex(o: Order): number { return FULFIL_STAGES.indexOf((o.stage || 'placed') as FulfilStage); }
  async setStage(o: Order, stage: FulfilStage): Promise<void> {
    // Steps must be worked through in order — you can advance one step or go back to correct,
    // but never skip ahead. This is the safety net so an order can't be shipped by accident.
    const current = this.stageIndex(o);
    const target = FULFIL_STAGES.indexOf(stage);
    if (target > current + 1) {
      this.showToast('Complete the steps in order');
      return;
    }
    if (target === current) return; // already here
    try {
      await this.shopSvc.setOrderStage(o.id, stage);
      this.selectedOrder.set({ ...o, stage });
      if (stage === 'shipped' && o.status !== 'fulfilled' && o.status !== 'cancelled') {
        await this.shopSvc.setOrderStatus(o, 'fulfilled');
        this.emailSvc.status(o, 'fulfilled');
      }
      this.showToast(`Stage: ${stage}`);
    } catch { this.showToast('Update failed'); }
  }

  exportOrdersCsv(): void {
    const rows = [['Reference', 'Date', 'Status', 'Customer', 'Email', 'Phone', 'Method', 'Delivery', 'Items', 'Total']];
    for (const o of this.shopSvc.orders()) {
      rows.push([
        o.reference,
        new Date(o.createdAt).toISOString().slice(0, 10),
        o.status,
        o.customer?.name ?? '',
        o.customer?.email ?? '',
        o.customer?.phone ?? '',
        o.deliveryMethod ?? '',
        this.deliveryLine(o),
        o.items.map((i) => `${i.qty}x ${i.name}${i.size ? ' (' + i.size + ')' : ''}`).join('; '),
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
    this.showToast('Orders exported');
  }

  // ---------- Confirm ----------
  runConfirm(): void {
    const c = this.confirm();
    if (c) c.action();
    this.confirm.set(null);
  }

  // ---------- Helpers ----------
  fillPercent(o: Oil): number | null {
    return this.oilsSvc.fillPercent(o);
  }

  isLow(o: Oil): boolean {
    return this.oilsSvc.isLow(o);
  }

  price(v: number | null | undefined): string {
    if (v == null) return '—';
    return 'R' + v.toFixed(2).replace(/\.00$/, '');
  }

  syncedAgo(): string {
    const t = this.rumiSvc.lastSynced();
    if (!t) return 'never';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return new Date(t).toLocaleDateString();
  }

  onImgError(ev: Event): void {
    (ev.target as HTMLImageElement).style.visibility = 'hidden';
  }

  showToast(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2400);
  }

  private numOrNull(v: number | null): number | null {
    return v === null || v === undefined || (v as any) === '' || isNaN(v) ? null : Number(v);
  }

  private emptyOilForm(): OilForm {
    return { name: '', imageUrl: '', amountMl: null, capacityMl: null, lowThresholdMl: null, notes: '' };
  }

  private emptyRumiForm(): RumiForm {
    return { name: '', fromPrice: null, imageUrl: '', permalink: '', inStock: true, notes: '' };
  }

  private emptyWishForm(): WishForm {
    return { name: '', price: null, imageUrl: '', permalink: '', notes: '' };
  }

  private emptyProductForm(): ProductForm {
    return {
      name: '', description: '', size: '', price: null, salePrice: null, cost: null, stockQty: null,
      inStock: true, active: true, featured: false, imageUrl: '', gallery: [],
      category: '', gender: '', inspiredBy: '', notesTop: '', notesHeart: '', notesBase: '', longDescription: '',
    };
  }
}
