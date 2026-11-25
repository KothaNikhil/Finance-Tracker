/**
 * The phone's "one device edits at a time" UI:
 *  - The banner under every screen title lives in `edit-session-banner.tsx` (light imports).
 *  - {@link EditSessionOverlay}: the In-use question (Take over / View only), the "offline changes
 *    saved" pill, and a global handler that turns a blocked write into a short alert instead of a
 *    crash. Mounted once in the root layout.
 * Alerts for "Editing moved" and "Offline changes not saved" are raised by the sync service.
 */

import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { setAskOpen, useAskOpen } from '@/components/edit-session-banner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { isReadOnlyError } from '@/core/db/runtime';
import { holderName, lockTime } from '@/core/sync/session';
import { useTheme } from '@/hooks/use-theme';
import { stayViewOnly, takeOverEditing, useEditSession, useSyncHealth } from '@/services/drive';

export { EditSessionBanner, VIEW_ONLY_HINT } from '@/components/edit-session-banner';

export function EditSessionOverlay() {
  const session = useEditSession();
  const asked = useAskOpen();
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const visible = session.mode === 'view-only' && (session.reason === 'in-use' || asked);

  // A write attempted in view only throws ReadOnlyError. Most screens disable their controls, but
  // anything missed must not crash a release build: show a short alert instead.
  useEffect(() => {
    const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (!errorUtils) return;
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isReadOnlyError(error)) {
        Alert.alert('View only', 'Another device is editing. Take over to make changes here.');
        return;
      }
      previous(error, isFatal);
    });
    return () => errorUtils.setGlobalHandler(previous);
  }, []);

  const close = () => {
    setAskOpen(false);
    void stayViewOnly();
  };
  const takeOver = () => {
    setBusy(true);
    takeOverEditing()
      .catch((error: unknown) =>
        Alert.alert('Couldn’t take over', error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        setBusy(false);
        setAskOpen(false);
      });
  };

  const holder = session.holder;
  const who = holderName(holder, 'phone');
  const lastActive = holder ? minutesAgo(holder.refreshedAt) : null;

  return (
    <>
      <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
        <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
          <ThemedView type="backgroundElement" style={styles.card} accessibilityViewIsModal>
            <ThemedText type="heading">In use on {who}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Only one device can edit at a time, so changes never overwrite each other.
              {holder
                ? ` ${holder.deviceLabel} has been editing since ${lockTime(holder.acquiredAt)}${lastActive ? ` and was last active ${lastActive}` : ''}.`
                : ''}
            </ThemedText>
            <Choice
              primary
              icon="edit"
              title="Take over"
              detail="Edit on this phone. The other device switches to view only, and anything it hasn’t saved is kept as a Drive snapshot."
            />
            <Choice
              icon="visibility"
              title="View only"
              detail="Browse with the latest data. Nothing is saved. You can take over later."
            />
            <View style={styles.actions}>
              <Button label="View only" size="small" onPress={close} disabled={busy} style={styles.grow} />
              <Button
                label="Take over"
                variant="primary"
                size="small"
                onPress={takeOver}
                disabled={busy}
                style={styles.grow}
              />
            </View>
          </ThemedView>
        </View>
      </Modal>
      <OfflineSavedPill />
    </>
  );
}

function Choice({ icon, title, detail, primary = false }: { icon: string; title: string; detail: string; primary?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.choice,
        { borderColor: primary ? theme.accent : theme.border },
        primary && { backgroundColor: theme.accentMuted },
      ]}
    >
      <SymbolView
        name={{ ios: icon === 'edit' ? 'pencil' : 'eye', android: icon as never, web: icon as never }}
        size={18}
        tintColor={primary ? theme.accent : theme.textSecondary}
      />
      <View style={styles.choiceCopy}>
        <ThemedText type="smallEmphasis">{title}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}

/** "3 offline changes saved to Drive" style confirmation; fades after 3 s. */
function OfflineSavedPill() {
  const { savedAfterOffline } = useSyncHealth();
  const [shownFor, setShownFor] = useState<number | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!savedAfterOffline) return;
    setShownFor(savedAfterOffline);
    const timer = setTimeout(() => setShownFor(null), 3_000);
    return () => clearTimeout(timer);
  }, [savedAfterOffline]);

  if (!shownFor) return null;
  return (
    <View pointerEvents="none" style={styles.pillWrap}>
      <ThemedView type="backgroundElement" style={[styles.pill, { borderColor: theme.border }]} accessibilityRole="alert">
        <SymbolView name={{ ios: 'checkmark.icloud', android: 'cloud_done', web: 'cloud_done' }} size={14} tintColor={theme.income} />
        <ThemedText type="small">Offline changes saved to Drive</ThemedText>
      </ThemedView>
    </View>
  );
}

interface ErrorUtilsLike {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

function minutesAgo(iso: string): string | null {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes <= 0) return 'just now';
  return `${minutes} min ago`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.three },
  card: { width: '100%', maxWidth: 420, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  choice: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    padding: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  choiceCopy: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  grow: { flex: 1 },
  pillWrap: { position: 'absolute', left: 0, right: 0, bottom: BottomTabInset + Spacing.two, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
