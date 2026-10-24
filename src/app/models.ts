export interface Oil {
  id: string;
  name: string;
  imageUrl?: string;
  amountMl: number | null; // remaining ml (null if not tracked)
  capacityMl: number | null; // full bottle size, for the fill bar
  lowThresholdMl: number | null; // flag as "running low" at/below this
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RumiProduct {
  id: string; // Rumi product id, or a generated id for manual entries
  name: string;
  fromPrice: number | null; // "from" price in ZAR
  priceHtml?: string;
  inStock: boolean;
  imageUrl?: string;
  permalink?: string;
  source: 'rumi' | 'manual';
  updatedAt: number;
  notes?: string;
}

export interface WishlistItem {
  id: string;
  name: string;
  imageUrl?: string;
  price: number | null; // "from" price in ZAR
  permalink?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// ---- Shop (shared with the Kauā Fragrances storefront) ----

export type ProductSizeKey = 'size30' | 'size50' | 'size100';
export const PRODUCT_SIZE_KEYS: ProductSizeKey[] = ['size30', 'size50', 'size100'];
export const PRODUCT_SIZE_LABELS: Record<ProductSizeKey, string> = {
  size30: '30ml',
  size50: '50ml',
  size100: '100ml',
};

export interface ProductSize {
  size: string;
  price: number;
  salePrice?: number | null;
  cost?: number | null;
  stockQty: number | null;
  inStock: boolean;
  imageUrl?: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  size?: string;
  price: number;
  salePrice?: number | null;
  stockQty: number | null;
  inStock: boolean;
  active: boolean;
  imageUrl?: string;
  sizes?: Partial<Record<ProductSizeKey, ProductSize>>;
  gallery?: string[];
  category?: string;
  gender?: string;
  inspiredBy?: string;
  notesTop?: string;
  notesHeart?: string;
  notesBase?: string;
  longDescription?: string;
  featured?: boolean;
  cost?: number | null; // unit cost, for profit/margin + inventory valuation
  ratingSum?: number;
  ratingCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Review {
  id: string;
  productId: string;
  name: string;
  rating: number; // 1–5
  text?: string;
  approved?: boolean;
  createdAt: number;
}

// Business expense / spend line for the Budgeting tab.
export interface Expense {
  id: string;
  date: number; // epoch ms of the expense date
  category: string; // e.g. Oils, Bottles, Packaging, Marketing, Rent, Other
  description?: string;
  amount: number; // ZAR
  createdAt: number;
}

export const EXPENSE_CATEGORIES = ['Oils', 'Bottles', 'Packaging', 'Labels', 'Marketing', 'Market fees', 'Transport', 'Equipment', 'Other'];

export interface OrderItem {
  productId: string;
  sizeKey?: ProductSizeKey;
  name: string;
  size?: string;
  price: number;
  qty: number;
}

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
  note?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface CustomerProfile {
  uid: string;
  name: string;
  email: string;
  phone: string;
  billing?: Address;
  delivery?: Address;
  updatedAt: number;
}

export type DiscountScope = 'online' | 'pos' | 'both';

export type DiscountMechanic = 'order' | 'item' | 'bundle';
export type BundleReward = 'percent' | 'fixed' | 'price' | 'free';

export interface Discount {
  code: string; // stored uppercase; also the doc id
  type: 'percent' | 'fixed'; // used by 'order' and 'item' mechanics
  value: number; // percent (0–100) or rand amount
  active: boolean;
  scope?: DiscountScope; // where the code may be used (default 'both')
  minSpend?: number; // minimum subtotal to qualify
  maxUses?: number | null; // total redemption limit (null = unlimited)
  usedCount?: number; // times redeemed
  expiresAt?: number | null; // epoch ms; null = no expiry
  mechanic?: DiscountMechanic; // how the discount works (default 'order')
  bundleQty?: number; // multi-buy group size N
  bundleReward?: BundleReward; // how each complete group is rewarded
  bundleValue?: number; // % off group / R off group / group price
  bundleFree?: number; // # cheapest items free per group (reward 'free')
  updatedAt?: number;
}

export interface RestockRequest {
  id: string;
  productId: string;
  productName: string;
  email: string;
  createdAt: number;
  notified: boolean;
}

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'shipped' | 'delivered' | 'cancelled';
export type DeliveryMethod = 'delivery' | 'collection';
export type FulfilStage = 'placed' | 'mixed' | 'labelled' | 'packaged' | 'shipped';
export const FULFIL_STAGES: FulfilStage[] = ['placed', 'mixed', 'labelled', 'packaged', 'shipped'];

export interface Order {
  id: string;
  reference: string;
  uid?: string | null;
  customer: OrderCustomer;
  delivery?: Address;
  deliveryMethod?: DeliveryMethod;
  deliveryFee?: number;
  subtotal?: number;
  discountCode?: string;
  discountAmount?: number;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  stage?: FulfilStage;
  channel?: 'online' | 'pos';
  paymentMethod?: string; // cash | card | eft | yoco
  courier?: string;
  trackingNumber?: string;
  stockReserved?: boolean;
  stockRestored?: boolean;
  discountCounted?: boolean;
  paidAt?: number;
  cancelledReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoreSettings {
  storeOpen?: boolean;
  storeClosedMessage?: string;
  deliveryEnabled?: boolean;
  collectionEnabled?: boolean;
  deliveryFee?: number;
  freeDeliveryThreshold?: number | null;
  collectionNote?: string;
  whatsappNumber?: string;
  contactEmail?: string;
  contactPhone?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
  bankAccountType?: string;
  companyName?: string;
  companyRegistration?: string;
  companyAddress?: string;
  vatNumber?: string;
  // Custom placeholder images (data URLs) set from the Image Manager tab.
  placeholderMen?: string;
  placeholderWomen?: string;
  updatedAt?: number;
}

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  ctaText?: string;
  ctaLink?: string;
  active: boolean;
}

export function sizeOptions(p: Product): { key: ProductSizeKey; size: ProductSize }[] {
  const out: { key: ProductSizeKey; size: ProductSize }[] = [];
  if (p.sizes) {
    for (const key of PRODUCT_SIZE_KEYS) {
      const size = p.sizes[key];
      if (size && Number(size.price) > 0) out.push({ key, size });
    }
  }
  if (out.length) return out;
  if (Number(p.price) > 0) {
    out.push({ key: 'size30', size: {
      size: p.size || 'Default', price: p.price, salePrice: p.salePrice, cost: p.cost,
      stockQty: p.stockQty, inStock: p.inStock, imageUrl: p.imageUrl,
    }});
  }
  return out;
}

export function sizeEffectivePrice(s: ProductSize): number {
  return s.salePrice != null && Number(s.salePrice) > 0 && Number(s.salePrice) < Number(s.price)
    ? Number(s.salePrice) : Number(s.price) || 0;
}

export function sizeOnSale(s: ProductSize): boolean {
  return s.salePrice != null && Number(s.salePrice) > 0 && Number(s.salePrice) < Number(s.price);
}

export function fromPrice(p: Product): number {
  const opts = sizeOptions(p);
  return opts.length ? Math.min(...opts.map((o) => sizeEffectivePrice(o.size))) : Number(p.price) || 0;
}

export function sizeAvailable(s: ProductSize): boolean {
  return !!s.inStock && (s.stockQty == null || Number(s.stockQty) > 0);
}

export interface SiteContent {
  announcementText?: string;
  announcementActive?: boolean;
  heroTitle?: string;
  heroSubtitle?: string;
  heroImageUrl?: string;
  heroCtaText?: string;
  heroCtaLink?: string;
  banners?: Banner[];
  featuredTitle?: string;
  updatedAt?: number;
}

export interface RumiSyncResponse {
  products: RumiProduct[];
  count: number;
  inStockCount: number;
  fetchedAt: number;
}
