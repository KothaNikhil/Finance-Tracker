# Shared core

`@finance-tracker/core` contains the platform-independent finance domain, import/export logic,
Drizzle schema, migrations, repository, and SQL query builders. Native and browser adapters supply
a synchronous Drizzle SQLite database through `db/runtime.ts`; the shared repository does not import
Expo or a browser storage API.

Database files use `PRAGMA user_version`. Run `migrateSchema` before constructing the Drizzle client.
Databases newer than `CURRENT_SCHEMA_VERSION` are rejected before schema writes.
