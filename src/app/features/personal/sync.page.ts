import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SyncService } from '../../sync.service';
import { OilsService } from '../../oils.service';
import { WishlistService } from '../../wishlist.service';
import { RumiService } from '../../rumi.service';
import { UiService } from '../../core/ui.service';
import { IconComponent } from '../../icon.component';
import { agoLabel } from './personal-util';

@Component({
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page narrow">
      <header class="page-head compact">
        <div>
          <h1 class="page-title">Sync devices</h1>
          <p class="page-sub">Share your oils, wishlist and Rumi list across phone, tablet and laptop.</p>
        </div>
      </header>

      @if (!svc.configured) {
        <div class="notice warn">
          Firebase isn't set up yet. Add your project config in <code>src/app/firebase.config.ts</code>,
          follow the README and redeploy — then you can turn on sync here.
        </div>
      } @else {
        <div class="card card-pad stack">
          <div class="row between">
            <span class="section-title muted">Status</span>
            <span class="pill" [class.ok]="svc.status() === 'synced'" [class.info]="svc.status() === 'connecting'"
                  [class.danger]="svc.status() === 'error'">{{ statusLabel() }}</span>
          </div>
          <dl class="kv">
            <dt>Sync code</dt>
            <dd>@if (svc.code()) { <span class="mono">{{ svc.code() }}</span> } @else { <span class="muted">None</span> }</dd>
            <dt>Shared data</dt>
            <dd>{{ oils.oils().length }} oils · {{ wish.items().length }} wishlist · {{ rumi.products().length }} Rumi</dd>
            <dt>Rumi catalogue updated</dt>
            <dd>{{ rumiAgo() }}</dd>
          </dl>
          @if (svc.status() === 'error') {
            <div class="notice danger">Couldn't reach the cloud. Check your connection and tap Reconnect.</div>
          }
        </div>

        <div class="card card-pad">
          <form class="form" (ngSubmit)="connect()">
            <div class="field">
              <label for="sync-code">Sync code</label>
              <div class="row nowrap">
                <input id="sync-code" type="text" name="synccode" [(ngModel)]="codeInput" placeholder="e.g. musk-vault"
                       autocomplete="off" autocapitalize="off" spellcheck="false" />
                <button type="button" class="btn btn-icon" (click)="generate()" title="Generate a code" aria-label="Generate a code">
                  <app-icon name="shuffle" [size]="18" />
                </button>
                @if (codeInput.trim()) {
                  <button type="button" class="btn btn-icon" (click)="copy()" title="Copy code" aria-label="Copy code"><app-icon name="copy" [size]="18" /></button>
                }
              </div>
              <span class="hint">Enter the same code on every device to share one list. There's no login — anyone with the code sees this data, so keep it private.</span>
            </div>
            <div class="row between">
              @if (svc.code()) {
                <button type="button" class="btn btn-danger" (click)="disconnect()">Turn off</button>
              } @else { <span></span> }
              <button type="submit" class="btn btn-primary"
                      [disabled]="!codeInput.trim() || svc.status() === 'connecting'">
                {{ svc.status() === 'connecting' ? 'Connecting…' : svc.code() ? 'Reconnect' : 'Connect' }}
              </button>
            </div>
          </form>
        </div>
      }
    </div>
  `,
})
export class SyncPage {
  readonly svc = inject(SyncService);
  readonly oils = inject(OilsService);
  readonly wish = inject(WishlistService);
  readonly rumi = inject(RumiService);
  private ui = inject(UiService);

  codeInput = this.svc.code() ?? '';

  readonly statusLabel = computed(() => {
    switch (this.svc.status()) {
      case 'synced': return 'Synced';
      case 'connecting': return 'Connecting…';
      case 'error': return 'Sync error';
      default: return 'Not syncing';
    }
  });

  rumiAgo(): string { return agoLabel(this.rumi.lastSynced()); }

  async connect(): Promise<void> {
    const code = this.codeInput.trim();
    if (!code) return;
    if (code.length < 6) {
      this.ui.toast('Use a code of at least 6 characters', 'err');
      return;
    }
    await this.svc.connect(code);
    this.ui.toast(
      this.svc.status() === 'synced' ? 'Syncing across devices' : 'Sync failed',
      this.svc.status() === 'synced' ? 'ok' : 'err',
    );
  }

  generate(): void {
    this.codeInput = this.svc.generateCode();
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codeInput.trim());
      this.ui.toast('Code copied', 'ok');
    } catch {
      this.ui.toast('Could not copy', 'err');
    }
  }

  async disconnect(): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Turn off sync',
      message: 'Stop syncing this device? Your data stays on this device and in the cloud.',
      confirmLabel: 'Turn off',
    });
    if (!ok) return;
    this.svc.disconnect();
    this.codeInput = '';
    this.ui.toast('Sync turned off', 'info');
  }
}
