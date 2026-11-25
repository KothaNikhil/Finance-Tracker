import { DriveSyncEngine, RevisionConflictError, type DriveSyncPort, type SnapshotFile } from '../engine';
import {
  EditLockLostError,
  EditLockManager,
  LOCK_TTL_MS,
  discardedOfflineSnapshotName,
  lockJson,
  lockStatus,
  parseLockJson,
  reconnectAction,
  type EditLock,
  type EditLockPort,
  type LockFile,
} from '../lock';

function memoryLockPort() {
  let file: LockFile | null = null;
  let version = 0;
  const port: EditLockPort & {
    file: LockFile | null;
    interfere?: () => void;
    setRaw(lock: EditLock | null): void;
  } = {
    get file() {
      return file;
    },
    setRaw(lock) {
      file = { id: 'lock', etag: `e${++version}`, lock };
    },
    async readLock() {
      return file ? { ...file } : null;
    },
    async createLock(lock) {
      if (file) throw new RevisionConflictError();
      file = { id: 'lock', etag: `e${++version}`, lock };
      return { ...file };
    },
    async writeLock(current, lock) {
      port.interfere?.();
      if (!file || file.etag !== current.etag) throw new RevisionConflictError();
      file = { id: file.id, etag: `e${++version}`, lock };
      return { ...file };
    },
  };
  return port;
}

function clockAt(start: string) {
  let now = new Date(start);
  return {
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const phone = { id: 'phone-1', label: 'your phone', platform: 'phone' as const };
const web = { id: 'web-1', label: 'Chrome on Windows', platform: 'web' as const };

describe('EditLockManager', () => {
  it('lets the first device take a free lock and tells the second it is in use', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditLockManager(port, phone, clock.now);
    const onWeb = new EditLockManager(port, web, clock.now);

    expect((await onPhone.acquire()).kind).toBe('acquired');
    const second = await onWeb.acquire();

    expect(second).toEqual({ kind: 'in-use', holder: expect.objectContaining({ deviceLabel: 'your phone' }) });
    expect(onPhone.holdsLock).toBe(true);
    expect(onWeb.holdsLock).toBe(false);
  });

  it('moves the lock on Take over, and the old holder learns on its next refresh', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditLockManager(port, phone, clock.now);
    const onWeb = new EditLockManager(port, web, clock.now);
    await onPhone.acquire();

    const taken = await onWeb.acquire({ takeOver: true });

    expect(taken).toEqual(expect.objectContaining({ kind: 'acquired', tookOverFrom: expect.objectContaining({ deviceId: 'phone-1' }) }));
    expect(await onPhone.refresh()).toBe(false);
    await expect(onPhone.assertCanWrite()).rejects.toBeInstanceOf(EditLockLostError);
    await expect(onWeb.assertCanWrite()).resolves.toBeUndefined();
  });

  it('treats an expired lock as free, so a killed phone does not lock the user out', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    await new EditLockManager(port, phone, clock.now).acquire();
    clock.advance(LOCK_TTL_MS + 1);

    const result = await new EditLockManager(port, web, clock.now).acquire();

    expect(result).toEqual(expect.objectContaining({ kind: 'acquired', tookOverFrom: null }));
  });

  it('refresh keeps the original acquiredAt and pushes the expiry forward', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const manager = new EditLockManager(port, phone, clock.now);
    await manager.acquire();
    clock.advance(60_000);

    expect(await manager.refresh()).toBe(true);
    expect(port.file?.lock?.acquiredAt).toBe('2026-11-24T10:32:00.000Z');
    expect(port.file?.lock?.expiresAt).toBe(new Date(Date.parse('2026-11-24T10:33:00Z') + LOCK_TTL_MS).toISOString());
  });

  it('quietly reclaims its own expired lock when nobody else took it', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const manager = new EditLockManager(port, phone, clock.now);
    await manager.acquire();
    clock.advance(LOCK_TTL_MS + 5_000);

    expect(await manager.refresh()).toBe(true);
    expect(manager.holdsLock).toBe(true);
  });

  it('release clears only a lock this device still holds', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditLockManager(port, phone, clock.now);
    const onWeb = new EditLockManager(port, web, clock.now);
    await onPhone.acquire();
    await onWeb.acquire({ takeOver: true });

    await onPhone.release();
    expect(port.file?.lock?.deviceId).toBe('web-1');

    await onWeb.release();
    expect(port.file?.lock).toBeNull();
    expect((await onPhone.acquire()).kind).toBe('acquired');
  });

  it('re-reads after losing a write race instead of overwriting the winner', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    await new EditLockManager(port, phone, clock.now).acquire();
    await new EditLockManager(port, phone, clock.now).release();
    const onWeb = new EditLockManager(port, web, clock.now);
    // The phone grabs the lock between the web's read and write.
    port.interfere = () => {
      port.interfere = undefined;
      port.setRaw({
        deviceId: 'phone-1',
        deviceLabel: 'your phone',
        platform: 'phone',
        acquiredAt: clock.now().toISOString(),
        refreshedAt: clock.now().toISOString(),
        expiresAt: new Date(clock.now().getTime() + LOCK_TTL_MS).toISOString(),
      });
    };

    const result = await onWeb.acquire();

    expect(result).toEqual({ kind: 'in-use', holder: expect.objectContaining({ deviceId: 'phone-1' }) });
  });
});

describe('lock helpers', () => {
  const lock: EditLock = {
    deviceId: 'phone-1',
    deviceLabel: 'your phone',
    platform: 'phone',
    acquiredAt: '2026-11-24T10:32:00.000Z',
    refreshedAt: '2026-11-24T10:32:00.000Z',
    expiresAt: '2026-11-24T10:35:00.000Z',
  };

  it('round-trips the lock JSON and reads junk as no lock', () => {
    expect(parseLockJson(lockJson(lock))).toEqual(lock);
    expect(parseLockJson(lockJson(null))).toBeNull();
    expect(parseLockJson('{not json')).toBeNull();
    expect(parseLockJson('{"deviceId":1}')).toBeNull();
  });

  it('classifies locks by holder and expiry', () => {
    const before = new Date('2026-11-24T10:34:00Z');
    const after = new Date('2026-11-24T10:36:00Z');
    expect(lockStatus(lock, 'phone-1', before).kind).toBe('mine');
    expect(lockStatus(lock, 'web-1', before).kind).toBe('other');
    expect(lockStatus(lock, 'web-1', after).kind).toBe('free');
    expect(lockStatus(null, 'web-1', before).kind).toBe('free');
  });

  it('discards offline edits only when another device took over', () => {
    expect(reconnectAction({ status: { kind: 'other', lock }, hasLocalChanges: true })).toBe('discard');
    expect(reconnectAction({ status: { kind: 'mine', lock }, hasLocalChanges: true })).toBe('upload');
    expect(reconnectAction({ status: { kind: 'free' }, hasLocalChanges: true })).toBe('upload');
    expect(reconnectAction({ status: { kind: 'other', lock }, hasLocalChanges: false })).toBe('pull');
  });

  it('names the discarded-offline snapshot so pruning protects it', () => {
    expect(discardedOfflineSnapshotName(new Date(0))).toBe('Finance-Tracker-backup-0-discarded-offline.db');
  });
});

describe('DriveSyncEngine write guard', () => {
  function drive(): DriveSyncPort & { writes: number } {
    const state = { writes: 0 };
    return {
      get writes() {
        return state.writes;
      },
      async findLiveFile() {
        return { id: 'live', name: 'finance-live.db', revisionId: '1', modifiedTime: '2026-01-01' };
      },
      async listSnapshots(): Promise<SnapshotFile[]> {
        return [];
      },
      async download() {
        return new Uint8Array([1]);
      },
      async createLive() {
        state.writes += 1;
        throw new Error('unexpected');
      },
      async updateLive(file) {
        state.writes += 1;
        return { ...file, revisionId: '2' };
      },
      async createSnapshot(name) {
        state.writes += 1;
        return { id: name, name, modifiedTime: '2026-01-01' };
      },
      async deleteFile() {
        state.writes += 1;
      },
    };
  }

  it('writes nothing when the device does not hold the edit lock', async () => {
    const port = drive();
    const engine = new DriveSyncEngine(port, {
      beforeWrite: async () => {
        throw new EditLockLostError(null);
      },
    });

    await expect(
      engine.save(new Uint8Array([2]), { expectedFileId: 'live', expectedRevisionId: '1' }),
    ).rejects.toBeInstanceOf(EditLockLostError);
    expect(port.writes).toBe(0);
  });
});
