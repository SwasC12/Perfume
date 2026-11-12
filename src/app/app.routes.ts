import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { AuthService } from './auth.service';

/** Wait for Firebase Auth to resolve once, then admit only the admin. */
const adminOnly: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const decide = () => auth.isAdmin || router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  if (auth.ready()) return decide();
  return toObservable(auth.ready).pipe(filter(Boolean), take(1), map(decide));
};

/** '' → dashboard for the admin, My oils for everyone else. */
const home: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const decide = () => router.createUrlTree([auth.isAdmin ? '/dashboard' : '/oils']);
  if (auth.ready()) return decide();
  return toObservable(auth.ready).pipe(filter(Boolean), take(1), map(decide));
};

const admin = { canActivate: [adminOnly] };

/**
 * Every screen is its own lazy chunk, so startup only parses the shell.
 * PreloadAllModules (app.config.ts) then fetches the rest in the background,
 * so switching screens never waits on the network.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [home], children: [] },
  { path: 'login', loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },

  { path: 'dashboard', ...admin, loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
  { path: 'orders', ...admin, loadComponent: () => import('./features/orders/orders.page').then((m) => m.OrdersPage) },
  { path: 'orders/:id', ...admin, loadComponent: () => import('./features/orders/order-detail.page').then((m) => m.OrderDetailPage) },
  { path: 'customers', ...admin, loadComponent: () => import('./features/customers/customers.page').then((m) => m.CustomersPage) },
  { path: 'referrals', ...admin, loadComponent: () => import('./features/referrals/referrals.page').then((m) => m.ReferralsPage) },

  { path: 'products', ...admin, loadComponent: () => import('./features/products/products.page').then((m) => m.ProductsPage) },
  { path: 'products/:id', ...admin, loadComponent: () => import('./features/products/product-edit.page').then((m) => m.ProductEditPage) },
  { path: 'reviews', ...admin, loadComponent: () => import('./features/reviews/reviews.page').then((m) => m.ReviewsPage) },
  { path: 'storefront', ...admin, loadComponent: () => import('./features/storefront/storefront.page').then((m) => m.StorefrontPage) },
  { path: 'images', ...admin, loadComponent: () => import('./features/images/images.page').then((m) => m.ImagesPage) },

  { path: 'pos', ...admin, loadComponent: () => import('./features/pos/pos.page').then((m) => m.PosPage) },
  { path: 'discounts', ...admin, loadComponent: () => import('./features/discounts/discounts.page').then((m) => m.DiscountsPage) },
  { path: 'budget', ...admin, loadComponent: () => import('./features/budget/budget.page').then((m) => m.BudgetPage) },
  { path: 'settings', ...admin, loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },

  { path: 'scan', ...admin, loadComponent: () => import('./features/scanner/scan.page').then((m) => m.ScanPage) },

  { path: 'oils', loadComponent: () => import('./features/personal/oils.page').then((m) => m.OilsPage) },
  { path: 'wishlist', loadComponent: () => import('./features/personal/wishlist.page').then((m) => m.WishlistPage) },
  { path: 'rumi', loadComponent: () => import('./features/personal/rumi.page').then((m) => m.RumiPage) },
  { path: 'sync', loadComponent: () => import('./features/personal/sync.page').then((m) => m.SyncPage) },

  { path: '**', redirectTo: '' },
];
