/**
 * One device edits at a time.
 *
 * Drive holds a small lock file (`finance-session.json`) next to `finance-live.db`. The device that
 * holds the lock is the only one that writes to Drive; it refreshes the lock about once a minute
 * and releases it on sign-out or tab close. A lock that isn't refreshed expires, so a phone that was
 * killed or went flat can't lock the user out for long.
 *
 * A second device sees "In use on <device>" and can either Take over (the lock moves to it) or stay
 * View only. The device that lost the lock finds out on its next refresh or write and stops writing.
 *
 * Writes to the lock file use the file's ETag (`If-Match`), so two devices racing to take the lock
 * can't both win; the loser gets {@link RevisionConflictError} from the port. The live file's own
 * revision check stays as a backstop.
 *
 * This module is pure TypeScript. Each app implements {@link EditLockPort} with its Drive client.
 */

import { RevisionConflictError } from './engine';

export const LOCK_FILE_NAME = 'finance-session.json';
/** How often the holder refreshes the lock while the app is open. */
export const LOCK_HEARTBEAT_MS = 60_000;
/** A lock not refreshed for this long is treated as free. */
export const LOCK_TTL_MS = 3 * 60_000;

export type DevicePlatform = 'web' | 'phone';

export interface DeviceIdentity {
  /** Stable per install (phone) or per browser profile (web). */
  id: string;
  /** Shown to the other device, e.g. "your phone" or "Chrome on Windows". */
  label: string;
  platform: DevicePlatform;
}

export interface EditLock {
  deviceId: string;
  deviceLabel: string;
  platform: DevicePlatform;
  /** When this device took the lock (ISO). Shown as "since 10:32". */
  acquiredAt: string;
  /** Last refresh (ISO). */
  refreshedAt: string;
  /** After this the lock is free (ISO). */
  expiresAt: string;
}

/** The lock file as read from Drive. `lock` is null after a release. */
export interface LockFile {
  id: string;
  /** Used as `If-Match` on the next write. */
  etag: string;
  lock: EditLock | null;
}

export interface EditLockPort {
  /** Read the lock file, or null if it doesn't exist yet. */
  readLock(): Promise<LockFile | null>;
  /**
   * Create the lock file holding `lock`. If another device created one at the same moment, the
   * oldest file wins and this rejects with {@link RevisionConflictError}.
   */
  createLock(lock: EditLock): Promise<LockFile>;
  /**
   * Replace the lock file's content, only if its ETag still matches `file.etag`. Rejects with
   * {@link RevisionConflictError} when another device wrote it first.
   */
  writeLock(file: LockFile, lock: EditLock | null): Promise<LockFile>;
}

/** Thrown when a device tries to write to Drive without holding the lock. */
export class EditLockLostError extends Error {
  constructor(readonly holder: EditLock | null) {
    super(
      holder
        ? `Editing moved to ${holder.deviceLabel}. This device is now view only.`
        : 'This device no longer holds the edit lock.',
    );
    this.name = 'EditLockLostError';
  }
}

export type LockStatus =
  | { kind: 'free' }
  | { kind: 'mine'; lock: EditLock }
  | { kind: 'other'; lock: EditLock };

/** Classify a lock for `deviceId` at `now`: expired or released locks are free. */
export function lockStatus(lock: EditLock | null, deviceId: string, now: Date): LockStatus {
  if (!lock || Date.parse(lock.expiresAt) <= now.getTime()) return { kind: 'free' };
  return lock.deviceId === deviceId ? { kind: 'mine', lock } : { kind: 'other', lock };
}

export type AcquireResult =
  | { kind: 'acquired'; lock: EditLock; tookOverFrom: EditLock | null }
  | { kind: 'in-use'; holder: EditLock };

export class EditLockManager {
  private file: LockFile | null = null;
  private held: EditLock | null = null;

  constructor(
    private port: EditLockPort,
    private readonly device: DeviceIdentity,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Swap the Drive client (e.g. after the access token was refreshed). Keeps what is known. */
  setPort(port: EditLockPort): void {
    this.port = port;
  }

  /** True while this device believes it holds the lock (confirmed at the last read or write). */
  get holdsLock(): boolean {
    return this.held !== null && Date.parse(this.held.expiresAt) > this.clock().getTime();
  }

  /** The lock this device holds, if any. */
  get currentLock(): EditLock | null {
    return this.holdsLock ? this.held : null;
  }

  /** The lock as last read from Drive (whoever holds it), or null. */
  get lastSeen(): EditLock | null {
    return this.file?.lock ?? null;
  }

  /** Read who holds the lock without changing it. */
  async check(): Promise<LockStatus> {
    this.file = await this.port.readLock();
    const status = lockStatus(this.file?.lock ?? null, this.device.id, this.clock());
    this.held = status.kind === 'mine' ? status.lock : null;
    return status;
  }

  /**
   * Take the lock. When another device holds a fresh lock, this returns `in-use` unless `takeOver`
   * is set, in which case the lock moves to this device.
   */
  async acquire(options: { takeOver?: boolean } = {}): Promise<AcquireResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const status = await this.check();
      if (status.kind === 'other' && !options.takeOver) return { kind: 'in-use', holder: status.lock };
      const previous = status.kind === 'other' ? status.lock : null;
      const now = this.clock();
      const lock = this.makeLock(now, status.kind === 'mine' ? status.lock.acquiredAt : now.toISOString());
      try {
        this.file = this.file
          ? await this.port.writeLock(this.file, lock)
          : await this.port.createLock(lock);
        this.held = lock;
        return { kind: 'acquired', lock, tookOverFrom: previous };
      } catch (error) {
        if (!(error instanceof RevisionConflictError)) throw error;
        // Another device wrote the lock between our read and write. Read again and decide afresh.
      }
    }
    const status = await this.check();
    if (status.kind === 'other') return { kind: 'in-use', holder: status.lock };
    throw new RevisionConflictError();
  }

  /**
   * Extend the lock. Returns false when another device took it (or it expired and was taken), in
   * which case this device must stop writing and switch to view only.
   */
  async refresh(): Promise<boolean> {
    const status = await this.check();
    if (status.kind !== 'mine') {
      if (status.kind === 'free' && this.file?.lock?.deviceId === this.device.id) {
        // Our own lock expired (app was asleep) and nobody took it: reclaim it quietly.
        return (await this.acquire()).kind === 'acquired';
      }
      return false;
    }
    try {
      const lock = this.makeLock(this.clock(), status.lock.acquiredAt);
      this.file = await this.port.writeLock(this.file!, lock);
      this.held = lock;
      return true;
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      return (await this.check()).kind === 'mine';
    }
  }

  /** Give the lock up (sign-out, tab close). A no-op when another device already holds it. */
  async release(): Promise<void> {
    const status = await this.check();
    this.held = null;
    if (status.kind !== 'mine' || !this.file) return;
    try {
      this.file = await this.port.writeLock(this.file, null);
    } catch (error) {
      // Someone else wrote it in the meantime, so it isn't ours to clear.
      if (!(error instanceof RevisionConflictError)) throw error;
    }
  }

  /**
   * Release without re-reading first, using the last known ETag. For page unload, where there is
   * no time for a round trip. If another device wrote the lock since, the ETag no longer matches
   * and Drive rejects the write, which is what we want.
   */
  async releaseNow(): Promise<void> {
    const file = this.file;
    const held = this.holdsLock;
    this.held = null;
    if (!file || !held) return;
    try {
      this.file = await this.port.writeLock(file, null);
    } catch {
      // Best effort: an unreleased lock simply expires.
    }
  }

  /**
   * Call before every Drive write. Re-reads the lock and throws {@link EditLockLostError} if this
   * device doesn't hold it, so a device in view only can never write.
   */
  async assertCanWrite(): Promise<void> {
    const status = await this.check();
    if (status.kind === 'mine') return;
    throw new EditLockLostError(status.kind === 'other' ? status.lock : null);
  }

  private makeLock(now: Date, acquiredAt: string): EditLock {
    return {
      deviceId: this.device.id,
      deviceLabel: this.device.label,
      platform: this.device.platform,
      acquiredAt,
      refreshedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
    };
  }
}

/** Parse the lock file's JSON; anything malformed reads as "no lock". */
export function parseLockJson(text: string): EditLock | null {
  try {
    const value = JSON.parse(text) as Partial<EditLock> | null;
    if (
      value &&
      typeof value.deviceId === 'string' &&
      typeof value.deviceLabel === 'string' &&
      (value.platform === 'web' || value.platform === 'phone') &&
      typeof value.acquiredAt === 'string' &&
      typeof value.refreshedAt === 'string' &&
      typeof value.expiresAt === 'string'
    ) {
      return value as EditLock;
    }
  } catch {
    // fall through
  }
  return null;
}

/** The lock file's JSON body (`null` after a release). */
export function lockJson(lock: EditLock | null): string {
  return JSON.stringify(lock);
}

/**
 * What a phone does when it reconnects after being offline.
 *  - `upload`: it still holds the lock (or can take a free one), so its offline edits are saved.
 *  - `discard`: another device took over meanwhile; the offline edits are dropped and Drive's copy
 *    is loaded. The phone first uploads its copy as a `discarded-offline` snapshot so nothing is
 *    unrecoverable, and tells the user.
 *  - `pull`: no local edits, so just load whatever Drive has.
 */
export type ReconnectAction = 'upload' | 'discard' | 'pull';

export function reconnectAction(input: {
  status: LockStatus;
  hasLocalChanges: boolean;
}): ReconnectAction {
  if (!input.hasLocalChanges) return 'pull';
  return input.status.kind === 'other' ? 'discard' : 'upload';
}

/** Snapshot name for a phone's offline copy that is about to be discarded (kept 30 days). */
export function discardedOfflineSnapshotName(now: Date): string {
  return `Finance-Tracker-backup-${now.getTime()}-discarded-offline.db`;
}
