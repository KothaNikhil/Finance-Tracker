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
 * for a modal's flex children). Pass `gestureRoot` when the body uses react-native-gesture-handler
 * (gestures inside a RN Modal need their own root).
 *
 * The body area is a flex column that can shrink, so a ScrollView child (with flexShrink) scrolls
 * within the sheet instead of overflowing/clipping.
 */

import { type ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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
  /** Wrap the body in a GestureHandlerRootView (needed for RNGH gestures inside a Modal). */
  gestureRoot?: boolean;
  /** Optional style overrides for the sheet container. */
  sheetStyle?: StyleProp<ViewStyle>;
}

const DISMISS_DISTANCE = 90; // drag the grabber down this far (or flick) to dismiss

export function BottomSheet({
  visible,
  onClose,
  children,
  heightFraction,
  backdropPaddingBottom,
  gestureRoot,
  sheetStyle,
}: BottomSheetProps) {
  const theme = useTheme();
  const height = heightFraction != null ? Math.round(Dimensions.get('window').height * heightFraction) : undefined;
  const translateY = useRef(new Animated.Value(0)).current;

  // Reset the sheet to its resting position whenever it (re)opens.
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  // Drag-to-dismiss lives ONLY on the grabber area, so it never fights the body's scrolling.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: Dimensions.get('window').height,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onClose());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
    }),
  ).current;

  const body = gestureRoot ? <GestureHandlerRootView style={styles.grow}>{children}</GestureHandlerRootView> : children;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, backdropPaddingBottom ? { paddingBottom: backdropPaddingBottom } : null]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.background },
            height != null ? { height } : styles.maxHeight,
            { transform: [{ translateY }] },
            sheetStyle,
          ]}
        >
          <View {...panResponder.panHandlers} style={styles.dragZone}>
            <SheetHandle />
          </View>
          {body}
        </Animated.View>
      </View>
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
  // A slightly taller touch target around the grabber so it's easy to grab and drag.
  dragZone: { alignItems: 'stretch' },
});
