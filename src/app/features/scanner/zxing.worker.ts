/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

// Load the decoder from our own origin (bundled at /zxing/) instead of a CDN:
// works offline and avoids a slow first scan.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? new URL('/zxing/zxing_reader.wasm', self.location.origin).href : prefix + path,
  },
  fireImmediately: true,
});

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

addEventListener('message', async ({ data }: MessageEvent<{ bitmap: ImageBitmap }>) => {
  const bitmap = data.bitmap;
  try {
    const { width, height } = bitmap;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) throw new Error('no ctx');
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const results = await readBarcodes(image, {
      formats: ['QRCode', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF', 'DataMatrix'],
      tryHarder: false,
      tryInvert: false,
      maxNumberOfSymbols: 1,
    });
    const hit = results.find((r) => r.isValid && r.text);
    postMessage({ text: hit ? hit.text : null, format: hit?.format });
  } catch {
    postMessage({ text: null });
  } finally {
    bitmap.close();
  }
});
