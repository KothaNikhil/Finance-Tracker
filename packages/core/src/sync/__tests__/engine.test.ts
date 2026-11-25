import {
  DriveSyncEngine,
  hasPendingLocalChanges,
  type DriveSyncPort,
  type LiveDatabaseFile,
  type SnapshotFile,
} from '../engine';

function fakeDrive(): DriveSyncPort & {
  live: LiveDatabaseFile | null;
  snapshots: SnapshotFile[];
  bytesById: Map<string, Uint8Array>;
  snapshotsCreated: number;
  updates: number;
} {
  let nextId = 0;
  const state = {
    live: null as LiveDatabaseFile | null,
    snapshots: [] as SnapshotFile[],
    bytesById: new Map<string, Uint8Array>(),
    snapshotsCreated: 0,
    updates: 0,
  };
  return {
    get live() {
      return state.live;
    },
    get snapshots() {
      return state.snapshots;
    },
    get bytesById() {
      return state.bytesById;
    },
    get snapshotsCreated() {
      return state.snapshotsCreated;
    },
    get updates() {
      return state.updates;
    },
    async findLiveFile() {
      return state.live;
    },
    async listSnapshots() {
      return state.snapshots;
    },
    async download(fileId) {
      const bytes = state.bytesById.get(fileId);
      if (!bytes) throw new Error('Missing fixture file');
      return bytes;
    },
    async createLive(bytes) {
      const file = { id: `live-${++nextId}`, name: 'finance-live.db', revisionId: '1', modifiedTime: '2026-01-01' };
      state.live = file;
      state.bytesById.set(file.id, bytes);
      return file;
    },
    async updateLive(file, bytes) {
      state.updates += 1;
      const updated = { ...file, revisionId: String(Number(file.revisionId) + 1) };
      state.live = updated;
      state.bytesById.set(file.id, bytes);
      return updated;
    },
    async createSnapshot(name, bytes) {
      state.snapshotsCreated += 1;
      const file = { id: `snapshot-${++nextId}`, name, modifiedTime: '2026-01-01' };
      state.snapshots.push(file);
      state.bytesById.set(file.id, bytes);
      return file;
    },
    async deleteFile(fileId) {
      state.snapshots = state.snapshots.filter((file) => file.id !== fileId);
      state.bytesById.delete(fileId);
    },
  };
}

describe('DriveSyncEngine', () => {
  it('detects an edit after the first empty database upload', () => {
    expect(hasPendingLocalChanges('2026-03-01T10:00:00.001Z', '')).toBe(true);
    expect(hasPendingLocalChanges(null, '')).toBe(false);
  });

  it('seeds the live database from the newest snapshot when no live file exists', async () => {
    const drive = fakeDrive();
    const bytes = new Uint8Array([9, 8, 7]);
    drive.snapshots.push({ id: 'old', name: 'FinanceTracker-backup-2025-01-01-0000.db', modifiedTime: '2025-01-01' });
    drive.snapshots.push({ id: 'new', name: 'Finance-Tracker-backup-2026-01-01.db', modifiedTime: '2026-01-01' });
    drive.bytesById.set('old', new Uint8Array([1]));
    drive.bytesById.set('new', bytes);

    const result = await new DriveSyncEngine(drive).load();

    expect(result.kind).toBe('migrated');
    expect(result.bytes).toBe(bytes);
    expect(drive.live?.name).toBe('finance-live.db');
  });

  it('returns a conflict instead of uploading when the Drive revision changed', async () => {
    const drive = fakeDrive();
    const live = await drive.createLive(new Uint8Array([1]));
    await drive.updateLive(live, new Uint8Array([2]));

    const result = await new DriveSyncEngine(drive).save(new Uint8Array([3]), {
      expectedFileId: live.id,
      expectedRevisionId: '1',
    });

    expect(result.kind).toBe('conflict');
    expect(drive.updates).toBe(1);
  });

  it('detects a competing live-file creation even when revision ids match', async () => {
    const drive = fakeDrive();
    const first = await drive.createLive(new Uint8Array([1]));
    await drive.createLive(new Uint8Array([2]));

    const result = await new DriveSyncEngine(drive).save(new Uint8Array([3]), {
      expectedFileId: first.id,
      expectedRevisionId: first.revisionId,
    });

    expect(result.kind).toBe('conflict');
    expect(drive.updates).toBe(0);
  });

  it('snapshots before an overwrite and advances the expected revision', async () => {
    const drive = fakeDrive();
    const live = await drive.createLive(new Uint8Array([1]));

    const result = await new DriveSyncEngine(drive).save(new Uint8Array([2]), {
      expectedFileId: live.id,
      expectedRevisionId: null,
      force: true,
      now: new Date('2026-03-04T10:20:30'),
    });

    expect(result.kind).toBe('saved');
    expect(drive.snapshotsCreated).toBe(1);
    expect(drive.updates).toBe(1);
  });

  it('keeps a before-delete snapshot for 30 days even when 30 newer backups exist', async () => {
    const drive = fakeDrive();
    const live = await drive.createLive(new Uint8Array([1]));
    drive.snapshots.push({ id: 'del', name: 'Finance-Tracker-backup-1-before-delete-all-data.db', modifiedTime: '2026-02-20T00:00:00Z' });
    drive.snapshots.push({ id: 'old-del', name: 'Finance-Tracker-backup-0-before-delete-all-data.db', modifiedTime: '2026-01-01T00:00:00Z' });
    for (let day = 1; day <= 31; day += 1) {
      drive.snapshots.push({ id: `m${day}`, name: `Finance-Tracker-backup-202603${String(day).padStart(2, '0')}-manual.db`, modifiedTime: `2026-03-${String(day).padStart(2, '0')}T00:00:00Z` });
    }

    await new DriveSyncEngine(drive).save(new Uint8Array([2]), {
      expectedFileId: live.id,
      expectedRevisionId: live.revisionId,
      now: new Date('2026-03-15T12:00:00Z'),
    });

    const ids = drive.snapshots.map((file) => file.id);
    expect(ids).toContain('del');
    expect(ids).not.toContain('old-del');
    expect(ids.filter((id) => id !== 'del').length).toBe(30);
  });
});
