import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { RumiProduct } from './models';
import { StorageService } from './storage.service';

const KEY = 'perfume.rumi.v1';
const META_KEY = 'perfume.rumi.meta.v1';
const ORIGIN = 'https://rumifragrances.co.za';
/** Only the perfume oils ("Inspired By …") are tracked. */
const PRODUCT_PATH = /^\/product\/inspired-by-[a-z0-9-]+$/i;
const CONCURRENCY = 6;

/** A Rumi product, plus the extra details read from its public page. */
export interface RumiItem extends RumiProduct {
  sku?: string;
  category?: string;
  description?: string;
  maxPrice?: number | null;
}

function uid(): string {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Rumi Fragrances (sister company) runs a custom site with no public product
 * API. We read its public sitemap for the "Inspired By" product pages, then
 * each page's schema.org Product data (name, price, stock, image, category).
 *
 * Transport: in the APK, native HTTP (no browser CORS). In the web admin, the
 * admin Worker's /api/rumi proxy, which only forwards those two kinds of URL.
 */
@Injectable({ providedIn: 'root' })
export class RumiService {
  private storage = inject(StorageService);

  readonly products = signal<RumiItem[]>(this.storage.read<RumiItem[]>(KEY, []));
  readonly lastSynced = signal<number | null>(this.storage.read<number | null>(META_KEY, null));
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Sync progress: pages read so far / total pages. */
  readonly progress = signal<{ done: number; total: number } | null>(null);

  readonly inStockCount = computed(() => this.products().filter((p) => p.inStock).length);
  private cancelled = false;

  constructor() {
    effect(() => this.storage.write(KEY, this.products()));
    effect(() => this.storage.write(META_KEY, this.lastSynced()));
  }

  /** Pull the live catalogue from Rumi, keeping manual items and notes. */
  async sync(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.cancelled = false;
    this.progress.set({ done: 0, total: 0 });
    try {
      const sitemap = await this.fetchText(ORIGIN + '/sitemap/products-0');
      const urls = Array.from(sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g), (m) => m[1])
        .filter((u) => { try { const x = new URL(u); return x.origin === ORIGIN && PRODUCT_PATH.test(x.pathname); } catch { return false; } });
      if (!urls.length) throw new Error('No products found in the Rumi sitemap');
      this.progress.set({ done: 0, total: urls.length });

      const prev = new Map(this.products().filter((p) => p.source === 'rumi').map((p) => [p.permalink || p.id, p]));
      const found: RumiItem[] = [];
      let failed = 0;
      let next = 0;
      const worker = async () => {
        while (next < urls.length && !this.cancelled) {
          const url = urls[next++];
          try {
            const item = parseProductPage(await this.fetchText(url), url);
            if (item) found.push({ ...item, notes: prev.get(url)?.notes });
          } catch { failed++; }
          this.progress.update((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (this.cancelled) return;
      if (!found.length) throw new Error('Could not read any Rumi product pages');

      found.sort((a, b) => a.name.localeCompare(b.name));
      this.products.update((existing) => [...found, ...existing.filter((p) => p.source === 'manual')]);
      this.lastSynced.set(Date.now());
      if (failed > 0) this.error.set(`Synced ${found.length} products. ${failed} page${failed === 1 ? '' : 's'} could not be read — try again later.`);
    } catch (e: any) {
      this.error.set('Could not sync from Rumi: ' + (e?.message || 'network error') + '. You can still add items manually.');
    } finally {
      this.loading.set(false);
      this.progress.set(null);
    }
  }

  cancel(): void { this.cancelled = true; }

  private async fetchText(url: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, responseType: 'text', connectTimeout: 15000, readTimeout: 20000 });
      if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch('/api/rumi?u=' + encodeURIComponent(url), { signal: ctrl.signal, credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  addManual(data: Omit<RumiProduct, 'id' | 'source' | 'updatedAt'>): void {
    const item: RumiItem = { ...data, id: uid(), source: 'manual', updatedAt: Date.now() };
    this.products.update((list) => [...list, item]);
  }

  update(id: string, data: Partial<RumiItem>): void {
    this.products.update((list) => list.map((p) => (p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)));
  }

  remove(id: string): void {
    this.products.update((list) => list.filter((p) => p.id !== id));
  }
}

/** Read the schema.org Product (and breadcrumb category) from a product page. */
export function parseProductPage(html: string, url: string): RumiItem | null {
  const blocks = Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g), (m) => m[1]);
  let product: any = null;
  let category = '';
  for (const raw of blocks) {
    let data: any;
    try { data = JSON.parse(raw); } catch { continue; }
    for (const d of Array.isArray(data) ? data : [data]) {
      if (d?.['@type'] === 'Product' && !product) product = d;
      if (d?.['@type'] === 'BreadcrumbList' && Array.isArray(d.itemListElement)) {
        const items = d.itemListElement;
        if (items.length >= 3) category = String(items[items.length - 2]?.name || '');
      }
    }
  }
  if (!product?.name) return null;
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers || {};
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const low = num(offers.lowPrice ?? offers.price);
  const img = Array.isArray(product.image) ? product.image[0] : product.image;
  return {
    id: String(product.sku || url),
    sku: product.sku ? String(product.sku) : undefined,
    name: String(product.name),
    fromPrice: low,
    maxPrice: num(offers.highPrice),
    inStock: /InStock|LimitedAvailability|PreOrder/i.test(String(offers.availability || '')),
    imageUrl: typeof img === 'string' ? img : img?.url || '',
    permalink: url,
    description: product.description ? String(product.description) : undefined,
    category: category || undefined,
    source: 'rumi',
    updatedAt: Date.now(),
  };
}
