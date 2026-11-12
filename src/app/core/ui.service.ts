import { Injectable, signal } from '@angular/core';
import { cueForMessage, play } from '../ui-fx';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions { resolve: (ok: boolean) => void; }
export type ToastKind = 'ok' | 'err' | 'info';
interface ToastState { id: number; text: string; kind: ToastKind; }

/**
 * App-wide UI plumbing: toasts, confirm dialogs, and the overlay stack the
 * Android back gesture / browser back closes first.
 */
@Injectable({ providedIn: 'root' })
export class UiService {
  readonly toastState = signal<ToastState | null>(null);
  readonly confirmState = signal<ConfirmState | null>(null);

  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private toastSeq = 0;
  private overlays: (() => void)[] = [];

  /** Show a short message. Kind is guessed from the text when omitted. */
  toast(text: string, kind?: ToastKind): void {
    const cue = cueForMessage(text);
    const k: ToastKind = kind ?? (cue === 'error' ? 'err' : cue === 'success' ? 'ok' : 'info');
    play(k === 'err' ? 'error' : k === 'ok' ? 'success' : cue);
    this.toastState.set({ id: ++this.toastSeq, text, kind: k });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastState.set(null), k === 'err' ? 4200 : 2600);
  }

  dismissToast(): void { this.toastState.set(null); }

  /** Ask before doing something. Resolves true when confirmed. */
  confirm(opts: ConfirmOptions | string): Promise<boolean> {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    this.confirmState()?.resolve(false);
    return new Promise<boolean>((resolve) => this.confirmState.set({ ...o, resolve }));
  }

  answerConfirm(ok: boolean): void {
    const c = this.confirmState();
    if (!c) return;
    this.confirmState.set(null);
    c.resolve(ok);
  }

  /**
   * Register an open layer (sheet, dialog, menu). Back closes the newest one
   * first. Returns an unregister function — call it when the layer closes.
   */
  pushOverlay(close: () => void): () => void {
    this.overlays.push(close);
    return () => { this.overlays = this.overlays.filter((c) => c !== close); };
  }

  /** Close the top layer. Returns false when nothing was open. */
  closeTopOverlay(): boolean {
    if (this.confirmState()) { this.answerConfirm(false); return true; }
    const top = this.overlays.pop();
    if (!top) return false;
    top();
    return true;
  }
}
