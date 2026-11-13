import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * What a bottle shows.
 *  - art:  the brand's 100ml photo (Image manager). The raven logo is cut from
 *          it for the label. '' = label with text only.
 *  - name: scent name, printed on the back of the label.
 */
export interface BottleSpec {
  art: string;
  name?: string;
  /** Oil colour. Kaua oil is golden amber. */
  oil?: number;
  /** 0..1, how full. */
  fill?: number;
}

export const AMBER = 0xe0a030;
export const OIL = { men: 0xd99a2b, women: 0xe58aa6, unisex: 0x5bbf9a, out: 0xdc2626 };
export function oilFor(gender?: string, outOfStock = false): number {
  if (outOfStock) return OIL.out;
  const g = String(gender || '').toLowerCase();
  return g.startsWith('w') ? OIL.women : g.startsWith('m') ? OIL.men : OIL.unisex;
}

// ---------------------------------------------------------------------------
// The Kaua 100ml bottle, measured from the product photo (900px image):
// round glass body 358px wide x 590px tall, heavy clear base ~75px, wooden
// cap 202px wide x 225px tall, wraparound paper label 376px tall starting
// 74px below the shoulder. 1 unit = body radius (179px).
// ---------------------------------------------------------------------------
const R = 1.0;          // body radius
const H = 3.3;          // body height (base to shoulder)
const BASE = 0.42;      // clear glass base thickness
const CAP_R = 0.565;
const CAP_H = 1.26;
const LABEL_TOP = H - 0.41;
const LABEL_H = 2.1;
export const BOTTLE_HEIGHT = H + CAP_H;
/** Label canvas: true proportions of the wrap (circumference x height). */
const LABEL_W = 2048;
const LABEL_PX_H = Math.round(LABEL_W * LABEL_H / (2 * Math.PI * R));

/** Logo area inside the 900x900 brand photo (raven + bottle). */
const LOGO_CROP = { x: 355 / 900, y: 360 / 900, w: 170 / 900, h: 225 / 900 };

/**
 * One Kaua 100ml bottle on a stage. Used by the 3D Lab showcase and the
 * customer display.
 *
 *   const stage = new BottleStage(hostEl, { controls: true });
 *   stage.show({ art: url, name: 'Creed Aventus' });
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
  private resizeObs: ResizeObserver;
  private clock = new THREE.Clock();
  private envTex: THREE.Texture;
  private woodSide: THREE.CanvasTexture;
  private backdrop: THREE.CanvasTexture;
  private woodTop: THREE.CanvasTexture;
  private logoCache = new Map<string, Promise<HTMLImageElement | null>>();
  spinSpeed = 0.55;

  constructor(private host: HTMLElement, opts: { controls?: boolean } = {}) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(host.clientWidth || 300, host.clientHeight || 300);
    // Neutral keeps the amber oil and beech wood true to colour (ACES washes them out).
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(r.domElement);
    this.renderer = r;

    // Studio reflections for the glass, generated in code (no files to load).
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    // The scene draws its own backdrop: glass and oil refract it (real
    // transmission). With a see-through canvas they would look milky.
    this.backdrop = backdropTexture();
    this.scene.background = this.backdrop;

    this.woodSide = woodTexture(false);
    this.woodTop = woodTexture(true);
    (this.woodSide as any).__shared = (this.woodTop as any).__shared = true;

    this.camera = new THREE.PerspectiveCamera(30, (host.clientWidth || 1) / (host.clientHeight || 1), 0.1, 100);
    this.frameCamera();

    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 6, 5);
    const rim = new THREE.DirectionalLight(0xfff1d6, 0.9);
    rim.position.set(-4, 3, -3);
    this.scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.25));
    this.scene.add(this.makeShadow(), this.makeGlow());

    if (opts.controls) {
      const c = new OrbitControls(this.camera, r.domElement);
      c.enableDamping = true;
      c.enablePan = false;
      c.minDistance = 6;
      c.maxDistance = 20;
      c.target.set(0, BOTTLE_HEIGHT * 0.47, 0);
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
    g.position.y = -5;
    g.rotation.y = this.outgoing ? this.outgoing.group.rotation.y : -0.4;
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
    const n = 180;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 0.08), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), n);
    const palette = [0xe0a93b, 0x123b70, 0xf1eee6, 0xc99a63, 0xffffff];
    const c = new THREE.Color();
    this.confettiVel = [];
    for (let i = 0; i < n; i++) {
      mesh.setColorAt(i, c.setHex(palette[i % palette.length]));
      this.confettiVel.push(new THREE.Vector3((Math.random() - 0.5) * 7, 5 + Math.random() * 5, (Math.random() - 0.5) * 4));
    }
    mesh.userData['pos'] = Array.from({ length: n }, () => new THREE.Vector3(0, BOTTLE_HEIGHT * 0.6, 0));
    this.scene.add(mesh);
    this.confetti = mesh;
    this.confettiT = 0;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.controls?.dispose();
    this.clearConfetti();
    this.scene.traverse((o) => disposeObject(o));
    this.woodSide.dispose();
    this.woodTop.dispose();
    this.backdrop.dispose();
    this.envTex.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ model

  private makeBottle(spec: BottleSpec): THREE.Group {
    const g = new THREE.Group();

    // Glass body: a lathe-turned profile with rounded heel and shoulder.
    const glass = new THREE.Mesh(
      new THREE.LatheGeometry(bodyProfile(), 96),
      // Clear glass = reflections + a whisper of tint. (Only the oil uses real
      // transmission: three.js can't show one transmissive object through
      // another, and thin glass walls barely bend light anyway.)
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0, roughness: 0.015,
        clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5,
        transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    glass.renderOrder = 3;
    g.add(glass);

    // The heavy clear base, like the real bottle.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.035, R - 0.06, BASE - 0.04, 72),
      new THREE.MeshPhysicalMaterial({ color: 0xeef4ff, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.4, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    base.position.y = (BASE - 0.04) / 2 + 0.02;
    g.add(base);

    // Oil: sits on the heavy base and fills to just under the shoulder.
    const fill = Math.max(0.05, Math.min(1, spec.fill ?? 0.94));
    const oilMax = H - BASE - 0.16;
    const oilH = oilMax * fill;
    const oil = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 0.06, R - 0.06, oilH, 72, 1),
      // Light is absorbed the further it travels through the oil, so the
      // middle reads deep amber and the edges pale gold, like real perfume.
      new THREE.MeshPhysicalMaterial({
        color: 0xffedc2, roughness: 0.04, metalness: 0,
        transmission: 1, thickness: 1.6, ior: 1.46,
        attenuationColor: new THREE.Color(spec.oil ?? AMBER), attenuationDistance: 2.4,
        // A little inner glow: lit perfume looks lit from within.
        emissive: new THREE.Color(spec.oil ?? AMBER), emissiveIntensity: 0.32,
        specularIntensity: 0.6, envMapIntensity: 0.9,
      }),
    );
    // Meniscus: a thin bright ring where the oil meets the glass.
    const meniscus = new THREE.Mesh(
      new THREE.TorusGeometry(R - 0.075, 0.018, 8, 96),
      new THREE.MeshPhysicalMaterial({ color: 0xffe9b8, roughness: 0.1, transmission: 0.6, thickness: 0.1, transparent: true, opacity: 0.85 }),
    );
    meniscus.rotation.x = Math.PI / 2;
    meniscus.position.y = BASE + oilH - 0.005;
    g.add(meniscus);
    oil.position.y = BASE + oilH / 2;
    g.add(oil);

    // Clear glass neck under the cap.
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.32, 0.12, 40),
      new THREE.MeshPhysicalMaterial({ color: 0xdfe9f7, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.35 }),
    );
    neck.position.y = H + 0.05;
    g.add(neck);

    // Wooden cap (beech grain on the side, growth rings on top).
    const capSide = new THREE.MeshStandardMaterial({ map: this.woodSide, roughness: 0.62, metalness: 0 });
    const capTop = new THREE.MeshStandardMaterial({ map: this.woodTop, roughness: 0.6, metalness: 0 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(CAP_R, CAP_R, CAP_H, 64, 1), [capSide, capTop, capTop]);
    cap.position.y = H + 0.1 + CAP_H / 2;
    g.add(cap);

    // Wraparound paper label (front = brand, back = scent name).
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = LABEL_W;
    labelCanvas.height = LABEL_PX_H;
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelTex.anisotropy = 8;
    const label = new THREE.Mesh(
      // thetaStart = PI puts the middle of the texture (u = 0.5) facing +z.
      new THREE.CylinderGeometry(R + 0.006, R + 0.006, LABEL_H, 128, 1, true, Math.PI, Math.PI * 2),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.85, metalness: 0 }),
    );
    label.position.y = LABEL_TOP - LABEL_H / 2;
    label.renderOrder = 2;
    g.add(label);
    void this.paintLabel(labelCanvas, labelTex, spec);

    return g;
  }

  /** Draw the label: paper, rules, raven (from the brand photo), wordmark, scent name. */
  private async paintLabel(c: HTMLCanvasElement, tex: THREE.CanvasTexture, spec: BottleSpec): Promise<void> {
    const W = c.width, Hh = c.height;
    const x = c.getContext('2d')!;
    // Paper with a faint texture.
    x.fillStyle = '#f1eee6';
    x.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = `rgba(120,100,70,${Math.random() * 0.035})`;
      x.fillRect(Math.random() * W, Math.random() * Hh, 2, 2);
    }
    // Thin rules near the top and bottom edges.
    x.fillStyle = '#1b1b1b';
    x.fillRect(0, Math.round(Hh * 0.035), W, 3);
    x.fillRect(0, Math.round(Hh * 0.958), W, 3);

    const cx = W / 2; // front centre
    tex.needsUpdate = true; // show the paper right away; the logo follows
    const logo = spec.art ? await this.loadImage(spec.art) : null;
    if (logo) {
      const sw = logo.naturalWidth, sh = logo.naturalHeight;
      const lh = Hh * 0.56, lw = lh * (LOGO_CROP.w * sw) / (LOGO_CROP.h * sh);
      const ink = inkFrom(logo, LOGO_CROP.x * sw, LOGO_CROP.y * sh, LOGO_CROP.w * sw, LOGO_CROP.h * sh);
      if (ink) x.drawImage(ink, cx - lw / 2, Hh * 0.08, lw, lh);
    }
    x.fillStyle = '#141414';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.font = `800 ${Math.round(Hh * 0.15)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
    spaced(x, 'KAUĀ', cx, Hh * 0.8, Hh * 0.012);
    x.font = `600 ${Math.round(Hh * 0.075)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
    spaced(x, 'FRAGRANCES', cx, Hh * 0.9, Hh * 0.012);

    // Back of the label (u = 0 / 1): the scent, wrapped across the seam.
    if (spec.name) {
      const name = spec.name.replace(/^inspired\s+by\s+/i, '');
      for (const bx of [0, W]) {
        x.fillStyle = '#6b6357';
        x.font = `600 ${Math.round(Hh * 0.055)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
        spaced(x, 'INSPIRED BY', bx, Hh * 0.38, Hh * 0.01);
        x.fillStyle = '#141414';
        x.font = `700 ${Math.round(Hh * 0.1)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
        fitText(x, name, bx, Hh * 0.52, W * 0.3);
        x.fillStyle = '#6b6357';
        x.font = `500 ${Math.round(Hh * 0.055)}px "Helvetica Neue", Arial, system-ui, sans-serif`;
        spaced(x, 'EAU DE PARFUM · 100 ML', bx, Hh * 0.66, Hh * 0.008);
      }
    }
    tex.needsUpdate = true;
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    let p = this.logoCache.get(url);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Cloudinary sends CORS headers; needed to draw it on a canvas
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
      this.logoCache.set(url, p);
    }
    return p;
  }

  /** Warm light that passes through the oil and lands on the floor. */
  private makeGlow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grd = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,190,90,.55)');
    grd.addColorStop(0.5, 'rgba(230,150,40,.18)');
    grd.addColorStop(1, 'rgba(230,150,40,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.35, -0.01, 0.55); // offset away from the key light
    return m;
  }

  private makeShadow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.02;
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
      o.position.y = -ease(Math.min(1, this.outgoing.t)) * 6;
      o.rotation.y += dt * 6;
      if (this.outgoing.t >= 1) { this.scene.remove(o); o.traverse((x) => disposeObject(x)); this.outgoing = null; }
    }
    if (this.incoming) {
      this.incoming.t += dt * 1.5;
      const t = Math.min(1, this.incoming.t);
      this.incoming.group.position.y = -5 * (1 - ease(t)) + Math.sin(t * Math.PI) * 0.5;
      this.incoming.group.rotation.y += dt * (1 - t) * 9;
      if (t >= 1) { this.incoming.group.position.y = 0; this.incoming = null; }
    }
    if (this.bottle && !this.incoming) {
      this.bottle.rotation.y += dt * this.spinSpeed;
      this.bottle.position.y = Math.sin(performance.now() / 900) * 0.06;
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
      v.y -= 7 * dt;
      v.multiplyScalar(0.993);
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
    disposeObject(this.confetti);
    this.confetti.dispose();
    this.confetti = null;
  }

  /** Fit the whole bottle in view with a little headroom. */
  private frameCamera(): void {
    const aspect = this.camera.aspect || 1;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const needH = BOTTLE_HEIGHT * 1.25;
    const needW = R * 2 * 1.9;
    const distH = needH / 2 / Math.tan(vFov / 2);
    const distW = needW / 2 / (Math.tan(vFov / 2) * aspect);
    const d = Math.max(distH, distW);
    const cy = BOTTLE_HEIGHT * 0.47;
    this.camera.position.set(0, cy + d * 0.12, d);
    this.camera.lookAt(0, cy, 0);
    this.controls?.target.set(0, cy, 0);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.controls || this.spinSpeed > 0) this.frameCamera();
  }
}

// ---------------------------------------------------------------- helpers

/** Navy studio backdrop matching the app (rendered by three so glass can refract it). */
function backdropTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(256, 190, 20, 256, 230, 420);
  g.addColorStop(0, '#24497d');
  g.addColorStop(0.55, '#0f2a4d');
  g.addColorStop(1, '#071730');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Outer profile of the body (radius, height), base centre to shoulder centre. */
function bodyProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const heel = 0.1, shoulder = 0.16;
  // Rounded heel.
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - heel + Math.cos(a) * heel, heel + Math.sin(a) * heel));
  }
  // Rounded shoulder.
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - shoulder + Math.cos(a) * shoulder, H - shoulder + Math.sin(a) * shoulder));
  }
  pts.push(new THREE.Vector2(0.34, H), new THREE.Vector2(0, H));
  return pts;
}

/** Beech wood: vertical grain for the side, rings for the top. */
function woodTexture(rings: boolean): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c99762';
  x.fillRect(0, 0, S, S);
  if (rings) {
    for (let r = 4; r < S * 0.72; r += 6 + Math.random() * 7) {
      x.strokeStyle = `rgba(${120 + Math.random() * 30},${78 + Math.random() * 20},${40},${0.12 + Math.random() * 0.18})`;
      x.lineWidth = 1 + Math.random() * 2.2;
      x.beginPath();
      x.ellipse(S / 2 + Math.random() * 3, S / 2 + Math.random() * 3, r, r * (0.96 + Math.random() * 0.06), 0, 0, Math.PI * 2);
      x.stroke();
    }
  } else {
    for (let i = 0; i < 160; i++) {
      const gx = Math.random() * S;
      const amp = 2 + Math.random() * 6, freq = 0.004 + Math.random() * 0.01, ph = Math.random() * 6;
      x.strokeStyle = Math.random() < 0.7
        ? `rgba(130,84,44,${0.08 + Math.random() * 0.22})`
        : `rgba(235,200,150,${0.1 + Math.random() * 0.2})`;
      x.lineWidth = 0.6 + Math.random() * 2.4;
      x.beginPath();
      for (let y = 0; y <= S; y += 8) {
        const px = gx + Math.sin(y * freq + ph) * amp;
        if (y === 0) x.moveTo(px, y); else x.lineTo(px, y);
      }
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  if (!rings) t.repeat.set(2, 1);
  t.anisotropy = 4;
  return t;
}

/**
 * Cut the black artwork out of a photo crop: dark pixels become ink, the
 * off-white paper becomes transparent (no grey box around the raven).
 */
function inkFrom(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      // Paper (~225+) -> clear, ink (~40) -> solid, smooth edge between.
      const a = Math.max(0, Math.min(1, (190 - lum) / 120));
      px[i] = px[i + 1] = px[i + 2] = 20;
      px[i + 3] = Math.round(a * 255);
    }
    x.putImageData(d, 0, 0);
    return c;
  } catch {
    return null; // image not CORS-readable
  }
}

/** Letter-spaced text (canvas letterSpacing isn't on older WebViews). */
function spaced(x: CanvasRenderingContext2D, text: string, cx: number, y: number, gap: number): void {
  const widths = [...text].map((ch) => x.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
  let px = cx - total / 2;
  const align = x.textAlign;
  x.textAlign = 'left';
  [...text].forEach((ch, i) => { x.fillText(ch, px, y); px += widths[i] + gap; });
  x.textAlign = align;
}

/** Centered text, shrunk to fit maxW. */
function fitText(x: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number): void {
  const w = x.measureText(text).width;
  if (w > maxW) {
    const size = parseFloat(x.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || '40');
    x.font = x.font.replace(/\d+(?:\.\d+)?px/, Math.floor(size * maxW / w) + 'px');
  }
  x.fillText(text, cx, y);
}

function disposeObject(o: THREE.Object3D): void {
  const any = o as any;
  any.geometry?.dispose?.();
  const mats = Array.isArray(any.material) ? any.material : any.material ? [any.material] : [];
  for (const m of mats) {
    // Shared wood textures are disposed by the stage, not per bottle.
    if (m.map && !(m.map as any).__shared) m.map.dispose?.();
    m.dispose?.();
  }
}
