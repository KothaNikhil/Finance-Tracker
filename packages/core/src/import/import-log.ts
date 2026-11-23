/**
 * TEMP diagnostic logger for the import flow. Every `ilog(...)` line goes to BOTH the native console
 * (visible via `adb logcat -s ReactNativeJS`) and an in-memory ring buffer the Import screen tails on
 * screen — so a stall can be pinpointed with or without a cable, and async hangs (which a blocked JS
 * thread wouldn't repaint) are still captured in logcat. Remove once the on-device import is fixed.
 */

type Listener = (lines: string[]) => void;

const lines: string[] = [];
let listener: Listener | null = null;
let t0 = Date.now();

/** Log a stage with a millisecond offset from the last {@link resetImportLog}. */
export function ilog(msg: string): void {
  const line = `+${String(Date.now() - t0).padStart(5, ' ')}ms  ${msg}`;
  lines.push(line);
  if (lines.length > 60) lines.shift();
  console.log('[ccimport]', line);
  listener?.([...lines]);
}

/** Clear the buffer and restart the relative clock (call at the start of a fresh import). */
export function resetImportLog(): void {
  lines.length = 0;
  t0 = Date.now();
  listener?.([]);
}

/** Subscribe the UI to log updates; returns an unsubscribe. */
export function subscribeImportLog(fn: Listener): () => void {
  listener = fn;
  fn([...lines]);
  return () => {
    if (listener === fn) listener = null;
  };
}
