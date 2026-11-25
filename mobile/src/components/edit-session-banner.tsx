/**
 * The View-only / offline banner shown under every screen title. Kept apart from the overlay in
 * `edit-session-ui.tsx` so screens only depend on the session store, not on the Drive sync service.
 */

import { useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';

import { FeedbackBanner } from '@/components/feedback-banner';
import { Spacing } from '@/constants/theme';
import { holderName, lockTime } from '@/core/sync/session';
import { useEditSession, useSyncHealth } from '@/services/drive/edit-session';

/** "View only. Take over to edit." — the line shown in place of editing controls. */
export const VIEW_ONLY_HINT = 'View only. Take over to edit.';

// "Take over" in the banner re-asks the In-use question (the overlay shows it) rather than acting.
let askOpen = false;
const askListeners = new Set<() => void>();

export function setAskOpen(next: boolean): void {
  askOpen = next;
  askListeners.forEach((listener) => listener());
}

export function useAskOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      askListeners.add(listener);
      return () => {
        askListeners.delete(listener);
      };
    },
    () => askOpen,
    () => askOpen,
  );
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function EditSessionBanner() {
  const session = useEditSession();
  const health = useSyncHealth();

  if (session.mode === 'view-only') {
    const who = holderName(session.holder, 'phone');
    const since = session.holder ? ` (since ${lockTime(session.holder.acquiredAt)})` : '';
    return (
      <FeedbackBanner
        title="View only"
        message={`${capitalize(who)} is editing${since}. Changes here aren’t saved.`}
        actionLabel="Take over"
        onAction={() => setAskOpen(true)}
        wrap
        style={styles.banner}
      />
    );
  }
  if (health.offline && health.pendingChanges) {
    return (
      <FeedbackBanner
        tone="review"
        title="You’re offline · changes on this phone"
        message="They save to Drive when you reconnect. If you edit on another device before then, they’ll be lost."
        wrap
        style={styles.banner}
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  banner: { marginTop: Spacing.two },
});
