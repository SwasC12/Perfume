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

- **Sync across devices** — optional Firebase (Firestore) sync. Enter the same
  **sync code** on your phone, tablet, and laptop to share one live dataset. No
  login: anyone with the code sees that data, so keep it private. Works offline and
  catches up when back online.

## Tech

- Angular 19 (standalone + signals), SCSS
- localStorage persistence (offline cache + single-device default)
- Firebase Firestore for optional cross-device sync (real-time)
- Vercel serverless function (`/api/rumi-stock`) that proxies Rumi's WooCommerce
  Store API (avoids browser CORS)

## Enable cross-device sync (Firebase)

Sync is off until you add a Firebase project. It's free and takes ~5 minutes:

1. Go to <https://console.firebase.google.com> → **Add project** (no billing needed).
2. Inside the project, click the **Web** icon (`</>`) to register a web app, then
   copy the `firebaseConfig` object it shows.
3. Paste those values into **`src/app/firebase.config.ts`** (replace the `PASTE_...`
   placeholders).
4. **Build → Firestore Database → Create database** → *Production mode*.
5. Open the **Rules** tab, paste the rules below, and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /workspaces/{code} {
         allow get, write: if code.size() >= 6; // knowing the code = access
         allow list: if false;                  // can't enumerate other codes
       }
     }
   }
   ```

6. Commit + push → Vercel redeploys. Open the app, click **Sync** in the header,
   **Generate** (or type) a code of 6+ characters, and **Connect**. Enter the *same*
   code on your other devices.

> The sync code is the only thing protecting your data — treat it like a password.
> The Firebase web config is safe to commit (it's public by design); the Firestore
> rules above are what actually gate access.

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
