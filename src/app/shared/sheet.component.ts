import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, input, output } from '@angular/core';
import { UiService } from '../core/ui.service';
import { IconComponent } from '../icon.component';

/**
 * Bottom sheet on phones, centred dialog on tablet/laptop. Render it inside an
 * @if — it registers with the back stack while it exists.
 *
 *   @if (editing()) {
 *     <kf-sheet title="Edit oil" (closed)="editing.set(false)">
 *       ...body...
 *       <ng-container sheet-actions>
 *         <button class="btn" (click)="editing.set(false)">Cancel</button>
 *         <button class="btn btn-primary">Save</button>
 *       </ng-container>
 *     </kf-sheet>
 *   }
 */
@Component({
  selector: 'kf-sheet',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sh-backdrop" (click)="closed.emit()"></div>
    <section class="sh" [class.wide]="size() === 'wide'" [class.full]="size() === 'full'" role="dialog" aria-modal="true" [attr.aria-label]="title()">
      <span class="sh-grip" aria-hidden="true"></span>
      @if (title()) {
        <header class="sh-head">
          <div class="sh-titles">
            <h2>{{ title() }}</h2>
            @if (subtitle()) { <p>{{ subtitle() }}</p> }
          </div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" (click)="closed.emit()" aria-label="Close"><app-icon name="x" [size]="18" /></button>
        </header>
      }
      <div class="sh-body"><ng-content /></div>
      <footer class="sh-foot"><ng-content select="[sheet-actions]" /></footer>
    </section>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
    .sh-backdrop { position: absolute; inset: 0; background: rgba(15, 27, 45, .45); animation: fade .16s ease-out; }
    .sh {
      position: relative; width: 100%; max-height: calc(100dvh - var(--safe-t) - 24px);
      display: flex; flex-direction: column; background: var(--surface);
      border-radius: 20px 20px 0 0; box-shadow: var(--shadow-3);
      animation: up .22s var(--ease); padding-bottom: var(--safe-b);
    }
    .sh-grip { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 8px auto 0; flex: none; }
    .sh-head { display: flex; align-items: flex-start; gap: 12px; padding: 10px 16px 6px 20px; flex: none; }
    .sh-titles { flex: 1; min-width: 0; padding-top: 6px; }
    .sh-titles h2 { font-size: 18px; font-weight: 750; }
    .sh-titles p { color: var(--muted); font-size: 13.5px; margin-top: 2px; }
    .sh-body { padding: 8px 20px 16px; overflow-y: auto; overscroll-behavior: contain; flex: 1; min-height: 0; }
    .sh-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid var(--line-2); flex: none; }
    .sh-foot:empty { display: none; }
    @media (max-width: 767px) { .sh-foot ::ng-deep > .btn { flex: 1; } }
    @media (min-width: 768px) {
      :host { align-items: center; padding: 24px; }
      .sh { max-width: 520px; border-radius: 18px; max-height: calc(100dvh - 48px); animation: pop .18s var(--ease); padding-bottom: 0; }
      .sh.wide { max-width: 820px; }
      .sh.full { max-width: 1100px; height: calc(100dvh - 48px); }
      .sh-grip { display: none; }
      .sh-head { padding-top: 16px; }
    }
    @keyframes fade { from { opacity: 0; } }
    @keyframes up { from { transform: translateY(40px); opacity: .4; } }
    @keyframes pop { from { transform: scale(.97); opacity: 0; } }
  `],
})
export class SheetComponent implements OnInit, OnDestroy {
  private ui = inject(UiService);
  readonly title = input('');
  readonly subtitle = input('');
  readonly size = input<'normal' | 'wide' | 'full'>('normal');
  readonly closed = output<void>();
  private unregister: (() => void) | null = null;

  private static openCount = 0;

  ngOnInit(): void {
    this.unregister = this.ui.pushOverlay(() => this.closed.emit());
    if (SheetComponent.openCount++ === 0) document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    this.unregister?.();
    if (--SheetComponent.openCount <= 0) { SheetComponent.openCount = 0; document.body.style.overflow = ''; }
  }
}
