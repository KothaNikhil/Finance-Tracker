/**
 * The website's side of "one device edits at a time": who this tab is, and a hook for pages to
 * disable editing while the tab is view only (another device editing, offline, or Drive disconnected).
 * The session itself lives in App, which owns the Drive token.
 */

import { useSyncExternalStore } from 'react';
import { isReadOnly, subscribeReadOnly } from '@finance-tracker/core/db/runtime';
import type { DeviceIdentity } from '@finance-tracker/core/sync/lock';

/** "View only. Take over to edit." — the line shown in place of editing controls. */
export const VIEW_ONLY_HINT = 'View only. Take over to edit.';

const DEVICE_ID_KEY = 'ft-edit-device-id';
let fallbackId: string | null = null;

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Per tab, not per browser: two tabs must not both think they hold the lock. sessionStorage keeps
 * the id across a reload, so a reloaded tab picks its own lock back up.
 */
function tabId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = `web-${randomId()}`;
    sessionStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    fallbackId ??= `web-${randomId()}`;
    return fallbackId;
  }
}

/** "Chrome on Windows" style label, shown to the phone. */
export function browserLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'A browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

export function webDevice(): DeviceIdentity {
  return { id: tabId(), label: browserLabel(navigator.userAgent), platform: 'web' };
}

/** True while this tab must not change data. Pages disable their editing controls with it. */
export function useReadOnly(): boolean {
  return useSyncExternalStore(subscribeReadOnly, isReadOnly, isReadOnly);
}

/** A network failure (offline, DNS, CORS-less abort), as opposed to a Drive error response. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network|failed to fetch|timeout/i.test(error.message));
}
