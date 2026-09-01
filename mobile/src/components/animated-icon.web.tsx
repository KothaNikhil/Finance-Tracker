import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

export function AnimatedSplashOverlay() {
  return null;
}

export function AnimatedIcon() {
  const scheme = useColorScheme();
  const theme = useTheme();

  return (
    <View style={[styles.iconContainer, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Image
        style={styles.iconMark}
        contentFit="contain"
        source={
          scheme === 'dark'
            ? require('@/assets/images/brand-mark-dark.png')
            : require('@/assets/images/brand-mark.png')
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 112,
    height: 112,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconMark: { width: 88, height: 88 },
});
