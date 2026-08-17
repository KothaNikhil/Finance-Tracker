/**
 * Web stub for the Drive backup service. Google Sign-In / Drive backup is a native-only feature
 * here; this stub keeps the web bundle from importing the native module. The Manage screen hides
 * the Drive buttons on web, so these throw only if called directly.
 */

import type { DriveBackupResult, DriveRestoreResult, DriveBackup, DriveSyncResult } from './index';

const MESSAGE = 'Google Drive backup is available in the mobile app, not the web version.';

export type { DriveBackup, DriveBackupResult, DriveRestoreResult, DriveSyncResult };

export function driveAvailable(): boolean {
  return false;
}

export async function backupToDrive(): Promise<DriveBackupResult> {
  throw new Error(MESSAGE);
}

export async function listDriveBackups(): Promise<DriveBackup[]> {
  return [];
}

export async function restoreLatestFromDrive(): Promise<DriveRestoreResult> {
  throw new Error(MESSAGE);
}

/** No Drive on web, so nothing to sync down (web Google login is profile-only). */
export async function syncDownFromDrive(): Promise<DriveSyncResult> {
  return { restored: false, found: false };
}
