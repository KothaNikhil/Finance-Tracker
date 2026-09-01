import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useSummary } from '@/hooks/use-analytics';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AppTabs() {
  const colors = Colors[useColorScheme()];
  const { reviewCount } = useSummary({});
  const reviewBadge = reviewCount > 99 ? '99+' : String(reviewCount);

  return (
    <NativeTabs
      backBehavior="history"
      backgroundColor={colors.backgroundElement}
      badgeBackgroundColor={colors.review}
      badgeTextColor={colors.onReview}
      blurEffect="systemChromeMaterial"
      disableTransparentOnScrollEdge
      iconColor={{ default: colors.textSecondary, selected: colors.accent }}
      indicatorColor={colors.accentMuted}
      labelVisibilityMode="labeled"
      labelStyle={{
        default: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
        selected: { color: colors.accent, fontSize: 11, fontWeight: '500' },
      }}
      rippleColor={colors.accentMuted}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reports">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
        {reviewCount > 0 ? <NativeTabs.Trigger.Badge>{reviewBadge}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="import">
        <NativeTabs.Trigger.Label>Import</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.arrow.down" md="file_download" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="lending">
        <NativeTabs.Trigger.Label>Lending</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="arrow.left.arrow.right.circle.fill" md="swap_horiz" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
