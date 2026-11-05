import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { readBarcodes } from 'zxing-wasm/reader';
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

  readonly torchOn = signal(false);
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
      // Native decoder where the browser has one (Android Chrome): QR + 1D.
      const Detector = (window as any).BarcodeDetector;
      let formats: string[] = [];
      try {
        formats = Detector && Detector.getSupportedFormats ? await Detector.getSupportedFormats() : [];
      } catch { formats = []; }
      this.detector = Detector && formats.length ? new Detector({ formats }) : null;
      this.scanning.set(true);
      this.loop();
    } catch {
      this.error.set('Camera unavailable. Allow camera access and try again.');
    }
  }

  /** Torch / flashlight where the camera exposes it (most Android + iPad Pro). */
  async toggleTorch(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const next = !this.torchOn();
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      this.torchOn.set(next);
    } catch {
      this.error.set('This camera has no torch.');
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
        if (now - this.lastFrame >= 70) {
          this.lastFrame = now;
          void this.scanWithCanvas(video).finally(() => { this.busy = false; });
        } else {
          this.busy = false;
        }
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * Decode a frame with zxing-wasm (QR *and* 1D barcodes). We only read the
   * centre 70% — that's where the user aims — which cuts the pixel work in half
   * and lets us run at ~14 fps instead of ~11 fps with jsQR's single-symbology,
   * JS-only decoder.
   */
  private async scanWithCanvas(video: HTMLVideoElement): Promise<void> {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const rw = Math.max(1, Math.round(vw * 0.7));
    const rh = Math.max(1, Math.round(vh * 0.7));
    const sx = Math.round((vw - rw) / 2);
    const sy = Math.round((vh - rh) / 2);
    const scale = Math.min(1, 720 / Math.max(rw, rh));
    const cw = Math.max(1, Math.round(rw * scale));
    const ch = Math.max(1, Math.round(rh * scale));

    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, rw, rh, 0, 0, cw, ch);
    const frame = ctx.getImageData(0, 0, cw, ch);

    try {
      const results = await readBarcodes(frame, {
        formats: ['QRCode', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF', 'DataMatrix', 'PDF417', 'Aztec'],
        tryHarder: false,
        maxNumberOfSymbols: 1,
      });
      const hit = results && results[0];
      if (hit && hit.text) this.onScan(hit.text);
    } catch {
      /* a bad frame must never stop the loop */
    }
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
