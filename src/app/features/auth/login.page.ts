import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="brand">
          <span class="mark"><app-icon name="droplet" [size]="24" /></span>
          <h1>Kaua Tracker</h1>
          <p class="muted small">Sign in to the shop back office</p>
        </div>

        @if (!auth.configured) {
          <div class="notice warn">Firebase isn't configured yet — see the README.</div>
          <a class="btn btn-block" routerLink="/oils">Back to my oils</a>
        } @else {
          <form class="form" (ngSubmit)="signIn()">
            <div class="field">
              <label for="lemail">Email</label>
              <input id="lemail" type="email" name="email" [(ngModel)]="email"
                     autocomplete="username" inputmode="email" required autofocus />
            </div>
            <div class="field">
              <label for="lpass">Password</label>
              <div class="pw">
                <input id="lpass" [type]="showPw() ? 'text' : 'password'" name="password" [(ngModel)]="password"
                       autocomplete="current-password" required />
                <button type="button" class="btn btn-ghost btn-icon btn-sm pw-toggle" (click)="showPw.set(!showPw())"
                        [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'">
                  <app-icon [name]="showPw() ? 'eye-off' : 'eye'" [size]="18" />
                </button>
              </div>
            </div>

            @if (auth.error()) { <p class="form-error" role="alert">{{ auth.error() }}</p> }
            @if (resetSent()) { <div class="notice ok">Reset link sent to your email.</div> }

            <button type="submit" class="btn btn-primary btn-lg btn-block"
                    [disabled]="auth.busy() || !email.trim() || !password">
              {{ auth.busy() ? 'Signing in…' : 'Sign in' }}
            </button>
            <button type="button" class="btn btn-ghost btn-block" (click)="forgot()" [disabled]="auth.busy()">
              Forgot password?
            </button>
          </form>
        }
      </div>
      <a class="small muted" routerLink="/oils">Not the admin? Go to my oils</a>
    </div>
  `,
  styles: [`
    .login-wrap {
      min-height: calc(100dvh - var(--topbar-h) - var(--tabbar-h) - 40px);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 24px var(--page-pad);
    }
    @media (min-width: 1200px) { .login-wrap { min-height: 100dvh; } }
    .login-card { width: 100%; max-width: 400px; padding: 28px 24px; display: flex; flex-direction: column; gap: 20px; }
    .brand { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .brand h1 { font-size: 22px; font-weight: 750; }
    .mark {
      width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center;
      background: var(--primary); color: var(--primary-ink);
    }
    .pw { position: relative; }
    .pw input { padding-right: 48px !important; }
    .pw-toggle { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); color: var(--muted); }
  `],
})
export class LoginPage {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private ui = inject(UiService);

  /** Where to go after signing in (set by the admin route guard). */
  readonly next = input<string>();

  email = '';
  password = '';
  readonly showPw = signal(false);
  readonly resetSent = signal(false);
  private leaving = false;

  constructor() {
    this.auth.error.set(null);
    // Already signed in as admin (or auth just resolved) → leave this screen.
    effect(() => {
      if (this.auth.ready() && this.auth.user() && this.auth.isAdmin) this.leave();
    });
  }

  async signIn(): Promise<void> {
    if (!this.email.trim() || !this.password) return;
    this.resetSent.set(false);
    const ok = await this.auth.signIn(this.email, this.password);
    if (ok) {
      this.ui.toast('Signed in', 'ok');
      this.leave();
    }
  }

  async forgot(): Promise<void> {
    this.resetSent.set(false);
    if (!this.email.trim()) {
      this.auth.error.set('Enter your email address first.');
      return;
    }
    const ok = await this.auth.resetPassword(this.email);
    if (ok) this.resetSent.set(true);
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    const n = this.next();
    // Only follow in-app paths (no protocol-relative or external URLs).
    const target = n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/dashboard';
    void this.router.navigateByUrl(target, { replaceUrl: true });
  }
}
