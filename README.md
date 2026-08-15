# Finance Tracker

A modern Android + iPhone app that imports Paytm (and later PhonePe/GPay/bank/credit-card)
statements, auto-categorizes spending, shows dashboards, exports a yearly Excel workbook, and
backs up to Google Drive. Built with Expo (React Native) so the logic can be reused on a
future website.

## Repo layout

| Path | What's inside |
|------|---------------|
| [`docs/Requirements.md`](docs/Requirements.md) | Plain-language requirements |
| `mobile/` | The Expo (React Native) app |
| `mobile/src/core/` | The pure-TypeScript "brain" (no React Native) — testable in Node, reusable on web |
| `Refernce sample data/` | Real sample Paytm statements used for testing the importer |

## Developing (on Windows)

Prerequisites: Node.js LTS, and Android Studio (for the Android emulator). Everything is free
and open-source. iPhone builds need a Mac or a paid Apple account and are handled later.

```bash
cd mobile
npm install        # install dependencies
npm test           # run unit tests (the "brain")
npm run typecheck  # TypeScript check
npm run web        # open the app in a browser (quick preview)
npm run android    # run on an Android emulator / device
```

See [`docs/Requirements.md`](docs/Requirements.md) for the full feature list and the build
plan for the step-by-step approach.
