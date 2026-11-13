import { compressImage } from './image-util';
import { getAuthInstance } from './firebase';

// Browser -> Cloudinary uploads. The upload preset is in SIGNED mode, so each
// upload first asks the shop Worker for a signature (admin Firebase token
// required; the API secret never leaves the Worker). The image itself goes
// straight to Cloudinary and only the resulting URL is stored in Firestore.
export const CLOUDINARY_CLOUD = 'dpuvlgxsa';
export const CLOUDINARY_PRESET = 'kaua_unsigned';
const SIGN_ENDPOINT = 'https://kauafragrances.co.za/api/cloudinary-sign';

let cloudinaryDisabled = false;

export function cloudinaryReady(): boolean {
  return !cloudinaryDisabled;
}

interface Signed { signature: string; timestamp: number; apiKey: string; folder: string; uploadPreset: string; cloudName?: string; }

async function sign(folder: string): Promise<Signed> {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error('Sign in to upload images');
  const res = await fetch(SIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await user.getIdToken()) },
    body: JSON.stringify({ folder, uploadPreset: CLOUDINARY_PRESET }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signature) {
    if (res.status === 503) cloudinaryDisabled = true; // keys not set on the Worker yet
    throw new Error(data.error || 'Could not authorise the upload');
  }
  return data as Signed;
}

export async function uploadToCloudinary(dataUrl: string, folder = 'kaua/products'): Promise<string> {
  if (cloudinaryDisabled) throw new Error('Cloudinary disabled');
  const s = await sign(folder);
  const form = new FormData();
  form.append('file', dataUrl);
  form.append('upload_preset', s.uploadPreset);
  form.append('folder', s.folder);
  form.append('timestamp', String(s.timestamp));
  form.append('api_key', s.apiKey);
  form.append('signature', s.signature);
  const res = await fetch('https://api.cloudinary.com/v1_1/' + (s.cloudName || CLOUDINARY_CLOUD) + '/image/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) throw new Error((data && data.error && data.error.message) || 'Upload failed');
  return String(data.secure_url);
}

/**
 * Compress locally (fast, keeps uploads small), then upload. If uploading
 * isn't possible, fall back to the compressed data URL so nothing breaks
 * (the product editor still guards the 1 MB document limit).
 */
export async function imageFromFile(file: File, maxDim = 1400, quality = 0.85, folder = 'kaua/products'): Promise<string> {
  const compressed = await compressImage(file, maxDim, quality);
  try {
    return await uploadToCloudinary(compressed, folder);
  } catch (e) {
    console.warn('Cloudinary upload failed, storing inline', e);
    return compressed;
  }
}
