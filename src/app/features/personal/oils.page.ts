import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Oil } from '../../models';
import { OilsService } from '../../oils.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { SheetComponent } from '../../shared/sheet.component';
import { hideBrokenImg, numOrNull } from './personal-util';

interface OilForm {
  name: string;
  imageUrl: string;
  amountMl: number | null;
  capacityMl: number | null;
  lowThresholdMl: number | null;
  notes: string;
}

const emptyForm = (): OilForm => ({ name: '', imageUrl: '', amountMl: null, capacityMl: null, lowThresholdMl: null, notes: '' });

@Component({
  standalone: true,
  imports: [FormsModule, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">My oils</h1>
          <p class="page-sub">
            {{ svc.oils().length }} {{ svc.oils().length === 1 ? 'oil' : 'oils' }}
            @if (svc.lowCount()) { · <span class="text-warn bold">{{ svc.lowCount() }} running low</span> }
          </p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Add oil</button>
        </div>
      </header>

      @if (svc.oils().length) {
        <div class="toolbar">
          <div class="search">
            <app-icon name="search" [size]="16" />
            <input type="search" placeholder="Search my oils…" [value]="search()" (input)="search.set($any($event.target).value)" />
          </div>
        </div>
        @if (svc.lowCount()) {
          <div class="chips">
            <button class="chip" [class.on]="!lowOnly()" (click)="lowOnly.set(false)">All <span class="n">{{ svc.oils().length }}</span></button>
            <button class="chip" [class.on]="lowOnly()" (click)="lowOnly.set(true)">Running low <span class="n">{{ svc.lowCount() }}</span></button>
          </div>
        }
      }

      @if (filtered().length === 0) {
        <div class="card">
          <div class="empty">
            <div class="empty-icon"><app-icon name="droplet" [size]="26" /></div>
            <h3>{{ search() || lowOnly() ? 'No matches' : 'No oils yet' }}</h3>
            <p>{{ search() || lowOnly() ? 'Try a different search.' : 'Add the oils you currently have to start tracking what\\'s left.' }}</p>
            @if (!search() && !lowOnly()) {
              <button class="btn btn-primary" (click)="openAdd()"><app-icon name="plus" [size]="16" /> Add your first oil</button>
            }
          </div>
        </div>
      } @else {
        <div class="list">
          @for (o of filtered(); track o.id) {
            <button type="button" class="list-item" (click)="openEdit(o)">
              @if (o.imageUrl) {
                <img class="thumb" [src]="o.imageUrl" [alt]="o.name" width="44" height="44" loading="lazy" decoding="async" (error)="onImgError($event)" />
              } @else {
                <span class="thumb ph"><app-icon name="droplet" [size]="20" /></span>
              }
              <div class="li-main">
                <span class="li-title">
                  <span class="ellipsis">{{ o.name }}</span>
                  @if (svc.isLow(o)) { <span class="pill warn">Low</span> }
                </span>
                @if (o.amountMl != null) {
                  @let pct = svc.fillPercent(o);
                  @if (pct != null) {
                    <div class="bar fill" [class.warn]="svc.isLow(o)" [class.ok]="!svc.isLow(o)"><i [style.width.%]="pct"></i></div>
                  }
                } @else {
                  <span class="li-sub">Amount not tracked</span>
                }
                @if (o.notes) { <span class="li-sub">{{ o.notes }}</span> }
              </div>
              <div class="li-end">
                @if (o.amountMl != null) {
                  <span class="num" [class.text-warn]="svc.isLow(o)">{{ o.amountMl }} ml</span>
                  @if (o.capacityMl) { <span class="tiny muted">of {{ o.capacityMl }} ml</span> }
                }
              </div>
            </button>
          }
        </div>
      }
    </div>

    @if (sheetOpen()) {
      <kf-sheet [title]="editingId ? 'Edit oil' : 'Add oil'" (closed)="sheetOpen.set(false)">
        <form id="oil-form" class="form" (ngSubmit)="save()">
          <div class="field">
            <label for="o-name">Name</label>
            <input id="o-name" type="text" name="name" [(ngModel)]="form.name" required autocomplete="off" />
          </div>
          <div class="field-row three">
            <div class="field">
              <label for="o-amt">Remaining (ml)</label>
              <input id="o-amt" type="number" min="0" inputmode="decimal" name="amt" [(ngModel)]="form.amountMl" />
            </div>
            <div class="field">
              <label for="o-cap">Full size (ml)</label>
              <input id="o-cap" type="number" min="0" inputmode="decimal" name="cap" [(ngModel)]="form.capacityMl" />
            </div>
            <div class="field">
              <label for="o-low">Warn at (ml)</label>
              <input id="o-low" type="number" min="0" inputmode="decimal" name="low" [(ngModel)]="form.lowThresholdMl" />
            </div>
          </div>
          <div class="field">
            <label for="o-img">Image URL</label>
            <input id="o-img" type="url" name="img" [(ngModel)]="form.imageUrl" placeholder="https://…" />
          </div>
          <div class="field">
            <label for="o-notes">Notes</label>
            <textarea id="o-notes" rows="2" name="notes" [(ngModel)]="form.notes"></textarea>
          </div>
          @if (editingId) {
            <button type="button" class="btn btn-danger" (click)="remove()"><app-icon name="trash" [size]="16" /> Delete oil</button>
          }
        </form>
        <ng-container sheet-actions>
          <button type="button" class="btn" (click)="sheetOpen.set(false)">Cancel</button>
          <button type="submit" form="oil-form" class="btn btn-primary" [disabled]="!form.name.trim()">Save</button>
        </ng-container>
      </kf-sheet>
    }
  `,
  styles: [`
    .ph { display: grid; place-items: center; color: var(--primary); background: var(--primary-soft); }
    .fill { margin: 4px 0 2px; max-width: 320px; }
    .li-end .num { white-space: nowrap; }
    form .btn-danger { align-self: flex-start; }
  `],
})
export class OilsPage {
  readonly svc = inject(OilsService);
  private ui = inject(UiService);

  readonly search = signal('');
  readonly lowOnly = signal(false);
  readonly sheetOpen = signal(false);

  editingId: string | null = null;
  form: OilForm = emptyForm();

  readonly filtered = computed<Oil[]>(() => {
    const q = this.search().trim().toLowerCase();
    const low = this.lowOnly() && this.svc.lowCount() > 0;
    return this.svc.sorted().filter((o) => (!q || o.name.toLowerCase().includes(q)) && (!low || this.svc.isLow(o)));
  });

  readonly onImgError = hideBrokenImg;

  openAdd(): void {
    this.editingId = null;
    this.form = emptyForm();
    this.sheetOpen.set(true);
  }

  openEdit(o: Oil): void {
    this.editingId = o.id;
    this.form = {
      name: o.name,
      imageUrl: o.imageUrl ?? '',
      amountMl: o.amountMl,
      capacityMl: o.capacityMl,
      lowThresholdMl: o.lowThresholdMl,
      notes: o.notes ?? '',
    };
    this.sheetOpen.set(true);
  }

  save(): void {
    const name = this.form.name.trim();
    if (!name) return;
    const payload = {
      name,
      imageUrl: this.form.imageUrl.trim() || undefined,
      amountMl: numOrNull(this.form.amountMl),
      capacityMl: numOrNull(this.form.capacityMl),
      lowThresholdMl: numOrNull(this.form.lowThresholdMl),
      notes: this.form.notes.trim() || undefined,
    };
    if (this.editingId) {
      this.svc.update(this.editingId, payload);
      this.ui.toast('Oil updated', 'ok');
    } else {
      this.svc.add(payload);
      this.ui.toast('Oil added', 'ok');
    }
    this.sheetOpen.set(false);
  }

  async remove(): Promise<void> {
    const id = this.editingId;
    const oil = this.svc.oils().find((o) => o.id === id);
    if (!oil) return;
    const ok = await this.ui.confirm({
      title: 'Delete oil',
      message: `Delete "${oil.name}" from your oils?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.svc.remove(oil.id);
    this.sheetOpen.set(false);
    this.ui.toast('Oil deleted', 'ok');
  }
}
