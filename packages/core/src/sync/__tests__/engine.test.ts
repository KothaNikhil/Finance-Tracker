import { DriveSyncEngine, type DriveSyncPort, type LiveDatabaseFile, type SnapshotFile } from '../engine';

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
});
