import { Capacitor, PluginListenerHandle } from '@capacitor/core';

/**
 * ScanEngine — picks the fastest decoder the device has and hides the
 * differences from the UI.
 *
 *  1. native   — Google ML Kit on the camera stream (Android/iOS APK). The
 *                camera renders *behind* the WebView, decoding happens in
 *                native code at full frame rate. This is the "Zebra" path.
 *  2. detector — the browser's BarcodeDetector (Chrome on Android, macOS).
 *  3. zxing    — zxing-wasm in a Web Worker on a cropped, down-scaled frame,
 *                so the UI thread never stalls (desktop Firefox/Windows etc).
 */
export type EngineKind = 'native' | 'detector' | 'zxing';
export interface ScanHit { text: string; format?: string; }

const NATIVE_CLASS = 'kf-native-scan';

/** Region of the frame we decode on the web paths: the reticle area. */
const ROI_W = 0.82;
const ROI_H = 0.5;
const ROI_MAX = 960;

export class ScanEngine {
  kind: EngineKind | null = null;
  torchAvailable = false;

  private running = false;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private detector: any = null;
  private worker: Worker | null = null;
  private pending = false;
  private nativeListener: PluginListenerHandle | null = null;
  private frameHandle = 0;

  constructor(private readonly onHit: (hit: ScanHit) => void) {}

  static isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async start(video: HTMLVideoElement | null): Promise<void> {
    if (this.running) return;
    if (ScanEngine.isNative()) {
      await this.startNative();
    } else {
      if (!video) throw new Error('No video element');
      await this.startWeb(video);
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    const v = this.video as any;
    if (v && v.cancelVideoFrameCallback && this.frameHandle) {
      try { v.cancelVideoFrameCallback(this.frameHandle); } catch { /* ignore */ }
    }
    if (this.kind === 'native') {
      try {
        const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
        await this.nativeListener?.remove();
        await BarcodeScanner.stopScan();
      } catch { /* already stopped */ }
      document.documentElement.classList.remove(NATIVE_CLASS);
    }
    this.nativeListener = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.worker?.terminate();
    this.worker = null;
    this.detector = null;
    this.pending = false;
  }

  async setTorch(on: boolean): Promise<boolean> {
    try {
      if (this.kind === 'native') {
        const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
        if (on) await BarcodeScanner.enableTorch();
        else await BarcodeScanner.disableTorch();
        return true;
      }
      const track = this.stream?.getVideoTracks()[0];
      if (!track) return false;
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- native

  private async startNative(): Promise<void> {
    const { BarcodeScanner, BarcodeFormat, LensFacing, Resolution } = await import('@capacitor-mlkit/barcode-scanning');
    let perm = await BarcodeScanner.checkPermissions();
    if (perm.camera !== 'granted') perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== 'granted') throw new Error('Camera permission denied');

    // The preview is drawn behind the WebView, so the page must go see-through.
    document.documentElement.classList.add(NATIVE_CLASS);
    this.nativeListener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
      const b = event.barcodes?.[0];
      const text = b?.rawValue ?? b?.displayValue;
      if (text) this.onHit({ text, format: b.format });
    });
    try {
      await BarcodeScanner.startScan({
        lensFacing: LensFacing.Back,
        resolution: Resolution['1280x720'],
        // Fewer formats = faster decode. These cover everything we print.
        formats: [
          BarcodeFormat.QrCode, BarcodeFormat.Code128, BarcodeFormat.Code39,
          BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA,
          BarcodeFormat.UpcE, BarcodeFormat.Itf, BarcodeFormat.DataMatrix,
        ],
      });
    } catch (e) {
      document.documentElement.classList.remove(NATIVE_CLASS);
      await this.nativeListener?.remove();
      throw e;
    }
    this.kind = 'native';
    try {
      this.torchAvailable = (await BarcodeScanner.isTorchAvailable()).available;
    } catch {
      this.torchAvailable = false;
    }
  }

  // ------------------------------------------------------------------- web

  private async startWeb(video: HTMLVideoElement): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera API');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    const track = this.stream.getVideoTracks()[0];
    try {
      const caps: any = track.getCapabilities?.() ?? {};
      this.torchAvailable = !!caps.torch;
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
      }
    } catch { /* optional */ }

    this.video = video;
    video.srcObject = this.stream;
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    await video.play();

    const Detector = (window as any).BarcodeDetector;
    if (Detector) {
      try {
        const supported: string[] = await Detector.getSupportedFormats();
        const wanted = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'data_matrix'];
        const formats = wanted.filter((f) => supported.includes(f));
        if (formats.length) {
          this.detector = new Detector({ formats });
          this.kind = 'detector';
        }
      } catch { this.detector = null; }
    }
    if (!this.detector) {
      this.worker = new Worker(new URL('./zxing.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ text: string | null; format?: string }>) => {
        this.pending = false;
        if (e.data?.text && this.running) this.onHit({ text: e.data.text, format: e.data.format });
      };
      this.worker.onerror = () => { this.pending = false; };
      this.kind = 'zxing';
    }
    this.schedule();
  }

  /** Run once per *new* camera frame (not per screen refresh) when possible. */
  private schedule(): void {
    const v = this.video as any;
    if (!v) return;
    if (v.requestVideoFrameCallback) this.frameHandle = v.requestVideoFrameCallback(() => this.tick());
    else this.frameHandle = requestAnimationFrame(() => this.tick());
  }

  private async tick(): Promise<void> {
    const video = this.video;
    if (!video) return;
    if (!this.pending && video.readyState >= 2 && video.videoWidth) {
      if (this.detector) {
        this.pending = true;
        try {
          const codes = await this.detector.detect(video);
          const c = codes?.[0];
          if (c?.rawValue && this.running) this.onHit({ text: c.rawValue, format: c.format });
        } catch { /* skip frame */ }
        this.pending = false;
      } else if (this.worker) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sw = Math.round(vw * ROI_W);
        const sh = Math.round(vh * ROI_H);
        const scale = Math.min(1, ROI_MAX / sw);
        try {
          this.pending = true;
          const bitmap = await createImageBitmap(video, Math.round((vw - sw) / 2), Math.round((vh - sh) / 2), sw, sh, {
            resizeWidth: Math.round(sw * scale),
            resizeHeight: Math.round(sh * scale),
            resizeQuality: 'low',
          });
          this.worker.postMessage({ bitmap }, [bitmap]);
        } catch {
          this.pending = false;
        }
      }
    }
    if (this.video) this.schedule();
  }
}
