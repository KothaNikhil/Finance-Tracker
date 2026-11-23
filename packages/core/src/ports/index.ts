/**
 * Ports = the interfaces through which the pure-TS "brain" reaches the outside world.
 *
 * The phone app implements these with Expo modules (in `src/services/`); a future web app
 * would implement them with browser APIs. Keeping these as interfaces is what lets the same
 * business logic run on phone and web, and lets us swap the on-phone database for a cloud
 * database (Supabase) later without touching `core/`.
 *
 * These signatures are a starting contract and may grow as later steps are built.
 */

/** Read and write files (pick an import file, save an export, copy the DB for backup). */
export interface FileSystemPort {
  /** Read a file's bytes as a base64 string (used to feed SheetJS on import). */
  readAsBase64(uri: string): Promise<string>;
  /** Write base64 bytes to an app-owned path; returns the written file's uri. */
  writeBase64(fileName: string, base64: string): Promise<string>;
}

/** Talk to the user's Google Drive "Finance Tracker" folder (backup + exports). */
export interface DrivePort {
  /** Create the visible folder if missing; return its Drive id. */
  ensureFolder(name: string): Promise<string>;
  /** Find a file by name inside a folder, or null if absent. */
  findFile(folderId: string, fileName: string): Promise<{ id: string } | null>;
  /** Create the file, or replace it if it already exists; return its id. */
  uploadOrReplace(
    folderId: string,
    fileName: string,
    base64Data: string,
    mimeType: string,
  ): Promise<string>;
  /** Download a file's bytes as base64. */
  downloadBase64(fileId: string): Promise<string>;
}

/** A tiny key-value store for settings (theme, app-lock, Drive ids, last-backup marker). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
