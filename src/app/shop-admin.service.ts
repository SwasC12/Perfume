import { Injectable, computed, signal } from '@angular/core';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
} from 'firebase/firestore';
import { getDoc, setDoc } from 'firebase/firestore';
import { getDb } from './firebase';
import { Order, OrderItem, OrderStatus, Product, SiteContent, StoreSettings, CustomerProfile, Discount } from './models';

@Injectable({ providedIn: 'root' })
export class ShopAdminService {
  readonly products = signal<Product[]>([]);
  readonly orders = signal<Order[]>([]);
  readonly siteContent = signal<SiteContent | null>(null);
  readonly settings = signal<StoreSettings | null>(null);
  readonly customers = signal<CustomerProfile[]>([]);
  readonly discounts = signal<Discount[]>([]);
  readonly loadingProducts = signal(false);
  readonly loadingOrders = signal(false);
  readonly error = signal<string | null>(null);

  readonly pendingOrderCount = computed(
    () => this.orders().filter((o) => o.status === 'pending').length,
  );

  private unsubProducts?: Unsubscribe;
  private unsubOrders?: Unsubscribe;
  private unsubContent?: Unsubscribe;
  private unsubSettings?: Unsubscribe;
  private unsubCustomers?: Unsubscribe;
  private unsubDiscounts?: Unsubscribe;

  /** Start live listeners (call once the admin is signed in). */
  start(): void {
    if (this.unsubProducts) return; // already started
    const db = getDb();

    this.unsubSettings = onSnapshot(
      doc(db, 'settings', 'store'),
      (snap) => this.settings.set(snap.exists() ? (snap.data() as StoreSettings) : {}),
      () => this.settings.set({}),
    );

    this.unsubCustomers = onSnapshot(
      collection(db, 'customers'),
      (snap) => this.customers.set(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<CustomerProfile, 'uid'>) }))),
      () => this.customers.set([]),
    );

    this.unsubDiscounts = onSnapshot(
      collection(db, 'discounts'),
      (snap) => this.discounts.set(snap.docs.map((d) => ({ ...(d.data() as Discount), code: d.id }))),
      () => this.discounts.set([]),
    );

    this.unsubContent = onSnapshot(
      doc(db, 'siteContent', 'home'),
      (snap) => this.siteContent.set(snap.exists() ? (snap.data() as SiteContent) : {}),
      () => this.siteContent.set({}),
    );

    this.loadingProducts.set(true);
    this.unsubProducts = onSnapshot(
      query(collection(db, 'products'), orderBy('name')),
      (snap) => {
        this.products.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })));
        this.loadingProducts.set(false);
      },
      () => { this.error.set('Could not load products.'); this.loadingProducts.set(false); },
    );

    this.loadingOrders.set(true);
    this.unsubOrders = onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc')),
      (snap) => {
        this.orders.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) })));
        this.loadingOrders.set(false);
      },
      () => { this.error.set('Could not load orders.'); this.loadingOrders.set(false); },
    );
  }

  stop(): void {
    this.unsubProducts?.();
    this.unsubOrders?.();
    this.unsubContent?.();
    this.unsubSettings?.();
    this.unsubCustomers?.();
    this.unsubDiscounts?.();
    this.unsubProducts = undefined;
    this.unsubOrders = undefined;
    this.unsubContent = undefined;
    this.unsubSettings = undefined;
    this.unsubCustomers = undefined;
    this.unsubDiscounts = undefined;
    this.products.set([]);
    this.orders.set([]);
    this.siteContent.set(null);
    this.settings.set(null);
    this.customers.set([]);
    this.discounts.set([]);
  }

  // ---- Discounts ----
  async saveDiscount(d: Discount): Promise<void> {
    const code = d.code.trim().toUpperCase();
    await setDoc(doc(getDb(), 'discounts', code), { type: d.type, value: d.value, active: d.active, updatedAt: Date.now() });
  }
  async deleteDiscount(code: string): Promise<void> {
    await deleteDoc(doc(getDb(), 'discounts', code));
  }

  // ---- Site content (CMS) ----
  async saveSiteContent(data: SiteContent): Promise<void> {
    await setDoc(doc(getDb(), 'siteContent', 'home'), { ...data, updatedAt: Date.now() });
  }

  // ---- Store settings ----
  async saveStoreSettings(data: StoreSettings): Promise<void> {
    await setDoc(doc(getDb(), 'settings', 'store'), { ...data, updatedAt: Date.now() });
  }

  /** Reduce stock for the ordered items (products that track quantity). */
  async decrementStockForOrder(items: OrderItem[]): Promise<void> {
    const prods = this.products();
    for (const it of items) {
      const p = prods.find((x) => x.id === it.productId);
      if (p && p.stockQty != null) {
        const next = Math.max(0, p.stockQty - it.qty);
        try {
          await updateDoc(doc(getDb(), 'products', p.id), {
            stockQty: next, inStock: next > 0 ? p.inStock : false, updatedAt: Date.now(),
          });
        } catch { /* skip */ }
      }
    }
  }

  // ---- POS (in-person sale) ----
  async createPosOrder(data: {
    items: OrderItem[]; subtotal: number; total: number;
    customerName: string; paymentMethod: string; status: OrderStatus;
  }): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const reference = 'KF-' + Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const now = Date.now();
    await addDoc(collection(getDb(), 'orders'), {
      reference, uid: null, channel: 'pos', paymentMethod: data.paymentMethod,
      customer: { name: data.customerName || 'Walk-in', email: '', phone: '' },
      deliveryMethod: 'collection', deliveryFee: 0,
      subtotal: data.subtotal, items: data.items, total: data.total,
      status: data.status, createdAt: now, updatedAt: now,
    });
    try {
      await setDoc(doc(getDb(), 'orderStatus', reference),
        { reference, status: data.status, total: data.total, createdAt: now, updatedAt: now });
    } catch { /* non-fatal */ }
    return reference;
  }

  // ---- Products ----
  async addProduct(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = Date.now();
    await addDoc(collection(getDb(), 'products'), { ...data, createdAt: now, updatedAt: now });
  }

  async updateProduct(id: string, data: Partial<Product>): Promise<void> {
    await updateDoc(doc(getDb(), 'products', id), { ...data, updatedAt: Date.now() });
  }

  async deleteProduct(id: string): Promise<void> {
    await deleteDoc(doc(getDb(), 'products', id));
  }

  // ---- Orders ----
  async setOrderStatus(order: Order, status: OrderStatus): Promise<void> {
    const now = Date.now();
    await updateDoc(doc(getDb(), 'orders', order.id), { status, updatedAt: now });
    // Keep the public tracking doc in sync.
    try {
      await setDoc(doc(getDb(), 'orderStatus', order.reference),
        { reference: order.reference, status, total: order.total, updatedAt: now }, { merge: true });
    } catch { /* non-fatal */ }
  }

  async deleteOrder(id: string): Promise<void> {
    await deleteDoc(doc(getDb(), 'orders', id));
  }
}
