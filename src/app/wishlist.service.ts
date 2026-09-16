import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { WishlistItem, RumiProduct } from './models';
import { StorageService } from './storage.service';

const KEY = 'perfume.wishlist.v1';

function uid(): string {
  return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private storage = inject(StorageService);

  readonly items = signal<WishlistItem[]>(this.storage.read<WishlistItem[]>(KEY, []));

  readonly sorted = computed(() =>
    [...this.items()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  constructor() {
    effect(() => this.storage.write(KEY, this.items()));
  }

  /** Is a fragrance with this name already on the wishlist? */
  has(name: string): boolean {
    const n = name.trim().toLowerCase();
    return this.items().some((i) => i.name.trim().toLowerCase() === n);
  }

  add(data: Omit<WishlistItem, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = Date.now();
    this.items.update((list) => [...list, { ...data, id: uid(), createdAt: now, updatedAt: now }]);
  }

  addFromRumi(p: RumiProduct): void {
    if (this.has(p.name)) return;
    this.add({
      name: p.name,
      imageUrl: p.imageUrl,
      price: p.fromPrice,
      permalink: p.permalink,
    });
  }

  update(id: string, data: Partial<WishlistItem>): void {
    this.items.update((list) =>
      list.map((i) => (i.id === id ? { ...i, ...data, updatedAt: Date.now() } : i)),
    );
  }

  remove(id: string): void {
    this.items.update((list) => list.filter((i) => i.id !== id));
  }

  removeByName(name: string): void {
    const n = name.trim().toLowerCase();
    this.items.update((list) => list.filter((i) => i.name.trim().toLowerCase() !== n));
  }
}
