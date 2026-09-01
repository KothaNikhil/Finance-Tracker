import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ListSection } from '@/components/list-section';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const ICONS = {
  categories: { ios: 'tag', android: 'label', web: 'label' },
  paymentModes: { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  people: { ios: 'person.2', android: 'group', web: 'group' },
  appearance: { ios: 'moon', android: 'dark_mode', web: 'dark_mode' },
  appLock: { ios: 'lock', android: 'lock', web: 'lock' },
  currency: { ios: 'indianrupeesign.circle', android: 'currency_rupee', web: 'currency_rupee' },
  backup: { ios: 'arrow.up.doc', android: 'backup', web: 'backup' },
  account: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
} satisfies Record<string, SymbolName>;

export interface SettingsRowDefinition {
  id: string;
  title: string;
  icon: SymbolName;
  value?: string;
  description?: string;
  onPress?: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
}

export function SettingsGroup({
  title,
  rows,
}: {
  title: string;
  rows: SettingsRowDefinition[];
}) {
  return (
    <ListSection title={title}>
      {rows.map((row) => (
        <SettingsRow key={row.id} row={row} />
      ))}
    </ListSection>
  );
}

function SettingsRow({ row }: { row: SettingsRowDefinition }) {
  const theme = useTheme();
  const foreground = row.destructive ? theme.spend : theme.text;
  const spokenLabel = row.value ? `${row.title}, ${row.value}` : row.title;
  const content = (
    <>
      <SymbolView name={row.icon} size={18} tintColor={row.destructive ? theme.spend : theme.textSecondary} />
      <View style={styles.rowCopy}>
        <ThemedText type="label" numberOfLines={1} style={{ color: foreground }}>
          {row.title}
        </ThemedText>
        {row.description ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {row.description}
          </ThemedText>
        ) : null}
      </View>
      {row.value ? (
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.rowValue}>
          {row.value}
        </ThemedText>
      ) : null}
      {row.onPress ? <SymbolView name={ICONS.chevron} size={16} tintColor={theme.textSecondary} /> : null}
    </>
  );
  if (!row.onPress) {
    return (
      <View accessible accessibilityLabel={spokenLabel} style={styles.row} testID={row.testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={row.onPress}
      disabled={row.disabled}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityHint={row.accessibilityHint ?? row.description}
      accessibilityState={{ disabled: !!row.disabled }}
      testID={row.testID}
      style={({ pressed }) => [
        styles.row,
        { opacity: row.disabled ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

export interface SettingsLandingProps {
  categoryCount: number;
  paymentModeCount: number;
  peopleCount: number;
  appearanceLabel: string;
  appLockLabel: string;
  accountEmail?: string;
  driveEnabled: boolean;
  onOpenCategories: () => void;
  onOpenPaymentModes: () => void;
  onOpenPeople: () => void;
  onOpenAppearance: () => void;
  onOpenBackup: () => void;
  onOpenAccount?: () => void;
  onDeleteAll: () => void;
}

export function SettingsLanding({
  categoryCount,
  paymentModeCount,
  peopleCount,
  appearanceLabel,
  appLockLabel,
  accountEmail,
  driveEnabled,
  onOpenCategories,
  onOpenPaymentModes,
  onOpenPeople,
  onOpenAppearance,
  onOpenBackup,
  onOpenAccount,
  onDeleteAll,
}: SettingsLandingProps) {
  const theme = useTheme();
  const accountInitial = accountEmail?.trim().charAt(0).toUpperCase() || 'A';

  return (
    <>
      <ScreenHeader title="Settings" />

      {accountEmail ? (
        <ListSection>
          <View style={styles.accountRow}>
            <View style={[styles.avatar, { backgroundColor: theme.accentMuted }]}>
              <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
                {accountInitial}
              </ThemedText>
            </View>
            <View style={styles.accountCopy}>
              <ThemedText type="label" numberOfLines={1}>
                {accountEmail}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Signed in with Google
              </ThemedText>
            </View>
            <Button
              label="Back up now"
              size="small"
              variant="ghost"
              onPress={onOpenBackup}
              accessibilityHint="Choose where to save a backup"
            />
          </View>
        </ListSection>
      ) : null}

      <SettingsGroup
        title="ORGANIZE"
        rows={[
          {
            id: 'categories',
            title: 'Categories',
            icon: ICONS.categories,
            value: String(categoryCount),
            onPress: onOpenCategories,
            accessibilityHint: 'Add, rename, reorder, delete, or edit subcategories',
          },
          {
            id: 'payment-modes',
            title: 'Payment modes',
            icon: ICONS.paymentModes,
            value: String(paymentModeCount),
            onPress: onOpenPaymentModes,
            accessibilityHint: 'Add, rename, reorder, or delete payment modes',
          },
          {
            id: 'people',
            title: 'People & groups',
            icon: ICONS.people,
            value: String(peopleCount),
            onPress: onOpenPeople,
            accessibilityHint: 'Add, rename, reorder, or delete people and groups',
          },
        ]}
      />

      <SettingsGroup
        title="PREFERENCES"
        rows={[
          {
            id: 'appearance',
            title: 'Appearance',
            icon: ICONS.appearance,
            value: appearanceLabel,
            onPress: onOpenAppearance,
            accessibilityHint: 'Choose System, Light, or Dark appearance',
          },
          {
            id: 'app-lock',
            title: 'App lock',
            icon: ICONS.appLock,
            value: appLockLabel,
          },
          {
            id: 'currency',
            title: 'Currency',
            icon: ICONS.currency,
            value: 'Indian Rupee (₹)',
          },
        ]}
      />

      <SettingsGroup
        title="DATA & ACCOUNT"
        rows={[
          {
            id: 'backup',
            title: 'Backup & restore',
            icon: ICONS.backup,
            value: driveEnabled ? 'Drive + local file' : 'Local file',
            onPress: onOpenBackup,
            accessibilityHint: 'Back up or restore Finance Tracker data',
          },
          ...(accountEmail && onOpenAccount
            ? [
                {
                  id: 'account',
                  title: 'Account',
                  icon: ICONS.account,
                  value: 'Google',
                  onPress: onOpenAccount,
                  accessibilityHint: 'View your signed-in email or sign out',
                } satisfies SettingsRowDefinition,
              ]
            : []),
        ]}
      />

      <Button
        label="Delete all data"
        variant="danger"
        icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
        onPress={onDeleteAll}
        accessibilityHint="Permanently remove all transactions after confirmation"
        style={styles.deleteButton}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowValue: { maxWidth: '42%', textAlign: 'right' },
  accountRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  accountCopy: { flex: 1, minWidth: TouchTarget },
  deleteButton: { marginTop: Spacing.one },
});
