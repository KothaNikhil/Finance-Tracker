export interface LiveDatabaseFile {
  id: string;
  name: string;
  revisionId: string;
  modifiedTime: string;
  etag?: string;
}

export interface SnapshotFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface DriveSyncPort {
  findLiveFile(): Promise<LiveDatabaseFile | null>;
  listSnapshots(): Promise<SnapshotFile[]>;
  download(fileId: string): Promise<Uint8Array>;
  createLive(bytes: Uint8Array): Promise<LiveDatabaseFile>;
  updateLive(file: LiveDatabaseFile, bytes: Uint8Array): Promise<LiveDatabaseFile>;
  createSnapshot(name: string, bytes: Uint8Array): Promise<SnapshotFile>;
  deleteFile(fileId: string): Promise<void>;
}

export type LoadResult =
  | { kind: 'existing' | 'migrated'; bytes: Uint8Array; file: LiveDatabaseFile }
  | { kind: 'fresh'; file: null };

export type SaveResult =
  | { kind: 'saved'; file: LiveDatabaseFile }
  | { kind: 'conflict'; current: LiveDatabaseFile | null };

export interface SaveOptions {
  expectedFileId: string | null;
  expectedRevisionId: string | null;
  force?: boolean;
  manualSnapshot?: boolean;
  now?: Date;
}

export class RevisionConflictError extends Error {
  constructor() {
    super('The live Drive file changed before this update completed.');
    this.name = 'RevisionConflictError';
  }
}

const SNAPSHOT_PREFIX = 'Finance-Tracker-backup-';
const LEGACY_SNAPSHOT_PREFIX = 'FinanceTracker-backup-';
const SNAPSHOT_LIMIT = 30;

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export class DriveSyncEngine {
  constructor(private readonly drive: DriveSyncPort) {}

  async load(): Promise<LoadResult> {
    const liveFile = await this.drive.findLiveFile();
    if (liveFile) {
      return { kind: 'existing', file: liveFile, bytes: await this.drive.download(liveFile.id) };
    }

    const snapshots = await this.drive.listSnapshots();
    const newest = [...snapshots].sort(
      (a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime),
    )[0];
    if (!newest) return { kind: 'fresh', file: null };

    const bytes = await this.drive.download(newest.id);
    try {
      const file = await this.drive.createLive(bytes);
      return { kind: 'migrated', file, bytes };
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      const winner = await this.drive.findLiveFile();
      if (!winner) throw error;
      return { kind: 'existing', file: winner, bytes: await this.drive.download(winner.id) };
    }
  }

  async save(bytes: Uint8Array, options: SaveOptions): Promise<SaveResult> {
    const current = await this.drive.findLiveFile();
    const matches = current
      ? current.id === options.expectedFileId && current.revisionId === options.expectedRevisionId
      : options.expectedFileId === null && options.expectedRevisionId === null;

    if (!matches && !options.force) return { kind: 'conflict', current };
    if (!current) {
      try {
        return { kind: 'saved', file: await this.drive.createLive(bytes) };
      } catch (error) {
        if (!(error instanceof RevisionConflictError)) throw error;
        return { kind: 'conflict', current: await this.drive.findLiveFile() };
      }
    }

    const now = options.now ?? new Date();
    const snapshots = await this.drive.listSnapshots();
    const dailyName = `${SNAPSHOT_PREFIX}${stamp(new Date(now.getFullYear(), now.getMonth(), now.getDate())).slice(0, 8)}`;
    const hasDailySnapshot = snapshots.some((file) => file.name.startsWith(dailyName));
    if (options.manualSnapshot || options.force || !hasDailySnapshot) {
      const suffix = options.manualSnapshot || options.force ? stamp(now) : dailyName.slice(-8);
      await this.drive.createSnapshot(`${SNAPSHOT_PREFIX}${suffix}.db`, await this.drive.download(current.id));
    }

    let saved: LiveDatabaseFile;
    try {
      saved = await this.drive.updateLive(current, bytes);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      return { kind: 'conflict', current: await this.drive.findLiveFile() };
    }
    await this.pruneSnapshots();
    return { kind: 'saved', file: saved };
  }

  private async pruneSnapshots(): Promise<void> {
    const snapshots = (await this.drive.listSnapshots()).filter(
      (file) => file.name.startsWith(SNAPSHOT_PREFIX) || file.name.startsWith(LEGACY_SNAPSHOT_PREFIX),
    );
    const oldestFirst = [...snapshots].sort(
      (a, b) => Date.parse(a.modifiedTime) - Date.parse(b.modifiedTime),
    );
    const expired = oldestFirst.slice(0, Math.max(0, oldestFirst.length - SNAPSHOT_LIMIT));
    await Promise.all(expired.map((file) => this.drive.deleteFile(file.id)));
  }
}
