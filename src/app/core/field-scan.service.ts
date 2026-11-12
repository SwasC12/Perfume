import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { onHardwareTrigger } from '../device';
import { SoundManager } from '../sound/sound-manager';
import { ScanService } from './scan.service';

/**
 * Optional "keyboard wedge" mode, like a rugged handheld: press a volume key
 * anywhere in the app. If a text field has focus, the scanner opens and types
 * the code into it; otherwise the full scanner screen opens.
 */
@Injectable({ providedIn: 'root' })
export class FieldScanService {
  private zone = inject(NgZone);
  private router = inject(Router);
  private scan = inject(ScanService);
  private off: (() => void) | null = null;
  private allowed = false;

  /** Called by the shell when the admin signs in / out. */
  setAllowed(allowed: boolean): void {
    this.allowed = allowed;
    void this.sync();
  }

  get enabled(): boolean { return !!SoundManager.settings.fieldTrigger; }

  /** Settings toggle. */
  setEnabled(on: boolean): void {
    SoundManager.set('fieldTrigger', on);
    void this.sync();
  }

  private async sync(): Promise<void> {
    this.off?.();
    this.off = null;
    if (!this.allowed || !this.enabled) return;
    this.off = await onHardwareTrigger(() => this.zone.run(() => this.onTrigger()));
  }

  private async onTrigger(): Promise<void> {
    if (this.scan.session() || this.router.url.startsWith('/scan')) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const code = await this.scan.pickCode();
      if (!code) return;
      el.value = code;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      el.focus();
    } else {
      void this.router.navigateByUrl('/scan');
    }
  }
}
