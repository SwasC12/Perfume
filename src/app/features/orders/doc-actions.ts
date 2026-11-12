import { Order, StoreSettings } from '../../models';
import { DocKind, docFilename, docMessage, docsToPdf, printDocs, renderDoc, sharePdf } from '../../order-docs';

/**
 * Print or share invoices / packing slips (one order or a batch) as an A4 PDF.
 * Returns the outcome, or null when it failed (a toast has been shown).
 */
export async function runDocs(
  action: 'print' | 'share',
  kind: DocKind,
  orders: Order[],
  settings: StoreSettings | null,
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void,
): Promise<string | null> {
  if (!orders.length) { toast('Select orders first', 'info'); return null; }
  try {
    const ctx = { settings };
    const docs = await Promise.all(orders.map((o) => renderDoc(o, kind, ctx)));
    const name = docFilename(kind, orders);
    const msg = docMessage(kind, orders);
    const outcome = action === 'print' ? await printDocs(docs, name, msg) : await sharePdf(await docsToPdf(docs), name, msg);
    if (outcome === 'downloaded') toast('PDF downloaded. Attach it in WhatsApp', 'info');
    return outcome;
  } catch (e) {
    console.error(e);
    toast(action === 'share' ? 'Could not share the PDF' : 'Could not print', 'err');
    return null;
  }
}
