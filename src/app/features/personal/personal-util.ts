/** Small helpers shared by the personal screens (oils, wishlist, Rumi). */

/** Empty / NaN number inputs become null (same rule as the old app). */
export function numOrNull(v: number | string | null | undefined): number | null {
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v);
}

/** Hide an <img> whose URL is broken instead of showing the broken-image glyph. */
export function hideBrokenImg(ev: Event): void {
  (ev.target as HTMLImageElement).style.visibility = 'hidden';
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function agoLabel(t: number | null | undefined): string {
  if (!t) return 'never';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(t).toLocaleDateString();
}
