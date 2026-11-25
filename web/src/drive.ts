import {
  DriveSyncEngine,
  RevisionConflictError,
  type DriveSyncEngineOptions,
  type DriveSyncPort,
  type LiveDatabaseFile,
  type SnapshotFile,
} from '@finance-tracker/core/sync/engine';
import {
  LOCK_FILE_NAME,
  lockJson,
  parseLockJson,
  type EditLock,
  type EditLockPort,
  type LockFile,
} from '@finance-tracker/core/sync/lock';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'Finance Tracker';
const LIVE_FILE_NAME = 'finance-live.db';
const SNAPSHOT_PREFIX = 'Finance-Tracker-backup-';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SQLITE_MIME = 'application/x-sqlite3';

interface DriveFileResponse {
  id: string;
  name: string;
  mimeType?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
}

export class DriveReconnectRequiredError extends Error {
  constructor() {
    super('Reconnect Google Drive to continue saving.');
    this.name = 'DriveReconnectRequiredError';
  }
}

/** Google returned a token without the drive.file scope (the consent checkbox was left unticked). */
export class DriveAccessMissingError extends Error {
  constructor() {
    super('Google Drive access was not granted.');
    this.name = 'DriveAccessMissingError';
  }
}

export interface DriveLoadProgress {
  onLiveFileFound?(file: LiveDatabaseFile & { size: number | null }): void;
  onDownloadProgress?(loadedBytes: number, totalBytes: number | null): void;
}

async function isScopeError(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const detail = await response.clone().text().catch(() => '');
  return /insufficient(Permissions|.*scopes?)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(detail);
}

function asLiveFile(file: DriveFileResponse, etag?: string): LiveDatabaseFile {
  if (!file.headRevisionId) throw new Error('Drive returned a live database without a head revision id.');
  return {
    id: file.id,
    name: file.name,
    revisionId: file.headRevisionId,
    modifiedTime: file.modifiedTime ?? new Date().toISOString(),
    etag,
  };
}

function parseVersion(value: unknown): string | null {
  const version = (value as { version?: unknown } | null)?.version;
  return typeof version === 'string' || typeof version === 'number' ? String(version) : null;
}

async function concatenate(parts: (string | Uint8Array)[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const encoded = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
  const result = new Uint8Array(encoded.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of encoded) {
    result.set(part, offset);
    offset += part.length;
  }
  return result.buffer;
}

export class GoogleDriveSyncPort implements DriveSyncPort, EditLockPort {
  private folderId: string | null = null;

  constructor(private readonly token: string, private readonly progress: DriveLoadProgress = {}) {}

  private async request<T>(url: string, init?: RequestInit): Promise<{ value: T; etag: string | null }> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init?.headers ?? {}) },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (await isScopeError(response)) throw new DriveAccessMissingError();
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 412) throw new RevisionConflictError();
      throw new Error(`Google Drive request failed (${response.status}). ${detail.slice(0, 200)}`.trim());
    }
    const value = (response.status === 204 ? null : await response.json()) as T;
    return { value, etag: response.headers.get('etag') };
  }

  private async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const list = await this.request<{ files: DriveFileResponse[] }>(
      `${DRIVE_API}?q=${q}&pageSize=10&fields=files(id,name,mimeType)`,
    );
    const existing = list.value.files?.[0];
    if (existing) {
      this.folderId = existing.id;
      return existing.id;
    }
    const created = await this.request<DriveFileResponse>(`${DRIVE_API}?fields=id,name,mimeType`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    if (!created.value.id) throw new Error('Google Drive did not return the Finance Tracker folder id.');
    this.folderId = created.value.id;
    return created.value.id;
  }

  private async listFiles(query: string): Promise<DriveFileResponse[]> {
    const q = encodeURIComponent(query);
    const result = await this.request<{ files: DriveFileResponse[] }>(
      `${DRIVE_API}?q=${q}&pageSize=100&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,headRevisionId,createdTime,modifiedTime,parents)`,
    );
    return result.value.files ?? [];
  }

  async findLiveFile(): Promise<LiveDatabaseFile | null> {
    const folderId = await this.ensureFolder();
    const files = await this.listFiles(
      `'${folderId}' in parents and name='${LIVE_FILE_NAME}' and trashed=false`,
    );
    if (!files[0]) return null;
    // Two devices can create the live file at the same moment. The FIRST one created stays canonical,
    // so the earlier creator keeps its file and the later one gets a RevisionConflictError.
    const ordered = [...files].sort((a, b) => {
      const created = Date.parse(a.createdTime ?? a.modifiedTime ?? '') - Date.parse(b.createdTime ?? b.modifiedTime ?? '');
      return created || a.id.localeCompare(b.id);
    });
    const canonical = ordered[0];
    if (ordered.length > 1) {
      const duplicates = ordered.slice(1);
      for (const duplicate of duplicates) {
        await this.createSnapshot(
          `${SNAPSHOT_PREFIX}${Date.now()}-duplicate-${duplicate.id}.db`,
          await this.download(duplicate.id),
        );
      }
      await Promise.all(duplicates.map((duplicate) => this.deleteFile(duplicate.id)));
    }
    const metadata = await this.request<DriveFileResponse & { size?: string }>(
      `${DRIVE_API}/${canonical.id}?fields=id,name,headRevisionId,modifiedTime,size`,
    );
    const live = asLiveFile(metadata.value, metadata.etag ?? undefined);
    this.progress.onLiveFileFound?.({ ...live, size: metadata.value.size ? Number(metadata.value.size) : null });
    return live;
  }

  async listSnapshots(): Promise<SnapshotFile[]> {
    const folderId = await this.ensureFolder();
    return (await this.listFiles(
      `'${folderId}' in parents and (name contains '${SNAPSHOT_PREFIX}' or name contains 'FinanceTracker-backup-') and trashed=false`,
    )).map((file) => ({
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime ?? new Date(0).toISOString(),
    }));
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await fetch(`${DRIVE_API}/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (await isScopeError(response)) throw new DriveAccessMissingError();
    if (!response.ok) throw new Error(`Could not download Drive database (${response.status}).`);
    const onProgress = this.progress.onDownloadProgress;
    if (!onProgress || !response.body) return new Uint8Array(await response.arrayBuffer());
    const total = Number(response.headers.get('content-length')) || null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    onProgress(0, total);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  async createLive(bytes: Uint8Array): Promise<LiveDatabaseFile> {
    const folderId = await this.ensureFolder();
    if (await this.findLiveFile()) throw new RevisionConflictError();
    const boundary = `finance-tracker-${crypto.randomUUID()}`;
    const body = await concatenate([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: LIVE_FILE_NAME, mimeType: SQLITE_MIME, parents: [folderId] })}\r\n`,
      `--${boundary}\r\nContent-Type: ${SQLITE_MIME}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
    ]);
    const created = await this.request<DriveFileResponse>(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,headRevisionId,modifiedTime`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    const canonical = await this.findLiveFile();
    if (!canonical) throw new Error('The live database upload completed but could not be found in Drive.');
    if (canonical.id !== created.value.id) throw new RevisionConflictError();
    return canonical;
  }

  async updateLive(file: LiveDatabaseFile, bytes: Uint8Array): Promise<LiveDatabaseFile> {
    const latest = await this.findLiveFile();
    if (!latest || latest.id !== file.id || latest.revisionId !== file.revisionId) {
      throw new RevisionConflictError();
    }
    const response = await this.request<DriveFileResponse>(
      `${DRIVE_UPLOAD_API}/${file.id}?uploadType=media&fields=id,name,headRevisionId,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': SQLITE_MIME,
          ...(latest.etag ? { 'If-Match': latest.etag } : {}),
        },
        body: bytes.slice().buffer,
      },
    );
    return asLiveFile(response.value, response.etag ?? undefined);
  }

  async createSnapshot(name: string, bytes: Uint8Array): Promise<SnapshotFile> {
    const folderId = await this.ensureFolder();
    const boundary = `finance-tracker-${crypto.randomUUID()}`;
    const body = await concatenate([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: SQLITE_MIME, parents: [folderId] })}\r\n`,
      `--${boundary}\r\nContent-Type: ${SQLITE_MIME}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
    ]);
    const created = await this.request<DriveFileResponse>(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return {
      id: created.value.id,
      name: created.value.name,
      modifiedTime: created.value.modifiedTime ?? new Date().toISOString(),
    };
  }

  async uploadFile(name: string, bytes: Uint8Array, mimeType: string): Promise<{ id: string; name: string }> {
    const folderId = await this.ensureFolder();
    const boundary = `finance-tracker-${crypto.randomUUID()}`;
    const body = await concatenate([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType, parents: [folderId] })}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      bytes,
      `\r\n--${boundary}--`,
    ]);
    const result = await this.request<DriveFileResponse>(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!result.value.id || !result.value.name) throw new Error('Google Drive did not return the exported file.');
    return { id: result.value.id, name: result.value.name };
  }

  /** Drive's current `version` of the lock file. A lock file deleted meanwhile reads as a conflict. */
  private async lockVersion(fileId: string): Promise<string> {
    const response = await this.lockFetch(`${DRIVE_API}/${fileId}?fields=id,version`);
    const version = parseVersion(await response.json());
    if (!version) throw new Error('Drive returned the edit lock without a version.');
    return version;
  }

  private async lockContent(fileId: string): Promise<EditLock | null> {
    return parseLockJson(await (await this.lockFetch(`${DRIVE_API}/${fileId}?alt=media`)).text());
  }

  private async lockFetch(url: string): Promise<Response> {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (await isScopeError(response)) throw new DriveAccessMissingError();
    if (response.status === 404) throw new RevisionConflictError();
    if (!response.ok) throw new Error(`Could not read the edit lock (${response.status}).`);
    return response;
  }

  /** The lock file's id and current version. Duplicates resolve to the oldest, like the live file. */
  private async findLockFile(): Promise<{ id: string; version: string } | null> {
    const folderId = await this.ensureFolder();
    const files = await this.listFiles(`'${folderId}' in parents and name='${LOCK_FILE_NAME}' and trashed=false`);
    if (!files[0]) return null;
    const ordered = [...files].sort((a, b) => {
      const created = Date.parse(a.createdTime ?? a.modifiedTime ?? '') - Date.parse(b.createdTime ?? b.modifiedTime ?? '');
      return created || a.id.localeCompare(b.id);
    });
    await Promise.all(ordered.slice(1).map((duplicate) => this.deleteFile(duplicate.id)));
    try {
      return { id: ordered[0].id, version: await this.lockVersion(ordered[0].id) };
    } catch (error) {
      if (error instanceof RevisionConflictError) return null;
      throw error;
    }
  }

  async readLock(): Promise<LockFile | null> {
    // Version before content: if the lock changes in between, the stale version makes the next
    // write fail and re-read, rather than overwrite a lock this device never saw.
    const found = await this.findLockFile();
    if (!found) return null;
    try {
      return { ...found, lock: await this.lockContent(found.id) };
    } catch (error) {
      if (error instanceof RevisionConflictError) return null;
      throw error;
    }
  }

  async createLock(lock: EditLock): Promise<LockFile> {
    const created = await this.uploadFile(LOCK_FILE_NAME, new TextEncoder().encode(lockJson(lock)), 'application/json');
    const canonical = await this.findLockFile();
    if (!canonical || canonical.id !== created.id) throw new RevisionConflictError();
    return { ...canonical, lock };
  }

  async writeLock(file: LockFile, lock: EditLock | null): Promise<LockFile> {
    // Drive v3 has no ETag / If-Match, so check the version right before writing and read the
    // content back after: a device that raced and lost sees the other device's lock.
    if ((await this.lockVersion(file.id)) !== file.version) throw new RevisionConflictError();
    const written = await this.request<unknown>(`${DRIVE_UPLOAD_API}/${file.id}?uploadType=media&fields=id,version`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: lockJson(lock),
    });
    const version = parseVersion(written.value) ?? (await this.lockVersion(file.id));
    if (lockJson(await this.lockContent(file.id)) !== lockJson(lock)) throw new RevisionConflictError();
    return { id: file.id, version, lock };
  }

  /**
   * Clear the lock while the page unloads: one `keepalive` PATCH started synchronously, with no
   * version check or read-back, because nothing after an `await` runs once the page is gone.
   */
  releaseLockNow(file: LockFile): void {
    void fetch(`${DRIVE_UPLOAD_API}/${file.id}?uploadType=media&fields=id`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: lockJson(null),
      keepalive: true,
    }).catch(() => undefined);
  }

  async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${DRIVE_API}/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not prune old Drive snapshot (${response.status}).`);
    }
  }
}

export function createDriveSyncEngine(
  token: string,
  progress?: DriveLoadProgress,
  options?: DriveSyncEngineOptions,
): DriveSyncEngine {
  return new DriveSyncEngine(new GoogleDriveSyncPort(token, progress), options);
}
