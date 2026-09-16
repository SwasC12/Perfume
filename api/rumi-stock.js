// Vercel serverless function: proxies Rumi Fragrances' WooCommerce Store API
// so the browser can fetch live "Inspired By Oils" stock without CORS issues.
// Deployed automatically by Vercel from the /api directory.

const BASE = 'https://rumifragrances.co.za/wp-json/wc/store/v1';
const CATEGORY_SLUG = 'inspired-by-oils';
const FALLBACK_CATEGORY_ID = 1395;
const PER_PAGE = 100;
const MAX_PAGES = 6; // safety cap (~600 products)

async function resolveCategoryId() {
  try {
    // NOTE: the Store API ignores ?slug=, so it returns ALL categories — we must
    // filter by slug ourselves rather than trusting the first entry.
    const r = await fetch(`${BASE}/products/categories?per_page=100`);
    if (r.ok) {
      const cats = await r.json();
      const match = Array.isArray(cats)
        ? cats.find((c) => c.slug === CATEGORY_SLUG)
        : null;
      if (match?.id) return match.id;
    }
  } catch {
    /* fall through to hardcoded id */
  }
  return FALLBACK_CATEGORY_ID;
}

function toMajor(minorValue, minorUnit) {
  const v = Number(minorValue);
  if (!Number.isFinite(v)) return null;
  const unit = Number.isFinite(Number(minorUnit)) ? Number(minorUnit) : 2;
  return v / 10 ** unit;
}

function normalize(p) {
  const prices = p.prices || {};
  const from =
    toMajor(prices.price_range?.min_amount, prices.currency_minor_unit) ??
    toMajor(prices.price, prices.currency_minor_unit);
  const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
  return {
    id: String(p.id),
    name: p.name || 'Unnamed',
    fromPrice: from,
    priceHtml: p.price_html || '',
    inStock: !!p.is_in_stock,
    imageUrl: img?.thumbnail || img?.src || '',
    permalink: p.permalink || '',
    source: 'rumi',
    updatedAt: Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    const categoryId = await resolveCategoryId();
    let all = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url = `${BASE}/products?category=${categoryId}&per_page=${PER_PAGE}&page=${page}`;
      const r = await fetch(url);
      if (!r.ok) break;
      const tp = parseInt(r.headers.get('x-wp-totalpages') || '1', 10);
      totalPages = Number.isFinite(tp) && tp > 0 ? tp : 1;
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;
      all = all.concat(data);
      page += 1;
    } while (page <= totalPages && page <= MAX_PAGES);

    const products = all.map(normalize);
    res.status(200).json({
      products,
      count: products.length,
      inStockCount: products.filter((p) => p.inStock).length,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch Rumi stock', detail: String(e) });
  }
}
