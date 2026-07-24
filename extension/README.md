# Punch List in SFDC — Chrome extension

Shows, on a Salesforce opportunity record page, which **Punch List** criteria that
opportunity met (e.g. "No SE Notes", "14+ days since D-Score Update") so you can
fix the hygiene issue in place.

## How it works

The extension does **not** call the app API (the app is behind Pomerium SSO, which
an extension can't authenticate to cross-origin). Instead, the already-authenticated
Punch List page **pushes** each opp's reasons to the extension when you open it in
SFDC:

1. Punch List page → `chrome.runtime.sendMessage(extId, { type: "PUNCHLIST_DATA", entries })`
   (`src/lib/sfdc.ts` `notifyExtension`, wired into `src/routes/punch-list.tsx`).
2. `src/service-worker.js` validates the origin/type and writes each entry to
   `chrome.storage.local` under `punchlist:<oppId>` (with a 12h TTL).
3. `src/content-script.js` on `zendesk.lightning.force.com` detects the Opportunity
   record URL, reads `punchlist:<oppId>`, and renders a floating panel (Shadow DOM).

## Install (unpacked, for dev)

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Copy the generated **Extension ID**.
4. In the app, set the extension id so the page is allowed to message it:
   ```
   VITE_PUNCHLIST_EXT_ID=<the extension id>
   ```
   (in your `.env`), then restart Vite (`npm run dev`).

The dev extension id changes per machine. To pin a stable id (so
`VITE_PUNCHLIST_EXT_ID` doesn't need updating), add a `"key"` field to
`manifest.json` with your packed extension's public key.

## Origins

`manifest.json` → `externally_connectable.matches` lists the app origins allowed
to push data (currently `http://localhost:3000` and `http://localhost:8080`).
**Add the production app origin here before shipping**, and mirror it in
`src/common.js` `ALLOWED_ORIGINS`.

## Test end-to-end

1. Load the extension and set `VITE_PUNCHLIST_EXT_ID` (above).
2. Run the backend with `DEV_MODE=true` and a real `DEV_USER_EMAIL` (someone with
   SC opps) so `/api/opportunities/my-sc-opps` returns real 18-char SFDC ids.
3. Open `http://localhost:3000/punch-list`. In DevTools, `chrome.runtime` should be
   defined (confirms `externally_connectable` is active for this origin).
4. Click **Open in SFDC** on a row → the Lightning tab opens → the floating panel
   shows that opp's reason chips.
5. Click **Open All in SFDC** → each tab shows its own reasons. (Opening many tabs
   can trip the popup blocker; allow popups for the app if needed.)
6. Inspect the service worker (chrome://extensions → "service worker") to confirm
   `chrome.storage.local` entries were written.

## Icons

`icons/icon16.png`, `icon48.png`, `icon128.png` are referenced by the manifest.
Drop real PNGs in `icons/` before packing; unpacked dev works without them (Chrome
uses a default icon and only warns).
