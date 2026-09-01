import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ImportStep = 'file' | 'preview' | 'review';

const STEPS: readonly { key: ImportStep; label: string }[] = [
  { key: 'file', label: 'File' },
  { key: 'preview', label: 'Preview' },
  { key: 'review', label: 'Review' },
];

const CIRCLE = 22;

/** Compact, accessible progress indicator shared by every state in the import journey. */
export function ImportStepIndicator({ current }: { current: ImportStep }) {
  const theme = useTheme();
  const currentIndex = STEPS.findIndex((step) => step.key === current);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Import progress: step ${currentIndex + 1} of ${STEPS.length}, ${STEPS[currentIndex].label}`}
      accessibilityValue={{ min: 1, max: STEPS.length, now: currentIndex + 1 }}
      style={styles.track}
    >
      {STEPS.map((step, index) => {
        const completed = index < currentIndex;
        const emphasized = index <= currentIndex;
        return (
          // Each step owns an equal share of the width and centres both its circle and its label in
          // it, so the two can never drift apart. The joining line is two halves drawn behind the
          // circles, which meet exactly on the boundary between shares.
          <View key={step.key} style={styles.step}>
            {index > 0 ? (
              <View
                style={[
                  styles.line,
                  styles.lineLeft,
                  { backgroundColor: emphasized ? theme.accent : theme.borderStrong },
                ]}
              />
            ) : null}
            {index < STEPS.length - 1 ? (
              <View
                style={[
                  styles.line,
                  styles.lineRight,
                  { backgroundColor: completed ? theme.accent : theme.borderStrong },
                ]}
              />
            ) : null}
            <View
              style={[
                styles.circle,
                {
                  backgroundColor: emphasized ? theme.accent : theme.backgroundElement,
                  borderColor: emphasized ? theme.accent : theme.borderStrong,
                },
              ]}
            >
              <ThemedText
                type="caption"
                style={{ color: emphasized ? theme.onAccent : theme.textSecondary }}
              >
                {completed ? '✓' : index + 1}
              </ThemedText>
            </View>
            <ThemedText
              type="caption"
              numberOfLines={1}
              style={{ color: emphasized ? theme.accent : theme.textSecondary }}
            >
              {step.label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, alignItems: 'center', gap: Spacing.half },
  line: { position: 'absolute', top: (CIRCLE - 1) / 2, height: 1 },
  lineLeft: { left: 0, right: '50%' },
  lineRight: { left: '50%', right: 0 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
