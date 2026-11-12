import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { imageFromFile } from '../../cloudinary';
import { placeholderFor } from '../../product-image';

type SlotKey = 'men30' | 'men50' | 'men100' | 'women30' | 'women50' | 'women100';

const SITE_FIELD: Record<SlotKey, string> = {
  men30: 'placeholderMen30', men50: 'placeholderMen50', men100: 'placeholderMen100',
  women30: 'placeholderWomen30', women50: 'placeholderWomen50', women100: 'placeholderWomen100',
};

@Component({
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">Image manager</h1>
          <p class="page-sub">These bottle images stand in for any product without its own photo. Changes apply across the shop once saved.</p>
        </div>
      </header>

      @for (group of groups; track group.label) {
        <section class="stack">
          <h2 class="section-title muted">{{ group.label }}</h2>
          <div class="grid-3">
            @for (slot of group.slots; track slot.key) {
              <div class="card im-card">
                <div class="im-prev">
                  <img [src]="preview(slot.key)" [alt]="slot.label" width="300" height="300" loading="lazy" decoding="async" (error)="onImgError($event)" />
                  @if (uploading() === slot.key) { <span class="im-busy">Uploading…</span> }
                </div>
                <div class="card-body stack-sm">
                  <div class="row between">
                    <span class="bold">{{ slot.size }}</span>
                    @if (isCustom(slot.key)) { <span class="pill ok">Custom</span> } @else { <span class="pill plain">Default</span> }
                  </div>
                  <div class="row">
                    <label class="btn btn-sm" [class.disabled]="!!uploading()">
                      <app-icon name="upload" [size]="15" /> {{ isCustom(slot.key) ? 'Replace' : 'Upload' }}
                      <input type="file" accept="image/*" hidden (change)="onPlaceholderFile(slot.key, $event)" />
                    </label>
                    @if (isCustom(slot.key)) {
                      <button type="button" class="btn btn-sm btn-ghost" (click)="reset(slot.key)">Use default</button>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <div class="action-bar">
        <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving() || !!uploading()">
          {{ saving() ? 'Saving…' : 'Save images' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .im-card { overflow: hidden; }
    .im-prev { position: relative; aspect-ratio: 1; background: var(--surface-3); }
    .im-prev img { width: 100%; height: 100%; object-fit: cover; }
    .im-busy {
      position: absolute; inset: 0; display: grid; place-items: center;
      background: rgba(255, 255, 255, .75); font-weight: 600; font-size: 14px; color: var(--ink-2);
    }
    .disabled { opacity: .5; pointer-events: none; }
    @media (max-width: 559px) { .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class ImagesPage {
  private readonly shop = inject(ShopAdminService);
  private readonly ui = inject(UiService);

  readonly groups: { label: string; slots: { key: SlotKey; label: string; gender: string; size: string }[] }[] = [
    {
      label: 'Men / Unisex',
      slots: [
        { key: 'men30', label: 'Men / Unisex — 30ml', gender: 'Men', size: '30ml' },
        { key: 'men50', label: 'Men / Unisex — 50ml', gender: 'Men', size: '50ml' },
        { key: 'men100', label: 'Men / Unisex — 100ml', gender: 'Men', size: '100ml' },
      ],
    },
    {
      label: 'Women',
      slots: [
        { key: 'women30', label: 'Women — 30ml', gender: 'Women', size: '30ml' },
        { key: 'women50', label: 'Women — 50ml', gender: 'Women', size: '50ml' },
        { key: 'women100', label: 'Women — 100ml', gender: 'Women', size: '100ml' },
      ],
    },
  ];
  private readonly slotByKey = new Map(this.groups.flatMap((g) => g.slots).map((s) => [s.key, s]));

  readonly form = signal<Record<SlotKey, string>>({ men30: '', men50: '', men100: '', women30: '', women50: '', women100: '' });
  readonly saving = signal(false);
  readonly uploading = signal<SlotKey | null>(null);
  private settingsLoaded = false;
  /** Slots the admin changed here; live data no longer overwrites them. */
  private readonly touched = new Set<SlotKey>();

  constructor() {
    // Load the saved slots from store settings once (legacy single image as fallback).
    effect(() => {
      const s = this.shop.settings();
      untracked(() => {
        if (!s || this.settingsLoaded) return;
        this.settingsLoaded = true;
        const cur = this.form();
        const next = { ...cur };
        const fromSettings: Record<SlotKey, string> = {
          men30: s.placeholderMen30 || s.placeholderMen || '',
          men50: s.placeholderMen50 || s.placeholderMen || '',
          men100: s.placeholderMen100 || s.placeholderMen || '',
          women30: s.placeholderWomen30 || s.placeholderWomen || '',
          women50: s.placeholderWomen50 || s.placeholderWomen || '',
          women100: s.placeholderWomen100 || s.placeholderWomen || '',
        };
        for (const k of Object.keys(fromSettings) as SlotKey[]) {
          if (!this.touched.has(k)) next[k] = fromSettings[k] || cur[k];
        }
        this.form.set(next);
      });
    });
    // The storefront reads siteContent/home — show whatever is saved there too.
    effect(() => {
      const c = this.shop.siteContent() as Record<string, unknown> | null;
      untracked(() => {
        if (!c) return;
        const cur = this.form();
        let next: Record<SlotKey, string> | null = null;
        for (const k of Object.keys(SITE_FIELD) as SlotKey[]) {
          const value = c[SITE_FIELD[k]];
          if (typeof value === 'string' && value && !cur[k] && !this.touched.has(k)) {
            next = next ?? { ...cur };
            next[k] = value;
          }
        }
        if (next) this.form.set(next);
      });
    });
  }

  preview(key: SlotKey): string {
    const slot = this.slotByKey.get(key);
    return this.form()[key] || placeholderFor(slot?.gender, slot?.size);
  }

  isCustom(key: SlotKey): boolean { return !!this.form()[key]; }

  onImgError(ev: Event): void { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }

  async onPlaceholderFile(key: SlotKey, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading.set(key);
    try {
      const url = await imageFromFile(file, 1400, 0.85, 'kaua/placeholders');
      this.touched.add(key);
      this.form.update((f) => ({ ...f, [key]: url }));
    } catch { this.ui.toast('Could not read that image', 'err'); }
    finally { this.uploading.set(null); input.value = ''; }
  }

  reset(key: SlotKey): void {
    this.touched.add(key);
    this.form.update((f) => ({ ...f, [key]: '' }));
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const f = this.form();
    const fields = {
      placeholderMen: f.men30 || '',
      placeholderWomen: f.women30 || '',
      placeholderMen30: f.men30 || '',
      placeholderMen50: f.men50 || '',
      placeholderMen100: f.men100 || '',
      placeholderWomen30: f.women30 || '',
      placeholderWomen50: f.women50 || '',
      placeholderWomen100: f.women100 || '',
    };
    this.saving.set(true);
    try {
      await this.shop.savePlaceholderImages(fields);
      // Keep the legacy settings copy in sync for older screens.
      try { await this.shop.updateStoreSettings(fields); } catch { /* non-fatal */ }
      this.ui.toast('Placeholder images saved', 'ok');
    } catch { this.ui.toast('Save failed - are you signed in?', 'err'); }
    finally { this.saving.set(false); }
  }
}
