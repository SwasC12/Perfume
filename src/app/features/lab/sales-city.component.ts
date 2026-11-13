import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ShopAdminService } from '../../shop-admin.service';
import { IconComponent } from '../../icon.component';
import { LoaderComponent } from '../../shared/loader.component';

interface Day { date: number; online: number; pos: number; orders: number; }
const DAYS = 30;

/**
 * Sales city: the last 30 days as towers. Each day is a block — navy for
 * online, gold for in-store (POS) stacked on top. Taller = more money.
 * Towers grow up when it opens; tap one for that day's numbers.
 */
@Component({
  selector: 'kf-sales-city',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, IconComponent, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="city">
      <div #stage class="stage">
        @if (!ready()) { <kf-loader class="ld" label="Building the skyline…" /> }
        <div class="legend"><span><i style="background:#2878c7"></i>Online</span><span><i style="background:#e0a93b"></i>In store</span></div>
      </div>
      <div class="info">
        @if (picked(); as d) {
          <div class="li-main">
            <span class="li-title">{{ d.date | date:'EEE d MMM' }}</span>
            <span class="li-sub">{{ d.online + d.pos | currency:'ZAR':'symbol-narrow':'1.0-0' }} · {{ d.orders }} order{{ d.orders === 1 ? '' : 's' }} · online {{ d.online | currency:'ZAR':'symbol-narrow':'1.0-0' }} · store {{ d.pos | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span>
          </div>
          <button class="btn btn-sm btn-ghost btn-icon" (click)="picked.set(null)" aria-label="Close"><app-icon name="x" [size]="16" /></button>
        } @else {
          <div class="li-main">
            <span class="li-title">Last {{ days }} days · {{ total() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span>
            <span class="li-sub">Tap a tower for that day. Best day: {{ best() | currency:'ZAR':'symbol-narrow':'1.0-0' }}</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .city { display: flex; flex-direction: column; height: 100%; }
    .stage { position: relative; flex: 1; min-height: 0; background: linear-gradient(#0b1f3a, #18355f); touch-action: none; }
    .stage ::ng-deep canvas { display: block; width: 100% !important; height: 100% !important; }
    .ld { position: absolute; inset: 0; color: #fff; }
    .legend { position: absolute; left: 12px; top: 12px; display: flex; gap: 12px; font-size: 12px; font-weight: 600; color: #dbe5f1; pointer-events: none; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .info { display: flex; align-items: center; gap: 10px; padding: 12px var(--page-pad); background: var(--surface); border-top: 1px solid var(--line); min-height: 64px; }
  `],
})
export class SalesCityComponent implements AfterViewInit, OnDestroy {
  private shop = inject(ShopAdminService);
  private zone = inject(NgZone);
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;
  readonly days = DAYS;
  readonly ready = signal(false);
  readonly picked = signal<Day | null>(null);

  readonly series = computed<Day[]>(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const first = start.getTime() - (DAYS - 1) * 86400000;
    const out: Day[] = Array.from({ length: DAYS }, (_, i) => ({ date: first + i * 86400000, online: 0, pos: 0, orders: 0 }));
    for (const o of this.shop.orders()) {
      if (!['paid', 'fulfilled', 'shipped', 'delivered'].includes(o.status) || !o.createdAt) continue;
      const i = Math.floor((o.createdAt - first) / 86400000);
      if (i < 0 || i >= DAYS) continue;
      if (o.channel === 'pos') out[i].pos += o.total || 0; else out[i].online += o.total || 0;
      out[i].orders++;
    }
    return out;
  });
  readonly total = computed(() => this.series().reduce((t, d) => t + d.online + d.pos, 0));
  readonly best = computed(() => Math.max(0, ...this.series().map((d) => d.online + d.pos)));

  private three: any = null;
  private renderer: any = null;
  private scene: any = null;
  private camera: any = null;
  private controls: any = null;
  private city: any = null;
  private pickables: any[] = [];
  private grow = 0;
  private resizeObs: ResizeObserver | null = null;
  private down = { x: 0, y: 0 };

  constructor() {
    effect(() => {
      const s = this.series();
      if (!this.ready()) return;
      untracked(() => this.zone.runOutsideAngular(() => this.build(s)));
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js')]);
    this.three = THREE;
    this.zone.runOutsideAngular(() => {
      const host = this.stageRef.nativeElement;
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(host.clientWidth, host.clientHeight);
      host.prepend(r.domElement);
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0b1f3a, 30, 70);
      const cam = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 200);
      cam.position.set(14, 14, 22);
      scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x0b1f3a, 1.0));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(-8, 16, 10);
      scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x0e2747, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      const grid = new THREE.GridHelper(60, 60, 0x1f4b80, 0x173a63);
      (grid.material as any).transparent = true; (grid.material as any).opacity = 0.35;
      scene.add(grid);
      const c = new OrbitControls(cam, r.domElement);
      c.enableDamping = true; c.maxPolarAngle = Math.PI * 0.47; c.minDistance = 8; c.maxDistance = 60;
      c.autoRotate = true; c.autoRotateSpeed = 0.5;
      c.addEventListener('start', () => (c.autoRotate = false));
      this.renderer = r; this.scene = scene; this.camera = cam; this.controls = c;
      r.domElement.addEventListener('pointerdown', (e: PointerEvent) => (this.down = { x: e.clientX, y: e.clientY }));
      r.domElement.addEventListener('pointerup', (e: PointerEvent) => this.tap(e));
      this.resizeObs = new ResizeObserver(() => {
        const w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
      });
      this.resizeObs.observe(host);
      r.setAnimationLoop(() => {
        if (document.hidden) return;
        if (this.city && this.grow < 1) {
          this.grow = Math.min(1, this.grow + 0.025);
          const e = 1 - Math.pow(1 - this.grow, 3);
          this.city.scale.y = Math.max(0.001, e);
        }
        c.update();
        r.render(scene, cam);
      });
    });
    this.ready.set(true);
  }

  private build(series: Day[]): void {
    const THREE = this.three;
    if (!THREE || !this.scene) return;
    if (this.city) { this.scene.remove(this.city); this.city.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    const city = new THREE.Group();
    const max = Math.max(1, ...series.map((d) => d.online + d.pos));
    const H = 12, gap = 1.25;
    const onlineMat = new THREE.MeshStandardMaterial({ color: 0x2878c7, roughness: 0.4, metalness: 0.2 });
    const posMat = new THREE.MeshStandardMaterial({ color: 0xe0a93b, roughness: 0.35, metalness: 0.4 });
    const emptyMat = new THREE.MeshStandardMaterial({ color: 0x2b4a72, roughness: 0.8 });
    this.pickables = [];
    series.forEach((d, i) => {
      const x = (i - (series.length - 1) / 2) * gap;
      const hOn = (d.online / max) * H, hPos = (d.pos / max) * H;
      const add = (h: number, y0: number, mat: any) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.max(h, 0.05), 0.9), mat);
        m.position.set(x, y0 + Math.max(h, 0.05) / 2, 0);
        m.userData['day'] = d;
        city.add(m); this.pickables.push(m);
      };
      if (!hOn && !hPos) add(0.08, 0, emptyMat);
      if (hOn) add(hOn, 0, onlineMat);
      if (hPos) add(hPos, hOn, posMat);
    });
    city.scale.y = 0.001;
    this.grow = 0;
    this.scene.add(city);
    this.city = city;
    this.controls?.target.set(0, 3, 0);
  }

  private tap(e: PointerEvent): void {
    const THREE = this.three;
    if (!THREE || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.pickables, false)[0];
    this.zone.run(() => this.picked.set(hit ? hit.object.userData['day'] : null));
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.scene?.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
