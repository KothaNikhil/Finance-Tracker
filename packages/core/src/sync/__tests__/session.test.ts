import { RevisionConflictError } from '../engine';
import { EditLockLostError, LOCK_TTL_MS, type EditLock, type EditLockPort, type LockFile } from '../lock';
import { EditSession, holderName } from '../session';

function memoryLockPort(): EditLockPort {
  let file: LockFile | null = null;
  let version = 0;
  return {
    async readLock() {
      return file ? { ...file } : null;
    },
    async createLock(lock) {
      if (file) throw new RevisionConflictError();
      file = { id: 'lock', version: `v${++version}`, lock };
      return { ...file };
    },
    async writeLock(current, lock) {
      if (!file || file.version !== current.version) throw new RevisionConflictError();
      file = { id: file.id, version: `v${++version}`, lock };
      return { ...file };
    },
  };
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

const phone = { id: 'phone-1', label: 'Pixel 8', platform: 'phone' as const };
const web = { id: 'web-1', label: 'Chrome on Windows', platform: 'web' as const };

describe('EditSession', () => {
  it('edits when the lock is free and is asked about Take over when it is not', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditSession(port, phone, { clock: clock.now });
    const onWeb = new EditSession(port, web, { clock: clock.now });

    expect((await onPhone.start()).mode).toBe('editing');
    const second = await onWeb.start();

    expect(second).toMatchObject({ mode: 'view-only', reason: 'in-use', holder: { deviceId: 'phone-1' } });
    onWeb.chooseViewOnly();
    expect(onWeb.getState().reason).toBe('chosen');
  });

  it('tells the old holder on its next heartbeat and runs onLost once', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onLost = jest.fn(async () => 'discarded' as const);
    const onPhone = new EditSession(port, phone, { clock: clock.now, onLost });
    const onWeb = new EditSession(port, web, { clock: clock.now });
    await onPhone.start();
    const listener = jest.fn();
    onPhone.subscribe(listener);

    expect(await onWeb.takeOver()).toMatchObject({ deviceId: 'phone-1' });
    await Promise.all([onPhone.tick(), onPhone.tick()]);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'web-1' }));
    expect(onPhone.getState()).toMatchObject({ mode: 'view-only', reason: 'discarded', holder: { deviceId: 'web-1' } });
    expect(listener).toHaveBeenCalled();
  });

  it('handles a loss found by a guarded write and still rejects the write', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onLost = jest.fn();
    const onPhone = new EditSession(port, phone, { clock: clock.now, onLost });
    await onPhone.start();
    await new EditSession(port, web, { clock: clock.now }).takeOver();

    await expect(onPhone.assertCanWrite()).rejects.toBeInstanceOf(EditLockLostError);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onPhone.getState()).toMatchObject({ mode: 'view-only', reason: 'moved' });
  });

  it('keeps a view-only device informed and lets it take over later', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditSession(port, phone, { clock: clock.now });
    const onWeb = new EditSession(port, web, { clock: clock.now });
    await onWeb.start();
    await onPhone.start();

    clock.advance(LOCK_TTL_MS + 1);
    const status = await onPhone.tick();
    expect(status?.kind).toBe('free');
    expect(onPhone.getState().holder).toBeNull();

    await onPhone.takeOver();
    expect(onPhone.editing).toBe(true);
  });

  it('leaves an unresolved session to the next sync, but a guarded write resolves it', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditSession(port, phone, { clock: clock.now });
    await new EditSession(port, phone, { clock: clock.now }).start();

    await onPhone.tick();
    expect(onPhone.getState().mode).toBe('unknown');
    await onPhone.assertCanWrite();
    expect(onPhone.editing).toBe(true);
  });

  it('release frees the lock for the other device', async () => {
    const port = memoryLockPort();
    const clock = clockAt('2026-11-24T10:32:00Z');
    const onPhone = new EditSession(port, phone, { clock: clock.now });
    await onPhone.start();
    await onPhone.release();

    expect(onPhone.getState().mode).toBe('unknown');
    expect((await new EditSession(port, web, { clock: clock.now }).start()).mode).toBe('editing');
  });
});

describe('holderName', () => {
  const lock = (platform: 'web' | 'phone', deviceLabel: string): EditLock => ({
    deviceId: 'x',
    deviceLabel,
    platform,
    acquiredAt: '',
    refreshedAt: '',
    expiresAt: '',
  });

  it('names the other device the way each app talks about it', () => {
    expect(holderName(lock('phone', 'Pixel 8'), 'web')).toBe('your phone');
    expect(holderName(lock('web', 'Chrome on Windows'), 'phone')).toBe('the website');
    expect(holderName(lock('web', 'Chrome on Windows'), 'web')).toBe('Chrome on Windows');
    expect(holderName(null, 'web')).toBe('another device');
  });
});
