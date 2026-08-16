/**
 * Pure helpers for talking to the Google Drive REST API (Step 8, Drive part).
 *
 * These build request URLs / query strings / bodies and parse responses — no network, no React
 * Native, no auth. The `services/drive` adapter supplies the access token and does the actual
 * fetch / file I/O. Keeping the fiddly query-string and parsing logic here makes it unit-testable
 * in Node.
 *
 * We use the least-privileged Drive scope, `drive.file`: the app can only see and manage the files
 * *it* created. That's why finding "our" folder and backups is a simple query — nothing else in the
 * user's Drive is visible to us.
 */

/** The one Drive scope we request: access limited to files this app creates. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Drive v3 endpoints. */
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/** The special MIME type Drive uses for folders. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The folder (inside the user's Drive) we keep backups in. */
export const BACKUP_FOLDER_NAME = 'Finance Tracker';

/** A file or folder as returned by a Drive list query (only the fields we ask for). */
export interface DriveFile {
  id: string;
  name: string;
  /** RFC 3339 UTC timestamp, e.g. `2026-08-16T08:15:00.000Z`. Absent if not requested. */
  modifiedTime?: string;
}

/**
 * Escape a value for embedding inside a Drive query string (which wraps values in single quotes).
 * Backslashes and single quotes must be escaped — see Drive's "Search for files" reference.
 */
export function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Query that finds our (non-trashed) backup folder by name. */
export function folderSearchQuery(name: string = BACKUP_FOLDER_NAME): string {
  return `mimeType='${FOLDER_MIME}' and name='${escapeQueryValue(name)}' and trashed=false`;
}

/** Query that lists the (non-trashed) files directly inside a folder. */
export function folderChildrenQuery(folderId: string): string {
  return `'${escapeQueryValue(folderId)}' in parents and trashed=false`;
}

/**
 * Build a Drive "list files" URL. The query string is encoded by hand (rather than via
 * `URLSearchParams`, whose encoding differs between Hermes and Node) so the output is identical
 * everywhere and easy to assert in tests.
 */
export function buildListUrl(
  query: string,
  opts?: { orderBy?: string; pageSize?: number; fields?: string },
): string {
  const parts = [
    `q=${encodeURIComponent(query)}`,
    `fields=${encodeURIComponent(opts?.fields ?? 'files(id,name,modifiedTime)')}`,
    'spaces=drive',
  ];
  if (opts?.orderBy) parts.push(`orderBy=${encodeURIComponent(opts.orderBy)}`);
  if (opts?.pageSize) parts.push(`pageSize=${opts.pageSize}`);
  return `${DRIVE_FILES_URL}?${parts.join('&')}`;
}

/** Metadata body for creating the backup folder. */
export function createFolderBody(name: string = BACKUP_FOLDER_NAME): { name: string; mimeType: string } {
  return { name, mimeType: FOLDER_MIME };
}

/** Metadata body for creating an (initially empty) backup file inside a folder. */
export function createFileMetaBody(name: string, folderId: string): { name: string; parents: string[] } {
  return { name, parents: [folderId] };
}

/** Upload URL that replaces the *contents* (media) of an existing file with a raw body. */
export function mediaUpdateUrl(fileId: string): string {
  return `${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media`;
}

/** Download URL that returns the raw bytes of a file. */
export function mediaDownloadUrl(fileId: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`;
}

/** Pull the `id` out of a create/get response, or null if it's missing. */
export function parseFileId(json: unknown): string | null {
  if (json && typeof json === 'object' && typeof (json as { id?: unknown }).id === 'string') {
    return (json as { id: string }).id;
  }
  return null;
}

/** Parse a Drive list response into a clean array, skipping any malformed entries. */
export function parseFileList(json: unknown): DriveFile[] {
  if (!json || typeof json !== 'object') return [];
  const files = (json as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const out: DriveFile[] = [];
  for (const f of files) {
    if (f && typeof f === 'object' && typeof f.id === 'string' && typeof f.name === 'string') {
      out.push({
        id: f.id,
        name: f.name,
        modifiedTime: typeof f.modifiedTime === 'string' ? f.modifiedTime : undefined,
      });
    }
  }
  return out;
}

/**
 * Pick the newest backup: by `modifiedTime` descending (RFC 3339 UTC strings sort correctly as
 * plain text), falling back to filename descending — our filenames embed the timestamp, so that
 * still orders newest-first. Returns null for an empty list.
 */
export function pickLatestBackup(files: DriveFile[]): DriveFile | null {
  if (files.length === 0) return null;
  return [...files].sort((a, b) => {
    const at = a.modifiedTime ?? '';
    const bt = b.modifiedTime ?? '';
    if (at !== bt) return at < bt ? 1 : -1;
    return a.name < b.name ? 1 : -1;
  })[0];
}
