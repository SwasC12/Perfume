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

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled';
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
  paymentMethod?: string; // cash | card | eft
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
