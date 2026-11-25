/**
 * The edit session: whether this device is editing or view only, and the heartbeat that keeps the
 * edit lock fresh. Both apps drive one of these. What to do with local data when the lock is lost
 * (snapshot, pull) stays in the app, through `onLost`.
 *
 * Modes:
 *  - `unknown`: not checked yet (just opened, or offline). The phone keeps editing locally.
 *  - `editing`: this device holds the lock.
 *  - `view-only`: another device holds it. `reason` says why, for the banner copy.
 *
 * The data layer's read-only switch (`setReadOnly`) follows the mode: everything except `editing`
 * on the website, and only `view-only` on the phone (which edits offline). The app wires that.
 */

import {
  EditLockLostError,
  EditLockManager,
  LOCK_HEARTBEAT_MS,
  lockStatus,
  type DeviceIdentity,
  type EditLock,
  type EditLockPort,
  type LockStatus,
} from './lock';

export type EditMode = 'unknown' | 'editing' | 'view-only';

/**
 * Why this device is view only:
 *  - `in-use`: another device was editing when this one opened (it is asked Take over / View only).
 *  - `chosen`: the user picked View only.
 *  - `moved`: another device took over while this one was editing.
 *  - `discarded`: as `moved`, and this device's unsaved changes were dropped (kept as a snapshot).
 */
export type ViewOnlyReason = 'in-use' | 'chosen' | 'moved' | 'discarded';

export interface EditSessionState {
  mode: EditMode;
  reason: ViewOnlyReason | null;
  /** The device that holds the lock while this one is view only. */
  holder: EditLock | null;
  /** When this device last confirmed it holds the lock (ms), or null. */
  confirmedAt: number | null;
}

export interface EditSessionOptions {
  clock?: () => Date;
  heartbeatMs?: number;
  /**
   * Called once when this device finds it lost the lock while editing (heartbeat or a guarded
   * write). The app snapshots its unsaved changes and loads Drive's copy here. Returning
   * `discarded` sets that reason (changes were dropped).
   */
  onLost?: (holder: EditLock | null) => Promise<ViewOnlyReason | void> | ViewOnlyReason | void;
}

const INITIAL: EditSessionState = { mode: 'unknown', reason: null, holder: null, confirmedAt: null };

export class EditSession {
  readonly manager: EditLockManager;
  private state: EditSessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private losing: Promise<void> | null = null;

  constructor(
    port: EditLockPort,
    readonly device: DeviceIdentity,
    private readonly options: EditSessionOptions = {},
  ) {
    this.manager = new EditLockManager(port, device, options.clock);
  }

  getState = (): EditSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get editing(): boolean {
    return this.state.mode === 'editing';
  }

  setPort(port: EditLockPort): void {
    this.manager.setPort(port);
  }

  /**
   * Try to take the lock when the app opens. If another device holds it, become view only with
   * reason `in-use`, so the app asks Take over / View only.
   */
  async start(): Promise<EditSessionState> {
    const result = await this.manager.acquire();
    if (result.kind === 'acquired') this.becomeEditing();
    else this.update({ mode: 'view-only', reason: 'in-use', holder: result.holder });
    return this.state;
  }

  /** Take the lock from whoever holds it. Returns the device it was taken from, if any. */
  async takeOver(): Promise<EditLock | null> {
    const result = await this.manager.acquire({ takeOver: true });
    if (result.kind !== 'acquired') {
      this.update({ mode: 'view-only', reason: 'in-use', holder: result.holder });
      return null;
    }
    this.becomeEditing();
    return result.tookOverFrom;
  }

  /** The user chose View only (or dismissed the question). */
  chooseViewOnly(): void {
    if (this.state.mode === 'view-only') this.update({ reason: 'chosen' });
  }

  /** Mark view only without a Drive read (e.g. the phone found the lock taken during sync). */
  markViewOnly(reason: ViewOnlyReason, holder: EditLock | null): void {
    this.update({ mode: 'view-only', reason, holder });
  }

  /**
   * One heartbeat. While editing, refresh the lock and handle a loss. While view only,
   * re-read who holds it, so the banner stays right. Network errors are thrown to the caller.
   */
  async tick(): Promise<LockStatus | null> {
    // Not resolved yet: the app's next sync decides (it may have offline edits to deal with).
    if (this.state.mode === 'unknown') return null;
    if (this.state.mode === 'editing') {
      if (await this.manager.refresh()) {
        this.update({ confirmedAt: this.now() });
        return null;
      }
      await this.lose(this.manager.lastSeen);
      return null;
    }
    const status = await this.manager.check();
    const holder = status.kind === 'other' ? status.lock : null;
    if (holder?.deviceId !== this.state.holder?.deviceId) this.update({ holder });
    return status;
  }

  /**
   * Use as the sync engine's `beforeWrite`. Throws `EditLockLostError` (after handling the loss)
   * when this device doesn't hold the lock.
   */
  assertCanWrite = async (): Promise<void> => {
    try {
      await this.manager.assertCanWrite();
      if (this.state.mode === 'editing') this.update({ confirmedAt: this.now() });
      else this.becomeEditing();
    } catch (error) {
      if (error instanceof EditLockLostError && this.state.mode === 'editing') {
        await this.lose(error.holder);
      }
      throw error;
    }
  };

  /** Mark the lock as lost (once) and let the app clean up. */
  async lose(holder: EditLock | null): Promise<void> {
    if (this.losing) return this.losing;
    if (this.state.mode === 'view-only') return;
    this.losing = (async () => {
      this.update({ mode: 'view-only', reason: 'moved', holder });
      try {
        const reason = await this.options.onLost?.(holder);
        if (reason) this.update({ reason });
      } finally {
        this.losing = null;
      }
    })();
    return this.losing;
  }

  /** What a lock read means for this device right now. */
  statusOf(lock: EditLock | null): LockStatus {
    return lockStatus(lock, this.device.id, this.clock());
  }

  startHeartbeat(onError?: (error: unknown) => void): void {
    this.stopHeartbeat();
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => onError?.(error));
    }, this.options.heartbeatMs ?? LOCK_HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sign-out: stop and give the lock up. */
  async release(): Promise<void> {
    this.stopHeartbeat();
    try {
      await this.manager.release();
    } finally {
      this.update({ ...INITIAL });
    }
  }

  /** Page unload: give the lock up without waiting for a read. */
  releaseNow(): void {
    this.stopHeartbeat();
    void this.manager.releaseNow();
  }

  private becomeEditing(): void {
    this.update({ mode: 'editing', reason: null, holder: null, confirmedAt: this.now() });
  }

  private clock(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private now(): number {
    return this.clock().getTime();
  }

  private update(patch: Partial<EditSessionState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.mode === this.state.mode &&
      next.reason === this.state.reason &&
      next.holder === this.state.holder &&
      next.confirmedAt === this.state.confirmedAt
    ) {
      return;
    }
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** A short name for the device holding the lock, for alerts and banners. */
export function holderName(holder: EditLock | null, viewer: 'web' | 'phone'): string {
  if (!holder) return 'another device';
  if (holder.platform === 'phone') return viewer === 'web' ? 'your phone' : holder.deviceLabel;
  return viewer === 'phone' ? 'the website' : holder.deviceLabel;
}

/** "10:32" style local time, for "since 10:32". */
export function lockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
