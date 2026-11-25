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

import {
  buildListUrl,
  folderChildrenQuery,
  folderSearchQuery,
  parseFileList,
  type DriveFile,
} from '@/core/drive';
import { ensureSignedIn, getAccessToken } from './auth';
import { backupLiveDatabaseToDrive, restoreLatestFromDriveLive } from './sync';

export { syncDownFromDrive } from './sync';
export { startDriveSync, takeOverEditing, stayViewOnly, releaseEditLock } from './sync';
export { useEditSession, useViewOnly, useSyncHealth } from './edit-session';
export type { DriveSyncResult } from './sync';

/** A backup found in Drive, for a future "pick which one" UI. */
export type DriveBackup = DriveFile;

/** True on native — the Drive feature is available here (the web build has a stub). */
export function driveAvailable(): boolean {
  return true;
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

/** List the backups inside a folder, newest first. */
async function listBackupsIn(token: string, folderId: string): Promise<DriveBackup[]> {
  const url = buildListUrl(folderChildrenQuery(folderId), {
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    fields: 'files(id,name,modifiedTime)',
  });
  return parseFileList(await driveFetch(token, url)).filter(
    (file) =>
      file.name.startsWith('FinanceTracker-backup-') ||
      file.name.startsWith('Finance-Tracker-backup-'),
  );
}

export interface DriveBackupResult {
  /** False if the user cancelled the Google sign-in. */
  done: boolean;
  fileName: string;
  /** The account the backup was saved to (email), when known. */
  account: string | null;
}

/**
 * Save the phone's local database to the shared live file, taking a manual snapshot first.
 */
export async function backupToDrive(): Promise<DriveBackupResult> {
  return backupLiveDatabaseToDrive();
}

/** List every backup in the user's Drive folder (newest first). Empty if signed out / none yet. */
export async function listDriveBackups(): Promise<DriveBackup[]> {
  const account = await ensureSignedIn();
  if (!account) return [];
  const token = await getAccessToken();
  const folderId = await findFolderId(token);
  return folderId ? listBackupsIn(token, folderId) : [];
}

export interface DriveRestoreResult {
  restored: boolean;
  /** False when no backup was found in Drive (folder empty / missing). */
  found: boolean;
  fileName?: string;
}

/**
 * Restore the latest data from the user's Drive: the live database, or the newest snapshot when no
 * live file exists yet. Returns `found: false` when Drive has neither. Destructive, so the caller
 * should confirm first.
 */
export async function restoreLatestFromDrive(): Promise<DriveRestoreResult> {
  return restoreLatestFromDriveLive();
}
