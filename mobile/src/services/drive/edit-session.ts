/**
 * This phone's side of "one device edits at a time".
 *
 * One {@link EditSession} per app run. The Drive sync (`sync.ts`) gives it a fresh Drive client
 * before each run, resolves the lock at the start of each sync, and runs every Drive write through
 * `assertCanWrite`. The UI reads the state via {@link useEditSession} and the data layer's
 * read-only switch follows it: only `view-only` blocks edits. The phone keeps editing while the lock
 * state is unknown (offline), and its offline edits are dropped if another device took over meanwhile.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useSyncExternalStore } from 'react';

import { setReadOnly } from '@/core/db/runtime';
import type { DeviceIdentity, EditLock, EditLockPort } from '@/core/sync/lock';
import { EditSession, type EditSessionState, type ViewOnlyReason } from '@/core/sync/session';

const DEVICE_ID_KEY = 'edit_lock_device_id';

/** Before the first Drive call the session has no client; any use of it is a bug, so fail loudly. */
const NO_PORT: EditLockPort = {
  readLock: () => Promise.reject(new Error('Drive is not connected yet.')),
  createLock: () => Promise.reject(new Error('Drive is not connected yet.')),
  writeLock: () => Promise.reject(new Error('Drive is not connected yet.')),
};

let session: EditSession | null = null;
let sessionPromise: Promise<EditSession> | null = null;
let lostHandler: ((holder: EditLock | null) => void) | null = null;
const listeners = new Set<() => void>();
let unsubscribeSession: (() => void) | null = null;

const INITIAL: EditSessionState = { mode: 'unknown', reason: null, holder: null, confirmedAt: null };

function randomId(): string {
  return `phone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function deviceIdentity(): Promise<DeviceIdentity> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY).catch(() => null);
  if (!id) {
    id = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id).catch(() => undefined);
  }
  return { id, label: Device.modelName ?? 'your phone', platform: 'phone' };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** The phone's edit session, created on first use. */
export function getEditSession(): Promise<EditSession> {
  if (session) return Promise.resolve(session);
  sessionPromise ??= deviceIdentity().then((device) => {
    const created = new EditSession(NO_PORT, device, {
      // Cleanup (snapshot, pull) is queued by sync.ts; it must not run inside a write that is
      // still holding the sync queue, so this only hands it off.
      onLost: (holder) => lostHandler?.(holder),
    });
    unsubscribeSession = created.subscribe(() => {
      setReadOnly(created.getState().mode === 'view-only');
      notify();
    });
    session = created;
    notify();
    return created;
  });
  return sessionPromise;
}

/** sync.ts registers what to do when the lock is lost while editing. */
export function setLostHandler(handler: ((holder: EditLock | null) => void) | null): void {
  lostHandler = handler;
}

/** Sign-out or account switch: forget the session (the lock was released or simply expires). */
export function resetEditSession(): void {
  session?.stopHeartbeat();
  unsubscribeSession?.();
  unsubscribeSession = null;
  session = null;
  sessionPromise = null;
  setReadOnly(false);
  notify();
}

export function editSessionState(): EditSessionState {
  return session?.getState() ?? INITIAL;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Editing / view only, and why. For the banner, the In-use question and disabled controls. */
export function useEditSession(): EditSessionState {
  return useSyncExternalStore(subscribe, editSessionState, editSessionState);
}

/** True while this phone is view only. */
export function useViewOnly(): boolean {
  return useEditSession().mode === 'view-only';
}

// ---------------------------------------------------------------------------
// Sync health, for the offline banner and the "offline changes saved" pill.
// ---------------------------------------------------------------------------

export interface SyncHealth {
  /** The last Drive call failed on the network. */
  offline: boolean;
  /** Edits on this phone that Drive doesn't have yet. */
  pendingChanges: boolean;
  /** Set briefly after edits made offline reached Drive. */
  savedAfterOffline: number | null;
  /**
   * The first sync of this run on a phone that has never synced with Drive. Screens show "loading
   * from Drive" instead of "nothing here yet" meanwhile, since the data may still be on its way.
   */
  firstDownload: boolean;
}

let health: SyncHealth = { offline: false, pendingChanges: false, savedAfterOffline: null, firstDownload: false };
const healthListeners = new Set<() => void>();

export function setSyncHealth(patch: Partial<SyncHealth>): void {
  const next = { ...health, ...patch };
  if (
    next.offline === health.offline &&
    next.pendingChanges === health.pendingChanges &&
    next.savedAfterOffline === health.savedAfterOffline &&
    next.firstDownload === health.firstDownload
  ) {
    return;
  }
  health = next;
  healthListeners.forEach((listener) => listener());
}

export function syncHealth(): SyncHealth {
  return health;
}

export function useSyncHealth(): SyncHealth {
  return useSyncExternalStore(
    (listener) => {
      healthListeners.add(listener);
      return () => {
        healthListeners.delete(listener);
      };
    },
    syncHealth,
    syncHealth,
  );
}

/** A fetch that never reached Google (no connection, DNS, timeout). */
export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && /network request failed|network error|timed? ?out/i.test(error.message))
  );
}

export type { ViewOnlyReason };
