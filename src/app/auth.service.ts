import { Injectable, signal } from '@angular/core';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getAuthInstance, isFirebaseConfigured } from './firebase';

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
        this.user.set(u);
        this.ready.set(true);
      });
    } else {
      this.ready.set(true);
    }
  }

  get isAdmin(): boolean {
    return !!this.user();
  }

  async signIn(email: string, password: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password);
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

  async signOut(): Promise<void> {
    await signOut(getAuthInstance());
  }
}
