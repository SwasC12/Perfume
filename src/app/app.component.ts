import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OilsService } from './oils.service';
import { RumiService } from './rumi.service';
import { WishlistService } from './wishlist.service';
import { SyncService } from './sync.service';
import { AuthService } from './auth.service';
import { ShopAdminService } from './shop-admin.service';
import { IconComponent } from './icon.component';
import { Oil, RumiProduct, WishlistItem, Product, Order, OrderStatus } from './models';

type Tab = 'oils' | 'wishlist' | 'rumi' | 'products' | 'orders';

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
  stockQty: number | null;
  inStock: boolean;
  active: boolean;
  imageUrl: string;
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

  readonly tab = signal<Tab>('oils');
  readonly oilSearch = signal('');
  readonly wishSearch = signal('');
  readonly rumiSearch = signal('');
  readonly rumiInStockOnly = signal(false);
  readonly productSearch = signal('');
  readonly orderFilter = signal<'all' | OrderStatus>('all');

  // ---- Admin auth ----
  adminLoginOpen = signal(false);
  loginEmail = '';
  loginPassword = '';

  // ---- Product modal ----
  productModalOpen = signal(false);
  editingProductId: string | null = null;
  productForm: ProductForm = this.emptyProductForm();

  constructor() {
    // Start/stop the shop's live listeners with the admin session.
    effect(() => {
      if (this.authSvc.isAdmin) this.shopSvc.start();
      else this.shopSvc.stop();
    });
  }

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
  confirm = signal<{ message: string; action: () => void } | null>(null);
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
    return this.rumiSvc
      .products()
      .filter((p) => (inStockOnly ? p.inStock : true))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
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
      stockQty: p.stockQty,
      inStock: p.inStock,
      active: p.active,
      imageUrl: p.imageUrl ?? '',
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
    const payload = {
      name,
      description: this.productForm.description.trim() || undefined,
      size: this.productForm.size.trim() || undefined,
      price,
      stockQty: this.numOrNull(this.productForm.stockQty),
      inStock: this.productForm.inStock,
      active: this.productForm.active,
      imageUrl: this.productForm.imageUrl.trim() || undefined,
    };
    try {
      if (this.editingProductId) {
        await this.shopSvc.updateProduct(this.editingProductId, payload);
        this.showToast('Product updated');
      } else {
        await this.shopSvc.addProduct(payload);
        this.showToast('Product added');
      }
      this.productModalOpen.set(false);
    } catch {
      this.showToast('Save failed — are you signed in?');
    }
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

  // ---------- Orders ----------
  async setOrderStatus(o: Order, status: OrderStatus): Promise<void> {
    try {
      await this.shopSvc.setOrderStatus(o.id, status);
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
    return { name: '', description: '', size: '', price: null, stockQty: null, inStock: true, active: true, imageUrl: '' };
  }
}
