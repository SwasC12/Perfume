import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild,
  computed, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import QRCode from 'qrcode';
import { ShopAdminService } from '../../shop-admin.service';
import { SoundManager } from '../../sound/sound-manager';
import { Order, Product, ProductSizeKey, PRODUCT_SIZE_LABELS, sizeOptions } from '../../models';
import { IconComponent } from '../../icon.component';
import { onHardwareTrigger } from '../../device';
import { ScanEngine, ScanHit } from './scan-engine';

type ResultKind = 'ok' | 'err' | 'dup';
/** Workflow, like the apps on a rugged handheld. */
export type ScanMode = 'lookup' | 'receive' | 'count' | 'pack';
/** Why the scanner was opened: its own tab, or to pick something for another screen. */
export type ScanPurpose = 'tab' | 'order' | 'product' | 'field';

export interface PickedProduct { product: Product; sizeKey?: ProductSizeKey; }

function readAim(): boolean {
  try { return localStorage.getItem(AIM_KEY) !== '0'; } catch { return true; }
}

interface ScanResult {
  kind: ResultKind;
  code: string;
  /** Symbology, e.g. "QR", "EAN-13". */
  format?: string;
  title: string;
  sub: string;
  at: number;
  order?: Order;
  product?: Product;
  sizeKey?: ProductSizeKey;
  batch?: string;
}

/** A product line in a Receive / Count session. */
interface StockLine {
  key: string;
  product: Product;
  sizeKey?: ProductSizeKey;
  qty: number;
}

/** One order line in Pack mode. */
interface PackLine {
  productId: string;
  sizeKey?: ProductSizeKey;
  name: string;
  size?: string;
  need: number;
  got: number;
}

const REREAD_MS = 1200;
const DUPLICATE_MS = 8000;
const WEDGE_GAP_MS = 45;
/** Trigger mode: like a handheld's beam timer, stop looking after this long. */
const BEAM_MS = 4000;
const AIM_KEY = 'kf.scan.aim';

/** "QR_CODE" / "qr_code" / "QRCode" → "QR"; "EAN_13" → "EAN-13". */
function prettyFormat(f?: string): string {
  const k = String(f || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const map: Record<string, string> = {
    QRCODE: 'QR', QR: 'QR', CODE128: 'Code 128', CODE39: 'Code 39', CODE93: 'Code 93',
    EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E', ITF: 'ITF',
    DATAMATRIX: 'Data Matrix', PDF417: 'PDF417', AZTEC: 'Aztec', CODABAR: 'Codabar',
  };
  return map[k] ?? (k ? k : '');
}
const MODES: { key: ScanMode; label: string; hint: string }[] = [
  { key: 'lookup', label: 'Lookup', hint: 'Scan anything to see what it is' },
  { key: 'receive', label: 'Receive', hint: 'Each scan adds +1 to stock' },
  { key: 'count', label: 'Count', hint: 'Stock take: scan every unit on the shelf' },
  { key: 'pack', label: 'Pack', hint: 'Scan the slip, then every item going in the box' },
];

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, IconComponent],
  templateUrl: './scanner.component.html',
  styleUrl: './scanner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerComponent implements AfterViewInit, OnDestroy {
  private shop = inject(ShopAdminService);
  private zone = inject(NgZone);

  readonly purpose = input<ScanPurpose>('tab');
  /** Product purpose only: keep scanning after each hit (e.g. POS: scan, scan, scan). */
  readonly keepOpen = input(false);
  readonly closed = output<void>();
  readonly orderPicked = output<Order>();
  readonly productPicked = output<PickedProduct>();
  readonly codePicked = output<string>();

  @ViewChild('video') videoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('reticle') reticleRef?: ElementRef<HTMLElement>;

  /** Picklist / aim mode: only read the code inside the window. */
  readonly aimOn = signal(readAim());

  readonly modes = MODES;
  readonly sizeLabels = PRODUCT_SIZE_LABELS;
  readonly native = ScanEngine.isNative();
  readonly state = signal<'starting' | 'live' | 'error'>('starting');
  readonly error = signal<string | null>(null);
  readonly engineLabel = signal('');
  readonly torchOn = signal(false);
  readonly torchAvailable = signal(false);
  readonly continuous = signal(SoundManager.settings.continuousScan);
  readonly armed = signal(true);
  readonly flash = signal<ResultKind | null>(null);
  readonly result = signal<ScanResult | null>(null);
  readonly history = signal<ScanResult[]>([]);
  readonly historyOpen = signal(false);
  readonly busy = signal(false);
  readonly okCount = computed(() => this.history().filter((h) => h.kind === 'ok').length);

  readonly mode = signal<ScanMode>('lookup');
  readonly modeHint = computed(() => MODES.find((m) => m.key === this.mode())?.hint ?? '');
  readonly lines = signal<StockLine[]>([]);
  readonly lineUnits = computed(() => this.lines().reduce((t, l) => t + l.qty, 0));
  readonly packOrder = signal<Order | null>(null);
  readonly pack = signal<PackLine[]>([]);
  readonly packDone = computed(() => this.pack().length > 0 && this.pack().every((l) => l.got >= l.need));
  readonly packProgress = computed(() => {
    const need = this.pack().reduce((t, l) => t + l.need, 0);
    const got = this.pack().reduce((t, l) => t + Math.min(l.got, l.need), 0);
    return { need, got, pct: need ? Math.round((got / need) * 100) : 0 };
  });

  manual = '';
  readonly genOpen = signal(false);
  genType: 'order' | 'batch' | 'product' | 'custom' = 'order';
  genValue = '';
  readonly generated = signal<string | null>(null);
  readonly genError = signal<string | null>(null);

  private engine = new ScanEngine(
    (hit) => this.zone.run(() => this.onHit(hit)),
    () => (this.aimOn() ? this.reticleRef?.nativeElement.getBoundingClientRect() ?? null : null),
  );
  private beamTimer: ReturnType<typeof setTimeout> | undefined;
  private lastFormat = '';
  private lastText = '';
  private lastTextAt = 0;
  private acceptedAt = new Map<string, number>();
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private wedgeBuf = '';
  private wedgeAt = 0;
  private untrigger: (() => void) | null = null;

  ngAfterViewInit(): void {
    void SoundManager.unlock();
    void this.start();
    if (SoundManager.settings.volumeTrigger) {
      void onHardwareTrigger(
        () => this.zone.run(() => this.trigger()),
        () => this.zone.run(() => this.release()),
      ).then((off) => (this.untrigger = off));
    }
  }

  ngOnDestroy(): void {
    void this.engine.stop();
    this.untrigger?.();
    clearTimeout(this.flashTimer);
    clearTimeout(this.beamTimer);
  }

  toggleAim(): void {
    const next = !this.aimOn();
    this.aimOn.set(next);
    try { localStorage.setItem(AIM_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    SoundManager.vibrate('button');
  }

  async start(): Promise<void> {
    this.state.set('starting');
    this.error.set(null);
    try {
      await this.engine.start(this.videoRef?.nativeElement ?? null);
      this.torchAvailable.set(this.engine.torchAvailable);
      this.engineLabel.set(this.engine.kind === 'native' ? 'ML Kit' : this.engine.kind === 'detector' ? 'Fast decode' : 'Web decode');
      this.state.set('live');
    } catch (e: any) {
      await this.engine.stop();
      this.state.set('error');
      this.error.set(
        /denied|NotAllowed/i.test(String(e?.message || e?.name || e))
          ? 'Camera access was blocked. Allow the camera for this app, then tap Retry.'
          : 'Could not start the camera. You can still type or wedge-scan codes below.',
      );
    }
  }

  close(): void {
    void this.engine.stop();
    this.closed.emit();
  }

  async toggleTorch(): Promise<void> {
    const next = !this.torchOn();
    if (await this.engine.setTorch(next)) this.torchOn.set(next);
  }

  toggleMode(): void {
    const next = !this.continuous();
    this.continuous.set(next);
    this.armed.set(true);
    SoundManager.set('continuousScan', next);
  }

  setMode(m: ScanMode): void {
    if (m === this.mode()) return;
    this.mode.set(m);
    this.result.set(null);
    this.lastText = '';
    this.acceptedAt.clear();
    SoundManager.vibrate('button');
  }

  /** On-screen trigger or a volume key press: beam on for one read. */
  trigger(): void {
    this.armed.set(true);
    this.lastText = '';
    SoundManager.vibrate('button');
    clearTimeout(this.beamTimer);
    if (!this.continuous()) this.beamTimer = setTimeout(() => this.armed.set(false), BEAM_MS);
  }

  /** Volume key let go: in trigger mode the beam goes off, like a handheld. */
  release(): void {
    if (this.continuous()) return;
    clearTimeout(this.beamTimer);
    this.armed.set(false);
  }

  // ------------------------------------------------------------ decoding

  private onHit(hit: ScanHit): void {
    const text = String(hit.text || '').trim();
    if (!text) return;
    if (!this.continuous() && !this.armed()) return;
    const now = Date.now();
    if (text === this.lastText && now - this.lastTextAt < REREAD_MS) {
      this.lastTextAt = now;
      return;
    }
    this.lastText = text;
    this.lastTextAt = now;
    this.lastFormat = prettyFormat(hit.format);
    this.process(text);
    this.lastFormat = '';
  }

  /** Every input (camera, keyboard wedge, typed) ends up here. */
  process(code: string): void {
    const purpose = this.purpose();
    if (purpose === 'field') {
      this.emit({ kind: 'ok', code, at: Date.now(), title: code, sub: 'Sent to field' });
      this.finish(() => this.codePicked.emit(code));
      return;
    }
    const mode = purpose === 'tab' ? this.mode() : 'lookup';
    if (mode === 'receive' || mode === 'count') return this.stockScan(code);
    if (mode === 'pack') return this.packScan(code);

    const now = Date.now();
    const seen = this.acceptedAt.get(code);
    if (seen && now - seen < DUPLICATE_MS && purpose === 'tab') {
      const prev = this.history().find((h) => h.code === code && h.kind === 'ok');
      this.emit({ kind: 'dup', code, at: now, title: 'Already scanned', sub: prev ? prev.title : code, order: prev?.order, product: prev?.product, batch: prev?.batch });
      return;
    }

    const r = this.lookup(code);
    if (purpose === 'order' && r.kind === 'ok' && !r.order) {
      this.emit({ ...r, kind: 'err', title: 'Not an order', sub: 'Scan the QR on an order slip' });
      return;
    }
    if (purpose === 'product' && r.kind === 'ok' && !r.product) {
      this.emit({ ...r, kind: 'err', title: 'Not a product', sub: 'Scan a product barcode or label' });
      return;
    }
    if (r.kind === 'ok') this.acceptedAt.set(code, now);
    this.emit(r);
    if (r.kind !== 'ok') return;
    if (purpose === 'order' && r.order) this.finish(() => this.orderPicked.emit(r.order!));
    if (purpose === 'product' && r.product) {
      const picked = { product: r.product, sizeKey: r.sizeKey };
      if (this.keepOpen()) { this.productPicked.emit(picked); this.result.set({ ...r, sub: 'Added to sale · ' + r.sub }); }
      else this.finish(() => this.productPicked.emit(picked));
    }
  }

  /** Let the beep + green flash register, then hand the result back. */
  private finish(fn: () => void): void {
    setTimeout(() => { void this.engine.stop(); fn(); }, 220);
  }

  private parseOrderRef(code: string): string {
    if (/^KF-ORDER:/i.test(code)) return code.slice(9).trim().toUpperCase();
    if (/^KF-[A-Z0-9]{4,}$/i.test(code) && !/^KF-(PRODUCT|BATCH)/i.test(code)) return code.toUpperCase();
    return '';
  }

  /** KF-PRODUCT:<id>[:size50], a printed barcode, or a bare product id. */
  private findProduct(code: string): PickedProduct | null {
    const products = this.shop.products();
    if (/^KF-PRODUCT:/i.test(code)) {
      const [id, size] = code.slice(11).trim().split(':');
      const product = products.find((p) => p.id === id);
      if (!product) return null;
      const sizeKey = (['size30', 'size50', 'size100'] as ProductSizeKey[]).find((k) => k === size || PRODUCT_SIZE_LABELS[k] === size);
      return { product, sizeKey };
    }
    const product = products.find((p) => (p.barcode && p.barcode === code) || p.id === code);
    return product ? { product } : null;
  }

  private sizeFor(p: PickedProduct): ProductSizeKey | undefined {
    if (p.sizeKey) return p.sizeKey;
    const opts = sizeOptions(p.product);
    return opts.length === 1 ? opts[0].key : undefined;
  }

  private lookup(code: string): ScanResult {
    const at = Date.now();
    const ref = this.parseOrderRef(code);
    if (ref) {
      const order = this.shop.orders().find((o) => o.reference === ref || o.id === ref);
      if (order) {
        const items = order.items?.reduce((n, i) => n + i.qty, 0) ?? 0;
        return { kind: 'ok', code, at, order, title: order.reference, sub: `${order.customer?.name || 'Customer'} · ${items} item${items === 1 ? '' : 's'}` };
      }
      return { kind: 'err', code, at, title: 'Order not found', sub: ref + ' isn’t in the loaded orders' };
    }
    if (/^KF-BATCH:/i.test(code)) {
      const batch = code.slice(9).trim();
      return { kind: 'ok', code, at, batch, title: 'Batch ' + batch, sub: 'Batch code' };
    }
    const found = this.findProduct(code);
    if (found) {
      const sizeKey = this.sizeFor(found);
      const stock = this.stockOf(found.product, sizeKey);
      return {
        kind: 'ok', code, at, product: found.product, sizeKey,
        title: found.product.name + (sizeKey ? ' · ' + PRODUCT_SIZE_LABELS[sizeKey] : ''),
        sub: [found.product.category, found.product.gender, stock != null ? stock + ' in stock' : ''].filter(Boolean).join(' · '),
      };
    }
    return { kind: 'err', code, at, title: 'Not recognised', sub: code.length > 48 ? code.slice(0, 48) + '…' : code };
  }

  private emit(r: ScanResult): void {
    if (!r.format && this.lastFormat && r.code) r = { ...r, format: this.lastFormat };
    if (r.kind === 'ok') clearTimeout(this.beamTimer);
    this.result.set(r);
    this.history.update((h) => [r, ...h].slice(0, 200));
    SoundManager.feedback(r.kind === 'ok' ? 'scanSuccess' : r.kind === 'dup' ? 'duplicate' : 'scanError');
    this.flash.set(r.kind);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 380);
    if (!this.continuous() && r.kind === 'ok') this.armed.set(false);
  }

  // ------------------------------------------------- receive / count mode

  stockOf(p: Product, sizeKey?: ProductSizeKey): number | null {
    if (sizeKey && p.sizes?.[sizeKey]) return p.sizes[sizeKey]!.stockQty ?? null;
    return p.stockQty ?? null;
  }

  needsSize(l: StockLine): boolean {
    return !l.sizeKey && sizeOptions(l.product).length > 1;
  }

  sizeChoices(p: Product): { key: ProductSizeKey; label: string }[] {
    return sizeOptions(p).map((o) => ({ key: o.key, label: o.size.size || PRODUCT_SIZE_LABELS[o.key] }));
  }

  private stockScan(code: string): void {
    const found = this.findProduct(code);
    if (!found) {
      this.emit({ kind: 'err', code, at: Date.now(), title: 'Unknown product', sub: code });
      return;
    }
    const sizeKey = this.sizeFor(found);
    const key = found.product.id + '|' + (sizeKey || '');
    let qty = 1;
    this.lines.update((ls) => {
      const ex = ls.find((l) => l.key === key);
      if (ex) { qty = ex.qty + 1; return [{ ...ex, qty }, ...ls.filter((l) => l !== ex)]; }
      return [{ key, product: found.product, sizeKey, qty: 1 }, ...ls];
    });
    const label = found.product.name + (sizeKey ? ' · ' + PRODUCT_SIZE_LABELS[sizeKey] : '');
    this.emit({
      kind: 'ok', code, at: Date.now(), product: found.product, sizeKey, title: label,
      sub: this.mode() === 'receive' ? `+${qty} to receive` : `Counted ${qty}`,
    });
  }

  setLineQty(l: StockLine, qty: number): void {
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    this.lines.update((ls) => (q === 0 && this.mode() === 'receive' ? ls.filter((x) => x.key !== l.key) : ls.map((x) => (x.key === l.key ? { ...x, qty: q } : x))));
  }

  setLineSize(l: StockLine, sizeKey: ProductSizeKey): void {
    const key = l.product.id + '|' + sizeKey;
    this.lines.update((ls) => {
      const rest = ls.filter((x) => x.key !== l.key);
      const ex = rest.find((x) => x.key === key);
      if (ex) return rest.map((x) => (x === ex ? { ...x, qty: x.qty + l.qty } : x));
      return [{ ...l, key, sizeKey }, ...rest];
    });
  }

  clearLines(): void { this.lines.set([]); }

  /** Write the session to stock: Receive adds, Count overwrites. */
  async applyStock(): Promise<void> {
    const lines = this.lines().filter((l) => !this.needsSize(l));
    if (!lines.length || this.busy()) return;
    this.busy.set(true);
    const receive = this.mode() === 'receive';
    const byProduct = new Map<string, StockLine[]>();
    for (const l of lines) byProduct.set(l.product.id, [...(byProduct.get(l.product.id) ?? []), l]);
    let ok = 0;
    let failed = 0;
    for (const [id, ls] of byProduct) {
      const fresh = this.shop.products().find((p) => p.id === id) ?? ls[0].product;
      try {
        const patch: Partial<Product> = {};
        const sized = ls.filter((l) => l.sizeKey && fresh.sizes?.[l.sizeKey!]);
        if (sized.length) {
          const sizes = { ...(fresh.sizes ?? {}) };
          for (const l of sized) {
            const cur = sizes[l.sizeKey!]!;
            const next = receive ? (cur.stockQty ?? 0) + l.qty : l.qty;
            sizes[l.sizeKey!] = { ...cur, stockQty: next, inStock: next > 0 };
          }
          patch.sizes = sizes;
        }
        const plain = ls.filter((l) => !l.sizeKey || !fresh.sizes?.[l.sizeKey]);
        if (plain.length) {
          const add = plain.reduce((t, l) => t + l.qty, 0);
          const next = receive ? (fresh.stockQty ?? 0) + add : add;
          patch.stockQty = next;
          patch.inStock = next > 0;
        }
        await this.shop.updateProduct(id, patch);
        ok++;
      } catch {
        failed++;
      }
    }
    this.busy.set(false);
    if (failed) {
      this.result.set({ kind: 'err', code: '', at: Date.now(), title: 'Some updates failed', sub: `${ok} saved, ${failed} failed. Are you signed in?` });
      SoundManager.feedback('scanError');
    } else {
      this.result.set({ kind: 'ok', code: '', at: Date.now(), title: receive ? 'Stock received' : 'Stock count saved', sub: `${ok} product${ok === 1 ? '' : 's'} updated` });
      SoundManager.feedback('stockReceived');
      this.lines.set([]);
    }
  }

  // ------------------------------------------------------------ pack mode

  private packScan(code: string): void {
    const ref = this.parseOrderRef(code);
    if (ref) {
      const order = this.shop.orders().find((o) => o.reference === ref || o.id === ref);
      if (!order) { this.emit({ kind: 'err', code, at: Date.now(), title: 'Order not found', sub: ref }); return; }
      this.packOrder.set(order);
      this.pack.set((order.items || []).map((i) => ({ productId: i.productId, sizeKey: i.sizeKey, name: i.name, size: i.size, need: i.qty, got: 0 })));
      this.emit({ kind: 'ok', code, at: Date.now(), order, title: 'Packing ' + order.reference, sub: `${order.customer?.name || ''} · scan each item` });
      return;
    }
    if (!this.packOrder()) {
      this.emit({ kind: 'err', code, at: Date.now(), title: 'Scan the order slip first', sub: 'Then scan every item going in the box' });
      return;
    }
    const found = this.findProduct(code);
    if (!found) { this.emit({ kind: 'err', code, at: Date.now(), title: 'Unknown product', sub: code }); return; }
    const lines = this.pack();
    const match = (l: PackLine) => l.productId === found.product.id && (!found.sizeKey || !l.sizeKey || l.sizeKey === found.sizeKey);
    const open = lines.find((l) => match(l) && l.got < l.need);
    if (!open) {
      const any = lines.find(match);
      this.emit(any
        ? { kind: 'dup', code, at: Date.now(), title: 'Already packed', sub: `${any.name}: ${any.need} of ${any.need}` }
        : { kind: 'err', code, at: Date.now(), title: 'Not in this order', sub: found.product.name + ', put it back' });
      return;
    }
    this.pack.update((ls) => ls.map((l) => (l === open ? { ...l, got: l.got + 1 } : l)));
    this.emit({ kind: 'ok', code, at: Date.now(), product: found.product, title: open.name + (open.size ? ' · ' + open.size : ''), sub: `${open.got + 1} of ${open.need}` });
    if (this.packDone()) setTimeout(() => SoundManager.feedback('orderCompleted'), 160);
  }

  async markPacked(): Promise<void> {
    const o = this.packOrder();
    if (!o || this.busy()) return;
    this.busy.set(true);
    try {
      await this.shop.setOrderStage(o.id, 'packaged');
      this.result.set({ kind: 'ok', code: '', at: Date.now(), title: o.reference + ' packed', sub: 'Stage set to packaged. Scan the next slip.' });
      SoundManager.feedback('orderDispatched');
      this.packOrder.set(null);
      this.pack.set([]);
    } catch {
      this.result.set({ kind: 'err', code: '', at: Date.now(), title: 'Update failed', sub: 'Could not mark ' + o.reference + ' packed' });
      SoundManager.feedback('scanError');
    } finally {
      this.busy.set(false);
    }
  }

  resetPack(): void { this.packOrder.set(null); this.pack.set([]); this.result.set(null); }

  // ------------------------------------------------------- manual / wedge

  submitManual(): void {
    const v = this.manual.trim();
    if (!v) return;
    this.manual = '';
    this.process(v);
  }

  /** Hardware scanners "type" fast and end with Enter: catch that anywhere. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    if (now - this.wedgeAt > WEDGE_GAP_MS * 3) this.wedgeBuf = '';
    this.wedgeAt = now;
    if (e.key === 'Enter') {
      if (this.wedgeBuf.length >= 3) { e.preventDefault(); this.process(this.wedgeBuf); }
      this.wedgeBuf = '';
    } else if (e.key.length === 1) {
      this.wedgeBuf += e.key;
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  // -------------------------------------------------------------- actions

  open(r: ScanResult): void {
    if (r.order) { void this.engine.stop(); this.orderPicked.emit(r.order); }
  }

  canShip(o: Order | undefined): boolean {
    return !!o && (o.status === 'paid' || o.status === 'fulfilled');
  }

  async markShipped(r: ScanResult): Promise<void> {
    const o = r.order;
    if (!o) return;
    this.busy.set(true);
    try {
      await this.shop.setOrderStatus(o, 'shipped');
      this.result.set({ ...r, order: { ...o, status: 'shipped' }, sub: 'Marked shipped · ' + r.sub });
      SoundManager.feedback('orderDispatched');
    } catch {
      this.result.set({ ...r, kind: 'err', title: 'Update failed', sub: 'Could not mark ' + o.reference + ' shipped' });
      SoundManager.feedback('scanError');
    } finally {
      this.busy.set(false);
    }
  }

  clearHistory(): void {
    this.history.set([]);
    this.result.set(null);
    this.acceptedAt.clear();
    this.lastText = '';
  }

  /** Export this session's scans as CSV (like a handheld's batch upload). */
  exportCsv(): void {
    const rows = [['time', 'result', 'code', 'item', 'detail']];
    for (const h of [...this.history()].reverse()) {
      rows.push([new Date(h.at).toISOString(), h.kind, h.code, h.title, h.sub]);
    }
    const csv = rows.map((r) => r.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kaua-scans-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
      this.generated.set(await QRCode.toDataURL(payload, { margin: 1, width: 512, color: { dark: '#0B1F3A', light: '#ffffff' } }));
    } catch {
      this.genError.set('Could not generate the QR code.');
    }
  }
}
