/**
 * A drill-down sheet for one category: how its spend splits across sub-categories, for the
 * period the dashboard is showing. Opened by tapping a category in the "Where it went" list.
 *
 * Read-only for now — a per-sub-category / per-category transaction list is a later addition.
 * Follows the same bottom-sheet pattern as `TransactionDetail`.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';

export interface CategoryDetailProps {
  visible: boolean;
  /** Category label, e.g. `🏍️ Bike`. */
  title: string | null;
  /** The period in view, e.g. `May 2026` or `2026`. */
  periodLabel: string;
  /** The category's gross spend for the period (equals the sum of the sub-category bars). */
  totalPaise: number;
  txnCount: number;
  /** Sub-category rows (already labelled and sorted; set `id` = sub-category id to make one tappable). */
  rows: CategoryBreakdownRow[];
  color: string;
  onClose: () => void;
  /** Open this category's transactions in Reports (pre-filtered). */
  onViewTransactions?: () => void;
  /** Open one sub-category's transactions in Reports (pre-filtered to category + sub-category). */
  onSubcategoryPress?: (subcategoryId: number) => void;
}

export function CategoryDetail({
  visible,
  title,
  periodLabel,
  totalPaise,
  txnCount,
  rows,
  color,
  onClose,
  onViewTransactions,
  onSubcategoryPress,
}: CategoryDetailProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Category</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              <ThemedText type="subtitle" numberOfLines={2}>
                {title ?? 'Category'}
              </ThemedText>
              <ThemedText type="title" style={{ color, fontSize: 34, lineHeight: 40 }}>
                {formatINR(totalPaise)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Spent · {periodLabel} · {txnCount} transaction{txnCount === 1 ? '' : 's'}
              </ThemedText>

              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
                SUB-CATEGORIES
              </ThemedText>
              <CategoryBreakdown
                rows={rows}
                total={totalPaise}
                color={color}
                onRowPress={(row) => {
                  if (row.id != null && onSubcategoryPress) onSubcategoryPress(row.id);
                }}
              />

              {onViewTransactions && (
                <Button
                  label="View transactions"
                  variant="secondary"
                  onPress={onViewTransactions}
                  style={styles.viewBtn}
                />
              )}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  sectionTitle: { fontSize: 12, letterSpacing: 0.5, marginTop: Spacing.three, marginBottom: Spacing.two },
  viewBtn: { marginTop: Spacing.three },
});
