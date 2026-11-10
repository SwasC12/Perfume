import { Injectable, signal } from '@angular/core';
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getAuthInstance, isFirebaseConfigured, ADMIN_UID } from './firebase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly configured = isFirebaseConfigured();
  readonly user = signal<User | null>(null);
  readonly ready = signal(false); // auth state resolved at least once
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  constructor() {
    if (this.configured) {
      onAuthStateChanged(getAuthInstance(), (u) => {
        // Storefront customers share this Firebase project. Never keep a
        // non-admin account signed in here.
        if (u && u.uid !== ADMIN_UID) {
          void signOut(getAuthInstance());
          u = null;
        }
        this.user.set(u);
        this.ready.set(true);
      });
    } else {
      this.ready.set(true);
    }
  }

  get isAdmin(): boolean {
    return this.user()?.uid === ADMIN_UID;
  }

  async signIn(email: string, password: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const cred = await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password);
      if (cred.user.uid !== ADMIN_UID) {
        await signOut(getAuthInstance());
        this.error.set('This account does not have back-office access.');
        return false;
      }
      return true;
    } catch (e: any) {
      const code = e?.code ?? '';
      this.error.set(
        code.includes('invalid') || code.includes('wrong') || code.includes('not-found')
          ? 'Wrong email or password.'
          : 'Sign-in failed. Check your connection and try again.',
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async resetPassword(email: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await sendPasswordResetEmail(getAuthInstance(), email.trim());
      return true;
    } catch (e: any) {
      const c = e?.code ?? '';
      this.error.set(c.includes('invalid-email') ? 'That email address looks invalid.' : 'Could not send the reset email.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async signOut(): Promise<void> {
    await signOut(getAuthInstance());
  }
}
