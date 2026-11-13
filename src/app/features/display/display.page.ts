import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router } from '@angular/router';
import { CustomerDisplayService, DisplayLine, DisplayState } from '../../core/customer-display.service';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { placeholderFor } from '../../product-image';
import { sizeOptions } from '../../models';
import { LoaderComponent } from '../../shared/loader.component';
import type { BottleStage } from '../lab/bottle3d';

const PAID_MS = 8000;
const SHOWCASE_MS = 6000;

/**
 * Customer-facing display. Put a phone/tablet on a stand facing the customer,
 * open More → Customer display, and leave it. It mirrors the till live:
 * each scent you add rises in as a spinning 3D 100ml bottle with its name and
 * price; the total updates; a finished sale gets "Thank you" + confetti.
 * When the till is idle it shows off in-stock scents one by one.
 *
 * Leave: tap the top-left corner 3 times quickly (or Android back).
 */
@Component({
  standalone: true,
  imports: [CurrencyPipe, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cd" [class.paid]="mode() === 'paid'">
      <button class="exit" (click)="exitTap()" aria-label="Tap three times to leave"></button>
      <header class="brand">
        <span class="logo">K</span>
        <span>Kauā Fragrances</span>
      </header>

      <div #stage class="stage">
        @if (!ready()) { <kf-loader class="ld" label="Warming up…" /> }
      </div>

      <section class="info">
        @switch (mode()) {
          @case ('paid') {
            <h1 class="big">Thank you!</h1>
            <p class="sub">Paid {{ state()?.total | currency:'ZAR':'symbol-narrow':'1.2-2' }}{{ state()?.method === 'cash' && state()?.change ? ' · change ' + (state()!.change | currency:'ZAR':'symbol-narrow':'1.2-2') : '' }}</p>
            <p class="hint">Enjoy your fragrance ✨</p>
          }
          @case ('cart') {
            @if (focus(); as f) {
              <p class="eyebrow">{{ f.size || '' }}</p>
              <h1 class="name">{{ short(f.name) }}</h1>
              <p class="price">{{ f.price | currency:'ZAR':'symbol-narrow':'1.0-2' }}@if (f.qty > 1) { <span> × {{ f.qty }}</span> }</p>
            }
            <div class="cart">
              @for (l of state()?.lines ?? []; track l.productId + (l.size || '')) {
                <div class="row"><span class="nm">{{ l.qty }} × {{ short(l.name) }}</span><span>{{ l.price * l.qty | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
              }
              @if ((state()?.discount ?? 0) > 0) {
                <div class="row disc"><span>Discount</span><span>−{{ state()!.discount | currency:'ZAR':'symbol-narrow':'1.0-2' }}</span></div>
              }
              <div class="row total"><span>Total</span><span>{{ state()?.total | currency:'ZAR':'symbol-narrow':'1.2-2' }}</span></div>
            </div>
          }
          @default {
            @if (show(); as s) {
              <p class="eyebrow">Inspired by</p>
              <h1 class="name">{{ short(s.name) }}</h1>
              <p class="price">from {{ s.price | currency:'ZAR':'symbol-narrow':'1.0-0' }}</p>
            } @else {
              <h1 class="name">Welcome</h1>
            }
            <p class="hint">Ask us to try any scent</p>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 200; display: block; }
    .cd {
      position: absolute; inset: 0; display: grid; color: #fff; overflow: hidden;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: radial-gradient(ellipse at 50% 35%, #1d3f6e 0%, #0b1f3a 65%, #06142a 100%);
      padding: calc(var(--safe-t) + 12px) 20px calc(var(--safe-b) + 18px);
    }
    .exit { position: absolute; top: 0; left: 0; width: 72px; height: 72px; background: none; border: 0; z-index: 5; }
    .brand { display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: 13px; color: #c9d6e6; }
    .logo { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #e0a93b; color: #0b1f3a; font-weight: 800; letter-spacing: 0; }
    .stage { position: relative; min-height: 0; }
    .stage ::ng-deep canvas { width: 100% !important; height: 100% !important; display: block; }
    .ld { position: absolute; inset: 0; color: #fff; }
    .info { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 30%; justify-content: flex-start; }
    .eyebrow { color: #e0a93b; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: 13px; min-height: 1em; }
    .name { font-size: clamp(26px, 7vw, 54px); font-weight: 800; letter-spacing: -.02em; line-height: 1.05; animation: rise .45s cubic-bezier(.2,.8,.2,1); }
    .price { font-size: clamp(20px, 5vw, 34px); font-weight: 700; color: #f3d9a0; }
    .price span { color: #c9d6e6; font-weight: 600; }
    .big { font-size: clamp(38px, 11vw, 80px); font-weight: 800; animation: rise .45s cubic-bezier(.2,.8,.2,1); }
    .sub { font-size: clamp(18px, 4.5vw, 28px); color: #f3d9a0; font-weight: 700; }
    .hint { color: #93a7c1; font-size: 15px; margin-top: 6px; }
    .cart { width: min(520px, 100%); margin-top: 10px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 10px 14px; font-size: 15px; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-variant-numeric: tabular-nums; }
    .row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row.disc { color: #8fe0b8; }
    .row.total { border-top: 1px solid rgba(255,255,255,.15); margin-top: 6px; padding-top: 8px; font-size: 20px; font-weight: 800; }
    @keyframes rise { from { transform: translateY(14px); opacity: 0; } }
    /* Landscape tablets: bottle left, details right. */
    @media (min-aspect-ratio: 5/4) {
      .cd { grid-template-columns: 1.1fr 1fr; grid-template-rows: auto minmax(0, 1fr); }
      .brand { grid-column: 1 / -1; }
      .info { justify-content: center; min-height: 0; }
    }
  `],
})
export class DisplayPage implements AfterViewInit, OnDestroy {
  private display = inject(CustomerDisplayService);
  private shop = inject(ShopAdminService);
  private router = inject(Router);
  private ui = inject(UiService);
  private zone = inject(NgZone);
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;

  readonly state = signal<DisplayState | null>(null);
  readonly ready = signal(false);
  readonly show = signal<{ name: string; price: number } | null>(null);
  private readonly now = signal(Date.now());
  readonly mode = computed<'idle' | 'cart' | 'paid'>(() => {
    const s = this.state();
    if (!s) return 'idle';
    if (s.state === 'paid') return this.now() - s.updatedAt < PAID_MS ? 'paid' : 'idle';
    return s.state === 'cart' && s.lines.length ? 'cart' : 'idle';
  });
  readonly focus = computed<DisplayLine | null>(() => this.state()?.focus ?? this.state()?.lines?.at(-1) ?? null);

  private stage: BottleStage | null = null;
  private unwatch: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | undefined;
  private showcaseIdx = 0;
  private shownKey = '';
  private lastMode: string = '';
  private wakeLock: any = null;
  private taps: number[] = [];
  private unregisterBack: (() => void) | null = null;

  async ngAfterViewInit(): Promise<void> {
    void this.keepAwake();
    document.addEventListener('visibilitychange', this.onVisible);
    this.unregisterBack = this.ui.pushOverlay(() => this.leave());
    const { BottleStage } = await import('../lab/bottle3d');
    this.zone.runOutsideAngular(() => { this.stage = new BottleStage(this.stageRef.nativeElement); });
    this.ready.set(true);
    this.unwatch = this.display.watch((s) => this.zone.run(() => { this.state.set(s); this.react(); }));
    // Drives the "paid" timeout and the idle showcase.
    this.tick = setInterval(() => this.zone.run(() => { this.now.set(Date.now()); this.react(); }), 1000);
    this.react();
  }


  /** Decide what the 3D stage should show for the current state. */
  private react(): void {
    if (!this.stage) return;
    const mode = this.mode();
    if (mode === 'paid') {
      if (this.lastMode !== 'paid') this.stage.celebrate();
    } else if (mode === 'cart') {
      const f = this.focus();
      if (f) {
        const key = f.productId + '|' + (f.size || '');
        if (key !== this.shownKey) {
          this.stage.show({ art: placeholderFor(f.gender, '100ml'), name: f.name });
          this.shownKey = key;
        } else if (this.lastMode === 'cart' && this.lastQty < f.qty) {
          this.stage.bounce();
        }
        this.lastQty = f.qty;
      }
    } else if (this.lastMode !== 'idle' || Date.now() - this.lastShowcase > SHOWCASE_MS) {
      this.nextShowcase();
    }
    this.lastMode = mode;
  }
  private lastQty = 0;
  private lastShowcase = 0;

  /** Idle: cycle through in-stock scents. */
  private nextShowcase(): void {
    const list = this.shop.products().filter((p) => p.active !== false && sizeOptions(p).some((o) => o.size.inStock !== false && (o.size.stockQty == null || Number(o.size.stockQty) > 0)));
    this.lastShowcase = Date.now();
    if (!list.length || !this.stage) { this.show.set(null); return; }
    const p = list[this.showcaseIdx++ % list.length];
    const from = Math.min(...sizeOptions(p).map((o) => Number(o.size.salePrice) > 0 && Number(o.size.salePrice) < Number(o.size.price) ? Number(o.size.salePrice) : Number(o.size.price)));
    this.stage.show({ art: placeholderFor(p.gender, '100ml'), name: p.name });
    this.shownKey = '';
    this.show.set({ name: p.name, price: Number.isFinite(from) ? from : 0 });
  }

  short(name: string): string { return String(name || '').replace(/^inspired\s+by\s+/i, ''); }

  /** Three quick taps in the top-left corner leave the display. */
  exitTap(): void {
    const t = Date.now();
    this.taps = [...this.taps.filter((x) => t - x < 1200), t];
    if (this.taps.length >= 3) this.leave();
  }

  private leave(): void {
    void this.router.navigateByUrl('/pos', { replaceUrl: true });
  }

  private async keepAwake(): Promise<void> {
    try { this.wakeLock = await (navigator as any).wakeLock?.request('screen'); } catch { /* not supported */ }
  }
  private onVisible = () => { if (document.visibilityState === 'visible') void this.keepAwake(); };

  ngOnDestroy(): void {
    this.unwatch?.();
    clearInterval(this.tick);
    this.stage?.dispose();
    this.unregisterBack?.();
    document.removeEventListener('visibilitychange', this.onVisible);
    try { this.wakeLock?.release(); } catch { /* ignore */ }
  }
}
