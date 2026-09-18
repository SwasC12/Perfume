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
  stockQty: number | null;
  inStock: boolean;
  active: boolean;
  imageUrl?: string;
  createdAt: number;
  updatedAt: number;
}

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

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled';

export interface Order {
  id: string;
  reference: string;
  customer: OrderCustomer;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RumiSyncResponse {
  products: RumiProduct[];
  count: number;
  inStockCount: number;
  fetchedAt: number;
}
