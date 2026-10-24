import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { ShopAdminService } from '../../shop-admin.service';
import { Order, Product } from '../../models';

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './scanner.component.html',
  styleUrl: './scanner.component.scss',
})
export class ScannerComponent implements OnDestroy {
  private shop = inject(ShopAdminService);
  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  readonly scanning = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastCode = signal('');
  readonly scanned = signal<{ code: string; label: string; at: number }[]>([]);
  readonly order = signal<Order | null>(null);
  readonly product = signal<Product | null>(null);
  readonly batchCode = signal('');

  genType: 'order' | 'batch' | 'product' | 'custom' = 'order';
  genValue = '';
  readonly generated = signal<string | null>(null);
  readonly genError = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private raf = 0;
  private detector: any = null;
  private busy = false;
  private lastAt = 0;
  private lastFrame = 0;

  async start(): Promise<void> {
    if (this.scanning()) return;
    this.error.set(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      this.stream = stream;
      const video = this.videoRef?.nativeElement;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const Detector = (window as any).BarcodeDetector;
      this.detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      this.scanning.set(true);
      this.loop();
    } catch {
      this.error.set('Camera unavailable. Allow camera access and try again.');
    }
  }

  stop(): void {
    this.scanning.set(false);
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.detector = null;
    const video = this.videoRef?.nativeElement;
    if (video) video.srcObject = null;
  }

  private loop = (): void => {
    if (!this.scanning()) return;
    const video = this.videoRef?.nativeElement;
    if (video && video.readyState >= 2 && !this.busy) {
      this.busy = true;
      if (this.detector && this.detector.detect) {
        this.detector.detect(video)
          .then((codes: any[]) => { if (codes && codes[0]?.rawValue) this.onScan(codes[0].rawValue); })
          .catch(() => { this.detector = null; })
          .finally(() => { this.busy = false; });
      } else {
        const now = performance.now();
        if (now - this.lastFrame >= 90) {
          this.lastFrame = now;
          this.scanWithCanvas(video);
        }
        this.busy = false;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private scanWithCanvas(video: HTMLVideoElement): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const scale = Math.min(1, 640 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, cw, ch);
    const data = ctx.getImageData(0, 0, cw, ch);
    const code = jsQR(data.data, cw, ch, { inversionAttempts: 'dontInvert' });
    if (code?.data) this.onScan(code.data);
  }

  private onScan(raw: string): void {
    const value = String(raw || '').trim();
    if (!value) return;
    const now = Date.now();
    if (value === this.lastCode() && now - this.lastAt < 1500) return;
    this.lastCode.set(value);
    this.lastAt = now;
    this.handle(value);
  }

  private handle(code: string): void {
    this.order.set(null);
    this.product.set(null);
    this.batchCode.set('');

    let ref = '';
    let label = code;
    if (code.startsWith('KF-ORDER:')) ref = code.slice(9).trim();
    else if (/^KF-[A-Z2-9]{5}$/i.test(code)) ref = code.toUpperCase();
    else if (code.startsWith('KF-BATCH:')) {
      this.batchCode.set(code.slice(9).trim());
      label = 'Batch ' + this.batchCode();
    } else if (code.startsWith('KF-PRODUCT:')) {
      const id = code.slice(11).trim();
      const product = this.shop.products().find((p) => p.id === id);
      if (product) { this.product.set(product); label = product.name; }
    }

    if (ref) {
      const order = this.shop.orders().find((o) => o.reference === ref || o.id === ref);
      if (order) {
        this.order.set(order);
        label = 'Order ' + order.reference + ' · ' + order.customer.name;
      } else {
        label = 'Order ' + ref + ' (not loaded)';
      }
    }
    this.scanned.update((list) => [{ code, label, at: Date.now() }, ...list].slice(0, 40));
  }

  async markShipped(): Promise<void> {
    const order = this.order();
    if (!order) return;
    try {
      await this.shop.setOrderStatus(order, 'shipped');
      this.order.set({ ...order, status: 'shipped' });
    } catch {
      this.error.set('Could not update the order.');
    }
  }

  clear(): void {
    this.scanned.set([]);
    this.lastCode.set('');
    this.order.set(null);
    this.product.set(null);
    this.batchCode.set('');
  }

  async generate(): Promise<void> {
    this.genError.set(null);
    const value = this.genValue.trim();
    if (!value) { this.genError.set('Enter a value first.'); return; }
    let payload = value;
    if (this.genType === 'order') payload = 'KF-ORDER:' + value.toUpperCase();
    else if (this.genType === 'batch') payload = 'KF-BATCH:' + value;
    else if (this.genType === 'product') payload = 'KF-PRODUCT:' + value;
    try {
      const url = await QRCode.toDataURL(payload, {
        margin: 1, width: 512,
        color: { dark: '#141210', light: '#ffffff' },
      });
      this.generated.set(url);
    } catch {
      this.genError.set('Could not generate the QR code.');
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
