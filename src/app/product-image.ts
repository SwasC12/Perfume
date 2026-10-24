// Shared product-image helpers for the admin (mirrors the shop's util).

/** True for a usable custom image (not blank, not Rumi's generic cover). */
export function isCustomImage(url?: string): boolean {
  return !!url && !url.includes('rumifragrances.co.za');
}

// Optional custom placeholders (data URLs) from the Image Manager, kept in sync
// with the live store settings so admin previews match the shop.
let customMen = '';
let customWomen = '';
let customMen30 = '';
let customMen50 = '';
let customMen100 = '';
let customWomen30 = '';
let customWomen50 = '';
let customWomen100 = '';
export function setPlaceholderOverrides(
  men?: string, women?: string,
  men30?: string, men50?: string, men100?: string,
  women30?: string, women50?: string, women100?: string,
): void {
  customMen = men || '';
  customWomen = women || '';
  customMen30 = men30 || '';
  customMen50 = men50 || '';
  customMen100 = men100 || '';
  customWomen30 = women30 || '';
  customWomen50 = women50 || '';
  customWomen100 = women100 || '';
}

/** Branded placeholder bottle by gender when a product has no image of its own. */
export function placeholderFor(gender?: string, sizeLabel?: string): string {
  const g = (gender || '').toLowerCase();
  const isWomen = g.startsWith('w') || g.includes('lad') || g.includes('her');
  const label = (sizeLabel || '').toLowerCase();
  if (isWomen) {
    if (label.includes('30')) return customWomen30 || customWomen || 'placeholder-women.jpg';
    if (label.includes('50')) return customWomen50 || customWomen || 'placeholder-women.jpg';
    if (label.includes('100')) return customWomen100 || customWomen || 'placeholder-women.jpg';
    return customWomen || 'placeholder-women.jpg';
  }
  if (label.includes('30')) return customMen30 || customMen || 'placeholder-men.jpg';
  if (label.includes('50')) return customMen50 || customMen || 'placeholder-men.jpg';
  if (label.includes('100')) return customMen100 || customMen || 'placeholder-men.jpg';
  return customMen || 'placeholder-men.jpg';
}

/** The image to show for a product: its own, else the branded gender placeholder. */
export function productImage(p: { imageUrl?: string; gender?: string }): string {
  return isCustomImage(p.imageUrl) ? p.imageUrl! : placeholderFor(p.gender);
}
