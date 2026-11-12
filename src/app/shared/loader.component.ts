import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Perfume-bottle loader: a bottle that fills with oil, with a drop falling
 * from the atomiser. Pure SVG + CSS transforms (GPU only, no layout work).
 *
 *   <kf-loader />                         // default 56px, no text
 *   <kf-loader label="Syncing Rumi…" />   // with caption
 *   <kf-loader [size]="28" inline />      // small, inline (buttons, rows)
 *   <kf-loader [progress]="0.4" />        // determinate: fills to 40%
 */
@Component({
  selector: 'kf-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.inline]': 'inline()', role: 'status', '[attr.aria-label]': 'label() || "Loading"' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size() * 1.25" viewBox="0 0 48 60" aria-hidden="true">
      <defs>
        <clipPath [attr.id]="clipId"><path d="M10 26 Q10 20 16 20 H32 Q38 20 38 26 V52 Q38 57 33 57 H15 Q10 57 10 52 Z" /></clipPath>
      </defs>
      <!-- cap + neck -->
      <rect x="19" y="4" width="10" height="7" rx="2" class="cap" />
      <rect x="21" y="11" width="6" height="9" rx="1" class="neck" />
      <!-- liquid -->
      <g [attr.clip-path]="'url(#' + clipId + ')'">
        <g class="liquid" [class.det]="progress() != null" [style.transform]="progress() != null ? 'translateY(' + (37 * (1 - clamp(progress()!))) + 'px)' : null">
          <path class="wave" d="M-20 22 Q-14 19 -8 22 T4 22 T16 22 T28 22 T40 22 T52 22 T64 22 V70 H-20 Z" />
        </g>
      </g>
      <!-- glass -->
      <path d="M10 26 Q10 20 16 20 H32 Q38 20 38 26 V52 Q38 57 33 57 H15 Q10 57 10 52 Z" class="glass" />
      <path d="M15 27 V48" class="shine" />
      <!-- drop -->
      @if (progress() == null) { <path class="drop" d="M24 -2 q2.4 3.4 0 5 q-2.4 -1.6 0 -5 Z" /> }
    </svg>
    @if (label()) { <span class="lbl">{{ label() }}</span> }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; color: var(--primary); }
    :host(.inline) { display: inline-flex; flex-direction: row; padding: 0; gap: 8px; vertical-align: middle; }
    .lbl { font-size: 13.5px; font-weight: 600; color: var(--muted); }
    .cap { fill: var(--primary); }
    .neck { fill: #C9D6E6; }
    .glass { fill: none; stroke: var(--primary); stroke-width: 2.4; }
    .shine { stroke: rgba(255,255,255,.75); stroke-width: 2.2; stroke-linecap: round; }
    .wave { fill: #E0A93B; }
    .liquid { animation: fill 2.4s cubic-bezier(.45,.05,.35,1) infinite; }
    .liquid.det { animation: none; transition: transform .35s ease; }
    .wave { animation: wave 1.1s linear infinite; }
    .drop { fill: #E0A93B; animation: drop 2.4s ease-in infinite; }
    @keyframes fill { 0% { transform: translateY(37px); } 70% { transform: translateY(4px); } 100% { transform: translateY(4px); opacity: .0; } }
    @keyframes wave { to { transform: translateX(-24px); } }
    @keyframes drop { 0%, 10% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 45% { transform: translateY(26px); opacity: 1; } 50%, 100% { transform: translateY(26px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .liquid { animation: none; transform: translateY(18px); } .wave, .drop { animation: none; } }
  `],
})
export class LoaderComponent {
  readonly size = input(56);
  readonly label = input('');
  readonly inline = input(false, { transform: (v: boolean | string) => v === '' || v === true || v === 'true' });
  readonly progress = input<number | null>(null);
  readonly clipId = 'kfl' + Math.random().toString(36).slice(2, 8);
  clamp(v: number): number { return Math.max(0, Math.min(1, v || 0)); }
}
