import { Injectable } from '@angular/core';
import { doc, onSnapshot, setDoc, Unsubscribe } from 'firebase/firestore';
import { getDb } from '../firebase';

export interface DisplayLine {
  productId: string;
  name: string;
  size?: string;
  qty: number;
  price: number;
  gender?: string;
  /** 100ml photo (or the product photo) for the 3D bottle's label. */
  label?: string;
}

export interface DisplayState {
  state: 'idle' | 'cart' | 'paid';
  lines: DisplayLine[];
  /** The line that changed last: the display shows its bottle. */
  focus?: DisplayLine | null;
  subtotal: number;
  discount: number;
  total: number;
  method?: string;
  change?: number;
  updatedAt: number;
}

const DOC = ['posDisplay', 'current'] as const;

/**
 * Till → customer display link. The POS writes one small Firestore doc
 * (posDisplay/current); any device signed in as the admin and showing
 * /display listens to it live. Works across phones/tablets on any network.
 * Writes are coalesced so a fast run of taps is one write.
 */
@Injectable({ providedIn: 'root' })
export class CustomerDisplayService {
  private pending: DisplayState | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  publish(s: Omit<DisplayState, 'updatedAt'>): void {
    this.pending = { ...s, updatedAt: Date.now() };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 120);
  }

  /** Sale finished: show thanks right away (no coalescing). */
  publishNow(s: Omit<DisplayState, 'updatedAt'>): void {
    clearTimeout(this.timer);
    this.pending = { ...s, updatedAt: Date.now() };
    this.flush();
  }

  watch(cb: (s: DisplayState | null) => void): Unsubscribe {
    return onSnapshot(
      doc(getDb(), ...DOC),
      (snap) => cb(snap.exists() ? (snap.data() as DisplayState) : null),
      () => cb(null),
    );
  }

  private flush(): void {
    const s = this.pending;
    this.pending = null;
    if (!s || !navigator.onLine) return;
    // Never block or fail a sale because the display couldn't be updated.
    setDoc(doc(getDb(), ...DOC), JSON.parse(JSON.stringify(s))).catch(() => {});
  }
}
