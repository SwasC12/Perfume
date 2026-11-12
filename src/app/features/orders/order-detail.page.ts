import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import QRCode from 'qrcode';
import { ShopAdminService } from '../../shop-admin.service';
import { EmailService } from '../../email.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { FULFIL_STAGES, FulfilStage, Order, OrderStatus } from '../../models';
import {
  DocKind, customerInvoiceMessage, docFilename, docsToPdf, ensureDocStyles, renderDoc, sendPdfToCustomer,
} from '../../order-docs';
import { ORDER_STATUSES, deliveryLine, itemCount, orderDateTime, orderFlags, paymentText } from './order-util';
import { runDocs } from './doc-actions';

type NextAction =
  | { label: string; kind: 'status'; status: OrderStatus }
  | { label: string; kind: 'stage'; stage: FulfilStage };

@Component({
  standalone: true,
  imports: [RouterLink, CurrencyPipe, FormsModule, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail.page.html',
  styleUrl: './order-detail.page.scss',
})
export class OrderDetailPage {
  readonly id = input<string>();

  readonly shop = inject(ShopAdminService);
  private email = inject(EmailService);
  private ui = inject(UiService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  readonly stages = FULFIL_STAGES;
  readonly statuses = ORDER_STATUSES;

  /** Live order from the Firestore listener. */
  readonly order = computed<Order | undefined>(() => {
    const id = this.id();
    return id ? this.shop.orders().find((o) => o.id === id) : undefined;
  });
  private readonly reference = computed(() => this.order()?.reference ?? '');

  readonly stageIdx = computed(() => {
    const o = this.order();
    return o ? this.stageIndex(o) : 0;
  });
  readonly flags = computed(() => {
    const o = this.order();
    return o ? orderFlags(o) : [];
  });

  /** The one thing to do next — the primary button (sticky on phones). */
  readonly next = computed<NextAction | null>(() => {
    const o = this.order();
    if (!o) return null;
    const idx = this.stageIdx();
    switch (o.status) {
      case 'pending': return { label: 'Mark paid', kind: 'status', status: 'paid' };
      case 'paid':
        if (idx < FULFIL_STAGES.length - 1) {
          const s = FULFIL_STAGES[idx + 1];
          return { label: 'Next step: ' + s, kind: 'stage', stage: s };
        }
        return { label: 'Mark shipped', kind: 'status', status: 'shipped' };
      case 'fulfilled':
      case 'shipped': return { label: 'Mark delivered', kind: 'status', status: 'delivered' };
      default: return null;
    }
  });

  readonly busy = signal(false);

  // Tracking form
  readonly courier = signal('');
  readonly trackNo = signal('');
  readonly trackUrl = signal('');
  readonly savingTracking = signal(false);
  private trackingFor: string | null = null;

  // Documents
  readonly docOpen = signal(false);
  readonly docKind = signal<DocKind>('invoice');
  readonly docPreview = signal<SafeHtml | null>(null);
  readonly docBusy = signal<'print' | 'share' | 'send' | null>(null);
  private docSeq = 0;

  readonly qr = signal<string | null>(null);

  constructor() {
    // Fill the tracking form once per order (not on every live update).
    effect(() => {
      const o = this.order();
      if (!o || this.trackingFor === o.id) return;
      this.trackingFor = o.id;
      untracked(() => {
        this.courier.set(o.courier || '');
        this.trackNo.set(o.trackingNumber || '');
        this.trackUrl.set(o.trackingUrl || '');
      });
    });

    // QR for the order slip.
    effect(() => {
      const ref = this.reference();
      untracked(() => this.qr.set(null));
      if (!ref) return;
      QRCode.toDataURL(`KF-ORDER:${ref}`, { margin: 1, width: 200, color: { dark: '#141210', light: '#ffffff' } })
        .then((url) => { if (this.reference() === ref) this.qr.set(url); })
        .catch(() => {});
    });

    // Keep the preview in sync with the order (status, tracking) and store settings.
    effect(() => {
      const open = this.docOpen();
      const o = this.order();
      const kind = this.docKind();
      const settings = this.shop.settings();
      if (!open || !o) { untracked(() => this.docPreview.set(null)); return; }
      const seq = ++this.docSeq;
      ensureDocStyles();
      void renderDoc(o, kind, { settings }).then((html) => {
        if (seq === this.docSeq) this.docPreview.set(this.sanitizer.bypassSecurityTrustHtml(html));
      });
    });
  }

  // ---------------------------------------------------------------- view helpers
  dateTime = orderDateTime;
  payment = paymentText;
  units = itemCount;
  address = deliveryLine;
  total(o: Order): number { return Number(o.total) || 0; }
  subtotal(o: Order): number { return o.subtotal ?? (o.items || []).reduce((t, i) => t + i.price * i.qty, 0); }
  firstName(o: Order): string { return (o.customer?.name || '').split(' ')[0] || 'customer'; }
  stageIndex(o: Order): number { return Math.max(0, FULFIL_STAGES.indexOf((o.stage || 'placed') as FulfilStage)); }

  // ---------------------------------------------------------------- status
  async runNext(o: Order): Promise<void> {
    const n = this.next();
    if (!n) return;
    if (n.kind === 'stage') await this.setStage(o, n.stage);
    else await this.setOrderStatus(o, n.status);
  }

  async onStatusSelect(o: Order, ev: Event): Promise<void> {
    const el = ev.target as HTMLSelectElement;
    const status = el.value as OrderStatus;
    if (status === o.status) return;
    let ok = false;
    if (status === 'cancelled') ok = await this.cancelOrder(o);
    else ok = await this.setOrderStatus(o, status);
    if (!ok) el.value = this.order()?.status ?? o.status;
  }

  async cancelOrder(o: Order): Promise<boolean> {
    const yes = await this.ui.confirm({
      title: 'Cancel order?',
      message: `Cancel ${o.reference}? Reserved stock goes back on the shelf and any promo use is released.`,
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      danger: true,
    });
    if (!yes) return false;
    return this.setOrderStatus(o, 'cancelled');
  }

  /** Same rules as the old order list: safety gate, stock, promo counts, emails. */
  async setOrderStatus(o: Order, status: OrderStatus): Promise<boolean> {
    // Safety gate: never fulfil until every fulfilment step has been worked through.
    if ((status === 'fulfilled' || status === 'shipped' || status === 'delivered') && o.stage !== 'shipped') {
      this.ui.toast('Work through all fulfilment steps first', 'info');
      return false;
    }
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      await this.shop.setOrderStatus(o, status);
      if (status === 'paid') {
        // New orders reserve stock when placed; only legacy orders still need this.
        if (!o.stockReserved) await this.shop.decrementStockForOrder(o.items);
        await this.shop.countDiscount(o);
      }
      if (status === 'cancelled') {
        await this.shop.restoreStockForOrder(o);
        await this.shop.releaseDiscount(o);
      }
      if (status === 'shipped') this.email.shipping(o);
      else if (status === 'paid' || status === 'fulfilled' || status === 'delivered') this.email.status(o, status);
      this.ui.toast(`Order marked ${status}`, 'ok');
      return true;
    } catch {
      this.ui.toast('Update failed', 'err');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async setStage(o: Order, stage: FulfilStage): Promise<void> {
    // Steps must be worked through in order — you can advance one step or go back to correct,
    // but never skip ahead. This is the safety net so an order can't be shipped by accident.
    const current = this.stageIndex(o);
    const target = FULFIL_STAGES.indexOf(stage);
    if (target > current + 1) {
      this.ui.toast('Complete the steps in order', 'info');
      return;
    }
    if (target === current || this.busy()) return;
    this.busy.set(true);
    try {
      await this.shop.setOrderStage(o.id, stage);
      if (stage === 'shipped' && o.status !== 'shipped' && o.status !== 'delivered' && o.status !== 'cancelled') {
        await this.shop.setOrderStatus(o, 'shipped');
      }
      this.ui.toast(`Stage: ${stage}`, 'ok');
    } catch {
      this.ui.toast('Update failed', 'err');
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- tracking
  async saveTracking(o: Order): Promise<void> {
    if (this.savingTracking()) return;
    this.savingTracking.set(true);
    try {
      const courier = this.courier().trim();
      const waybill = this.trackNo().trim();
      let link = this.trackUrl().trim();
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      await this.shop.setOrderTracking(o, courier, waybill, link);
      this.trackUrl.set(link);
      const updated: Order = { ...o, courier: courier || undefined, trackingNumber: waybill || undefined, trackingUrl: link || undefined };
      // The customer must always be able to see where their parcel is.
      if (waybill) this.email.shipping(updated);
      this.ui.toast(waybill ? 'Tracking saved — customer emailed' : 'Tracking saved', 'ok');
    } catch {
      this.ui.toast('Could not save tracking', 'err');
    } finally {
      this.savingTracking.set(false);
    }
  }

  // ---------------------------------------------------------------- documents
  openDoc(kind: DocKind): void {
    this.docKind.set(kind);
    this.docOpen.set(true);
  }

  async docAction(action: 'print' | 'share'): Promise<void> {
    const o = this.order();
    if (!o || this.docBusy()) return;
    this.docBusy.set(action);
    try {
      await runDocs(action, this.docKind(), [o], this.shop.settings(), (t, k) => this.ui.toast(t, k));
    } finally {
      this.docBusy.set(null);
    }
  }

  /** Invoice PDF straight into the customer's WhatsApp chat. */
  async sendInvoice(): Promise<void> {
    const o = this.order();
    if (!o || this.docBusy()) return;
    if (!o.customer?.phone) { this.ui.toast('No phone number on this order', 'info'); return; }
    this.docBusy.set('send');
    try {
      const settings = this.shop.settings();
      const blob = await docsToPdf([await renderDoc(o, 'invoice', { settings })]);
      const r = await sendPdfToCustomer(blob, docFilename('invoice', [o]), o.customer.phone, customerInvoiceMessage(o, settings));
      if (r === 'downloaded') this.ui.toast('Invoice downloaded. Attach it in the WhatsApp chat', 'info');
    } catch (e) {
      console.error(e);
      this.ui.toast('Could not send the invoice', 'err');
    } finally {
      this.docBusy.set(null);
    }
  }

  // ---------------------------------------------------------------- delete
  async deleteOrder(o: Order): Promise<void> {
    const yes = await this.ui.confirm({
      title: 'Delete order?',
      message: `Delete order ${o.reference}? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await this.shop.deleteOrder(o.id);
      this.ui.toast('Order deleted', 'ok');
      void this.router.navigate(['/orders']);
    } catch {
      this.ui.toast('Delete failed', 'err');
    }
  }
}
