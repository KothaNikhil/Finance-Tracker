import {
  BACKUP_FOLDER_NAME,
  buildListUrl,
  buildMultipartRelatedBody,
  bytesToBase64,
  createFileMetaBody,
  createFolderBody,
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  folderChildrenQuery,
  folderSearchQuery,
  mediaDownloadUrl,
  multipartRelatedContentType,
  multipartUploadUrl,
  parseFileId,
  parseFileList,
  type DriveFile,
} from '@/core/drive';
import {
  RevisionConflictError,
  type DriveSyncPort,
  type LiveDatabaseFile,
  type SnapshotFile,
} from '@/core/sync/engine';
import {
  LOCK_FILE_NAME,
  lockJson,
  parseLockJson,
  type EditLock,
  type EditLockPort,
  type LockFile,
} from '@/core/sync/lock';

const LIVE_FILE_NAME = 'finance-live.db';
const SNAPSHOT_PREFIX = 'Finance-Tracker-backup-';
const SQLITE_MIME = 'application/x-sqlite3';

interface DriveMetadata extends DriveFile {
  headRevisionId?: string;
  createdTime?: string;
}

export class DriveReconnectRequiredError extends Error {
  constructor() {
    super('Reconnect Google Drive to continue syncing.');
    this.name = 'DriveReconnectRequiredError';
  }
}

export class GoogleDriveSyncPort implements DriveSyncPort, EditLockPort {
  private folderId: string | null = null;

  constructor(private readonly token: string) {}

  private async request<T>(url: string, init?: RequestInit): Promise<{ value: T; etag: string | null }> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init?.headers ?? {}) },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
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
    const folderResult = await this.request<unknown>(
      buildListUrl(folderSearchQuery(BACKUP_FOLDER_NAME), {
        pageSize: 10,
        fields: 'files(id,name)',
      }),
    );
    const existing = parseFileList(folderResult.value)[0];
    if (existing) {
      this.folderId = existing.id;
      return existing.id;
    }

    const created = await this.request<unknown>(`${DRIVE_FILES_URL}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createFolderBody(BACKUP_FOLDER_NAME)),
    });
    const id = parseFileId(created.value);
    if (!id) throw new Error('Google Drive did not return the Finance Tracker folder id.');
    this.folderId = id;
    return id;
  }

  private async listFiles(query: string): Promise<DriveMetadata[]> {
    const result = await this.request<unknown>(
      buildListUrl(query, {
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        fields: 'files(id,name,createdTime,modifiedTime,headRevisionId)',
      }),
    );
    const files = (result.value as { files?: DriveMetadata[] }).files ?? [];
    return files.filter(
      (file) => typeof file.id === 'string' && typeof file.name === 'string',
    );
  }

  async createSnapshot(name: string, bytes: Uint8Array): Promise<SnapshotFile> {
    const folderId = await this.ensureFolder();
    const body = buildMultipartRelatedBody(
      { ...createFileMetaBody(name, folderId), mimeType: SQLITE_MIME },
      bytesToBase64(bytes),
      SQLITE_MIME,
    );
    const created = await this.request<unknown>(
      `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,modifiedTime`,
      {
        method: 'POST',
        headers: { 'Content-Type': multipartRelatedContentType() },
        body,
      },
    );
    const file = created.value as Partial<DriveMetadata>;
    if (typeof file.id !== 'string' || typeof file.name !== 'string') {
      throw new Error('Google Drive did not return the snapshot file details.');
    }
    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime ?? new Date().toISOString(),
    };
  }

  async findLiveFile(): Promise<LiveDatabaseFile | null> {
    const folderId = await this.ensureFolder();
    const matches = await this.listFiles(
      `${folderChildrenQuery(folderId)} and name='${LIVE_FILE_NAME}'`,
    );
    if (matches.length === 0) return null;

    // Two devices can create the live file at the same moment. The FIRST one created stays canonical,
    // so the earlier creator keeps its file and the later one gets a RevisionConflictError.
    const ordered = [...matches].sort((a, b) => {
      const created = Date.parse(a.createdTime ?? a.modifiedTime ?? '') - Date.parse(b.createdTime ?? b.modifiedTime ?? '');
      return created || a.id.localeCompare(b.id);
    });
    const canonical = ordered[0];
    for (const duplicate of ordered.slice(1)) {
      await this.createSnapshot(
        `${SNAPSHOT_PREFIX}${Date.now()}-duplicate-${duplicate.id}.db`,
        await this.download(duplicate.id),
      );
    }
    await Promise.all(ordered.slice(1).map((duplicate) => this.deleteFile(duplicate.id)));

    const metadata = await this.request<DriveMetadata>(
      `${DRIVE_FILES_URL}/${encodeURIComponent(canonical.id)}?fields=id,name,headRevisionId,modifiedTime`,
    );
    if (!metadata.value.headRevisionId) {
      throw new Error('Drive returned a live database without a head revision id.');
    }
    return {
      id: metadata.value.id,
      name: metadata.value.name,
      revisionId: metadata.value.headRevisionId,
      modifiedTime: metadata.value.modifiedTime ?? new Date().toISOString(),
      etag: metadata.etag ?? undefined,
    };
  }

  async listSnapshots(): Promise<SnapshotFile[]> {
    const folderId = await this.ensureFolder();
    const files = await this.listFiles(folderChildrenQuery(folderId));
    return files
      .filter(
        (file) =>
          file.name.startsWith(SNAPSHOT_PREFIX) || file.name.startsWith('FinanceTracker-backup-'),
      )
      .map((file) => ({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime ?? new Date(0).toISOString(),
      }));
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await fetch(mediaDownloadUrl(fileId), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (!response.ok) throw new Error(`Could not download Drive database (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async createLive(bytes: Uint8Array): Promise<LiveDatabaseFile> {
    const folderId = await this.ensureFolder();
    if (await this.findLiveFile()) throw new RevisionConflictError();
    const body = buildMultipartRelatedBody(
      { ...createFileMetaBody(LIVE_FILE_NAME, folderId), mimeType: SQLITE_MIME },
      bytesToBase64(bytes),
      SQLITE_MIME,
    );
    const created = await this.request<unknown>(multipartUploadUrl(), {
      method: 'POST',
      headers: { 'Content-Type': multipartRelatedContentType() },
      body,
    });
    const createdId = parseFileId(created.value);
    if (!createdId) throw new Error('Google Drive did not return the live database id.');
    const canonical = await this.findLiveFile();
    if (!canonical) throw new Error('The live database upload completed but could not be found in Drive.');
    if (canonical.id !== createdId) throw new RevisionConflictError();
    return canonical;
  }

  async updateLive(file: LiveDatabaseFile, bytes: Uint8Array): Promise<LiveDatabaseFile> {
    const latest = await this.findLiveFile();
    if (!latest || latest.id !== file.id || latest.revisionId !== file.revisionId) {
      throw new RevisionConflictError();
    }
    const response = await this.request<DriveMetadata>(
      `${DRIVE_UPLOAD_URL}/${encodeURIComponent(file.id)}?uploadType=multipart&fields=id,name,headRevisionId,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': multipartRelatedContentType(),
          ...(latest.etag ? { 'If-Match': latest.etag } : {}),
        },
        body: buildMultipartRelatedBody(
          { name: file.name },
          bytesToBase64(bytes),
          SQLITE_MIME,
        ),
      },
    );
    if (!response.value.headRevisionId) {
      throw new Error('Drive did not return a revision id after saving the live database.');
    }
    return {
      id: response.value.id,
      name: response.value.name,
      revisionId: response.value.headRevisionId,
      modifiedTime: response.value.modifiedTime ?? new Date().toISOString(),
      etag: response.etag ?? undefined,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not prune old Drive snapshot (${response.status}).`);
    }
  }

  /** Drive's current `version` of the lock file. A lock file deleted meanwhile reads as a conflict. */
  private async lockVersion(fileId: string): Promise<string> {
    const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,version`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (response.status === 404) throw new RevisionConflictError();
    if (!response.ok) throw new Error(`Could not read the edit lock (${response.status}).`);
    const version = parseVersion(await response.json());
    if (!version) throw new Error('Drive returned the edit lock without a version.');
    return version;
  }

  private async lockContent(fileId: string): Promise<EditLock | null> {
    const response = await fetch(mediaDownloadUrl(fileId), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 401) throw new DriveReconnectRequiredError();
    if (response.status === 404) throw new RevisionConflictError();
    if (!response.ok) throw new Error(`Could not read the edit lock (${response.status}).`);
    return parseLockJson(await response.text());
  }

  /** The lock file's id and current version. Duplicates resolve to the oldest, like the live file. */
  private async findLockFile(): Promise<{ id: string; version: string } | null> {
    const folderId = await this.ensureFolder();
    const files = await this.listFiles(
      `'${folderId}' in parents and name='${LOCK_FILE_NAME}' and trashed=false`,
    );
    if (!files[0]) return null;
    const ordered = [...files].sort(
      (a, b) =>
        Date.parse(a.createdTime ?? a.modifiedTime ?? '') - Date.parse(b.createdTime ?? b.modifiedTime ?? '') ||
        a.id.localeCompare(b.id),
    );
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
    const folderId = await this.ensureFolder();
    const created = await this.request<unknown>(multipartUploadUrl(), {
      method: 'POST',
      headers: { 'Content-Type': multipartRelatedContentType() },
      body: buildMultipartRelatedBody(
        { ...createFileMetaBody(LOCK_FILE_NAME, folderId), mimeType: 'application/json' },
        bytesToBase64(new TextEncoder().encode(lockJson(lock))),
        'application/json',
      ),
    });
    const createdId = parseFileId(created.value);
    if (!createdId) throw new Error('Google Drive did not return the edit lock id.');
    // Another device may have created one at the same moment; the oldest wins and the rest are deleted.
    const canonical = await this.findLockFile();
    if (!canonical || canonical.id !== createdId) throw new RevisionConflictError();
    return { ...canonical, lock };
  }

  async writeLock(file: LockFile, lock: EditLock | null): Promise<LockFile> {
    // Drive v3 has no ETag / If-Match, so check the version right before writing and read the
    // content back after: a device that raced and lost sees the other device's lock.
    if ((await this.lockVersion(file.id)) !== file.version) throw new RevisionConflictError();
    const written = await this.request<unknown>(
      `${DRIVE_UPLOAD_URL}/${encodeURIComponent(file.id)}?uploadType=media&fields=id,version`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: lockJson(lock),
      },
    );
    const version = parseVersion(written.value) ?? (await this.lockVersion(file.id));
    if (lockJson(await this.lockContent(file.id)) !== lockJson(lock)) throw new RevisionConflictError();
    return { id: file.id, version, lock };
  }
}

function parseVersion(value: unknown): string | null {
  const version = (value as { version?: unknown } | null)?.version;
  return typeof version === 'string' || typeof version === 'number' ? String(version) : null;
}
