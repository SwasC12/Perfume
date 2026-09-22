import { Injectable } from '@angular/core';
import { Order, OrderStatus } from './models';

// The email endpoint lives on the shop's Cloudflare Worker (has the Resend key).
const ENDPOINT = 'https://kf-publicsite.swasteerc.workers.dev/api/send-email';

@Injectable({ providedIn: 'root' })
export class EmailService {
  /** Notify a shopper that a product is back in stock. Returns the fetch promise. */
  restock(to: string, productName: string): Promise<Response> {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'restock', to, productName }),
    });
  }

  /** Notify the customer their order is paid / on its way. Fire-and-forget. */
  status(order: Order, status: Extract<OrderStatus, 'paid' | 'fulfilled'>): void {
    if (!order.customer?.email) return;
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'status',
          to: order.customer.email,
          name: order.customer.name,
          reference: order.reference,
          status,
          total: order.total,
        }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}
