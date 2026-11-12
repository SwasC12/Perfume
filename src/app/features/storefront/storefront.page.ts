import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { imageFromFile } from '../../cloudinary';
import { Banner, SiteContent } from '../../models';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './storefront.page.html',
  styleUrl: './storefront.page.scss',
})
export class StorefrontPage {
  private readonly shop = inject(ShopAdminService);
  private readonly ui = inject(UiService);

  /** Editable copy of siteContent/home, loaded once (live updates don't clobber edits). */
  readonly form = signal<SiteContent | null>(null);
  readonly saving = signal(false);
  readonly uploading = signal<string | null>(null);

  constructor() {
    effect(() => {
      const sc = this.shop.siteContent();
      untracked(() => {
        if (sc && !this.form()) {
          const f: SiteContent = { banners: [], ...JSON.parse(JSON.stringify(sc)) };
          if (!f.banners) f.banners = [];
          this.form.set(f);
        }
      });
    });
  }

  private touch(): void { this.form.update((f) => (f ? { ...f } : f)); }

  addBanner(): void {
    const f = this.form();
    if (!f) return;
    if (!f.banners) f.banners = [];
    f.banners.push({
      id: 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: '', subtitle: '', imageUrl: '', ctaText: '', ctaLink: '', active: true,
    });
    this.touch();
  }

  async removeBanner(b: Banner): Promise<void> {
    const f = this.form();
    if (!f) return;
    if ((b.title || b.imageUrl) && !(await this.ui.confirm({
      title: 'Remove banner?',
      message: `Remove "${b.title || 'this banner'}"? It disappears from the shop when you save.`,
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    f.banners = (f.banners ?? []).filter((x) => x.id !== b.id);
    this.touch();
  }

  /** Hero + banner images upload straight to Cloudinary from the admin. */
  async uploadHero(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    const f = this.form();
    if (!file || !f) return;
    this.uploading.set('hero');
    try {
      f.heroImageUrl = await imageFromFile(file, 2000, 0.86, 'kaua/banners');
      this.touch();
      this.ui.toast('Hero image uploaded', 'ok');
    } catch { this.ui.toast('Could not upload that image', 'err'); }
    finally { this.uploading.set(null); input.value = ''; }
  }

  async uploadBanner(b: Banner, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    this.uploading.set(b.id);
    try {
      b.imageUrl = await imageFromFile(file, 1800, 0.86, 'kaua/banners');
      this.touch();
      this.ui.toast('Banner image uploaded', 'ok');
    } catch { this.ui.toast('Could not upload that image', 'err'); }
    finally { this.uploading.set(null); input.value = ''; }
  }

  async save(): Promise<void> {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);
    try {
      await this.shop.saveSiteContent(f);
      this.ui.toast('Storefront updated', 'ok');
    } catch {
      this.ui.toast('Save failed — are you signed in?', 'err');
    } finally {
      this.saving.set(false);
    }
  }
}
