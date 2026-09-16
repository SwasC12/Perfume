import { Injectable, effect, inject, signal } from '@angular/core';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Firestore,
  DocumentReference,
  Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebase.config';
import { OilsService } from './oils.service';
import { RumiService } from './rumi.service';
import { WishlistService } from './wishlist.service';
import { Oil, RumiProduct, WishlistItem } from './models';

const CODE_KEY = 'perfume.synccode.v1';

type SyncStatus = 'off' | 'connecting' | 'synced' | 'error';

interface WorkspaceDoc {
  oils?: Oil[];
  rumi?: RumiProduct[];
  wishlist?: WishlistItem[];
  updatedAt?: number;
}

/** Latest-write-wins merge of two lists keyed by id (used only on first connect). */
function mergeById<T extends { id: string; updatedAt: number }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const existing = map.get(item.id);
    if (!existing || (item.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private oilsSvc = inject(OilsService);
  private rumiSvc = inject(RumiService);
  private wishSvc = inject(WishlistService);

  readonly configured = isFirebaseConfigured();
  readonly code = signal<string | null>(localStorage.getItem(CODE_KEY));
  readonly status = signal<SyncStatus>('off');

  private app?: FirebaseApp;
  private db?: Firestore;
  private unsub?: Unsubscribe;
  private docRef?: DocumentReference;
  private applyingRemote = false;
  private lastSyncedJson: string | null = null;
  private writeTimer: any = null;

  constructor() {
    if (this.configured) {
      this.app = getApps()[0] ?? initializeApp(firebaseConfig);
      // ignoreUndefinedProperties lets us store our optional fields (notes, imageUrl…).
      this.db = initializeFirestore(this.app, { ignoreUndefinedProperties: true });
      const existing = this.code();
      if (existing) void this.connect(existing);
    }

    // Push local changes up to the cloud (debounced, content-deduped).
    effect(() => {
      const json = this.serialize(
        this.oilsSvc.oils(),
        this.rumiSvc.products(),
        this.wishSvc.items(),
      );
      if (!this.docRef || this.applyingRemote) return;
      if (json === this.lastSyncedJson) return;
      this.scheduleWrite(json);
    });
  }

  async connect(rawCode: string): Promise<void> {
    const code = rawCode.trim().toLowerCase();
    if (!this.db || !code) return;

    this.teardown();
    this.code.set(code);
    localStorage.setItem(CODE_KEY, code);
    this.status.set('connecting');
    this.docRef = doc(this.db, 'workspaces', code);

    try {
      const snap = await getDoc(this.docRef);
      const remote = (snap.exists() ? snap.data() : null) as WorkspaceDoc | null;

      // First connect: merge whatever is local with whatever is in the cloud so
      // nothing is lost, then that merged set becomes the shared truth.
      const mergedOils = mergeById(this.oilsSvc.oils(), remote?.oils ?? []);
      const mergedRumi = mergeById(this.rumiSvc.products(), remote?.rumi ?? []);
      const mergedWish = mergeById(this.wishSvc.items(), remote?.wishlist ?? []);
      this.applyRemote({ oils: mergedOils, rumi: mergedRumi, wishlist: mergedWish });
      await setDoc(this.docRef, {
        oils: mergedOils,
        rumi: mergedRumi,
        wishlist: mergedWish,
        updatedAt: Date.now(),
      });

      this.unsub = onSnapshot(
        this.docRef,
        (s) => {
          if (s.exists()) this.applyRemote(s.data() as WorkspaceDoc);
        },
        () => this.status.set('error'),
      );
      this.status.set('synced');
    } catch {
      this.status.set('error');
    }
  }

  disconnect(): void {
    this.teardown();
    this.code.set(null);
    localStorage.removeItem(CODE_KEY);
    this.status.set('off');
  }

  generateCode(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
    const pick = (n: number) =>
      Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${pick(4)}-${pick(4)}`;
  }

  // ---------- internals ----------
  private applyRemote(data: WorkspaceDoc): void {
    const oils = data.oils ?? [];
    const rumi = data.rumi ?? [];
    const wishlist = data.wishlist ?? [];
    this.lastSyncedJson = this.serialize(oils, rumi, wishlist);
    this.applyingRemote = true;
    this.oilsSvc.oils.set(oils);
    this.rumiSvc.products.set(rumi);
    this.wishSvc.items.set(wishlist);
    this.applyingRemote = false;
    if (this.status() === 'connecting') this.status.set('synced');
  }

  private scheduleWrite(json: string): void {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(async () => {
      if (!this.docRef) return;
      try {
        await setDoc(this.docRef, {
          oils: this.oilsSvc.oils(),
          rumi: this.rumiSvc.products(),
          wishlist: this.wishSvc.items(),
          updatedAt: Date.now(),
        });
        this.lastSyncedJson = json;
        this.status.set('synced');
      } catch {
        this.status.set('error');
      }
    }, 700);
  }

  private serialize(oils: Oil[], rumi: RumiProduct[], wishlist: WishlistItem[]): string {
    return JSON.stringify({ oils, rumi, wishlist });
  }

  private teardown(): void {
    clearTimeout(this.writeTimer);
    this.unsub?.();
    this.unsub = undefined;
    this.docRef = undefined;
    this.lastSyncedJson = null;
  }
}
