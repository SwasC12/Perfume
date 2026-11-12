import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { firebaseConfig, isFirebaseConfigured, ADMIN_UID } from './firebase.config';

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

function getApp(): FirebaseApp {
  if (!app) app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

/**
 * Shared Firestore handle (initialised once, ignores undefined fields).
 * Data is cached on the device (IndexedDB), so after the first run every
 * screen paints instantly from cache while the live listeners catch up, and
 * the app keeps working offline. Falls back to memory if IndexedDB is blocked.
 */
export function getDb(): Firestore {
  if (db) return db;
  try {
    db = initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    db = initializeFirestore(getApp(), { ignoreUndefinedProperties: true });
  }
  return db;
}

/** Shared Auth handle. */
export function getAuthInstance(): Auth {
  if (!auth) auth = getAuth(getApp());
  return auth;
}

export { isFirebaseConfigured, ADMIN_UID };
