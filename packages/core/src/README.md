# `core/` — the app's "brain" (pure TypeScript)

Everything in this folder is **plain TypeScript with no React Native imports**. That means:

- it can be **unit-tested in Node** on the laptop (fast, no emulator), and
- it can be **reused by a future website** with no rewrite.

The brain never touches the phone directly. It reaches files, the database, and Google Drive
through **ports** (interfaces in [`ports/`](ports)). The phone app supplies real
implementations of those ports (in `src/services/`); a future web app would supply browser
implementations of the same ports.

## Folders

| Folder | What lives here | Built in step |
|--------|-----------------|---------------|
| `domain/` | Core value helpers: money (paise), dates (`DD/MM/YYYY`), shared types | Step 0 ✅ |
| `ports/` | Interfaces for the outside world (files, Drive, key-value store) | Step 0 ✅ |
| `import/` | Reading statements: `SourceAdapter` per source, normalize, dedupe, pipeline | Step 3 |
| `categorize/` | Auto-categorization rules, confidence, learning from edits | Step 4 |
| `aggregate/` | Monthly/yearly totals, net worth, per-person/event reports | Steps 5–6 |
| `export/` | Building the yearly Excel workbook | Step 7 |
| `db/` | Drizzle schema + repositories (query helpers) | Step 2 |

## Rule of thumb

If a piece of logic could run in a plain Node script, it belongs in `core/`. If it needs the
phone (a native module, a screen, a device API), it belongs in `src/services/` or the UI.
