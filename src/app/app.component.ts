import { ChangeDetectionStrategy, Component, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { IconComponent } from './icon.component';
import { AuthService } from './auth.service';
import { ShopAdminService } from './shop-admin.service';
import { OilsService } from './oils.service';
import { SyncService } from './sync.service';
import { UiService } from './core/ui.service';
import { ScanService } from './core/scan.service';
import { FieldScanService } from './core/field-scan.service';
import { NAV, NAV_GROUPS, NavItem, titleFor } from './core/nav';
import { ScannerComponent } from './features/scanner/scanner.component';
import { PosQueueService } from './features/pos/pos-queue.service';
import { SoundManager } from './sound/sound-manager';
import { initNotifications } from './notifications';
import { registerPush } from './push';
import { setPlaceholderOverrides } from './product-image';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ScannerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly shop = inject(ShopAdminService);
  readonly oils = inject(OilsService);
  readonly sync = inject(SyncService);
  readonly ui = inject(UiService);
  readonly scan = inject(ScanService);
  private fieldScan = inject(FieldScanService);
  private posQueue = inject(PosQueueService);
  private router = inject(Router);
  private location = inject(Location);
  private zone = inject(NgZone);

  readonly groups = NAV_GROUPS;
  readonly menuOpen = signal(false);
  readonly url = toSignal(
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)),
    { initialValue: this.router.url },
  );
  readonly title = computed(() => titleFor(this.url()));
  readonly onScanScreen = computed(() => this.url().startsWith('/scan'));
  /** Detail screens show a back arrow instead of the menu button on phones. */
  readonly isDetail = computed(() => /^\/(orders|products)\/[^/?]+/.test(this.url()) || this.url().startsWith('/sync'));
  readonly isAdmin = computed(() => this.auth.isAdmin);
  readonly navItems = computed(() => NAV.filter((n) => !n.admin || this.isAdmin()));
  readonly pendingReviews = computed(() => this.shop.reviews().filter((r) => !r.approved).length);

  /** How many in-app screens deep we are, so Back knows when to leave. */
  private depth = 0;
  private lastOrderCount = -1;

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationStart => e instanceof NavigationStart)).subscribe((e) => {
      if (e.navigationTrigger === 'popstate') this.depth = Math.max(0, this.depth - 1);
      else if (!this.router.getCurrentNavigation()?.extras.replaceUrl) this.depth++;
      this.menuOpen.set(false);
    });
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => window.scrollTo({ top: 0 }));

    // Live shop data + hardware trigger follow the admin session.
    effect(() => {
      const admin = this.isAdmin();
      untracked(() => {
        if (admin) this.shop.start(); else this.shop.stop();
        this.fieldScan.setAllowed(admin);
      });
    });

    // New order chime (after the first snapshot, so startup is silent).
    effect(() => {
      if (!this.isAdmin() || this.shop.loadingOrders()) { if (!this.isAdmin()) this.lastOrderCount = -1; return; }
      const count = this.shop.orders().length;
      untracked(() => {
        if (this.lastOrderCount >= 0 && count > this.lastOrderCount) {
          this.ui.toast('New order received', 'info');
          SoundManager.feedback('notify');
        }
        this.lastOrderCount = count;
      });
    });

    // Storefront placeholder images follow live settings everywhere.
    effect(() => {
      const s = this.shop.settings();
      setPlaceholderOverrides(
        s?.placeholderMen, s?.placeholderWomen,
        s?.placeholderMen30, s?.placeholderMen50, s?.placeholderMen100,
        s?.placeholderWomen30, s?.placeholderWomen50, s?.placeholderWomen100,
      );
    });

    // Offline POS sales go up as soon as we're online and products are loaded.
    this.posQueue.init();
    effect(() => { if (this.isAdmin() && this.shop.products().length) untracked(() => void this.posQueue.flush()); });

    void initNotifications();
    void registerPush();
    window.addEventListener('pointerdown', () => void SoundManager.unlock(), { once: true });
    this.initBack();
    // Warm the scanner code while idle so the first scan opens instantly.
    const idle = (window as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => { void import('./features/scanner/scan-engine').then((m) => m.ScanEngine.prewarm()); });
  }

  itemsIn(group: NavItem['group']): NavItem[] { return this.navItems().filter((n) => n.group === group); }

  badge(path: string): number {
    if (path === 'orders') return this.shop.pendingOrderCount();
    if (path === 'reviews') return this.pendingReviews();
    if (path === 'oils') return this.oils.lowCount();
    return 0;
  }

  back(): void {
    if (this.depth > 0) this.location.back();
    else void this.router.navigateByUrl(this.isAdmin() ? '/dashboard' : '/oils', { replaceUrl: true });
  }

  async signOut(): Promise<void> {
    if (!(await this.ui.confirm({ title: 'Sign out?', message: 'You will need your password to get back into the shop admin.', confirmLabel: 'Sign out' }))) return;
    await this.auth.signOut();
    void this.router.navigateByUrl('/oils', { replaceUrl: true });
  }

  /** Android back: top layer first, then screens, then minimise. */
  private handleBack(): boolean {
    if (this.ui.closeTopOverlay()) return true;
    if (this.scan.session()) { this.scan.close(); return true; }
    if (this.menuOpen()) { this.menuOpen.set(false); return true; }
    if (this.depth > 0) { this.location.back(); return true; }
    const home = this.isAdmin() ? '/dashboard' : '/oils';
    if (!this.url().startsWith(home)) { void this.router.navigateByUrl(home, { replaceUrl: true }); return true; }
    return false;
  }

  private initBack(): void {
    if (!Capacitor.isNativePlatform()) return;
    // Long-press shortcuts (kauatracker://scan, //pos, //orders) open that screen.
    const open = (url?: string) => this.zone.run(() => {
      const m = /^kauatracker:\/\/([a-z-]+)/i.exec(url || '');
      const allowed = ['scan', 'pos', 'orders', 'products', 'dashboard'];
      if (m && allowed.includes(m[1].toLowerCase())) void this.router.navigateByUrl('/' + m[1].toLowerCase());
    });
    void CapApp.addListener('appUrlOpen', (e) => open(e.url));
    void CapApp.getLaunchUrl().then((r) => open(r?.url)).catch(() => {});
    void CapApp.addListener('backButton', () => this.zone.run(() => {
      if (!this.handleBack()) void CapApp.minimizeApp();
    }));
  }
}
