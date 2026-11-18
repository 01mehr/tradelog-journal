# TradeLog — trading journal web app

TradeLog is an installable browser app (PWA) with responsive layouts, offline shell caching, a local-first journal, and multiple trading-account profiles. A private per-user cloud sync path is included for the hosted build, with explicit local-to-cloud selection and read-only share links. Your existing local trades are not uploaded automatically.

## Start the local app and bridge

Install a current Node.js LTS release. On Windows, use the **TradeLog** desktop shortcut to start the local server and open the app in a Chrome app window. The shortcut can be recreated by running `scripts/create-desktop-shortcut.ps1` from this project folder.

If you prefer to start it manually, open PowerShell in this folder and run:

```powershell
node server.mjs
```

Open [http://127.0.0.1:4188](http://127.0.0.1:4188). Do not open `index.html` directly from the project folder: `file://` does not provide the web app's local server or install features. The server binds only to `127.0.0.1`; it is not reachable from other computers. A random pairing token is generated once and saved in `local-data/bridge-token.txt`; copy it from the server console into the Expert Advisor settings. Treat it as private.

## MetaTrader 4 / 5 sync

Open [http://127.0.0.1:4188/bridge/](http://127.0.0.1:4188/bridge/) for in-app pairing instructions. Install the matching EA in every terminal/account and paste the same local pairing token into each EA. The EAs send separate snapshots every 15 seconds. Dashboard scope and the account profile list separate each login; “All accounts” aggregates their recorded trades. Sync is strictly read-only: there are no trading commands in the API or EAs. If a terminal's WebRequest is disabled, the server is stopped, or the token is wrong, the journal shows that account as offline or waiting while retaining its last snapshot.

The MT4 history snapshot depends on the history range selected in the terminal. MT5 snapshot size depends on the account's available deal history; MT5 exits are recorded at exit-deal level, so partial fills and fee allocation can differ from a broker's grouped-position report. This initial connector needs compilation in MetaEditor and comparison against your broker's demo-account history before relying on it. Brokers differ in symbol names, contract specifications, partial fills, and commissions.

## Pip and cash calculations

The manual trade form includes 28 standard major FX pairs plus XAUUSD, XAGUSD, and GOLD. FX pairs use conventional pip sizes (0.0001, or 0.01 for JPY quote pairs) and a 100,000-unit lot baseline. Without broker data, XAUUSD/GOLD use a 100 oz contract and a $1 pip; XAGUSD uses 5,000 oz and a $0.01 pip. The calculator scales cash per pip by lot size and shows estimated P/L in the selected account currency. The currency-conversion graph uses live bid/ask quotes supplied by the MetaTrader bridge. If a cross-currency conversion is not available, the UI says so rather than inventing a dollar value. Broker specifications override generic assumptions whenever the terminal is connected; this matters for broker suffixes, nonstandard contracts, and account-currency conversion. Profit and loss tick values are retained separately when supplied by MT5.

Opened and closed times use local date-time controls and display in the browser local 12-hour time format. Closed trades show elapsed duration; open trades show a live duration that refreshes each minute. Imported history uses terminal timestamps.
## Backtesting and backups

The browser-only SMA crossover simulator accepts local OHLC CSV data; it does not download market data or model variable spreads, swaps, execution delay, or slippage. It applies the fixed spread and commission inputs you provide. Use Tools → Export CSV for a portable trade backup. Browser local storage and the bridge JSON file are separate; back up both if you want a complete copy. This is a browser app served locally on Windows; it is not packaged as a standalone `.exe` installer.

## Hosted web app (GitHub Pages)

The project includes a static web build for GitHub Pages. It is an installable, offline-capable PWA. The Pages workflow publishes an explicit allowlist from `dist/`; it never publishes `.codex/`, `local-data/`, bridge tokens, local bridge code, account-history CSV files, or the Google Sheets scripts.

Build the public bundle locally with Node.js:

```powershell
node scripts/build-web.mjs
```

Add the GitHub Actions variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, then enable **Settings → Pages → GitHub Actions**. These are browser-facing project settings; never put a Supabase service-role key in the app or Pages variables. The workflow deploys on pushes to `main` or `master`.

When the browser offers installation, use the download icon in the top bar and choose **Install**. The installed app opens in its own window. For browsers that do not show the install control, use the browser's **Install app** or **Add to Home Screen** command.

After the hosted build is configured, sign in under Settings with Google or an email sign-in link. An existing journal stays local until you choose to upload it. Once a device is linked, changes sync to the private row for that signed-in account; on another device, sign in to load the cloud journal. If both copies already have data, choose which copy to use before replacing either one. Keep CSV backups.

The database migration is in `supabase/migrations/202611180001_tradelog_user_state.sql`. It has been applied to the TradeLog Supabase project. It creates one private JSON state row per user with Row Level Security and a separate view-only link table. The public share RPC returns a snapshot only; it does not grant database write access. Sharing exposes the full journal snapshot, including trades, account details, notes, and profile fields, to anyone who has the link. Links can expire and be revoked in Settings.

The hosted HTTPS app cannot connect to an MT4/MT5 bridge listening only on your computer's `127.0.0.1`. Keep terminal bridge sync on the local journal. Never expose the local bridge or pairing token to the public internet.

## Feature status

- **Reports:** CSV backup/export and a full Markdown account report, plus individual journal reports.
- **Economic calendar:** live event feed from PipAtlas with local cache and currency/impact filters. Feed coverage and publication timing depend on the upstream provider.
- **Trade insights:** transparent statistics calculated on-device from saved trade history. These are not generated AI. A real AI integration would need a selected provider and secure server credentials, and explicit opt-in before sending any trade data off-device.
- **Advanced analytics:** performance, trade quality scoring, journal coverage, filters, and backtesting are computed from the saved trade data.
- **MT4/MT5 auto-journal:** available through the local read-only bridge, not directly through GitHub Pages.
