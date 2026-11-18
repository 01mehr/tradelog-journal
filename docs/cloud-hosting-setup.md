# TradeLog cloud sync and sharing

## Current project state

- Supabase organization: `TradeLog` on the Free plan.
- Supabase project: `tradelog-cloud`, South Asia (Mumbai), ref `wqgssadlinqqfqryrwgt`.
- The per-user journal table and read-only share RPC are installed.
- No trades, account records, profile details, or photos have been copied from the local browser into Supabase.
- The static GitHub Pages build reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from repository Actions variables and writes them to `dist/cloud-config.js`.
- The public publishable key is intended for the browser. Never use a Supabase secret or service-role key in the browser, the repository, or GitHub Pages.

## Finish hosting configuration

1. Create the public source repository and push only the allowlisted project files. Do not add `local-data/`, `.codex/`, `bridge/`, `server.mjs`, the account-history CSV files, `freellmapi/`, or `google-sheets/`.
2. Add GitHub Actions variables named `SUPABASE_URL` (`https://wqgssadlinqqfqryrwgt.supabase.co`) and `SUPABASE_PUBLISHABLE_KEY` (from Supabase Project Settings → API Keys).
3. Enable GitHub Pages using **GitHub Actions**. The existing workflow publishes the static bundle from `dist/`.
4. In Supabase Authentication → URL Configuration, add the hosted Pages URL to the allowed redirect URLs. Also add `http://127.0.0.1:4188/` if testing sign-in from the local app.
5. Enable Email sign-in. For Google, configure Google OAuth credentials in Supabase Authentication → Sign In / Providers → Google, then add the Supabase callback URL shown there to the Google OAuth client.
6. Open the hosted HTTPS app, sign in, then choose whether to upload that browser's existing journal or load an existing cloud copy. No local data is uploaded before that choice.

The app supports Google OAuth and email magic links. Passkeys are not part of the current working build.

## Cloud behavior

After a browser is linked to a signed-in account, TradeLog writes the complete journal state to that user's private row and checks for updates from other devices. If a device already has local data while a cloud copy exists, TradeLog asks which copy to use before replacing anything. Keep CSV backups before selecting an overwrite.

The database has Row Level Security enabled and forced on both tables. Authenticated users can read or change only their own journal row and manage only their own share-link records. The anonymous role cannot query either table directly.

## Read-only sharing

In Settings, create a named link with a 7-, 30-, or 90-day expiry, or choose no expiry. Before creating it, TradeLog warns that anyone who receives the link can view the complete journal snapshot, including all trades, account names and login numbers, notes, screenshots, and profile fields. The share page has no edit or cloud-write route. Only a SHA-256 hash of the random link token is stored in the database. Owners can revoke active links from Settings.

Keep share links private. Anyone holding one can view the complete snapshot until it expires or is revoked.

## Local / MT5 behavior

The local app at `http://127.0.0.1:4188/` continues to use its existing local storage and MetaTrader bridge. Its trade records are a separate origin from the hosted website. Cloud sync will not reach into local storage and upload trades automatically; use the in-app upload choice or CSV workflow when you decide to move data. The hosted HTTPS app cannot connect to a bridge bound only to `127.0.0.1` on your PC.
