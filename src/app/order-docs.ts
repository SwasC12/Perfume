import { Capacitor } from '@capacitor/core';
import QRCode from 'qrcode';
import { Order, StoreSettings } from './models';
import { waDigits, whatsappFile } from './device';

/**
 * Order documents: tax-invoice style invoice + warehouse packing slip.
 *
 * One HTML template per document is used for everything: the on-screen
 * preview, printing, and the PDF that is shared to WhatsApp. So what you see
 * is exactly what the customer gets.
 */
export type DocKind = 'invoice' | 'slip';

export interface DocContext {
  settings: StoreSettings | null;
}

const BRAND = 'KAUĀ FRAGRANCES';
const TAGLINE = 'one spray to last the day';
const WEBSITE = 'www.kauafragrances.co.za';

// ---------------------------------------------------------------- helpers

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

export function money(v: number | null | undefined): string {
  const n = Number(v || 0);
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '−' : '') + 'R ' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function addressLines(o: Order): string[] {
  const d = o.delivery;
  if (!d) return [];
  return [d.line1, d.line2, [d.city, d.postalCode].filter(Boolean).join(' '), d.province, d.country].filter(Boolean) as string[];
}

function paymentLabel(o: Order): string {
  const m = (o.paymentMethod || (o.channel === 'pos' ? 'cash' : 'eft')).toLowerCase();
  return ({ eft: 'EFT', yoco: 'Card (Yoco)', card: 'Card', cash: 'Cash' } as Record<string, string>)[m] ?? esc(m.toUpperCase());
}

function statusBadge(o: Order): { text: string; cls: string } {
  if (o.status === 'cancelled') return { text: 'Cancelled', cls: 'void' };
  if (o.status === 'pending') return { text: 'Awaiting payment', cls: 'due' };
  return { text: 'Paid', cls: 'paid' };
}

export async function orderQr(o: Order, width = 220): Promise<string> {
  try {
    return await QRCode.toDataURL(`KF-ORDER:${o.reference}`, {
      margin: 0, width, errorCorrectionLevel: 'M',
      color: { dark: '#0B2547', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}

/** Invoice number derived from the order reference: stable and unique per order. */
export function invoiceNo(o: Order): string {
  return 'INV-' + String(o.reference || o.id).replace(/^KF-/i, '').toUpperCase();
}

const VAT_RATE = 0.15;

// -------------------------------------------------------------- templates

function header(kind: DocKind, o: Order, s: StoreSettings): string {
  const company = s.companyName || 'Kauā Fragrances';
  const lines = [
    s.companyAddress ? esc(s.companyAddress).replace(/\n/g, '<br>') : '',
    s.companyRegistration ? 'Reg. ' + esc(s.companyRegistration) : '',
    s.vatNumber ? 'VAT ' + esc(s.vatNumber) : '',
  ].filter(Boolean);
  const contact = [s.contactEmail, s.contactPhone].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const title = kind === 'invoice' ? (s.vatNumber ? 'Tax Invoice' : 'Invoice') : 'Packing Slip';
  return `
  <div class="kd-band"></div>
  <header class="kd-head">
    <div class="kd-from">
      <div class="kd-brand">${BRAND}</div>
      <div class="kd-tag">${TAGLINE}</div>
      <div class="kd-company">
        <strong>${esc(company)}</strong>
        ${lines.length ? '<br>' + lines.join('<br>') : ''}
        ${contact ? '<br>' + contact : ''}
      </div>
    </div>
    <div class="kd-title">
      <h1>${title}</h1>
      <table class="kd-meta">
        ${kind === 'invoice' ? `<tr><th>Invoice no.</th><td>${esc(invoiceNo(o))}</td></tr>` : ''}
        <tr><th>Order no.</th><td>${esc(o.reference)}</td></tr>
        <tr><th>${kind === 'invoice' ? 'Invoice date' : 'Date'}</th><td>${longDate(o.createdAt)}</td></tr>
        ${kind === 'invoice'
          ? `<tr><th>${o.status === 'pending' ? 'Due' : 'Paid'}</th><td>${
              o.status === 'pending' ? 'On receipt' : o.status === 'cancelled' ? '—' : longDate(o.paidAt || o.updatedAt || o.createdAt)
            }</td></tr><tr><th>Payment</th><td>${paymentLabel(o)}</td></tr>`
          : `<tr><th>Method</th><td>${o.deliveryMethod === 'collection' ? 'Collection' : 'Delivery'}</td></tr>`}
        ${o.channel === 'pos' ? '<tr><th>Channel</th><td>In store</td></tr>' : ''}
      </table>
    </div>
  </header>`;
}

function parties(o: Order, slip: boolean): string {
  const c = o.customer || ({} as Order['customer']);
  const addr = addressLines(o);
  const shipTitle = o.deliveryMethod === 'collection' ? 'Collection' : slip ? 'Ship to' : 'Deliver to';
  const shipBody = o.deliveryMethod === 'collection'
    ? 'Customer collects in person'
    : addr.length ? addr.map(esc).join('<br>') : '—';
  return `
  <section class="kd-parties ${slip ? 'slip' : ''}">
    <div>
      <div class="kd-label">${slip ? 'Customer' : 'Bill to'}</div>
      <div class="kd-party">
        <strong>${esc(c.name || 'Walk-in customer')}</strong>
        ${c.phone ? '<br>' + esc(c.phone) : ''}
        ${c.email ? '<br>' + esc(c.email) : ''}
        ${!slip && addr.length && o.deliveryMethod !== 'collection' ? '<br><span class="kd-dim">' + addr.map(esc).join(', ') + '</span>' : ''}
      </div>
    </div>
    <div>
      <div class="kd-label">${shipTitle}</div>
      <div class="kd-party ${slip ? 'big' : ''}">
        ${slip && o.deliveryMethod !== 'collection' ? `<strong>${esc(c.name || '')}</strong><br>` : ''}${shipBody}
      </div>
    </div>
    ${o.courier || o.trackingNumber ? `
    <div>
      <div class="kd-label">Courier</div>
      <div class="kd-party">${esc(o.courier || 'Courier')}${o.trackingNumber ? '<br>Waybill <strong>' + esc(o.trackingNumber) + '</strong>' : ''}</div>
    </div>` : ''}
  </section>`;
}

function invoiceBody(o: Order, s: StoreSettings, qr: string): string {
  const rows = (o.items || []).map((i, n) => `
    <tr>
      <td class="n">${n + 1}</td>
      <td class="d"><strong>${esc(i.name)}</strong>${i.size ? `<span>${esc(i.size)}${i.isGift ? ' · Gift' : ''}</span>` : i.isGift ? '<span>Gift</span>' : ''}</td>
      <td class="q">${esc(i.qty)}</td>
      <td class="m">${i.isGift && !i.price ? 'Free' : money(i.price)}</td>
      <td class="m">${i.isGift && !i.price ? money(0) : money(i.price * i.qty)}</td>
    </tr>`).join('');
  const subtotal = o.subtotal ?? (o.items || []).reduce((t, i) => t + i.price * i.qty, 0);
  const badge = statusBadge(o);
  // Payment is by card (Yoco) online and cash/card in person. EFT is no longer accepted.
  const payBlock = `
    <div class="kd-pay">
      <div class="kd-label">Payment</div>
      <p>${o.status === 'pending'
        ? `Awaiting card payment for order <strong>${esc(o.reference)}</strong>.`
        : o.status === 'cancelled'
          ? 'This order was cancelled.' + (o.cancelledReason ? ' ' + esc(o.cancelledReason) : '')
          : `Received with thanks${o.paidAt ? ' on ' + longDate(o.paidAt) : ''} · ${paymentLabel(o)}.`}</p>
    </div>`;

  return `
  ${parties(o, false)}
  <table class="kd-items">
    <thead><tr><th class="n">#</th><th class="d">Description</th><th class="q">Qty</th><th class="m">Unit price</th><th class="m">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="kd-sum">
    <div class="kd-sum-left">
      <span class="kd-badge ${badge.cls}">${badge.text}</span>
      ${payBlock}
      ${o.customer?.note ? `<div class="kd-note"><div class="kd-label">Customer note</div>${esc(o.customer.note)}</div>` : ''}
    </div>
    <table class="kd-totals">
      <tr><th>Subtotal</th><td>${money(subtotal)}</td></tr>
      ${o.discountAmount ? `<tr><th>Discount${o.discountCode ? ' (' + esc(o.discountCode) + ')' : ''}</th><td>−${money(o.discountAmount).replace('−', '')}</td></tr>` : ''}
      ${o.channel === 'pos' ? '' : `<tr><th>${o.deliveryMethod === 'collection' ? 'Collection' : 'Delivery'}</th><td>${o.deliveryFee ? money(o.deliveryFee) : 'Free'}</td></tr>`}
      ${s.vatNumber ? `<tr class="vat"><th>Total excl. VAT</th><td>${money(o.total / (1 + VAT_RATE))}</td></tr>
      <tr class="vat"><th>VAT (15%)</th><td>${money(o.total - o.total / (1 + VAT_RATE))}</td></tr>` : ''}
      <tr class="grand"><th>Total${s.vatNumber ? ' (incl. VAT)' : ''}</th><td>${money(o.total)}</td></tr>
      ${o.status !== 'pending' && o.status !== 'cancelled' ? `<tr class="due"><th>Amount due</th><td>${money(0)}</td></tr>` : ''}
    </table>
  </section>
  <footer class="kd-foot">
    <div>
      <strong>Thank you for choosing Kauā.</strong><br>
      Questions about this order? Quote <strong>${esc(o.reference)}</strong>${s.contactEmail ? ' · ' + esc(s.contactEmail) : ''}${s.whatsappNumber || s.contactPhone ? ' · ' + esc(s.whatsappNumber || s.contactPhone) : ''}<br>
      <span class="kd-web">${WEBSITE}</span>
      <div class="kd-terms">${s.vatNumber ? '' : 'Not a registered VAT vendor. '}Goods remain the property of ${esc(s.companyName || 'Kauā Fragrances')} until paid in full. Returns and exchanges per our policy at ${WEBSITE}/shipping.</div>
    </div>
    ${qr ? `<img class="kd-qr" src="${qr}" alt="">` : ''}
  </footer>`;
}

function slipBody(o: Order, qr: string): string {
  const units = (o.items || []).reduce((t, i) => t + i.qty, 0);
  const rows = (o.items || []).map((i) => `
    <tr>
      <td class="box"><span></span></td>
      <td class="d"><strong>${esc(i.name)}</strong>${i.isGift ? '<span>Gift: include free</span>' : ''}</td>
      <td class="s">${esc(i.size || '—')}</td>
      <td class="q">${esc(i.qty)}</td>
    </tr>`).join('');
  return `
  <div class="kd-slip-top">
    ${parties(o, true)}
    ${qr ? `<div class="kd-slip-qr"><img src="${qr}" alt=""><span>${esc(o.reference)}</span></div>` : ''}
  </div>
  ${o.customer?.note ? `<div class="kd-note slip"><div class="kd-label">Customer note</div>${esc(o.customer.note)}</div>` : ''}
  <table class="kd-items slip">
    <thead><tr><th class="box">✓</th><th class="d">Item</th><th class="s">Size</th><th class="q">Qty</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td></td><td class="d">${(o.items || []).length} line${(o.items || []).length === 1 ? '' : 's'}</td><td class="s">Units</td><td class="q">${units}</td></tr></tfoot>
  </table>
  <section class="kd-sign">
    <div><span></span>Picked by</div>
    <div><span></span>Packed by</div>
    <div><span></span>Date</div>
  </section>
  <footer class="kd-foot slip">
    <div>Thank you for your order. Questions? Quote <strong>${esc(o.reference)}</strong> · <span class="kd-web">${WEBSITE}</span></div>
  </footer>`;
}

/** Full HTML for one document. All user content is escaped. */
export async function renderDoc(o: Order, kind: DocKind, ctx: DocContext): Promise<string> {
  const s = ctx.settings || {};
  const qr = await orderQr(o, kind === 'slip' ? 300 : 200);
  return `<article class="kfdoc ${kind}">${header(kind, o, s)}${kind === 'invoice' ? invoiceBody(o, s, qr) : slipBody(o, qr)}</article>`;
}

// ------------------------------------------------------------------ styles

export const DOC_CSS = `
.kfdoc{--kd-navy:#123B70;--kd-deep:#0B2547;--kd-ink:#172B45;--kd-dim:#6B7C93;--kd-line:#DCE6F1;--kd-soft:#F3F7FC;
  font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--kd-ink);background:#fff;
  font-size:12.5px;line-height:1.5;padding:0 40px 32px;position:relative;box-sizing:border-box;width:100%}
.kfdoc *{box-sizing:border-box}
.kfdoc table{min-width:0;width:auto;background:none;border-radius:0;border-collapse:collapse}
.kfdoc td,.kfdoc th{border-bottom:0;padding:0;font-size:inherit;background:none;text-transform:none;letter-spacing:0;white-space:normal;vertical-align:top;position:static;color:inherit}
.kfdoc tbody tr:hover{background:none}
.kfdoc .kd-items{width:100%}
.kfdoc .kd-band{height:8px;background:var(--kd-navy);margin:0 -40px 28px}
.kfdoc .kd-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:22px;border-bottom:1px solid var(--kd-line)}
.kfdoc .kd-brand{font-size:21px;font-weight:800;letter-spacing:.2em;color:var(--kd-deep);white-space:nowrap}
.kfdoc .kd-tag{font-family:Georgia,"Times New Roman",serif;font-style:italic;color:var(--kd-dim);font-size:12.5px;margin:2px 0 12px}
.kfdoc .kd-company{font-size:11.5px;color:var(--kd-dim);line-height:1.55}
.kfdoc .kd-company strong{color:var(--kd-ink)}
.kfdoc .kd-title{text-align:right}
.kfdoc h1{margin:0 0 10px;font-size:28px;font-weight:300;letter-spacing:.06em;text-transform:uppercase;color:var(--kd-navy);white-space:nowrap}
.kfdoc .kd-meta{margin-left:auto;border-collapse:collapse;font-size:12px}
.kfdoc .kd-meta th{text-align:left;font-weight:600;color:var(--kd-dim);padding:2px 14px 2px 0;white-space:nowrap}
.kfdoc .kd-meta td{text-align:right;font-weight:600;white-space:nowrap}
.kfdoc .kd-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--kd-navy);margin-bottom:5px}
.kfdoc .kd-parties{display:flex;gap:28px;padding:20px 0;flex-wrap:wrap}
.kfdoc .kd-parties>div{flex:1 1 150px;min-width:0}
.kfdoc .kd-party{font-size:12.5px;line-height:1.55;overflow-wrap:anywhere}
.kfdoc .kd-party.big{font-size:15px;line-height:1.5}
.kfdoc .kd-items{width:100%;border-collapse:collapse;margin:4px 0 0}
.kfdoc .kd-items thead th{background:var(--kd-deep);color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:9px 10px;text-align:left}
.kfdoc .kd-items thead th:first-child{border-radius:6px 0 0 6px}
.kfdoc .kd-items thead th:last-child{border-radius:0 6px 6px 0}
.kfdoc .kd-items td{padding:10px;border-bottom:1px solid var(--kd-line);vertical-align:top}
.kfdoc .kd-items tbody tr:nth-child(even) td{background:var(--kd-soft)}
.kfdoc .kd-items .n{width:34px;color:var(--kd-dim)}
.kfdoc .kd-items .d span{display:block;color:var(--kd-dim);font-size:11.5px}
.kfdoc .kd-items .q{width:56px;text-align:center}
.kfdoc .kd-items .m{width:110px;text-align:right;white-space:nowrap}
.kfdoc .kd-items .s{width:90px}
.kfdoc .kd-sum{display:flex;justify-content:space-between;gap:28px;margin-top:18px;align-items:flex-start;flex-wrap:wrap}
.kfdoc .kd-sum-left{flex:1 1 240px;min-width:0}
.kfdoc .kd-badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px;border:1.5px solid}
.kfdoc .kd-badge.paid{color:#1C7F55;border-color:#1C7F55;background:#E8F6EF}
.kfdoc .kd-badge.due{color:#A86A0C;border-color:#D99A2B;background:#FDF3E2}
.kfdoc .kd-badge.void{color:#B23A36;border-color:#D9534F;background:#FBECEB}
.kfdoc .kd-pay p{margin:0;color:var(--kd-ink)}
.kfdoc .kd-pay table{border-collapse:collapse;font-size:12px}
.kfdoc .kd-pay th{text-align:left;font-weight:600;color:var(--kd-dim);padding:2px 16px 2px 0;white-space:nowrap}
.kfdoc .kd-note{margin-top:14px;padding:10px 12px;background:var(--kd-soft);border-left:3px solid var(--kd-navy);border-radius:4px;font-size:12px}
.kfdoc .kd-note.slip{margin:0 0 14px}
.kfdoc .kd-totals{border-collapse:collapse;min-width:260px;flex:0 0 auto;margin-left:auto}
.kfdoc .kd-totals th{text-align:left;font-weight:500;color:var(--kd-dim);padding:6px 24px 6px 0}
.kfdoc .kd-totals td{text-align:right;padding:6px 0;white-space:nowrap;font-weight:600}
.kfdoc .kd-totals .grand th,.kfdoc .kd-totals .grand td{background:var(--kd-deep);color:#fff;font-size:15px;font-weight:800;padding:11px 12px}
.kfdoc .kd-totals .grand th{border-radius:6px 0 0 6px}
.kfdoc .kd-totals .grand td{border-radius:0 6px 6px 0}
.kfdoc .kd-totals .due th,.kfdoc .kd-totals .due td{font-size:11.5px;padding-top:8px}
.kfdoc .kd-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:32px;padding-top:16px;border-top:1px solid var(--kd-line);font-size:11.5px;color:var(--kd-dim);line-height:1.6}
.kfdoc .kd-foot strong{color:var(--kd-ink)}
.kfdoc .kd-web{color:var(--kd-navy);font-weight:600;letter-spacing:.02em}
.kfdoc .kd-terms{margin-top:8px;font-size:10px;color:#8A98AB;max-width:520px}
.kfdoc .kd-dim{color:var(--kd-dim)}
.kfdoc .kd-totals .vat th,.kfdoc .kd-totals .vat td{font-size:11.5px;padding:3px 0}
.kfdoc .kd-qr{width:84px;height:84px;flex:none}
.kfdoc .kd-slip-top{display:flex;gap:20px;align-items:flex-start}
.kfdoc .kd-slip-top .kd-parties{flex:1;min-width:0}
.kfdoc .kd-slip-qr{flex:none;text-align:center;padding:20px 0 12px;font-weight:800;letter-spacing:.08em;font-size:13px;color:var(--kd-deep)}
.kfdoc .kd-slip-qr img{display:block;width:132px;height:132px;margin:0 auto 6px}
.kfdoc .kd-items.slip td{font-size:13.5px;padding:12px 10px}
.kfdoc .kd-items.slip .q{font-size:16px;font-weight:800}
.kfdoc .kd-items .box{width:40px;text-align:center}
.kfdoc .kd-items td.box span{display:inline-block;width:16px;height:16px;border:1.5px solid var(--kd-ink);border-radius:3px}
.kfdoc .kd-items tfoot td{border-bottom:0;font-weight:700;color:var(--kd-dim);background:none}
.kfdoc .kd-items tfoot .q{color:var(--kd-ink)}
.kfdoc .kd-sign{display:flex;gap:28px;margin-top:40px}
.kfdoc .kd-sign div{flex:1;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--kd-dim)}
.kfdoc .kd-sign span{display:block;border-bottom:1px solid var(--kd-ink);height:28px;margin-bottom:6px}
.kfdoc .kd-foot.slip{justify-content:center;text-align:center}
@media (max-width:560px){
  .kfdoc{padding:0 18px 24px;font-size:12px}
  .kfdoc .kd-band{margin:0 -18px 20px}
  .kfdoc .kd-head{flex-direction:column;gap:14px}
  .kfdoc .kd-title{text-align:left}.kfdoc .kd-meta{margin-left:0}.kfdoc .kd-meta td{text-align:left}
  .kfdoc h1{font-size:22px}
  .kfdoc .kd-items .n,.kfdoc .kd-items thead .n{display:none}
  .kfdoc .kd-items td,.kfdoc .kd-items th{padding:8px 6px}
  .kfdoc .kd-items .m{width:auto}
  .kfdoc .kd-totals{min-width:0;width:100%}
  .kfdoc .kd-slip-top{flex-direction:column-reverse;gap:0}
  .kfdoc .kd-slip-qr{padding-bottom:0}
}`;

/** Make DOC_CSS available to the in-app preview (once). */
export function ensureDocStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('kfdoc-css')) return;
  const el = document.createElement('style');
  el.id = 'kfdoc-css';
  el.textContent = DOC_CSS;
  document.head.appendChild(el);
}

// ------------------------------------------------------------- PDF output

const A4_PX = 794; // A4 width at 96 dpi
const A4_H_PX = 1123;

/** Rasterise each document onto its own A4 page. Crisp at 2× for print. */
export async function docsToPdf(docs: string[]): Promise<Blob> {
  ensureDocStyles();
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_PX}px;background:#fff;z-index:-1;`;
  document.body.appendChild(host);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  try {
    for (let i = 0; i < docs.length; i++) {
      host.innerHTML = docs[i];
      const el = host.firstElementChild as HTMLElement;
      el.style.minHeight = A4_H_PX + 'px';
      await Promise.all(Array.from(el.querySelectorAll('img')).map((img) =>
        img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null); })));
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: A4_PX, windowWidth: A4_PX });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const ratio = canvas.height / canvas.width;
      let w = 210, h = 210 * ratio;
      if (h > 297) { h = 297; w = 297 / ratio; }
      if (i > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', (210 - w) / 2, 0, w, h, undefined, 'FAST');
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Share a PDF. On the phone this opens the Android share sheet (WhatsApp,
 * Gmail, Drive, print…). On the web it uses the Web Share API when files are
 * supported, otherwise downloads the PDF and opens WhatsApp with the message.
 */
export async function sharePdf(blob: Blob, filename: string, message: string): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const written = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title: filename.replace(/\.pdf$/, ''), text: message, files: [written.uri], dialogTitle: 'Share via WhatsApp or another app' });
      return 'shared';
    } catch (e: any) {
      if (/cancel/i.test(String(e?.message || e))) return 'cancelled';
      throw e;
    }
  }
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename, text: message });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  window.open('https://wa.me/?text=' + encodeURIComponent(message + '\n(PDF attached separately: ' + filename + ')'), '_blank', 'noopener');
  return 'downloaded';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Print documents on A4. Browsers print an off-screen iframe (no pop-up
 * needed). The Android WebView has no print support, so there we build the
 * PDF and open the share sheet, where any printer / PDF app can take it.
 */
export async function printDocs(docs: string[], filename: string, message: string): Promise<ShareOutcome | 'printed'> {
  if (Capacitor.isNativePlatform()) {
    return sharePdf(await docsToPdf(docs), filename, message);
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(filename.replace(/\.pdf$/, ''))}</title><style>
    @page{size:A4;margin:0}html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{width:210mm;min-height:297mm;page-break-after:always;break-after:page;overflow:hidden}
    .page:last-child{page-break-after:auto;break-after:auto}
    ${DOC_CSS}</style></head><body>${docs.map((h) => `<div class="page">${h}</div>`).join('')}</body></html>`);
  d.close();
  await new Promise<void>((resolve) => {
    const imgs = Array.from(d.images);
    let left = imgs.length;
    if (!left) return resolve();
    imgs.forEach((img) => {
      if (img.complete) { if (--left === 0) resolve(); }
      else img.onload = img.onerror = () => { if (--left === 0) resolve(); };
    });
    setTimeout(resolve, 1500);
  });
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60000);
  return 'printed';
}

export function docFilename(kind: DocKind, orders: Order[]): string {
  const label = kind === 'invoice' ? 'Invoice' : 'Packing-slip';
  if (orders.length === 1) return `Kaua-${label}-${kind === 'invoice' ? invoiceNo(orders[0]) : orders[0].reference}.pdf`;
  const day = new Date().toISOString().slice(0, 10);
  return `Kaua-${label}s-${orders.length}-orders-${day}.pdf`;
}

export function docMessage(kind: DocKind, orders: Order[]): string {
  if (orders.length === 1) {
    const o = orders[0];
    return kind === 'invoice'
      ? `Kauā Fragrances: invoice ${o.reference} for ${o.customer?.name || 'your order'}, total ${money(o.total)}.`
      : `Kauā Fragrances: packing slip for order ${o.reference} (${o.customer?.name || ''}).`;
  }
  return `Kauā Fragrances: ${kind === 'invoice' ? 'invoices' : 'packing slips'} for ${orders.length} orders: ${orders.map((o) => o.reference).join(', ')}.`;
}

/** Customer-facing message that goes with an invoice. */
export function customerInvoiceMessage(o: Order, s: StoreSettings | null): string {
  const first = (o.customer?.name || '').trim().split(/\s+/)[0] || 'there';
  const lines = [
    `Hi ${first}, thank you for your order with Kauā Fragrances!`,
    `Attached is your invoice ${invoiceNo(o)} for order ${o.reference}: ${money(o.total)}.`,
  ];
  if (o.status === 'pending') {
    lines.push(`Your card payment hasn't come through yet. Reply here if you'd like us to send you a payment link.`);
  } else if (o.status !== 'cancelled') {
    lines.push('Payment received, thank you!');
  }
  return lines.join('\n');
}

export type SendOutcome = 'whatsapp' | ShareOutcome;

/**
 * Send a PDF to a customer. In the APK this opens WhatsApp straight on the
 * customer's chat with the file attached (falls back to the share sheet).
 * On the web it downloads the PDF and opens the chat with the message.
 */
export async function sendPdfToCustomer(blob: Blob, filename: string, phone: string, message: string): Promise<SendOutcome> {
  const digits = waDigits(phone);
  if (Capacitor.isNativePlatform() && digits) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const written = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
      if (await whatsappFile(written.uri, digits, message)) return 'whatsapp';
    } catch { /* fall through to the share sheet */ }
    return sharePdf(blob, filename, message);
  }
  if (!Capacitor.isNativePlatform() && digits) {
    downloadBlob(blob, filename);
    window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
    return 'downloaded';
  }
  return sharePdf(blob, filename, message);
}
