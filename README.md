# OrderFlow Restaurant Console V4 Complete Build

## Files

- `index.html` — main app file
- `styles.css` — responsive Flipkart-style orange/purple UI
- `app.js` — all frontend logic
- `config.js` — Supabase URL and anon public key
- `supabase-orderflow-v4-complete.sql` — full SQL migration and RPC functions
- `manifest.json` — PWA manifest
- `service-worker.js` — simple network-first service worker
- `TESTING-CHECKLIST.md` — test list

## Setup

1. Create / open your GitHub repository.
2. Upload all files to the repository root.
3. Open `config.js`.
4. Replace:

```js
SUPABASE_URL: "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE",
SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE"
```

with your real Supabase Project URL and anon public key.

5. In Supabase, go to SQL Editor and run:

```text
supabase-orderflow-v4-complete.sql
```

6. Open GitHub Pages URL with `?v=4` at the end.

## Default login

Username: `admin`
Password: `admin123`

Change this password after first login from:

Settings → Manage Users → Change Password

## Important accounting flow

- Purchases add raw material inventory.
- Production confirmation deducts raw material inventory and adds prepared food stock.
- Sales deduct prepared food stock only.
- Raw materials are not deducted again during sales.
- Daily profit uses food cost of sold items, not the full purchases made on that day.
- Sales Minus Today’s Expenses is shown separately as cash-flow balance.
