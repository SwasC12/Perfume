import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Oil } from './models';
import { StorageService } from './storage.service';

const KEY = 'perfume.oils.v1';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

@Injectable({ providedIn: 'root' })
export class OilsService {
  private storage = inject(StorageService);

  readonly oils = signal<Oil[]>(this.storage.read<Oil[]>(KEY, []));

  readonly sorted = computed(() =>
    [...this.oils()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  readonly lowCount = computed(
    () => this.oils().filter((o) => this.isLow(o)).length,
  );

  constructor() {
    effect(() => this.storage.write(KEY, this.oils()));
  }

  isLow(o: Oil): boolean {
    if (o.amountMl == null || o.lowThresholdMl == null) return false;
    return o.amountMl <= o.lowThresholdMl;
  }

  fillPercent(o: Oil): number | null {
    if (o.amountMl == null || o.capacityMl == null || o.capacityMl <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((o.amountMl / o.capacityMl) * 100)));
  }

  add(data: Omit<Oil, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now = Date.now();
    const oil: Oil = { ...data, id: uid(), createdAt: now, updatedAt: now };
    this.oils.update((list) => [...list, oil]);
  }

  update(id: string, data: Partial<Oil>): void {
    this.oils.update((list) =>
      list.map((o) => (o.id === id ? { ...o, ...data, updatedAt: Date.now() } : o)),
    );
  }

  remove(id: string): void {
    this.oils.update((list) => list.filter((o) => o.id !== id));
  }
}
