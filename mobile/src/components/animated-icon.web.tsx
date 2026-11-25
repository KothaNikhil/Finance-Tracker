import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

export function AnimatedSplashOverlay() {
  return null;
}

export function AnimatedIcon() {
  const scheme = useColorScheme();

  return (
    <View style={styles.iconContainer}>
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
  // The mark is its own rounded teal tile, so no extra container chrome.
  iconContainer: { justifyContent: 'center', alignItems: 'center', width: 112, height: 112 },
  iconMark: { width: 112, height: 112 },
});
