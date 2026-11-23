import {
  DriveSyncEngine,
  RevisionConflictError,
  type DriveSyncPort,
  type LiveDatabaseFile,
  type SnapshotFile,
} from '@finance-tracker/core/sync/engine';

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

export class GoogleDriveSyncPort implements DriveSyncPort {
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
    const ordered = [...files].sort((a, b) => {
      const dateDifference = Date.parse(b.modifiedTime ?? '') - Date.parse(a.modifiedTime ?? '');
      return dateDifference || a.id.localeCompare(b.id);
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
    const metadata = await this.request<DriveFileResponse>(
      `${DRIVE_API}/${canonical.id}?fields=id,name,headRevisionId,modifiedTime`,
    );
    return asLiveFile(metadata.value, metadata.etag ?? undefined);
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
    if (!response.ok) throw new Error(`Could not download Drive database (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
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

export function createDriveSyncEngine(token: string): DriveSyncEngine {
  return new DriveSyncEngine(new GoogleDriveSyncPort(token));
}
