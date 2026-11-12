import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WishlistItem } from '../../models';
import { OilsService } from '../../oils.service';
import { WishlistService } from '../../wishlist.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { hideBrokenImg, numOrNull } from './personal-util';

interface WishForm {
  name: string;
  price: number | null;
  imageUrl: string;
  permalink: string;
  notes: string;
}

const emptyForm = (): WishForm => ({ name: '', price: null, imageUrl: '', permalink: '', notes: '' });

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, CurrencyPipe, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">Wishlist</h1>
          <p class="page-sub">{{ svc.items().length }} {{ svc.items().length === 1 ? 'fragrance' : 'fragrances' }} you want</p>
        </div>
        <div class="page-actions">
          <a class="btn" routerLink="/rumi"><app-icon name="bag" [size]="16" /> Browse Rumi</a>
          <button class="btn btn-primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Add</button>
        </div>
      </header>

      @if (svc.items().length) {
        <div class="toolbar">
          <div class="search">
            <app-icon name="search" [size]="16" />
            <input type="search" placeholder="Search wishlist…" [value]="search()" (input)="search.set($any($event.target).value)" />
          </div>
        </div>
      }

      @if (filtered().length === 0) {
        <div class="card">
          <div class="empty">
            <div class="empty-icon"><app-icon name="star" [size]="26" /></div>
            <h3>{{ search() ? 'No matches' : 'Wishlist is empty' }}</h3>
            <p>Browse <strong>Buy from Rumi</strong> and tap the star to save fragrances you want. When you get one, move it to My oils.</p>
            @if (!search()) {
              <a class="btn btn-primary" routerLink="/rumi">Browse Rumi <app-icon name="arrow-right" [size]="15" /></a>
            }
          </div>
        </div>
      } @else {
        <div class="list">
          @for (i of filtered(); track i.id) {
            <div class="list-item">
              @if (i.imageUrl) {
                <img class="thumb lg" [src]="i.imageUrl" [alt]="i.name" width="64" height="64" loading="lazy" decoding="async" (error)="onImgError($event)" />
              } @else {
                <span class="thumb lg ph"><app-icon name="star" [size]="24" /></span>
              }
              <button type="button" class="li-main as-btn" (click)="openEdit(i)">
                <span class="li-title"><span class="ellipsis">{{ i.name }}</span></span>
                <span class="li-sub">
                  @if (i.price != null) { from <strong>{{ i.price | currency:'ZAR':'symbol-narrow':'1.0-2' }}</strong> } @else { No price }
                </span>
                @if (i.notes) { <span class="li-sub">{{ i.notes }}</span> }
              </button>
              <div class="acts">
                <button type="button" class="btn btn-ok btn-sm" (click)="gotIt(i)" title="I got it — move to My oils">
                  <app-icon name="check" [size]="15" /> Got it
                </button>
                @if (i.permalink) {
                  <a class="btn btn-ghost btn-icon btn-sm" [href]="i.permalink" target="_blank" rel="noopener" title="Open on Rumi" aria-label="Open on Rumi"><app-icon name="link" [size]="16" /></a>
                }
                <button type="button" class="btn btn-ghost btn-icon btn-sm hide-phone" (click)="remove(i)" title="Remove" aria-label="Remove"><app-icon name="trash" [size]="16" /></button>
              </div>
            </div>
          }
        </div>
      }
    </div>

    @if (sheetOpen()) {
      <kf-sheet [title]="editingId ? 'Edit wishlist item' : 'Add to wishlist'" (closed)="sheetOpen.set(false)">
        <form id="wish-form" class="form" (ngSubmit)="save()">
          <div class="field">
            <label for="w-name">Name</label>
            <input id="w-name" type="text" name="wname" [(ngModel)]="form.name" required autocomplete="off" />
          </div>
          <div class="field">
            <label for="w-price">Price (R)</label>
            <input id="w-price" type="number" min="0" inputmode="decimal" name="wprice" [(ngModel)]="form.price" />
          </div>
          <div class="field">
            <label for="w-img">Image URL</label>
            <input id="w-img" type="url" name="wimg" [(ngModel)]="form.imageUrl" placeholder="https://…" />
          </div>
          <div class="field">
            <label for="w-link">Product link</label>
            <input id="w-link" type="url" name="wlink" [(ngModel)]="form.permalink" placeholder="https://rumifragrances.co.za/…" />
          </div>
          <div class="field">
            <label for="w-notes">Notes</label>
            <textarea id="w-notes" rows="2" name="wnotes" [(ngModel)]="form.notes"></textarea>
          </div>
          @if (editingItem(); as cur) {
            <button type="button" class="btn btn-danger" (click)="remove(cur)"><app-icon name="trash" [size]="16" /> Remove from wishlist</button>
          }
        </form>
        <ng-container sheet-actions>
          <button type="button" class="btn" (click)="sheetOpen.set(false)">Cancel</button>
          <button type="submit" form="wish-form" class="btn btn-primary" [disabled]="!form.name.trim()">Save</button>
        </ng-container>
      </kf-sheet>
    }
  `,
  styles: [`
    .ph { display: grid; place-items: center; color: var(--primary); background: var(--primary-soft); }
    .as-btn { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .acts { display: flex; align-items: center; gap: 4px; flex: none; }
    form .btn-danger { align-self: flex-start; }
  `],
})
export class WishlistPage {
  readonly svc = inject(WishlistService);
  private oils = inject(OilsService);
  private ui = inject(UiService);
  private router = inject(Router);

  readonly search = signal('');
  readonly sheetOpen = signal(false);
  readonly editingItem = signal<WishlistItem | null>(null);

  editingId: string | null = null;
  form: WishForm = emptyForm();

  readonly filtered = computed<WishlistItem[]>(() => {
    const q = this.search().trim().toLowerCase();
    const list = this.svc.sorted();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  });

  readonly onImgError = hideBrokenImg;

  openAdd(): void {
    this.editingId = null;
    this.editingItem.set(null);
    this.form = emptyForm();
    this.sheetOpen.set(true);
  }

  openEdit(i: WishlistItem): void {
    this.editingId = i.id;
    this.editingItem.set(i);
    this.form = {
      name: i.name,
      price: i.price,
      imageUrl: i.imageUrl ?? '',
      permalink: i.permalink ?? '',
      notes: i.notes ?? '',
    };
    this.sheetOpen.set(true);
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) return;
    const payload = {
      name,
      price: numOrNull(this.form.price),
      imageUrl: this.form.imageUrl.trim() || undefined,
      permalink: this.form.permalink.trim() || undefined,
      notes: this.form.notes.trim() || undefined,
    };
    if (this.editingId) {
      this.svc.update(this.editingId, payload);
      this.ui.toast('Wishlist item updated', 'ok');
    } else {
      this.svc.add(payload);
      this.ui.toast('Added to wishlist', 'ok');
    }
    this.sheetOpen.set(false);
  }

  async remove(i: WishlistItem): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Remove from wishlist',
      message: `Remove "${i.name}" from your wishlist?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    this.svc.remove(i.id);
    this.sheetOpen.set(false);
    this.ui.toast('Removed from wishlist', 'ok');
  }

  /** "Got it" — add it to My oils and drop it from the wishlist. */
  gotIt(i: WishlistItem): void {
    this.oils.add({
      name: i.name,
      imageUrl: i.imageUrl,
      amountMl: null,
      capacityMl: null,
      lowThresholdMl: null,
      notes: i.permalink ? `From Rumi: ${i.permalink}` : undefined,
    });
    this.svc.remove(i.id);
    this.ui.toast('Got it! Moved to My oils', 'ok');
    void this.router.navigateByUrl('/oils');
  }
}
