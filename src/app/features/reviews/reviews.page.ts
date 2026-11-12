import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { Review } from '../../models';

@Component({
  standalone: true,
  imports: [IconComponent, DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page narrow">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">Reviews</h1>
          <p class="page-sub">Approved reviews show on the shop and count toward the star rating.</p>
        </div>
      </header>

      <div class="seg">
        <button type="button" [class.on]="view() === 'pending'" (click)="setView('pending')">
          Pending @if (pending().length) { <span class="badge alert">{{ pending().length }}</span> }
        </button>
        <button type="button" [class.on]="view() === 'approved'" (click)="setView('approved')">
          Approved <span class="badge">{{ approved().length }}</span>
        </button>
      </div>

      @if (!list().length) {
        <div class="empty">
          <div class="empty-icon"><app-icon name="star" [size]="24" /></div>
          <h3>{{ view() === 'pending' ? 'No reviews waiting' : 'No approved reviews yet' }}</h3>
          <p>{{ view() === 'pending' ? 'New reviews from shoppers land here first.' : 'Approve pending reviews to show them on the shop.' }}</p>
        </div>
      } @else {
        <div class="list">
          @for (r of visible(); track r.id) {
            <div class="list-item rv">
              <div class="li-main">
                <span class="stars" [attr.aria-label]="r.rating + ' out of 5 stars'">
                  @for (n of stars; track n) { <app-icon name="star" [size]="14" [filled]="n <= r.rating" [class.on]="n <= r.rating" /> }
                </span>
                <span class="li-title">{{ r.name }}</span>
                <span class="li-sub">
                  <a [routerLink]="['/products', r.productId]">{{ productName(r.productId) }}</a> · {{ r.createdAt | date:'d MMM y' }}
                </span>
                @if (r.text) { <p class="rv-text">{{ r.text }}</p> }
              </div>
              <div class="rv-actions">
                @if (!r.approved) {
                  <button type="button" class="btn btn-sm btn-ok" (click)="approve(r)" [disabled]="busy() === r.id">
                    <app-icon name="check" [size]="14" /> Approve
                  </button>
                }
                <button type="button" class="btn btn-sm btn-ghost btn-icon" (click)="remove(r)" [disabled]="busy() === r.id" aria-label="Delete review">
                  <app-icon name="trash" [size]="16" />
                </button>
              </div>
            </div>
          }
        </div>
        @if (list().length > visible().length) {
          <button type="button" class="btn btn-block" (click)="limit.set(limit() + 100)">Show more ({{ list().length - visible().length }} left)</button>
        }
      }
    </div>
  `,
  styles: [`
    .rv { align-items: flex-start; }
    .rv .li-sub a { color: inherit; text-decoration: underline; text-decoration-color: var(--line); }
    .stars { display: flex; gap: 2px; color: var(--line); }
    .stars .on { color: #F59E0B; }
    .rv-text { font-size: 14px; color: var(--ink-2); margin-top: 4px; white-space: pre-line; overflow-wrap: anywhere; }
    .rv-actions { display: flex; gap: 6px; align-items: center; flex: none; }
    .seg .badge { margin-left: 6px; }
  `],
})
export class ReviewsPage {
  private readonly shop = inject(ShopAdminService);
  private readonly ui = inject(UiService);

  readonly view = signal<'pending' | 'approved'>('pending');
  readonly busy = signal<string | null>(null);
  readonly limit = signal(100);
  readonly stars = [1, 2, 3, 4, 5];

  readonly pending = computed(() => this.shop.reviews().filter((r) => !r.approved));
  readonly approved = computed(() => this.shop.reviews().filter((r) => r.approved));
  readonly list = computed(() => (this.view() === 'pending' ? this.pending() : this.approved()));
  readonly visible = computed(() => this.list().slice(0, this.limit()));
  private readonly names = computed(() => new Map(this.shop.products().map((p) => [p.id, p.name])));

  productName(id: string): string { return this.names().get(id) ?? 'Unknown product'; }

  setView(v: 'pending' | 'approved'): void { this.view.set(v); this.limit.set(100); }

  async approve(r: Review): Promise<void> {
    this.busy.set(r.id);
    try { await this.shop.approveReview(r); this.ui.toast('Review approved', 'ok'); }
    catch { this.ui.toast('Approve failed — signed in?', 'err'); }
    finally { this.busy.set(null); }
  }

  async remove(r: Review): Promise<void> {
    if (!(await this.ui.confirm({
      title: 'Delete review?',
      message: `Delete this review by ${r.name}?`,
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    this.busy.set(r.id);
    try { await this.shop.deleteReview(r); this.ui.toast('Review deleted', 'ok'); }
    catch { this.ui.toast('Delete failed', 'err'); }
    finally { this.busy.set(null); }
  }
}
