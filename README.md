# 🧴 Oil Tracker

A simple, clean app to track the perfume oils you have left, plus a live view of
what's in stock at [Rumi Fragrances](https://rumifragrances.co.za/product-category/inspired-by-oils/)
so you know what to buy.

No login. Data is stored locally in the browser (localStorage), so it works
offline and as an installed app.

## Features

- **My Oils** — add the oils you own with an image, remaining ml, full size, and a
  "running low" warning. A fill bar shows how much is left at a glance. Add / edit / delete.
- **Buy from Rumi** — one-tap **Sync from Rumi** pulls the live "Inspired By Oils"
  catalogue (name, price, in-stock status, image) via a serverless proxy. Filter by
  in stock, add items manually, edit, delete, open on Rumi, or "＋" straight into My Oils.
- Clean UI with loaders, skeletons, image cards, search, and empty states.

## Tech

- Angular 19 (standalone + signals), SCSS
- localStorage persistence
- Vercel serverless function (`/api/rumi-stock`) that proxies Rumi's WooCommerce
  Store API (avoids browser CORS)

## Run locally

```bash
npm install
npm start          # http://localhost:4200  (UI + manual entry work fully)
```

The **Sync from Rumi** button calls `/api/rumi-stock`, which only exists on Vercel.
To test live sync locally, use the Vercel CLI instead of `ng serve`:

```bash
npm i -g vercel
vercel dev         # serves the app + the /api function together
```

## Deploy to Vercel

Import the repo in Vercel — `vercel.json` already sets the build command and output
directory (`dist/perfume-app/browser`). No extra config needed. The `/api` folder is
deployed as a serverless function automatically.

## Android APK (Capacitor, later)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Oil Tracker" za.co.swasteer.oiltracker --web-dir dist/perfume-app/browser
npm run build && npx cap add android && npx cap sync
npx cap open android
```

> Note: `/api/rumi-stock` is a Vercel function and won't exist inside the APK. For the
> APK, point the sync call at your deployed Vercel URL (e.g.
> `https://<your-app>.vercel.app/api/rumi-stock`) — set that as the base URL in
> `src/app/rumi.service.ts`. Manual entry works offline regardless.
