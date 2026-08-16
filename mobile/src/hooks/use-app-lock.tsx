/**
 * App-lock context: locks the app on launch and whenever it returns from the background, requiring
 * a biometric / device-PIN unlock. If the device has no biometrics/PIN enrolled, the lock is
 * disabled (never locked) so the app stays usable.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { authenticate, canUseAppLock } from '@/services/auth/app-lock';

interface LockState {
  /** True if a device lock is available and in use. */
  enabled: boolean;
  /** True while the app is locked and awaiting an unlock. */
  locked: boolean;
  /** Prompt biometrics; on success the app unlocks. */
  unlock: () => Promise<void>;
}

const LockContext = createContext<LockState>({ enabled: false, locked: false, unlock: async () => {} });

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(true); // assume locked until we know the device supports it
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    let active = true;
    canUseAppLock().then((ok) => {
      if (!active) return;
      setEnabled(ok);
      if (!ok) setLocked(false); // no biometrics/PIN → nothing to lock behind
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Re-lock whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (enabled && /background|inactive/.test(prev) && next === 'active') {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = useCallback(async () => {
    const ok = await authenticate();
    if (ok) setLocked(false);
  }, []);

  // Until we've checked device capability, treat as not-locked to avoid a flash of the lock screen.
  return (
    <LockContext.Provider value={{ enabled, locked: ready ? locked : false, unlock }}>
      {children}
    </LockContext.Provider>
  );
}

export function useAppLock(): LockState {
  return useContext(LockContext);
}
