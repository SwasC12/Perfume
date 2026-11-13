import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { Product, sizeOptions } from '../../models';
import { isCustomImage, placeholderFor } from '../../product-image';
import { IconComponent } from '../../icon.component';
import { LoaderComponent } from '../../shared/loader.component';
import type { BottleStage } from './bottle3d';

/** One bottle up close: pick a scent, drag to spin, swipe/arrows for the next. */
@Component({
  selector: 'kf-showcase',
  standalone: true,
  imports: [CurrencyPipe, RouterLink, IconComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc">
      <div #stage class="stage">
        @if (!ready()) { <kf-loader class="ld" label="Polishing the glass…" /> }
        <button class="nav prev" (click)="step(-1)" aria-label="Previous scent"><app-icon name="chevron-left" [size]="26" /></button>
        <button class="nav next" (click)="step(1)" aria-label="Next scent"><app-icon name="chevron-right" [size]="26" /></button>
      </div>
      @if (current(); as p) {
        <div class="info">
          <div class="li-main">
            <span class="li-title">{{ short(p.name) }}</span>
            <span class="li-sub">{{ p.gender || 'Unisex' }} · {{ stock(p) }} in stock · from {{ from(p) | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span>
          </div>
          <a class="btn btn-sm btn-soft" [routerLink]="['/products', p.id]">Edit</a>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .sc { display: flex; flex-direction: column; height: 100%; }
    .stage { position: relative; flex: 1; min-height: 0; background: radial-gradient(ellipse at 50% 35%, #1d3f6e 0%, #0b1f3a 70%); touch-action: none; }
    .stage ::ng-deep canvas { display: block; width: 100% !important; height: 100% !important; }
    .ld { position: absolute; inset: 0; color: #fff; }
    .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border-radius: 50%; border: 0; background: rgba(255,255,255,.12); color: #fff; display: grid; place-items: center; cursor: pointer; z-index: 2; }
    .nav:active { transform: translateY(-50%) scale(.92); }
    .prev { left: 10px; } .next { right: 10px; }
    .info { display: flex; align-items: center; gap: 10px; padding: 12px var(--page-pad); background: var(--surface); border-top: 1px solid var(--line); }
  `],
})
export class ShowcaseComponent implements AfterViewInit, OnDestroy {
  private shop = inject(ShopAdminService);
  private zone = inject(NgZone);
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;

  readonly ready = signal(false);
  readonly index = signal(0);
  readonly list = computed(() => this.shop.products().filter((p) => p.active !== false));
  readonly current = computed<Product | null>(() => {
    const l = this.list();
    return l.length ? l[((this.index() % l.length) + l.length) % l.length] : null;
  });

  private stage: BottleStage | null = null;
  private oilFor: (g?: string, out?: boolean) => number = () => 0xd99a2b;
  private swipeX: number | null = null;

  async ngAfterViewInit(): Promise<void> {
    const m = await import('./bottle3d');
    this.oilFor = m.oilFor;
    this.zone.runOutsideAngular(() => {
      this.stage = new m.BottleStage(this.stageRef.nativeElement, { controls: true });
      const el = this.stage.renderer.domElement;
      // Two-finger-free swipe: a fast horizontal flick changes scent.
      el.addEventListener('pointerdown', (e) => (this.swipeX = e.clientX));
      el.addEventListener('pointerup', (e) => {
        if (this.swipeX == null) return;
        const dx = e.clientX - this.swipeX;
        this.swipeX = null;
        if (Math.abs(dx) > 120) this.zone.run(() => this.step(dx < 0 ? 1 : -1));
      });
    });
    this.ready.set(true);
    this.render();
  }

  step(d: number): void {
    this.index.update((i) => i + d);
    this.render();
  }

  private render(): void {
    const p = this.current();
    if (!p || !this.stage) return;
    const own100 = p.sizes?.size100?.imageUrl;
    const label = isCustomImage(own100) ? own100! : isCustomImage(p.imageUrl) ? p.imageUrl! : placeholderFor(p.gender, '100ml');
    const s = this.stock(p);
    this.stage.spinSpeed = 0.6;
    this.stage.show({ label, oil: this.oilFor(p.gender, s <= 0), fill: s <= 0 ? 0.06 : 0.85 });
  }

  stock(p: Product): number {
    const o = sizeOptions(p);
    return o.length ? o.reduce((t, x) => t + (Number(x.size.stockQty) || 0), 0) : Number(p.stockQty) || 0;
  }
  from(p: Product): number {
    const o = sizeOptions(p);
    return o.length ? Math.min(...o.map((x) => Number(x.size.price) || 0)) : Number(p.price) || 0;
  }
  short(n: string): string { return n.replace(/^inspired\s+by\s+/i, ''); }

  ngOnDestroy(): void { this.stage?.dispose(); }
}
