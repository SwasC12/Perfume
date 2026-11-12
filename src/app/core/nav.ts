/** Every screen in the app, in sidebar order. Routes live in app.routes.ts. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  group: 'shop' | 'manage' | 'personal';
  admin: boolean;
}

export const NAV: NavItem[] = [
  { path: 'dashboard', label: 'Dashboard', icon: 'home', group: 'shop', admin: true },
  { path: 'orders', label: 'Orders', icon: 'receipt', group: 'shop', admin: true },
  { path: 'pos', label: 'Point of sale', icon: 'wallet', group: 'shop', admin: true },
  { path: 'scan', label: 'Scanner', icon: 'qr', group: 'shop', admin: true },
  { path: 'products', label: 'Products', icon: 'package', group: 'shop', admin: true },
  { path: 'customers', label: 'Customers', icon: 'users', group: 'shop', admin: true },

  { path: 'discounts', label: 'Discounts', icon: 'percent', group: 'manage', admin: true },
  { path: 'referrals', label: 'Referrals', icon: 'star', group: 'manage', admin: true },
  { path: 'reviews', label: 'Reviews', icon: 'edit', group: 'manage', admin: true },
  { path: 'budget', label: 'Budget', icon: 'chart', group: 'manage', admin: true },
  { path: 'storefront', label: 'Storefront', icon: 'store', group: 'manage', admin: true },
  { path: 'images', label: 'Images', icon: 'image', group: 'manage', admin: true },
  { path: 'settings', label: 'Settings', icon: 'settings', group: 'manage', admin: true },

  { path: 'oils', label: 'My oils', icon: 'droplet', group: 'personal', admin: false },
  { path: 'wishlist', label: 'Wishlist', icon: 'star', group: 'personal', admin: false },
  { path: 'rumi', label: 'Buy from Rumi', icon: 'bag', group: 'personal', admin: false },
];

export const NAV_GROUPS: { key: NavItem['group']; label: string }[] = [
  { key: 'shop', label: 'Shop' },
  { key: 'manage', label: 'Manage' },
  { key: 'personal', label: 'Personal' },
];

/** Title shown in the phone top bar for a URL. */
export function titleFor(url: string): string {
  const seg = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (!seg.length) return 'Kaua Tracker';
  if (seg[0] === 'orders' && seg[1]) return 'Order';
  if (seg[0] === 'products' && seg[1]) return seg[1] === 'new' ? 'New product' : 'Edit product';
  if (seg[0] === 'login') return 'Sign in';
  if (seg[0] === 'sync') return 'Sync';
  return NAV.find((n) => n.path === seg[0])?.label ?? 'Kaua Tracker';
}
