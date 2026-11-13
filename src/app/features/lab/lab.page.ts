import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopAdminService } from '../../shop-admin.service';
import { Product, PRODUCT_SIZE_LABELS, sizeOptions } from '../../models';
import { IconComponent } from '../../icon.component';
import { LoaderComponent } from '../../shared/loader.component';
import { ShowcaseComponent } from './showcase.component';
import { SalesCityComponent } from './sales-city.component';

type Tab = 'shelf' | 'showcase' | 'city';

type Filter = 'all' | 'low' | 'out';
interface Picked { product: Product; units: number; sizes: string; }

const LOW = 5;
/** Liquid colours by gender (out of stock = red). */
const COLORS = { men: 0xd99a2b, women: 0xe58aa6, unisex: 0x5bbf9a, out: 0xdc2626 };

/**
 * 3D Lab — a playground for three.js inside the admin app, loaded only when
 * opened (three.js is ~600 KB, kept out of every other screen).
 *
 * First experiment: the stock shelf. Every product is a bottle; the oil level
 * shows units in stock relative to the best-stocked product. Drag to spin,
 * pinch/scroll to zoom, tap a bottle for details.
 */
@Component({
  standalone: true,
  imports: [RouterLink, IconComponent, LoaderComponent, ShowcaseComponent, SalesCityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lab">
      <div class="lab-tabs">
        <div class="seg">
          <button [class.on]="tab() === 'shelf'" (click)="tab.set('shelf')">Shelf</button>
          <button [class.on]="tab() === 'showcase'" (click)="tab.set('showcase')">Showcase</button>
          <button [class.on]="tab() === 'city'" (click)="tab.set('city')">Sales city</button>
        </div>
        <a class="btn btn-sm btn-primary" routerLink="/display"><app-icon name="eye" [size]="15" /> Customer display</a>
      </div>
      @if (tab() === 'showcase') { <kf-showcase class="pane" /> }
      @if (tab() === 'city') { <kf-sales-city class="pane" /> }
      <div class="lab-bar" [hidden]="tab() !== 'shelf'">
        <div class="chips">
          <button class="chip" [class.on]="filter() === 'all'" (click)="filter.set('all')">All <span class="n">{{ counts().all }}</span></button>
          <button class="chip" [class.on]="filter() === 'low'" (click)="filter.set('low')">Low <span class="n">{{ counts().low }}</span></button>
          <button class="chip" [class.on]="filter() === 'out'" (click)="filter.set('out')">Out <span class="n">{{ counts().out }}</span></button>
        </div>
        <button class="btn btn-sm btn-ghost" (click)="toggleSpin()">{{ spinning() ? 'Stop spin' : 'Spin' }}</button>
      </div>

      <div #stage class="stage" [hidden]="tab() !== 'shelf'">
        @if (!ready()) { <kf-loader class="stage-loader" label="Building the 3D shelf…" /> }
        @if (ready() && !visible().length) { <p class="stage-empty">No products in this view.</p> }
        <div class="legend">
          <span><i style="background:#d99a2b"></i>Men</span>
          <span><i style="background:#e58aa6"></i>Women</span>
          <span><i style="background:#5bbf9a"></i>Unisex</span>
          <span><i style="background:#dc2626"></i>Out</span>
        </div>
      </div>

      @if (picked(); as p) {
        <div class="pick card">
          <div class="li-main">
            <span class="li-title">{{ p.product.name }}</span>
            <span class="li-sub">{{ p.units }} in stock{{ p.sizes ? ' · ' + p.sizes : '' }}</span>
          </div>
          <a class="btn btn-sm btn-primary" [routerLink]="['/products', p.product.id]">Open</a>
          <button class="btn btn-sm btn-ghost btn-icon" (click)="picked.set(null)" aria-label="Close"><app-icon name="x" [size]="16" /></button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .lab { position: relative; display: flex; flex-direction: column; height: calc(100dvh - var(--topbar-h) - var(--safe-t) - var(--tabbar-h) - var(--safe-b)); }
    @media (min-width: 1200px) { .lab { height: 100dvh; } }
    .lab-tabs { display: flex; align-items: center; gap: 8px; padding: 10px var(--page-pad) 0; flex-wrap: wrap; }
    .lab-tabs .seg { flex: 1; min-width: 0; }
    .pane { flex: 1; min-height: 0; }
    .lab-bar { display: flex; align-items: center; gap: 8px; padding: 10px var(--page-pad); }
    .lab-bar .chips { flex: 1; }
    .stage { position: relative; flex: 1; min-height: 0; background: radial-gradient(ellipse at 50% 30%, #18355f 0%, #0b1f3a 70%); overflow: hidden; touch-action: none; }
    .stage ::ng-deep canvas { display: block; width: 100%; height: 100%; }
    .stage-loader { position: absolute; inset: 0; color: #fff; }
    .stage-loader ::ng-deep .lbl { color: #c9d6e6; }
    .stage-empty { position: absolute; inset: 0; display: grid; place-items: center; color: #c9d6e6; pointer-events: none; }
    .legend { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; font-weight: 600; color: #dbe5f1; pointer-events: none; }
    .legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .pick { position: absolute; left: 12px; right: 12px; bottom: 44px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; animation: up .18s var(--ease); }
    @media (min-width: 768px) { .pick { left: auto; width: 380px; } }
    @keyframes up { from { transform: translateY(10px); opacity: 0; } }
  `],
})
export class LabPage implements AfterViewInit, OnDestroy {
  private shop = inject(ShopAdminService);
  private zone = inject(NgZone);
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;

  readonly tab = signal<Tab>('shelf');
  readonly filter = signal<Filter>('all');
  readonly ready = signal(false);
  readonly spinning = signal(true);
  readonly picked = signal<Picked | null>(null);

  private readonly units = (p: Product) => {
    const opts = sizeOptions(p);
    return opts.length ? opts.reduce((t, o) => t + (Number(o.size.stockQty) || 0), 0) : Number(p.stockQty) || 0;
  };

  readonly counts = computed(() => {
    const ps = this.shop.products();
    return {
      all: ps.length,
      low: ps.filter((p) => { const u = this.units(p); return u > 0 && u <= LOW; }).length,
      out: ps.filter((p) => this.units(p) <= 0).length,
    };
  });

  readonly visible = computed(() => {
    const f = this.filter();
    return this.shop.products().filter((p) => {
      const u = this.units(p);
      return f === 'all' ? true : f === 'low' ? u > 0 && u <= LOW : u <= 0;
    });
  });

  // three.js objects (typed loosely: the module is imported lazily)
  private THREE: typeof import('three') | null = null;
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null = null;
  private shelf: import('three').Group | null = null;
  private glass: import('three').InstancedMesh | null = null;
  private shown: Product[] = [];
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;
  private downAt = { x: 0, y: 0, t: 0 };
  private oilMesh: import('three').InstancedMesh | null = null;
  private capMesh: import('three').InstancedMesh | null = null;
  /** Base matrices per bottle part, so a tapped bottle can hop and land back. */
  private bases: { glass: number[]; oil: number[]; cap: number[] }[] = [];
  private hop: { i: number; t: number } | null = null;

  constructor() {
    // Rebuild the shelf whenever products or the filter change.
    effect(() => {
      const list = this.visible();
      if (!this.ready()) return;
      untracked(() => this.zone.runOutsideAngular(() => this.buildShelf(list)));
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const [THREE, { OrbitControls }] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
    ]);
    if (this.disposed) return;
    this.THREE = THREE;
    this.zone.runOutsideAngular(() => {
      const host = this.stageRef.nativeElement;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
      host.prepend(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 200);
      camera.position.set(0, 4, 14);

      scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x0b1f3a, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(5, 10, 8);
      scene.add(sun);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;
      controls.minDistance = 4;
      controls.maxDistance = 40;
      controls.maxPolarAngle = Math.PI * 0.55;
      controls.addEventListener('start', () => { if (controls.autoRotate) this.zone.run(() => this.spinning.set(false)); controls.autoRotate = false; });

      this.renderer = renderer; this.scene = scene; this.camera = camera; this.controls = controls;

      renderer.domElement.addEventListener('pointerdown', (e) => { this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
      renderer.domElement.addEventListener('pointerup', (e) => this.onTap(e));

      this.resizeObs = new ResizeObserver(() => {
        const w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      this.resizeObs.observe(host);

      renderer.setAnimationLoop(() => {
        if (document.hidden || this.tab() !== 'shelf') return;
        this.stepHop();
        controls.update();
        renderer.render(scene, camera);
      });
    });
    this.ready.set(true);
  }

  toggleSpin(): void {
    const on = !this.spinning();
    this.spinning.set(on);
    if (this.controls) this.controls.autoRotate = on;
  }

  /** Bottles laid out on shelves: glass, oil and cap are 3 instanced meshes (3 draw calls). */
  private buildShelf(list: Product[]): void {
    const THREE = this.THREE, scene = this.scene;
    if (!THREE || !scene) return;
    this.clearShelf();
    this.shown = list;
    const n = list.length;
    const group = new THREE.Group();
    if (!n) { this.shelf = group; scene.add(group); return; }

    const cols = Math.max(4, Math.ceil(Math.sqrt(n * 2.2)));
    const rows = Math.ceil(n / cols);
    const gapX = 1.1, gapY = 2.0;
    const maxUnits = Math.max(1, ...list.map(this.units));

    const glassGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.2, 20);
    const oilGeo = new THREE.CylinderGeometry(0.33, 0.33, 1, 20);
    oilGeo.translate(0, 0.5, 0); // scale from the bottom up
    const capGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.28, 12);
    const glass = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.1, depthWrite: false }), n);
    const oil = new THREE.InstancedMesh(oilGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), n);
    const cap = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x123b70, roughness: 0.4, metalness: 0.6 }), n);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const color = new THREE.Color();
    list.forEach((prod, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * gapX;
      const y = ((rows - 1) / 2 - r) * gapY;
      const u = this.units(prod);
      const fill = u <= 0 ? 0.04 : Math.max(0.08, Math.min(1, u / maxUnits));
      m.compose(p.set(x, y + 0.6, 0), q, s.set(1, 1, 1)); glass.setMatrixAt(i, m);
      m.compose(p.set(x, y + 0.03, 0), q, s.set(1, 1.12 * fill, 1)); oil.setMatrixAt(i, m);
      m.compose(p.set(x, y + 1.34, 0), q, s.set(1, 1, 1)); cap.setMatrixAt(i, m);
      const g = String(prod.gender || '').toLowerCase();
      color.setHex(u <= 0 ? COLORS.out : g.startsWith('w') ? COLORS.women : g.startsWith('m') ? COLORS.men : COLORS.unisex);
      oil.setColorAt(i, color);
    });
    // Shelf boards under each row.
    const boardGeo = new THREE.BoxGeometry(cols * gapX + 0.6, 0.08, 1.2);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
    for (let r = 0; r < rows; r++) {
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(0, ((rows - 1) / 2 - r) * gapY - 0.04, 0);
      group.add(board);
    }
    this.bases = list.map((_, i) => {
      const a = new THREE.Matrix4(), b = new THREE.Matrix4(), c = new THREE.Matrix4();
      glass.getMatrixAt(i, a); oil.getMatrixAt(i, b); cap.getMatrixAt(i, c);
      return { glass: a.toArray(), oil: b.toArray(), cap: c.toArray() };
    });
    this.oilMesh = oil;
    this.capMesh = cap;
    this.hop = null;
    group.add(oil, glass, cap);
    scene.add(group);
    this.shelf = group;
    this.glass = glass;

    // Frame the whole shelf.
    if (this.camera && this.controls) {
      const size = Math.max(cols * gapX, rows * gapY);
      this.camera.position.set(0, size * 0.25, size * 1.25 + 3);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  /** A short tap (not a drag) picks the bottle under the finger. */
  private onTap(e: PointerEvent): void {
    const THREE = this.THREE;
    if (!THREE || !this.camera || !this.glass || !this.renderer) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    if (moved > 8 || performance.now() - this.downAt.t > 400) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.glass, false)[0];
    this.zone.run(() => {
      if (hit?.instanceId == null) { this.picked.set(null); return; }
      const product = this.shown[hit.instanceId];
      this.hop = { i: hit.instanceId, t: 0 };
      const sizes = sizeOptions(product).map((o) => (PRODUCT_SIZE_LABELS[o.key] || o.size.size) + ': ' + (o.size.stockQty ?? '–')).join(' · ');
      this.picked.set({ product, units: this.units(product), sizes });
    });
  }

  /** A tapped bottle hops up with a little spin and lands back on the shelf. */
  private stepHop(): void {
    const THREE = this.THREE, h = this.hop;
    if (!THREE || !h || !this.glass || !this.oilMesh || !this.capMesh) return;
    h.t = Math.min(1, h.t + 0.045);
    const lift = Math.sin(h.t * Math.PI) * 0.9;
    const spin = new THREE.Matrix4().makeRotationY(h.t * Math.PI * 2);
    const b = this.bases[h.i];
    const set = (mesh: import('three').InstancedMesh, base: number[]) => {
      const m = new THREE.Matrix4().fromArray(base);
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      m.setPosition(0, 0, 0);
      m.premultiply(spin);
      m.setPosition(pos.x, pos.y + lift, pos.z);
      mesh.setMatrixAt(h.i, m);
      mesh.instanceMatrix.needsUpdate = true;
    };
    set(this.glass, b.glass); set(this.oilMesh, b.oil); set(this.capMesh, b.cap);
    if (h.t >= 1) this.hop = null;
  }

  private clearShelf(): void {
    if (!this.shelf || !this.scene) return;
    this.scene.remove(this.shelf);
    this.shelf.traverse((o: any) => {
      o.geometry?.dispose?.();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
      o.dispose?.();
    });
    this.shelf = null;
    this.glass = null;
  }

  ngOnDestroy(): void {
    this.disposed = true;
    this.resizeObs?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.clearShelf();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
