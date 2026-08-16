/**
 * Local backup / restore orchestration (Step 8). Turns the database into a `.db` file the user
 * can save to their device or share (drop it in Google Drive to keep it safe), and restores the
 * database from a backup file the user picks.
 *
 * Google Drive auto-sync will layer on top of these same building blocks later.
 */

import { File } from 'expo-file-system';

import { backupFileName, isSqliteFile, type StampParts } from '@/core/backup';
import { restoreFromBytes, serializeDatabase } from '@/services/db/backup';
import { saveBytesToFolder, shareBytes } from '@/services/file-io';

// A generic type so any target (Files, Drive, email) accepts the backup.
const DB_MIME = 'application/octet-stream';

/** Timestamp parts for the backup filename (uses the device clock; not pure, so it lives here). */
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

/** Save a backup of the whole database to a folder the user picks. */
export async function saveBackupToFolder(): Promise<{ saved: boolean; fileName: string }> {
  const fileName = backupFileName(nowStamp());
  const saved = await saveBytesToFolder(serializeDatabase(), fileName, DB_MIME);
  return { saved, fileName };
}

/** Share a backup of the whole database via the OS share sheet. */
export async function shareBackup(): Promise<{ shared: boolean; fileName: string }> {
  const fileName = backupFileName(nowStamp());
  const { shared } = await shareBytes(serializeDatabase(), fileName, DB_MIME, 'Finance Tracker backup');
  return { shared, fileName };
}

/**
 * Let the user pick a backup file and restore from it. Returns `restored: false` if they cancel
 * the picker; throws with a friendly message if the file isn't a valid backup.
 */
export async function restoreFromPickedFile(): Promise<{ restored: boolean }> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (picked.canceled || !picked.result) return { restored: false };

  const bytes = new Uint8Array(await picked.result.arrayBuffer());
  if (!isSqliteFile(bytes)) {
    throw new Error('That doesn’t look like a backup file (.db). Pick a Finance Tracker backup.');
  }
  await restoreFromBytes(bytes);
  return { restored: true };
}
