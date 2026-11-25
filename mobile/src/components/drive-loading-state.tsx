import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSyncHealth } from '@/services/drive/edit-session';

/** True while a phone that never synced is fetching its data from Drive for the first time. */
export function useFirstDriveDownload(): boolean {
  return useSyncHealth().firstDownload;
}

/** Shown instead of a "nothing here yet" state while the first Drive download may still bring data. */
export function DriveLoadingState({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, style]} accessibilityRole="progressbar" accessibilityLabel="Loading your data from Google Drive">
      <ActivityIndicator color={theme.accent} />
      <ThemedText type="heading" style={styles.text}>
        Loading your data
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Getting your latest data from Google Drive. This can take a moment the first time.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  text: { textAlign: 'center' },
});
