import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { EmailService } from '../../email.service';
import { UiService } from '../../core/ui.service';
import { ScanService } from '../../core/scan.service';
import { IconComponent } from '../../icon.component';
import { LoaderComponent } from '../../shared/loader.component';
import { imageFromFile } from '../../cloudinary';
import { PRODUCT_SIZE_KEYS, PRODUCT_SIZE_LABELS, Product, ProductSize, ProductSizeKey } from '../../models';
import {
  hideBrokenImg, isDataUrl, isSellable, loadBulkPrices, marginLabel, notifyPendingRestock, numOrNull, pendingRestockCount,
} from './product-util';

interface ProductSizeForm {
  size: string;
  price: number | null;
  salePrice: number | null;
  cost: number | null;
  stockQty: number | null;
  inStock: boolean;
  imageUrl: string;
}

interface ProductForm {
  name: string;
  sizes: Record<ProductSizeKey, ProductSizeForm>;
  description: string;
  size: string;
  price: number | null;
  salePrice: number | null;
  cost: number | null;
  stockQty: number | null;
  inStock: boolean;
  active: boolean;
  featured: boolean;
  imageUrl: string;
  gallery: string[];
  category: string;
  gender: string;
  inspiredBy: string;
  barcode: string;
  notesTop: string;
  notesHeart: string;
  notesBase: string;
  longDescription: string;
}

/** What another screen (e.g. Rumi "Add to my shop") may pass in router state as `prefill`. */
export interface ProductPrefill {
  name?: string;
  inspiredBy?: string;
  description?: string;
  imageUrl?: string;
  category?: string;
}

const REQUIRED: ProductSizeKey = 'size30';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-edit.page.html',
  styleUrl: './product-edit.page.scss',
})
export class ProductEditPage {
  readonly id = input<string>();

  private readonly shop = inject(ShopAdminService);
  private readonly email = inject(EmailService);
  private readonly ui = inject(UiService);
  private readonly scan = inject(ScanService);
  private readonly router = inject(Router);

  readonly sizeRows = PRODUCT_SIZE_KEYS.map((key) => ({ key, label: PRODUCT_SIZE_LABELS[key], required: key === REQUIRED }));
  readonly genders = ['Men', 'Women', 'Unisex'];
  readonly marginLabel = marginLabel;
  readonly isDataUrl = isDataUrl;
  readonly hideImg = hideBrokenImg;

  /** The editable model. Mutated in place by ngModel; `touch()` after async changes. */
  readonly form = signal<ProductForm | null>(null);
  readonly saving = signal(false);
  /** Uploads in flight per slot ('main', 'gallery', or a size key). */
  readonly uploads = signal<Record<string, number>>({});
  readonly uploading = computed(() => Object.keys(this.uploads()).length > 0);
  /** Which sizes are offered (toggle chips). Off sizes have no price, so they aren't saved. */
  readonly sizeOn = signal<Record<ProductSizeKey, boolean>>({ size30: true, size50: false, size100: false });
  readonly prefilled = signal(false);
  galleryUrl = '';
  private loadedFor: string | undefined | null = null;
  /** Price a size had before it was switched off, restored when switched back on. */
  private parked: Partial<Record<ProductSizeKey, number | null>> = {};
  private readonly bulk = loadBulkPrices();
  /** Router state is only readable while the navigation is in progress — grab it now. */
  private readonly navPrefill = this.router.getCurrentNavigation()?.extras.state?.['prefill'] as ProductPrefill | undefined;

  readonly isNew = computed(() => !this.id() || this.id() === 'new');
  readonly editingId = computed(() => (this.isNew() ? null : this.id()!));
  readonly product = computed(() => {
    const id = this.editingId();
    return id ? this.shop.products().find((p) => p.id === id) ?? null : null;
  });
  readonly notFound = computed(
    () => !this.isNew() && !this.shop.loadingProducts() && this.shop.products().length > 0 && !this.product(),
  );
  readonly waiting = computed(() => {
    const id = this.editingId();
    if (!id) return 0;
    return pendingRestockCount(this.shop, id);
  });
  /** Existing categories, for suggestions. */
  readonly categories = computed(() =>
    [...new Set(this.shop.products().map((p) => (p.category || '').trim()).filter(Boolean))].sort());

  constructor() {
    // Fill the form once per product (later live updates don't clobber edits).
    effect(() => {
      const id = this.id();
      const isNew = this.isNew();
      const p = this.product();
      untracked(() => {
        if (this.loadedFor === id && this.form()) return;
        if (isNew) { this.load(this.newForm()); this.loadedFor = id; }
        else if (p) { this.load(this.formFrom(p)); this.loadedFor = id; }
      });
    });
  }

  private load(f: ProductForm): void {
    this.parked = {};
    this.sizeOn.set({
      size30: true,
      size50: Number(f.sizes.size50.price) > 0,
      size100: Number(f.sizes.size100.price) > 0,
    });
    this.form.set(f);
  }

  /** Re-render after an async change to the form model. */
  private touch(): void { this.form.update((f) => (f ? { ...f } : f)); }

  margin(row: ProductSizeForm): string | null {
    return row.price && row.cost ? marginLabel(row.price, row.cost) : null;
  }

  // ---------------- Sizes ----------------
  toggleSize(key: ProductSizeKey): void {
    const f = this.form();
    if (!f) return;
    if (key === REQUIRED) { this.ui.toast('30ml is always offered — give it a price', 'info'); return; }
    const s = f.sizes[key];
    const on = !this.sizeOn()[key];
    if (on) {
      s.price = this.parked[key] ?? (Number(s.price) > 0 ? s.price : this.bulk[key]);
      s.inStock = s.stockQty == null ? true : Number(s.stockQty) > 0;
    } else {
      this.parked[key] = s.price;
      s.price = null;
    }
    this.sizeOn.update((m) => ({ ...m, [key]: on }));
  }

  /** Stock typed → "in stock" follows quantity > 0. */
  setStock(key: ProductSizeKey, v: unknown): void {
    const s = this.form()?.sizes[key];
    if (!s) return;
    const n = numOrNull(v);
    s.stockQty = n;
    if (n != null) s.inStock = n > 0;
  }

  // ---------------- Images ----------------
  busy(slot: string): boolean { return (this.uploads()[slot] || 0) > 0; }
  pending(slot: string): number[] { return Array.from({ length: this.uploads()[slot] || 0 }, (_, i) => i); }

  private async upload(slot: string, file: File, maxDim: number, quality: number, apply: (url: string) => void): Promise<void> {
    this.uploads.update((u) => ({ ...u, [slot]: (u[slot] || 0) + 1 }));
    try {
      apply(await imageFromFile(file, maxDim, quality, 'kaua/products'));
      this.touch();
    } catch {
      this.ui.toast('Could not process that image', 'err');
    } finally {
      this.uploads.update((u) => {
        const n = { ...u };
        n[slot] = (n[slot] || 1) - 1;
        if (n[slot] <= 0) delete n[slot];
        return n;
      });
    }
  }

  private files(ev: Event): File[] {
    const input = ev.target as HTMLInputElement;
    const list = Array.from(input.files ?? []);
    input.value = '';
    return list;
  }

  onMainImageFile(ev: Event): void {
    const [file] = this.files(ev);
    if (file) void this.upload('main', file, 1400, 0.85, (u) => { this.form()!.imageUrl = u; });
  }

  onSizeImageFile(ev: Event, key: ProductSizeKey): void {
    const [file] = this.files(ev);
    if (file) void this.upload(key, file, 1400, 0.85, (u) => { this.form()!.sizes[key].imageUrl = u; });
  }

  onGalleryFile(ev: Event): void {
    for (const file of this.files(ev)) {
      void this.upload('gallery', file, 1200, 0.8, (u) => { const f = this.form()!; f.gallery = [...f.gallery, u]; });
    }
  }

  addGalleryUrl(): void {
    const u = this.galleryUrl.trim();
    const f = this.form();
    if (u && f) { f.gallery = [...f.gallery, u]; this.galleryUrl = ''; this.touch(); }
  }

  removeGalleryImage(i: number): void {
    const f = this.form();
    if (f) { f.gallery = f.gallery.filter((_, idx) => idx !== i); this.touch(); }
  }

  async scanBarcode(): Promise<void> {
    const code = await this.scan.pickCode();
    const f = this.form();
    if (code && f) { f.barcode = code.trim(); this.touch(); }
  }

  // ---------------- Save / delete ----------------
  async save(): Promise<void> {
    const form = this.form();
    if (!form || this.saving()) return;
    const name = form.name.trim();
    const sizes: Partial<Record<ProductSizeKey, ProductSize>> = {};
    for (const key of PRODUCT_SIZE_KEYS) {
      const row = form.sizes[key];
      const price = numOrNull(row.price);
      if (price == null || price <= 0) continue;
      sizes[key] = {
        size: row.size.trim() || PRODUCT_SIZE_LABELS[key],
        price,
        salePrice: numOrNull(row.salePrice),
        cost: numOrNull(row.cost),
        stockQty: numOrNull(row.stockQty),
        inStock: row.inStock,
        imageUrl: row.imageUrl.trim() || undefined,
      };
    }
    const s30 = sizes.size30;
    if (!name || !s30) {
      this.ui.toast('Name and a 30ml price are required', 'err');
      return;
    }
    const gallery = form.gallery.filter(Boolean);
    const payload = {
      name,
      description: form.description.trim() || undefined,
      size: s30.size,
      price: s30.price,
      salePrice: s30.salePrice,
      cost: s30.cost,
      stockQty: s30.stockQty,
      inStock: s30.inStock,
      active: form.active,
      featured: form.featured,
      imageUrl: form.imageUrl.trim() || undefined,
      sizes,
      gallery: gallery.length ? gallery : undefined,
      category: form.category.trim() || undefined,
      gender: form.gender.trim() || undefined,
      inspiredBy: form.inspiredBy.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      notesTop: form.notesTop.trim() || undefined,
      notesHeart: form.notesHeart.trim() || undefined,
      notesBase: form.notesBase.trim() || undefined,
      longDescription: form.longDescription.trim() || undefined,
    };
    // Guard against Firestore's ~1MB per-document limit (uploaded images may be stored inline).
    if (JSON.stringify(payload).length > 950000) {
      this.ui.toast('Images too large — remove a gallery image or use smaller photos', 'err');
      return;
    }
    this.saving.set(true);
    try {
      const editedId = this.editingId();
      if (editedId) {
        const prev = this.shop.products().find((x) => x.id === editedId);
        const wasSellable = prev ? isSellable(prev) : false;
        const nowSellable = isSellable(payload);
        await this.shop.updateProduct(editedId, payload);
        // Auto-notify anyone waiting if this product just came back in stock.
        if (!wasSellable && nowSellable && pendingRestockCount(this.shop, editedId)) {
          const sent = await notifyPendingRestock(this.shop, this.email, editedId, name);
          this.ui.toast(sent ? `Product updated · notified ${sent} waiting` : 'Product updated', 'ok');
        } else {
          this.ui.toast('Product updated', 'ok');
        }
      } else {
        await this.shop.addProduct(payload);
        this.ui.toast('Product added', 'ok');
      }
      void this.router.navigate(['/products']);
    } catch {
      this.ui.toast('Save failed — are you signed in?', 'err');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const p = this.product();
    if (!p) return;
    if (!(await this.ui.confirm({
      title: 'Delete product?',
      message: `Delete "${p.name}" from the shop? This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    }))) return;
    try {
      await this.shop.deleteProduct(p.id);
      this.ui.toast('Product deleted', 'ok');
      void this.router.navigate(['/products']);
    } catch {
      this.ui.toast('Delete failed', 'err');
    }
  }

  // ---------------- Form builders ----------------
  /** A blank product with smart defaults: bulk prices per size, plus any router prefill. */
  private newForm(): ProductForm {
    const f = this.emptyForm();
    for (const key of PRODUCT_SIZE_KEYS) {
      const price = this.bulk[key];
      if (price != null) {
        f.sizes[key].price = price;
        f.sizes[key].inStock = true;
      }
    }
    const pre = this.readPrefill();
    if (pre) {
      f.name = String(pre.name ?? '').trim();
      f.inspiredBy = String(pre.inspiredBy ?? '').trim();
      f.description = String(pre.description ?? '').trim();
      f.imageUrl = String(pre.imageUrl ?? '').trim();
      f.category = String(pre.category ?? '').trim();
      this.prefilled.set(true);
    }
    return f;
  }

  private readPrefill(): ProductPrefill | null {
    let p: unknown = this.navPrefill;
    if (!p) {
      try { p = (history.state as { prefill?: ProductPrefill } | null)?.prefill; } catch { p = null; }
    }
    return p && typeof p === 'object' ? (p as ProductPrefill) : null;
  }

  private emptyForm(): ProductForm {
    return {
      name: '', description: '', size: '30ml', price: null, salePrice: null, cost: null, stockQty: null,
      inStock: true, active: true, featured: false, imageUrl: '', gallery: [],
      sizes: {
        size30: this.emptySizeForm('30ml', true),
        size50: this.emptySizeForm('50ml', false),
        size100: this.emptySizeForm('100ml', false),
      },
      category: '', gender: '', inspiredBy: '', barcode: '', notesTop: '', notesHeart: '', notesBase: '', longDescription: '',
    };
  }

  private emptySizeForm(label: string, inStock = false): ProductSizeForm {
    return { size: label, price: null, salePrice: null, cost: null, stockQty: null, inStock, imageUrl: '' };
  }

  private sizeFormFrom(s: ProductSize | undefined, label: string): ProductSizeForm {
    return {
      size: s?.size || label,
      price: s?.price ?? null,
      salePrice: s?.salePrice ?? null,
      cost: s?.cost ?? null,
      stockQty: s?.stockQty ?? null,
      inStock: s?.inStock ?? false,
      imageUrl: s?.imageUrl || '',
    };
  }

  private formFrom(p: Product): ProductForm {
    return {
      name: p.name,
      description: p.description ?? '',
      size: p.size ?? '',
      price: p.price,
      salePrice: p.salePrice ?? null,
      cost: p.cost ?? null,
      stockQty: p.stockQty,
      inStock: p.inStock,
      active: p.active,
      featured: !!p.featured,
      imageUrl: p.imageUrl ?? '',
      gallery: [...(p.gallery ?? [])],
      category: p.category ?? '',
      gender: p.gender ?? '',
      inspiredBy: p.inspiredBy ?? '',
      barcode: p.barcode ?? '',
      notesTop: p.notesTop ?? '',
      notesHeart: p.notesHeart ?? '',
      notesBase: p.notesBase ?? '',
      longDescription: p.longDescription ?? '',
      sizes: {
        size30: this.sizeFormFrom(p.sizes?.size30 || {
          size: p.size || '30ml', price: p.price, salePrice: p.salePrice, cost: p.cost,
          stockQty: p.stockQty, inStock: p.inStock, imageUrl: p.imageUrl,
        }, '30ml'),
        size50: this.sizeFormFrom(p.sizes?.size50, '50ml'),
        size100: this.sizeFormFrom(p.sizes?.size100, '100ml'),
      },
    };
  }
}
