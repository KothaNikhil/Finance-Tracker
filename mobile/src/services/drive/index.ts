/**
 * Google Drive backup / restore orchestration (Step 8, Drive part).
 *
 * Reuses the exact same building blocks as the local backup: `serializeDatabase()` produces the
 * bytes we upload, and `restoreFromBytes()` swallows the bytes we download. Drive is just a
 * different destination for the same `.db` file.
 *
 * We keep everything in a single "Finance Tracker" folder in the user's Drive. Because we use the
 * `drive.file` scope, we can only see files we created — so listing that folder's children only
 * ever returns our own backups.
 */

import { File, Paths } from 'expo-file-system';

import { backupFileName, isSqliteFile, type StampParts } from '@/core/backup';
import {
  BACKUP_FOLDER_NAME,
  buildListUrl,
  createFileMetaBody,
  createFolderBody,
  DRIVE_FILES_URL,
  folderChildrenQuery,
  folderSearchQuery,
  mediaDownloadUrl,
  mediaUpdateUrl,
  parseFileId,
  parseFileList,
  pickLatestBackup,
  type DriveFile,
} from '@/core/drive';
import { restoreFromBytes, serializeDatabase } from '@/services/db/backup';
import { ensureSignedIn, getAccessToken } from './auth';

const JSON_MIME = 'application/json';
const DB_MIME = 'application/x-sqlite3';

/** A backup found in Drive, for a future "pick which one" UI. */
export type DriveBackup = DriveFile;

/** True on native — the Drive feature is available here (the web build has a stub). */
export function driveAvailable(): boolean {
  return true;
}

/** Timestamp parts for the backup filename (device clock; not pure, so it lives here). */
function nowStamp(): StampParts {
  const d = new Date();
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/** A Drive REST call that returns JSON (or text), throwing a readable error on a non-2xx status. */
async function driveFetch(token: string, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Drive request failed (${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? res.json() : res.text();
}

/** Find our backup folder's id, or null if it doesn't exist yet. */
async function findFolderId(token: string): Promise<string | null> {
  const url = buildListUrl(folderSearchQuery(), { pageSize: 1, fields: 'files(id,name)' });
  return parseFileList(await driveFetch(token, url))[0]?.id ?? null;
}

/** Find our backup folder, creating it if it doesn't exist. */
async function ensureFolderId(token: string): Promise<string> {
  const existing = await findFolderId(token);
  if (existing) return existing;

  const created = await driveFetch(token, `${DRIVE_FILES_URL}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_MIME },
    body: JSON.stringify(createFolderBody()),
  });
  const id = parseFileId(created);
  if (!id) throw new Error('Could not create the Finance Tracker folder in Drive.');
  return id;
}

/** List the backups inside a folder, newest first. */
async function listBackupsIn(token: string, folderId: string): Promise<DriveBackup[]> {
  const url = buildListUrl(folderChildrenQuery(folderId), {
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    fields: 'files(id,name,modifiedTime)',
  });
  return parseFileList(await driveFetch(token, url));
}

export interface DriveBackupResult {
  /** False if the user cancelled the Google sign-in. */
  done: boolean;
  fileName: string;
  /** The account the backup was saved to (email), when known. */
  account: string | null;
}

/**
 * Back up the whole database to the user's Google Drive: sign in, make sure our folder exists,
 * create a named file in it, then upload the serialized database bytes as that file's contents.
 */
export async function backupToDrive(): Promise<DriveBackupResult> {
  const account = await ensureSignedIn();
  if (!account) return { done: false, fileName: '', account: null };

  const token = await getAccessToken();
  const folderId = await ensureFolderId(token);
  const fileName = backupFileName(nowStamp());

  // 1) Create the (empty) file with its name + parent folder in one shot.
  const created = await driveFetch(token, `${DRIVE_FILES_URL}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_MIME },
    body: JSON.stringify(createFileMetaBody(fileName, folderId)),
  });
  const fileId = parseFileId(created);
  if (!fileId) throw new Error('Could not create the backup file in Drive.');

  // 2) Write the DB bytes to a temp file and upload them as the file's media content.
  const cacheFile = new File(Paths.cache, fileName);
  cacheFile.create({ overwrite: true });
  cacheFile.write(serializeDatabase());

  const result = await cacheFile.upload(mediaUpdateUrl(fileId), {
    httpMethod: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    mimeType: DB_MIME,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Uploading the backup to Drive failed (${result.status}).`);
  }

  return { done: true, fileName, account: account.email };
}

/** List every backup in the user's Drive folder (newest first). Empty if signed out / none yet. */
export async function listDriveBackups(): Promise<DriveBackup[]> {
  const account = await ensureSignedIn();
  if (!account) return [];
  const token = await getAccessToken();
  const folderId = await findFolderId(token);
  return folderId ? listBackupsIn(token, folderId) : [];
}

/** Download a backup by id and restore it into the live database (replaces all current data). */
async function downloadAndRestore(token: string, fileId: string): Promise<void> {
  const dest = new File(Paths.cache, 'drive-restore.db');
  const downloaded = await File.downloadFileAsync(mediaDownloadUrl(fileId), dest, {
    headers: { Authorization: `Bearer ${token}` },
    idempotent: true, // overwrite any previous temp download
  });
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  if (!isSqliteFile(bytes)) {
    throw new Error('The file in Drive isn’t a valid Finance Tracker backup.');
  }
  await restoreFromBytes(bytes);
}

export interface DriveRestoreResult {
  restored: boolean;
  /** False when no backup was found in Drive (folder empty / missing). */
  found: boolean;
  fileName?: string;
}

/**
 * Restore the most recent backup from the user's Drive. Returns `found: false` when there are no
 * backups to restore. Destructive — the caller should confirm first.
 */
export async function restoreLatestFromDrive(): Promise<DriveRestoreResult> {
  const account = await ensureSignedIn();
  if (!account) return { restored: false, found: false };

  const token = await getAccessToken();
  const folderId = await findFolderId(token);
  const backups = folderId ? await listBackupsIn(token, folderId) : [];
  const latest = pickLatestBackup(backups);
  if (!latest) return { restored: false, found: false };

  await downloadAndRestore(token, latest.id);
  return { restored: true, found: true, fileName: latest.name };
}
