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
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT.firebaseapp.com',
  projectId: 'PASTE_PROJECT',
  storageBucket: 'PASTE_PROJECT.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId: 'PASTE_APP_ID',
};

/** True once you've replaced the placeholders above with real values. */
export function isFirebaseConfigured(): boolean {
  return !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
}
