import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RumiProduct, RumiSyncResponse } from './models';
import { StorageService } from './storage.service';

const KEY = 'perfume.rumi.v1';
const META_KEY = 'perfume.rumi.meta.v1';

function uid(): string {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

@Injectable({ providedIn: 'root' })
export class RumiService {
  private storage = inject(StorageService);
  private http = inject(HttpClient);

  /** Everything shown in the "Buy from Rumi" table (synced + manual). */
  readonly products = signal<RumiProduct[]>(this.storage.read<RumiProduct[]>(KEY, []));
  readonly lastSynced = signal<number | null>(
    this.storage.read<number | null>(META_KEY, null),
  );

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly inStockCount = computed(
    () => this.products().filter((p) => p.inStock).length,
  );

  constructor() {
    effect(() => this.storage.write(KEY, this.products()));
    effect(() => this.storage.write(META_KEY, this.lastSynced()));
  }

  /** Pull live stock from Rumi via the Vercel proxy, merging with manual edits. */
  async sync(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<RumiSyncResponse>('/api/rumi-stock'),
      );
      const fetched = res.products ?? [];

      this.products.update((existing) => {
        const manual = existing.filter((p) => p.source === 'manual');
        // Preserve any user notes previously attached to a synced product.
        const prevNotes = new Map(
          existing.filter((p) => p.source === 'rumi').map((p) => [p.id, p.notes]),
        );
        const synced = fetched.map((p) => ({ ...p, notes: prevNotes.get(p.id) }));
        return [...synced, ...manual];
      });
      this.lastSynced.set(res.fetchedAt ?? Date.now());
    } catch {
      this.error.set(
        'Could not reach Rumi. Deploy to Vercel (or run "vercel dev") for live sync — you can still add items manually.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  addManual(data: Omit<RumiProduct, 'id' | 'source' | 'updatedAt'>): void {
    const item: RumiProduct = { ...data, id: uid(), source: 'manual', updatedAt: Date.now() };
    this.products.update((list) => [...list, item]);
  }

  update(id: string, data: Partial<RumiProduct>): void {
    this.products.update((list) =>
      list.map((p) => (p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p)),
    );
  }

  remove(id: string): void {
    this.products.update((list) => list.filter((p) => p.id !== id));
  }
}
