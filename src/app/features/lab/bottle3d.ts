import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** What a bottle shows. `label` is an image URL (the 100ml photo) or ''. */
export interface BottleSpec {
  label: string;
  /** Oil colour, e.g. 0xd99a2b. */
  oil: number;
  /** 0..1, how full. */
  fill?: number;
}

export const OIL = { men: 0xd99a2b, women: 0xe58aa6, unisex: 0x5bbf9a, out: 0xdc2626 };
export function oilFor(gender?: string, outOfStock = false): number {
  if (outOfStock) return OIL.out;
  const g = String(gender || '').toLowerCase();
  return g.startsWith('w') ? OIL.women : g.startsWith('m') ? OIL.men : OIL.unisex;
}

/**
 * One Kaua 100ml-style bottle on a little stage: square glass body, oil
 * inside, gold collar, black cap, and the product's photo as its label.
 * Used by the 3D Lab showcase and the customer display.
 *
 *   const stage = new BottleStage(hostEl, { controls: true });
 *   stage.show({ label: url, oil: OIL.women, fill: .85 });
 *   stage.celebrate();   // confetti
 *   stage.dispose();
 */
export class BottleStage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private bottle: THREE.Group | null = null;
  private incoming: { group: THREE.Group; t: number } | null = null;
  private outgoing: { group: THREE.Group; t: number } | null = null;
  private confetti: THREE.InstancedMesh | null = null;
  private confettiVel: THREE.Vector3[] = [];
  private confettiT = 0;
  private texLoader = new THREE.TextureLoader();
  private resizeObs: ResizeObserver;
  private clock = new THREE.Clock();
  private envTex: THREE.Texture;
  spinSpeed = 0.6;

  constructor(private host: HTMLElement, opts: { controls?: boolean } = {}) {
    this.texLoader.setCrossOrigin('anonymous');
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(host.clientWidth || 300, host.clientHeight || 300);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(r.domElement);
    this.renderer = r;

    // Soft studio reflections without loading any files.
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(32, (host.clientWidth || 1) / (host.clientHeight || 1), 0.1, 100);
    this.camera.position.set(0, 0.6, 7.2);
    this.camera.lookAt(0, 0.3, 0);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));
    this.scene.add(this.makeShadow());

    if (opts.controls) {
      const c = new OrbitControls(this.camera, r.domElement);
      c.enableDamping = true;
      c.enablePan = false;
      c.minDistance = 4;
      c.maxDistance = 12;
      c.target.set(0, 0.3, 0);
      c.addEventListener('start', () => (this.spinSpeed = 0));
      this.controls = c;
    }

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);

    r.setAnimationLoop(() => this.frame());
  }

  /** Swap to a new bottle: the old one drops away, the new one rises in. */
  show(spec: BottleSpec): void {
    if (this.bottle) this.outgoing = { group: this.bottle, t: 0 };
    const g = this.makeBottle(spec);
    g.position.y = -3;
    g.rotation.y = this.outgoing ? this.outgoing.group.rotation.y : 0;
    this.scene.add(g);
    this.bottle = g;
    this.incoming = { group: g, t: 0 };
  }

  /** Little hop + spin, e.g. when the same scent is added again. */
  bounce(): void {
    if (this.bottle) this.incoming = { group: this.bottle, t: 0.55 };
  }

  /** Burst of confetti (sale complete). */
  celebrate(): void {
    this.clearConfetti();
    const n = 160;
    const geo = new THREE.PlaneGeometry(0.09, 0.05);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const palette = [0xe0a93b, 0x123b70, 0xe58aa6, 0x5bbf9a, 0xffffff];
    const c = new THREE.Color();
    this.confettiVel = [];
    for (let i = 0; i < n; i++) {
      c.setHex(palette[i % palette.length]);
      mesh.setColorAt(i, c);
      this.confettiVel.push(new THREE.Vector3((Math.random() - 0.5) * 5, 4 + Math.random() * 4, (Math.random() - 0.5) * 3));
    }
    mesh.userData['pos'] = Array.from({ length: n }, () => new THREE.Vector3(0, 0.5, 0));
    this.scene.add(mesh);
    this.confetti = mesh;
    this.confettiT = 0;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.controls?.dispose();
    this.clearConfetti();
    this.scene.traverse((o: any) => {
      o.geometry?.dispose?.();
      const m = o.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((x: any) => { x.map?.dispose?.(); x.dispose?.(); });
    });
    this.envTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ build

  private makeBottle(spec: BottleSpec): THREE.Group {
    const g = new THREE.Group();
    const W = 1.5, H = 1.9, D = 0.85;

    const glass = new THREE.Mesh(
      new RoundedBoxGeometry(W, H, D, 4, 0.16),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.28,
        clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, depthWrite: false,
      }),
    );
    glass.renderOrder = 2;
    g.add(glass);

    const fill = Math.max(0.06, Math.min(1, spec.fill ?? 0.85));
    const oilH = (H - 0.3) * fill;
    const oil = new THREE.Mesh(
      new RoundedBoxGeometry(W - 0.2, oilH, D - 0.2, 3, 0.1),
      new THREE.MeshPhysicalMaterial({ color: spec.oil, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.9, envMapIntensity: 0.8 }),
    );
    oil.position.y = -H / 2 + 0.15 + oilH / 2;
    g.add(oil);

    // Gold collar + black cap with a gold ring.
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94f, metalness: 1, roughness: 0.25 });
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.22, 32), gold);
    collar.position.y = H / 2 + 0.1;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.7, 40),
      new THREE.MeshStandardMaterial({ color: 0x111418, metalness: 0.4, roughness: 0.25 }),
    );
    cap.position.y = H / 2 + 0.55;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.03, 12, 48), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = H / 2 + 0.3;
    g.add(collar, cap, ring);

    // Label: the product photo on front and back.
    if (spec.label) {
      const labelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0 });
      const lw = W * 0.72, lh = H * 0.62;
      for (const side of [1, -1]) {
        const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), labelMat);
        label.position.set(0, -0.05, side * (D / 2 + 0.003));
        if (side < 0) label.rotation.y = Math.PI;
        g.add(label);
      }
      this.texLoader.load(spec.label, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        // Centre-crop the photo to the label's shape.
        const img = tex.image as { width: number; height: number };
        const want = lw / lh, have = img.width / img.height;
        if (have > want) { tex.repeat.set(want / have, 1); tex.offset.set((1 - want / have) / 2, 0); }
        else { tex.repeat.set(1, have / want); tex.offset.set(0, (1 - have / want) / 2); }
        labelMat.map = tex;
        labelMat.opacity = 1;
        labelMat.needsUpdate = true;
      }, undefined, () => { /* no CORS / broken image: plain bottle */ });
    }
    return g;
  }

  /** A soft dark ellipse under the bottle (fake shadow, no shadow maps). */
  private makeShadow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = -1.06;
    return m;
  }

  // ------------------------------------------------------------------ loop

  private frame(): void {
    if (document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    if (this.outgoing) {
      this.outgoing.t += dt * 2.2;
      const o = this.outgoing.group;
      o.position.y = -ease(Math.min(1, this.outgoing.t)) * 4;
      o.rotation.y += dt * 6;
      if (this.outgoing.t >= 1) { this.scene.remove(o); this.disposeGroup(o); this.outgoing = null; }
    }
    if (this.incoming) {
      this.incoming.t += dt * 1.6;
      const t = Math.min(1, this.incoming.t);
      // Rise in with a small overshoot hop.
      this.incoming.group.position.y = -3 * (1 - ease(t)) + Math.sin(t * Math.PI) * 0.35;
      this.incoming.group.rotation.y += dt * (1 - t) * 10;
      if (t >= 1) { this.incoming.group.position.y = 0; this.incoming = null; }
    }
    if (this.bottle && !this.incoming) {
      this.bottle.rotation.y += dt * this.spinSpeed;
      this.bottle.position.y = Math.sin(performance.now() / 900) * 0.05; // gentle float
    }
    if (this.confetti) this.stepConfetti(dt);

    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  private stepConfetti(dt: number): void {
    const mesh = this.confetti!;
    this.confettiT += dt;
    const pos: THREE.Vector3[] = mesh.userData['pos'];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < pos.length; i++) {
      const v = this.confettiVel[i];
      v.y -= 6 * dt;
      v.multiplyScalar(0.995);
      pos[i].addScaledVector(v, dt);
      e.set(this.confettiT * (3 + (i % 5)), this.confettiT * (2 + (i % 3)), i);
      m.compose(pos[i], q.setFromEuler(e), s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.confettiT > 4) this.clearConfetti();
  }

  private clearConfetti(): void {
    if (!this.confetti) return;
    this.scene.remove(this.confetti);
    this.confetti.geometry.dispose();
    (this.confetti.material as THREE.Material).dispose();
    this.confetti.dispose();
    this.confetti = null;
  }

  private disposeGroup(g: THREE.Object3D): void {
    g.traverse((o: any) => {
      o.geometry?.dispose?.();
      const m = o.material;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((x: any) => { x.map?.dispose?.(); x.dispose?.(); });
    });
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
