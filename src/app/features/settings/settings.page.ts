import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ShopAdminService } from '../../shop-admin.service';
import { UiService } from '../../core/ui.service';
import { FieldScanService } from '../../core/field-scan.service';
import { StoreSettings } from '../../models';
import { BEEP_TONES, Cue, SoundManager, SoundPrefs } from '../../sound/sound-manager';
import { isNative } from '../../notifications';

/** Fields this screen edits. Everything else on the doc (bank details,
 *  placeholder images…) is kept exactly as it is in Firestore. */
const EDITABLE: (keyof StoreSettings)[] = [
  'storeOpen', 'storeClosedMessage', 'deliveryEnabled', 'collectionEnabled', 'deliveryFee',
  'freeDeliveryThreshold', 'collectionNote', 'whatsappNumber', 'contactEmail', 'contactPhone',
  'companyName', 'companyRegistration', 'companyAddress', 'vatNumber',
];

function defaultSettings(): StoreSettings {
  return {
    storeOpen: true, deliveryEnabled: true, collectionEnabled: true,
    deliveryFee: 60, freeDeliveryThreshold: 500,
  };
}

@Component({
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .sw-list { display: flex; flex-direction: column; gap: 6px; }
    .cue-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; }
    .cue-row + .cue-row { border-top: 1px solid var(--line-2); }
    .vol { display: flex; align-items: center; gap: 12px; }
    .vol input { flex: 1; accent-color: var(--primary); }
    .vol .num { min-width: 40px; text-align: right; }
  `],
  template: `
<div class="page narrow">
  <header class="page-head compact">
    <div>
      <h1 class="page-title">Settings</h1>
      <p class="page-sub">Store, delivery and this device's scanner</p>
    </div>
  </header>

  @if (!loaded()) {
    <div class="card card-pad stack">
      <div class="skeleton" style="height: 20px; width: 40%"></div>
      <div class="skeleton" style="height: 42px"></div>
      <div class="skeleton" style="height: 42px"></div>
    </div>
  } @else {
    <h2 class="section-title muted">Store</h2>

    <section class="card">
      <div class="card-head"><h3>Store status</h3>
        <span class="pill" [class.ok]="form.storeOpen" [class.danger]="!form.storeOpen">{{ form.storeOpen ? 'open' : 'closed' }}</span>
      </div>
      <div class="card-body form">
        <label class="switch"><input type="checkbox" [(ngModel)]="form.storeOpen" /><span></span> Store open (accepting orders)</label>
        <div class="field">
          <label for="s-closed">Closed message</label>
          <input id="s-closed" type="text" [(ngModel)]="form.storeClosedMessage" placeholder="Back soon!" />
          <span class="hint">Shown on the shop while the store is closed.</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Delivery &amp; pickup</h3></div>
      <div class="card-body form">
        <div class="sw-list">
          <label class="switch"><input type="checkbox" [(ngModel)]="form.deliveryEnabled" /><span></span> Offer delivery</label>
          <label class="switch"><input type="checkbox" [(ngModel)]="form.collectionEnabled" /><span></span> Offer pickup (free)</label>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="s-fee">Delivery fee (R)</label>
            <input id="s-fee" type="number" min="0" inputmode="decimal" [(ngModel)]="form.deliveryFee" />
          </div>
          <div class="field">
            <label for="s-thr">Free delivery over (R)</label>
            <input id="s-thr" type="number" min="0" inputmode="decimal" [(ngModel)]="form.freeDeliveryThreshold" placeholder="Never" />
            <span class="hint">Leave blank for never.</span>
          </div>
        </div>
        <div class="field">
          <label for="s-colnote">Pickup note</label>
          <input id="s-colnote" type="text" [(ngModel)]="form.collectionNote" placeholder="Where / how customers collect" />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Contact &amp; WhatsApp</h3></div>
      <div class="card-body form">
        <div class="field">
          <label for="s-wa">WhatsApp number</label>
          <input id="s-wa" type="tel" inputmode="numeric" [(ngModel)]="form.whatsappNumber" placeholder="27821234567" />
          <span class="hint">International format, digits only.</span>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="s-email">Contact email</label>
            <input id="s-email" type="email" [(ngModel)]="form.contactEmail" placeholder="hello@kauafragrances.co.za" />
          </div>
          <div class="field">
            <label for="s-phone">Contact phone</label>
            <input id="s-phone" type="tel" [(ngModel)]="form.contactPhone" />
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Business details</h3></div>
      <div class="card-body form">
        <p class="small muted">Used on invoices and the Terms &amp; Privacy pages.</p>
        <div class="field-row">
          <div class="field">
            <label for="s-co">Company name</label>
            <input id="s-co" type="text" [(ngModel)]="form.companyName" placeholder="Kauā Fragrances" />
          </div>
          <div class="field">
            <label for="s-reg">Registration no.</label>
            <input id="s-reg" type="text" [(ngModel)]="form.companyRegistration" placeholder="2026/000000/07" />
          </div>
        </div>
        <div class="field">
          <label for="s-addr">Business address</label>
          <input id="s-addr" type="text" [(ngModel)]="form.companyAddress" placeholder="Street, City, Province, Postal code" />
        </div>
        <div class="field">
          <label for="s-vat">VAT number (optional)</label>
          <input id="s-vat" type="text" [(ngModel)]="form.vatNumber" placeholder="4xxxxxxxxx" />
        </div>
      </div>
    </section>

    <div class="action-bar">
      <span class="small muted spacer hide-phone">Store settings are shared with the online shop.</span>
      <button class="btn btn-primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save settings' }}</button>
    </div>
  }

  <h2 class="section-title muted">This device</h2>

  <section class="card">
    <div class="card-head"><h3>Scanner &amp; sounds</h3></div>
    <div class="card-body form">
      <label class="switch"><input type="checkbox" [checked]="prefs().master" (change)="setPref('master', checked($event))" /><span></span> Sounds</label>
      <div class="field">
        <label for="s-vol">Volume</label>
        <div class="vol">
          <input id="s-vol" type="range" min="0" max="1" step="0.05" [value]="prefs().volume" (input)="setPref('volume', +value($event))" (change)="test('scanSuccess')" [disabled]="!prefs().master" />
          <span class="num small muted">{{ (prefs().volume * 100).toFixed(0) }}%</span>
        </div>
      </div>
      <div class="field">
        <label for="s-beep">Scan beep</label>
        <select id="s-beep" [ngModel]="prefs().beepTone" (ngModelChange)="setPref('beepTone', $event); test('scanSuccess')">
          @for (t of beepTones; track t.key) { <option [value]="t.key">{{ t.label }}</option> }
        </select>
      </div>

      <div>
        <span class="field-label">Sound for</span>
        <div class="mt-1">
          @for (c of cues; track c.key) {
            <div class="cue-row">
              <label class="switch"><input type="checkbox" [checked]="prefs().cues[c.key]" (change)="setCue(c.key, checked($event))" /><span></span> {{ c.label }}</label>
              <button type="button" class="btn btn-ghost btn-sm" (click)="test(c.key)">Test</button>
            </div>
          }
          <div class="cue-row">
            <label class="switch"><input type="checkbox" [checked]="prefs().buttonSound" (change)="setPref('buttonSound', checked($event))" /><span></span> Button taps</label>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h3>Vibration</h3><button type="button" class="btn btn-ghost btn-sm" (click)="testVibration()">Test</button></div>
    <div class="card-body sw-list">
      <label class="switch"><input type="checkbox" [checked]="prefs().vibration" (change)="setPref('vibration', checked($event))" /><span></span> Vibration</label>
      <label class="switch"><input type="checkbox" [checked]="prefs().vibrateScanner" (change)="setPref('vibrateScanner', checked($event))" [disabled]="!prefs().vibration" /><span></span> On scans</label>
      <label class="switch"><input type="checkbox" [checked]="prefs().vibrateNotifications" (change)="setPref('vibrateNotifications', checked($event))" [disabled]="!prefs().vibration" /><span></span> On alerts</label>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h3>Scanning</h3></div>
    <div class="card-body sw-list">
      <label class="switch"><input type="checkbox" [checked]="prefs().continuousScan" (change)="setPref('continuousScan', checked($event))" /><span></span> Continuous scanning (stay open after each scan)</label>
      <label class="switch"><input type="checkbox" [checked]="prefs().volumeTrigger" (change)="setPref('volumeTrigger', checked($event))" /><span></span> Volume keys scan (in the scanner)</label>
      <label class="switch"><input type="checkbox" [checked]="fieldTrigger()" (change)="setFieldTrigger(checked($event))" /><span></span> Volume key scans into the focused field</label>
      <p class="tiny muted">Like a handheld scanner: press a volume key while typing in any box and the scanned code is typed in for you.@if (!native) { Volume keys work in the Android app only. }</p>
    </div>
  </section>
</div>
  `,
})
export class SettingsPage {
  readonly shop = inject(ShopAdminService);
  private ui = inject(UiService);
  private fieldScan = inject(FieldScanService);

  readonly loaded = signal(false);
  readonly saving = signal(false);
  form: StoreSettings = {};

  readonly prefs = signal<SoundPrefs>({ ...SoundManager.settings });
  readonly fieldTrigger = signal(this.fieldScan.enabled);
  readonly beepTones = BEEP_TONES;
  readonly native = isNative();
  readonly cues: { key: Cue; label: string }[] = [
    { key: 'scanSuccess', label: 'Successful scan' },
    { key: 'scanError', label: 'Failed / unknown scan' },
    { key: 'duplicate', label: 'Duplicate scan' },
    { key: 'stockReceived', label: 'Stock received' },
    { key: 'orderCompleted', label: 'Order completed' },
    { key: 'orderDispatched', label: 'Order dispatched' },
    { key: 'lowStock', label: 'Low stock warning' },
  ];

  constructor() {
    // Fill the form once the live settings arrive.
    effect(() => {
      const s = this.shop.settings();
      if (s && !untracked(this.loaded)) {
        this.form = { ...defaultSettings(), ...JSON.parse(JSON.stringify(s)) };
        this.loaded.set(true);
      }
    });
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      // Start from the live doc so fields this screen doesn't show (bank
      // details, placeholder images changed elsewhere) are never lost.
      const data: StoreSettings = { ...(this.shop.settings() ?? {}) };
      const rec = data as Record<string, unknown>;
      for (const k of EDITABLE) {
        const v = this.form[k];
        if (v === undefined) continue;
        rec[k] = typeof v === 'string' ? v.trim() : v;
      }
      if ((rec['freeDeliveryThreshold'] as unknown) === '') rec['freeDeliveryThreshold'] = null;
      delete data.updatedAt;
      await this.shop.saveStoreSettings(data);
      this.ui.toast('Settings saved', 'ok');
    } catch {
      this.ui.toast('Save failed — are you signed in?', 'err');
    } finally {
      this.saving.set(false);
    }
  }

  // ------------------------------------------------------ sound prefs
  checked(e: Event): boolean { return (e.target as HTMLInputElement).checked; }
  value(e: Event): string { return (e.target as HTMLInputElement).value; }

  setPref<K extends keyof SoundPrefs>(key: K, value: SoundPrefs[K]): void {
    SoundManager.set(key, value);
    this.prefs.set({ ...SoundManager.settings });
  }
  setCue(cue: Cue, on: boolean): void {
    SoundManager.setCue(cue, on);
    this.prefs.set({ ...SoundManager.settings, cues: { ...SoundManager.settings.cues } });
  }
  setFieldTrigger(on: boolean): void {
    this.fieldScan.setEnabled(on);
    this.fieldTrigger.set(this.fieldScan.enabled);
    this.prefs.set({ ...SoundManager.settings });
  }
  test(cue: Cue): void {
    void SoundManager.unlock();
    SoundManager.feedback(cue);
  }
  testVibration(): void { SoundManager.vibrate('scanSuccess'); }
}
