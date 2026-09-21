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
import { Order, OrderStatus, Product, SiteContent, StoreSettings } from './models';

@Injectable({ providedIn: 'root' })
export class ShopAdminService {
  readonly products = signal<Product[]>([]);
  readonly orders = signal<Order[]>([]);
  readonly siteContent = signal<SiteContent | null>(null);
  readonly settings = signal<StoreSettings | null>(null);
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

  /** Start live listeners (call once the admin is signed in). */
  start(): void {
    if (this.unsubProducts) return; // already started
    const db = getDb();

    this.unsubSettings = onSnapshot(
      doc(db, 'settings', 'store'),
      (snap) => this.settings.set(snap.exists() ? (snap.data() as StoreSettings) : {}),
      () => this.settings.set({}),
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
    this.unsubProducts = undefined;
    this.unsubOrders = undefined;
    this.unsubContent = undefined;
    this.unsubSettings = undefined;
    this.products.set([]);
    this.orders.set([]);
    this.siteContent.set(null);
    this.settings.set(null);
  }

  // ---- Site content (CMS) ----
  async saveSiteContent(data: SiteContent): Promise<void> {
    await setDoc(doc(getDb(), 'siteContent', 'home'), { ...data, updatedAt: Date.now() });
  }

  // ---- Store settings ----
  async saveStoreSettings(data: StoreSettings): Promise<void> {
    await setDoc(doc(getDb(), 'settings', 'store'), { ...data, updatedAt: Date.now() });
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
