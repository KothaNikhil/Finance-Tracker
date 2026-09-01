/**
 * A drill-down sheet for one category: how its spend splits across sub-categories, for the
 * period the dashboard is showing. Opened by tapping a category in the "Where it went" list.
 *
 * Read-only for now — a per-sub-category / per-category transaction list is a later addition.
 * Follows the same bottom-sheet pattern as `TransactionDetail`.
 */

import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { IconButton } from '@/components/icon-button';
import { ScreenHeader } from '@/components/screen-header';
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
  /** Open this category's transactions in Activity (pre-filtered). */
  onViewTransactions?: () => void;
  /** Open one sub-category's transactions in Activity (pre-filtered to category + sub-category). */
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
        <ScreenHeader
          compact
          title={title ?? 'Category'}
          action={
            <IconButton
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              label="Close category breakdown"
              onPress={onClose}
              variant="plain"
            />
          }
        />

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Card padding="small" style={styles.summary}>
            <ThemedText type="amount" style={{ color }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
              {formatINR(totalPaise)}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              Spent · {periodLabel} · {txnCount} transaction{txnCount === 1 ? '' : 's'}
            </ThemedText>
          </Card>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
            SUB-CATEGORIES
          </ThemedText>
          <Card padding="small">
            <CategoryBreakdown
              rows={rows}
              total={totalPaise}
              color={color}
              onRowPress={(row) => {
                if (row.id != null && onSubcategoryPress) onSubcategoryPress(row.id);
              }}
            />
          </Card>

          {onViewTransactions ? (
            <Button
              label="View in Activity"
              variant="primary"
              onPress={onViewTransactions}
              style={styles.viewBtn}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  body: { paddingTop: Spacing.two, paddingBottom: Spacing.four, gap: Spacing.one },
  summary: { gap: 0 },
  sectionTitle: { marginTop: Spacing.two, marginBottom: Spacing.one },
  viewBtn: { marginTop: Spacing.two },
});
