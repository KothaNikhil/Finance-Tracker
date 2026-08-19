/**
 * The app's single bottom-sheet shell. Every sheet that slides up from the bottom uses this, so
 * dismiss behavior is defined in ONE place:
 *  - tapping the dim backdrop closes it (an absolute-fill Pressable rendered BEHIND the sheet, so
 *    taps on the sheet hit the sheet and inner scroll views/lists still scroll),
 *  - dragging the grabber bar down past a threshold closes it (a flick works too),
 *  - Android back closes it.
 *
 * Content-sized by default (capped at 90% tall). Pass `heightFraction` for a fixed-height sheet —
 * needed when the body is a flex list with no intrinsic height (percentage heights don't resolve
 * for a modal's flex children).
 *
 * The body area is a flex column that can shrink, so a ScrollView child (with flexShrink) scrolls
 * within the sheet instead of overflowing/clipping.
 *
 * The drag-to-dismiss uses react-native-gesture-handler + Reanimated (NOT an RN PanResponder): on
 * the New Architecture, a PanResponder inside a Modal is swallowed and never fires. A Modal is its
 * own view hierarchy, so it needs its OWN `GestureHandlerRootView` here — the app-root one doesn't
 * reach inside it. That root also covers any gesture-driven body (e.g. drag-to-reorder lists), so
 * `gestureRoot` is no longer needed by callers but is accepted for backwards compatibility.
 */

import { type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SheetHandle } from '@/components/sheet-handle';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface BottomSheetProps {
  visible: boolean;
  /** Called when the sheet should close: backdrop tap, grabber drag-down, or Android back. */
  onClose: () => void;
  children: ReactNode;
  /** Fixed height as a fraction of the screen (e.g. 0.85). Omit for content height capped at 90%. */
  heightFraction?: number;
  /** Extra bottom padding on the backdrop, e.g. to lift the sheet above the keyboard. */
  backdropPaddingBottom?: number;
  /** @deprecated The sheet now always provides its own gesture root; this is ignored. */
  gestureRoot?: boolean;
  /** Optional style overrides for the sheet container. */
  sheetStyle?: StyleProp<ViewStyle>;
}

const DISMISS_DISTANCE = 90; // drag the grabber down this far (or flick) to dismiss
const FLICK_VELOCITY = 800; // px/s downward flick that dismisses regardless of distance

export function BottomSheet({
  visible,
  onClose,
  children,
  heightFraction,
  backdropPaddingBottom,
  sheetStyle,
}: BottomSheetProps) {
  const theme = useTheme();
  const height = heightFraction != null ? Math.round(Dimensions.get('window').height * heightFraction) : undefined;
  const translateY = useSharedValue(0);
  const screenHeight = Dimensions.get('window').height;

  // Reset the sheet to its resting position whenever it (re)opens. Done in the Modal's `onShow`
  // (an event, not an effect) so the compiler allows the shared-value writes in the gestures below.
  const reset = () => {
    translateY.value = 0;
  };

  // Drag-to-dismiss lives ONLY on the grabber area, so it never fights the body's scrolling.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > FLICK_VELOCITY) {
        translateY.value = withTiming(screenHeight, { duration: 160 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(onClose);
        });
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    });

  const sheetAnimStyle = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: translateY.value }] };
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onShow={reset}>
      <GestureHandlerRootView style={styles.grow}>
        <View style={[styles.backdrop, backdropPaddingBottom ? { paddingBottom: backdropPaddingBottom } : null]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme.background },
              height != null ? { height } : styles.maxHeight,
              sheetStyle,
              sheetAnimStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.dragZone}>
                <SheetHandle />
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  // Cap at 90% and let children (e.g. a ScrollView with flexShrink) shrink to fit instead of
  // overflowing past the sheet's bottom edge.
  maxHeight: { maxHeight: '90%' },
  grow: { flex: 1 },
  // A taller touch target around the grabber so it's easy to grab and drag down.
  dragZone: { alignItems: 'stretch', paddingBottom: Spacing.two, marginBottom: -Spacing.two },
});
