import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ShopAdminService } from '../../shop-admin.service';
import { IconComponent } from '../../icon.component';
import { Referral } from '../../models';
import { isSold } from '../orders/order-util';

/** Paid referrals needed for one free 30 ml. */
const GOAL = 3;

@Component({
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="page">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Referrals</h1>
      <p class="page-sub">{{ shop.referrals().length }} codes · {{ giftsReady() }} free gift{{ giftsReady() === 1 ? '' : 's' }} ready</p>
    </div>
  </header>

  <div class="notice">
    <app-icon name="star" [size]="18" />
    <span>Customers get a code after their first paid order. {{ goal }} paid referrals = one free 30 ml, added automatically to their next order.</span>
  </div>

  @if (shop.referrals().length === 0) {
    <div class="card">
      <div class="empty">
        <span class="empty-icon"><app-icon name="user" [size]="24" /></span>
        <h3>No referral codes yet</h3>
        <p>They appear here as soon as a customer with a paid order opens their account page.</p>
      </div>
    </div>
  } @else {
    <div class="grid-3">
      <div class="card stat"><span class="stat-label">Codes</span><span class="stat-value">{{ shop.referrals().length }}</span></div>
      <div class="card stat"><span class="stat-label">Total referred</span><span class="stat-value">{{ totalReferred() }}</span></div>
      <div class="card stat"><span class="stat-label">Gifts ready</span><span class="stat-value">{{ giftsReady() }}</span></div>
    </div>

    <div class="toolbar">
      <div class="search">
        <app-icon name="search" [size]="16" />
        <input type="search" placeholder="Search code, name, email…" aria-label="Search referrals"
               [value]="search()" (input)="search.set($any($event.target).value)" />
      </div>
    </div>

    <div class="list">
      @for (r of rows(); track r.id) {
        <div class="list-item">
          <span class="avatar"><app-icon name="star" [size]="16" /></span>
          <div class="li-main">
            <span class="li-title">
              <span class="mono">{{ r.code }}</span>
              @if (r.rewards > 0) { <span class="pill ok">{{ r.rewards }} free 30 ml</span> }
            </span>
            <span class="li-sub">{{ r.name || r.email || '—' }}@if (r.name && r.email) { · {{ r.email }}}</span>
            <div class="progress">
              <div class="bar" [class.ok]="r.count >= goal"><i [style.width.%]="progress(r)"></i></div>
              <span class="tiny muted">{{ r.count }} / {{ goal }}</span>
            </div>
          </div>
          <div class="li-end">
            <span class="num">{{ r.lifetime }} referred</span>
            <span class="tiny muted">{{ r.uses }} order{{ r.uses === 1 ? '' : 's' }} with it</span>
          </div>
        </div>
      } @empty {
        <div class="list-empty">Nothing matches your search.</div>
      }
    </div>
  }
</div>
  `,
  styles: [`
    .progress { display: flex; align-items: center; gap: 8px; margin-top: 4px; max-width: 220px; }
    .progress .bar { flex: 1; }
  `],
})
export class ReferralsPage {
  readonly shop = inject(ShopAdminService);
  readonly goal = GOAL;
  readonly search = signal('');

  /** How many paid orders were placed with each referral code. */
  private readonly usesByCode = computed(() => {
    const m = new Map<string, number>();
    for (const o of this.shop.orders()) {
      if (o.referralCode && isSold(o)) m.set(o.referralCode, (m.get(o.referralCode) || 0) + 1);
    }
    return m;
  });

  readonly rows = computed(() => {
    const q = this.search().trim().toLowerCase();
    const uses = this.usesByCode();
    return this.shop.referrals()
      .filter((r) => !q || [r.code, r.name, r.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .map((r) => ({ ...r, uses: uses.get(r.code) || 0 }))
      .sort((a, b) => (b.rewards - a.rewards) || (b.lifetime - a.lifetime) || a.code.localeCompare(b.code));
  });

  readonly giftsReady = computed(() => this.shop.referrals().reduce((s, r) => s + (r.rewards || 0), 0));
  readonly totalReferred = computed(() => this.shop.referrals().reduce((s, r) => s + (r.lifetime || 0), 0));

  progress(r: Referral): number {
    return Math.min(100, Math.round(((r.count || 0) / GOAL) * 100));
  }
}
