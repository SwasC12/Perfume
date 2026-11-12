# Kaua Tracker — UI conventions

Modern, simple, straight to the point. Blue (#123B70) and white. Phone first,
then tablet (>=768px) and laptop (>=1200px, permanent sidebar).

## Architecture

- Each screen is a standalone, lazy-loaded route component in
  `src/app/features/<area>/<name>.page.ts` (+ `.html` / `.scss` when big).
  Routes are in `app.routes.ts`, nav in `core/nav.ts`. Do not edit those.
- `changeDetection: ChangeDetectionStrategy.OnPush` on every component.
- State = `signal()` / `computed()`. Anything changed after an `await`, a
  timer or a Firebase callback MUST be a signal (OnPush won't see plain fields).
  Plain fields are fine only for `[(ngModel)]` form models.
- Data: inject `ShopAdminService` (live signals: products, orders, customers,
  referrals, discounts, restockRequests, expenses, reviews, settings,
  siteContent, loadingProducts, loadingOrders). Never start/stop it — the shell does.
- Navigation: `routerLink` / `Router`. Detail screens are routes
  (`/orders/:id`, `/products/:id`, `/products/new`), read the param with an
  `input()` (component input binding is on): `readonly id = input<string>()`.
- Toasts / confirms: `inject(UiService)`
  - `ui.toast('Saved', 'ok' | 'err' | 'info')`
  - `if (!(await ui.confirm({ title, message, confirmLabel: 'Delete', danger: true }))) return;`
- Scanning from a screen: `inject(ScanService)`
  - `await scan.pickOrder()`, `await scan.pickProduct()`,
    `await scan.streamProducts(p => ...)` (stays open, e.g. POS), `await scan.pickCode()`
- Sheets / dialogs: `SheetComponent` (`<kf-sheet>`) from `shared/sheet.component.ts`,
  always inside `@if`. Footer buttons go in `<ng-container sheet-actions>`.
  `size="wide"` for big forms, `size="full"` for previews. It handles Back.
- Icons: `<app-icon name="..." [size]="18" />` (see icon.component.ts for names).
- Money: `CurrencyPipe` → `{{ x | currency:'ZAR':'symbol-narrow':'1.0-2' }}`.

## Page skeleton

```html
<div class="page">                         <!-- .page.narrow for forms -->
  <header class="page-head compact">       <!-- compact: title hidden on phones (top bar shows it) -->
    <div>
      <h1 class="page-title">Orders</h1>
      <p class="page-sub">12 waiting to be packed</p>
    </div>
    <div class="page-actions">
      <button class="btn">Export</button>
      <button class="btn btn-primary"><app-icon name="plus" [size]="16" /> New</button>
    </div>
  </header>

  <div class="toolbar">
    <div class="search"><app-icon name="search" [size]="16" /><input type="search" placeholder="Search…"></div>
  </div>
  <div class="chips"><button class="chip on">All <span class="n">40</span></button>…</div>

  <div class="list">
    <a class="list-item" [routerLink]="['/orders', o.id]">
      <img class="thumb" …> or <span class="avatar">AB</span>
      <div class="li-main"><span class="li-title">KF-ABCDE <span class="pill" data-status="paid">paid</span></span><span class="li-sub">Jane · 2 items</span></div>
      <div class="li-end"><span class="num">R 450</span><span class="tiny muted">2h ago</span></div>
    </a>
  </div>
</div>
```

## Class vocabulary (global, in src/styles.scss)

- Layout: `page`, `page-head`, `page-title`, `page-sub`, `page-actions`, `stack`,
  `stack-sm`, `stack-lg`, `row`, `row between`, `spacer`, `grid` (auto cards),
  `grid-2/3/4`, `split` (main + 380px side on laptop), `sticky-side`,
  `hide-phone`, `only-phone`.
- Surfaces: `card` (+`card-pad`), `card-head`, `card-body`, `card-foot`,
  `section-title` (`.muted` = small caps label).
- Stats: `card stat` > `stat-label`, `stat-value`, `stat-note(.up/.down)`.
- Buttons: `btn` + `btn-primary | btn-soft | btn-ghost | btn-danger(.solid) | btn-ok`,
  sizes `btn-sm | btn-lg`, `btn-icon`, `btn-block`.
- Forms: wrap in `form`/`.form`; each control in `.field` (`label`, control,
  `.hint`, `.error`); `.field-row` (2 cols, `.three`); `.check`; `.switch`
  (`<label class="switch"><input type="checkbox" …><span></span> Label</label>`);
  `.seg` segmented (`button.on`); `.chips`/`.chip.on`; `.search`.
  Inputs/selects/textareas are styled globally — no classes needed.
- Lists: `list` > `list-item` (a/button/`.clickable`), `li-main`, `li-title`,
  `li-sub`, `li-end`; `list-empty`. Tables (laptop only, wide data):
  `table-wrap` > `table`, `tr.clickable`, `.num`, `.right`.
- Media: `thumb(.sm/.lg)`, `avatar`.
- Status: `pill` with `data-status="pending|paid|fulfilled|shipped|delivered|cancelled"`,
  or `pill ok|warn|danger|info`; `badge(.alert/.ok)`.
- Feedback: `notice(.warn/.danger/.ok)`, `empty` (> `empty-icon`, h3, p),
  `skeleton`, `bar` > `i[style.width.%]` (`.ok/.warn/.danger`).
- Details: `dl.kv` (dt/dd), `.totals` (rows of divs, `.grand`).
- Sticky save bar for long forms: `.action-bar` at the end of `.page`.
- Text: `muted`, `faint`, `small`, `tiny`, `bold`, `mono`, `num`,
  `text-ok/warn/danger`, `ellipsis`, `center`.

## Loading states

- `LoaderComponent` (`<kf-loader>`, shared/loader.component.ts) is the
  perfume-bottle loader. Use it for whole-page / section loads
  (`<kf-loader label="Loading orders…" />`), inside busy buttons
  (`<kf-loader [size]="18" inline />`) and for progress (`[progress]="0.4"`).
  Skeletons (`.skeleton`) stay fine for list placeholders.

## No unnecessary scrolling (owner's rule)

- The primary action of a screen is always visible without scrolling
  (sticky `.action-bar`, fixed bottom bar, or in the header).
- On phones, don't stack long forms: split into steps/tabs/collapsible
  sections, show the essentials first, tuck rarely used fields away.
- Prefer dense, scannable rows over big cards on phones.

## Rules

- Phone first: one column, big tap targets, primary action reachable.
  Lists are `.list` rows on phones; use a `.table` only behind `hide-phone`
  for wide laptop data (keep the `.list` with `only-phone`), or just use lists.
- Keep it simple: no decorative gradients, no glass/blur, no heavy shadows.
  One primary button per view. Plain words.
- Component `.scss` only for genuinely screen-specific layout (< 150 lines),
  using the CSS variables (`--primary`, `--surface`, `--line`, `--muted`,
  `--r`, `--r-lg`, …). Never restyle the global classes.
- Big lists: `@for (...; track x.id)` always. Lists over ~150 rows: show the
  first 100 and a "Show more" button (signal limit).
- Images: `loading="lazy" decoding="async"` and width/height attributes.
- No EFT anywhere: payments are card (Yoco) online and cash/card at the POS.
