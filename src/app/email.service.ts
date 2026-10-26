import { Injectable } from '@angular/core';
import { getAuthInstance } from './firebase';
import { Order, OrderStatus } from './models';

// The email endpoint lives on the shop's Cloudflare Worker (has the Resend key).
// Admin actions are authorised with the signed-in Firebase ID token; the Worker
// checks that its UID matches ADMIN_UID. No shared secret ships in this app.
const ENDPOINT = 'https://kauafragrances.co.za/api/send-email';

@Injectable({ providedIn: 'root' })
export class EmailService {
  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const user = getAuthInstance().currentUser;
      if (user) headers['Authorization'] = 'Bearer ' + (await user.getIdToken());
    } catch {
      /* fall through — the Worker will reject the call */
    }
    return headers;
  }

  /** Notify a shopper that a product is back in stock. Returns the fetch promise. */
  async restock(to: string, productName: string): Promise<Response> {
    const headers = await this.headers();
    return fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'restock', to, productName }),
    });
  }

  /** Notify the customer their order is paid / on its way. Fire-and-forget. */
  status(order: Order, status: Extract<OrderStatus, 'paid' | 'fulfilled' | 'shipped' | 'delivered'>): void {
    if (!order.customer?.email) return;
    void this.sendStatus(order, status);
  }

  /** Tell the customer their parcel is on its way, with the waybill details. */
  shipping(order: Order): void {
    if (!order.customer?.email) return;
    void this.sendStatus(order, 'shipped');
  }

  private async sendStatus(order: Order, status: Extract<OrderStatus, 'paid' | 'fulfilled' | 'shipped' | 'delivered'>): Promise<void> {
    try {
      const headers = await this.headers();
      await fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'status',
          to: order.customer.email,
          name: order.customer.name,
          reference: order.reference,
          status,
          total: order.total,
          courier: order.courier || '',
          trackingNumber: order.trackingNumber || '',
          trackingUrl: order.trackingUrl || '',
        }),
      });
    } catch {
      /* ignore */
    }
  }
}
