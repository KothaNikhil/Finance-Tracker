/**
 * Shared "get bytes out of the app" helpers, used by both the Excel export and the backup:
 *  - {@link saveBytesToFolder} writes to a folder the user picks (Android SAF / iOS Files) — a
 *    real save-to-device, outside the sandbox.
 *  - {@link shareBytes} writes to the cache and opens the OS share sheet (Drive, email, …).
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Save bytes to a folder the user chooses. Returns false if they back out of the picker.
 * (Android blocks picking Download / the storage root — the user picks Documents or another folder.)
 */
export async function saveBytesToFolder(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<boolean> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false; // user dismissed the picker
  }
  const file = dir.createFile(fileName, mimeType);
  file.write(bytes);
  return true;
}

/** Write bytes to the cache dir and hand the file to the OS share sheet. */
export async function shareBytes(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  dialogTitle: string,
  uti?: string,
): Promise<{ shared: boolean; uri: string }> {
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle, UTI: uti });
  }
  return { shared: canShare, uri: file.uri };
}
