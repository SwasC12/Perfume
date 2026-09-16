// ---------------------------------------------------------------------------
// Firebase config for cross-device sync.
//
// 1. Go to https://console.firebase.google.com → create a project (no billing needed).
// 2. Add a Web app (</> icon) → copy the `firebaseConfig` object it shows you.
// 3. Paste the values below (replace every PASTE_... placeholder).
// 4. In the console: Build → Firestore Database → Create database (Production mode)
//    → then Rules tab, paste the rules from the README, and Publish.
//
// NOTE: this web config is NOT a secret — it's meant to ship in the browser.
// Access is controlled by the Firestore security rules, not by hiding these keys.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'AIzaSyB_25Y7apafFSNJ1T8fYhNwJxSvFGrZcRo',
  authDomain: 'perfume-3b075.firebaseapp.com',
  projectId: 'perfume-3b075',
  storageBucket: 'perfume-3b075.firebasestorage.app',
  messagingSenderId: '323158526612',
  appId: '1:323158526612:web:567fab64313686c4b44281',
  measurementId: 'G-E56W1XQP20',
};

/** True once you've replaced the placeholders above with real values. */
export function isFirebaseConfigured(): boolean {
  return !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
}
