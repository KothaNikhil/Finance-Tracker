import {
  TabList,
  type TabListProps,
  TabSlot,
  TabTrigger,
  type TabTriggerSlotProps,
  Tabs,
} from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Opacity, Radius, Spacing } from '@/constants/theme';
import { useSummary } from '@/hooks/use-analytics';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

export default function AppTabs() {
  const { reviewCount } = useSummary({});

  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon={{ ios: 'house.fill', android: 'home', web: 'home' }}>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="activity" href="/reports" asChild>
            <TabButton
              icon={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              badge={reviewCount}
            >
              Activity
            </TabButton>
          </TabTrigger>
          <TabTrigger name="import" href="/import" asChild>
            <TabButton icon={{ ios: 'square.and.arrow.down', android: 'download', web: 'download' }}>
              Import
            </TabButton>
          </TabTrigger>
          <TabTrigger name="lending" href="/lending" asChild>
            <TabButton
              icon={{
                ios: 'arrow.left.arrow.right.circle.fill',
                android: 'swap_horiz',
                web: 'swap_horiz',
              }}
            >
              Lending
            </TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/explore" asChild>
            <TabButton icon={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}>
              Settings
            </TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({
  children,
  isFocused,
  icon,
  badge = 0,
  ...props
}: TabTriggerSlotProps & {
  children: ReactNode;
  icon: SymbolName;
  badge?: number;
}) {
  const theme = useTheme();
  const label = typeof children === 'string' ? children : undefined;

  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tabButton,
        { backgroundColor: isFocused ? theme.accentMuted : 'transparent' },
        { opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <SymbolView
        name={icon}
        size={18}
        tintColor={isFocused ? theme.accent : theme.textSecondary}
      />
      <ThemedText
        type="caption"
        style={{ color: isFocused ? theme.accent : theme.textSecondary }}
        numberOfLines={1}
      >
        {children}
      </ThemedText>
      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.review }]}>
          <ThemedText type="caption" style={{ color: theme.onReview }}>
            {badge > 99 ? '99+' : badge}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const theme = useTheme();

  return (
    <View {...props} style={[styles.tabListContainer, props.style]}>
      <View
        style={[
          styles.innerContainer,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
      >
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1 },
  slot: { flex: 1, paddingBottom: 76 },
  tabListContainer: {
    position: 'absolute',
    bottom: Spacing.two,
    zIndex: 20,
    width: '100%',
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerContainer: {
    width: '100%',
    maxWidth: Math.min(MaxContentWidth, 620),
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    padding: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
  },
  tabButton: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.md,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
