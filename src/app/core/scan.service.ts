import { Injectable, signal } from '@angular/core';
import type { Order } from '../models';
import type { PickedProduct, ScanPurpose } from '../features/scanner/scanner.component';

export interface ScanSession {
  purpose: Exclude<ScanPurpose, 'tab'>;
  keepOpen: boolean;
  onOrder?: (o: Order) => void;
  onProduct?: (p: PickedProduct) => void;
  onCode?: (c: string) => void;
  done: () => void;
}

/**
 * Open the scanner over any screen to pick something. The shell renders the
 * overlay whenever `session()` is set.
 *
 *   const order = await scan.pickOrder();            // null if closed
 *   const item  = await scan.pickProduct();
 *   await scan.streamProducts(p => addToCart(p));    // stays open, resolves on close
 *   const code  = await scan.pickCode();             // raw text for a field
 */
@Injectable({ providedIn: 'root' })
export class ScanService {
  readonly session = signal<ScanSession | null>(null);

  pickOrder(): Promise<Order | null> {
    return new Promise((resolve) => {
      let got: Order | null = null;
      this.open({ purpose: 'order', keepOpen: false, onOrder: (o) => (got = o), done: () => resolve(got) });
    });
  }

  pickProduct(): Promise<PickedProduct | null> {
    return new Promise((resolve) => {
      let got: PickedProduct | null = null;
      this.open({ purpose: 'product', keepOpen: false, onProduct: (p) => (got = p), done: () => resolve(got) });
    });
  }

  streamProducts(onProduct: (p: PickedProduct) => void): Promise<void> {
    return new Promise((resolve) => this.open({ purpose: 'product', keepOpen: true, onProduct, done: () => resolve() }));
  }

  pickCode(): Promise<string | null> {
    return new Promise((resolve) => {
      let got: string | null = null;
      this.open({ purpose: 'field', keepOpen: false, onCode: (c) => (got = c), done: () => resolve(got) });
    });
  }

  /** Called by the shell when the overlay closes (after a pick or by the user). */
  close(): void {
    const s = this.session();
    if (!s) return;
    this.session.set(null);
    s.done();
  }

  private open(s: ScanSession): void {
    this.session()?.done();
    this.session.set(s);
  }
}
