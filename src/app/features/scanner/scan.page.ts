import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { ScannerComponent } from './scanner.component';
import type { Order } from '../../models';

/** Full-screen scanner (the centre tab). */
@Component({
  standalone: true,
  imports: [ScannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-scanner purpose="tab" (closed)="close()" (orderPicked)="openOrder($event)" />`,
  styles: [':host { display: block; position: fixed; inset: 0; z-index: 30; }'],
})
export class ScanPage {
  private router = inject(Router);
  private location = inject(Location);

  close(): void {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
  }

  openOrder(o: Order): void {
    void this.router.navigate(['/orders', o.id]);
  }
}
