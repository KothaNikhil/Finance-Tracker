import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

/**
 * Run an async action while showing a busy state, surfacing any error as an alert. Replaces the
 * copy-pasted `busy` + try/finally blocks that were duplicated across the export, backup and
 * import flows.
 *
 * @example
 * const { busy, run } = useBusyAction();
 * run(async () => { await doThing(); }, { errorTitle: 'Could not do the thing' });
 */
export function useBusyAction(defaultErrorTitle = 'Something went wrong') {
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void> | void, opts?: { errorTitle?: string }) => {
      setBusy(true);
      try {
        await action();
      } catch (err) {
        Alert.alert(
          opts?.errorTitle ?? defaultErrorTitle,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setBusy(false);
      }
    },
    [defaultErrorTitle],
  );

  return { busy, run };
}
