// Shared product-image helpers for the admin (mirrors the shop's util).

/** True for a usable custom image (not blank, not Rumi's generic cover). */
export function isCustomImage(url?: string): boolean {
  return !!url && !url.includes('rumifragrances.co.za');
}

/** Branded placeholder bottle by gender when a product has no image of its own. */
export function placeholderFor(gender?: string): string {
  const g = (gender || '').toLowerCase();
  return g.startsWith('w') || g.includes('lad') || g.includes('her')
    ? 'placeholder-women.jpg'
    : 'placeholder-men.jpg';
}

/** The image to show for a product: its own, else the branded gender placeholder. */
export function productImage(p: { imageUrl?: string; gender?: string }): string {
  return isCustomImage(p.imageUrl) ? p.imageUrl! : placeholderFor(p.gender);
}
