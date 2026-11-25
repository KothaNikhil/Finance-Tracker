# Finance Tracker web

The web app is a separate Vite + React application. It keeps SQLite in `sql.js` memory only and
uses the shared `@finance-tracker/core` schema, migrations, repository, and sync engine.

## Run locally

```powershell
npm install
npm run dev --workspace web
```

Open `http://localhost:5173`. The app uses the existing public Supabase URL/key and Google web
client ID from the mobile app; `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_GOOGLE_CLIENT_ID` can override them for another development project. Never add an OAuth client
secret to the frontend.

## Google/Supabase console setup

Before sign-in can complete, enable Google as a Supabase OAuth provider, add
`http://localhost:5173` as a Supabase redirect URL and Google authorized JavaScript origin, and
enable the Google Drive API on the same Google Cloud project used by the phone app. The web app
requests only the `drive.file` scope. Add the eventual production origin to both consoles before
deployment.

The SQLite database and financial rows are held only in the current page's memory. Sign-out closes
and clears that database; only the Supabase authentication session is persisted by the auth SDK.
The phone keeps its own offline SQLite copy and now syncs with the same `finance-live.db` file.
Only one device edits at a time. An edit lock (`finance-session.json` on Drive) names the device
that is editing; opening a second device asks **Take over** or **View only**. In view only nothing
is editable. The website is also read-only while offline. Every upload checks the lock and the Drive
revision first. See `docs/WEB_PLAN.md` §2.1a.
