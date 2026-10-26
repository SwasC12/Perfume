import { compressImage } from './image-util';

// Direct browser -> Cloudinary uploads. Nothing passes through our servers and
// only the resulting URL is stored in Firestore, which keeps product documents
// small and lets Cloudinary serve resized WebP/AVIF copies.
export const CLOUDINARY_CLOUD = 'dpuvlgxsa';
// Create this preset in Cloudinary: Settings -> Upload -> Add upload preset,
// Signing mode: Unsigned. Change the name here if you use a different one.
export const CLOUDINARY_PRESET = 'kaua_unsigned';

let cloudinaryDisabled = false;

export function cloudinaryReady(): boolean {
  return !cloudinaryDisabled;
}

export async function uploadToCloudinary(dataUrl: string, folder = 'kaua/products'): Promise<string> {
  if (cloudinaryDisabled) throw new Error('Cloudinary disabled');
  const form = new FormData();
  form.append('file', dataUrl);
  form.append('upload_preset', CLOUDINARY_PRESET);
  if (folder) form.append('folder', folder);
  const res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD + '/image/upload', {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    // A bad/missing preset would otherwise fail on every single upload.
    if (res.status === 400 || res.status === 401 || res.status === 403) cloudinaryDisabled = true;
    throw new Error((data && data.error && data.error.message) || 'Upload failed');
  }
  return String(data.secure_url);
}

/**
 * Compress locally (fast, keeps uploads small), then upload. If Cloudinary is
 * not configured yet, fall back to the compressed data URL so nothing breaks.
 */
export async function imageFromFile(file: File, maxDim = 1400, quality = 0.85, folder = 'kaua/products'): Promise<string> {
  const compressed = await compressImage(file, maxDim, quality);
  try {
    return await uploadToCloudinary(compressed, folder);
  } catch {
    return compressed;
  }
}
