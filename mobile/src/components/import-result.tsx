import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { FeedbackBanner } from '@/components/feedback-banner';
import { ImportStepIndicator } from '@/components/import-step-indicator';
import { ListSection } from '@/components/list-section';
import { PeriodTabs } from '@/components/period-tabs';
import { SegmentedControl } from '@/components/segmented-control';
import { StatStrip, StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { MonthKey } from '@/core/analytics';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

/** Which set of saved transactions the review list shows. */
export type ImportResultScope = 'session' | 'flagged';

/** What the save that opened this step wrote. Absent when the step is opened from the pick step. */
export interface ImportSavedSummary {
  fileName: string;
  savedCount: number;
  duplicatesChecked: number;
  duplicatesUpdated: number;
  duplicatesFlagged: number;
}

export interface LastImportSummary {
  sourceLabel: string;
  addedCount: number;
  importedAt: string;
}

export interface ImportResultHeaderProps {
  saved: ImportSavedSummary | null;
  sessionCount: number;
  spentPaise: number;
  receivedPaise: number;
  reviewCount: number;
  lastImport: LastImportSummary | null;
  months: MonthKey[];
  selectedMonth: MonthKey | null;
  scope: ImportResultScope;
  onSelectMonth: (month: MonthKey | null) => void;
  onScopeChange: (scope: ImportResultScope) => void;
  onDone: () => void;
  onAcceptAll: () => void;
  onRevert: () => void;
}

/**
 * Header for the review step: the transactions the import just saved, or the whole needs-review
 * queue. Rows below it are stored records, so they open the app-wide transaction sheet and can be
 * edited. There is nothing to cancel here — Done finishes the run, and reverting the whole import
 * is its own action.
 */
export function ImportResultHeader({
  saved,
  sessionCount,
  spentPaise,
  receivedPaise,
  reviewCount,
  lastImport,
  months,
  selectedMonth,
  scope,
  onSelectMonth,
  onScopeChange,
  onDone,
  onAcceptAll,
  onRevert,
}: ImportResultHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <ThemedText type="heading" style={styles.grow}>
          {scope === 'flagged' ? 'Needs review' : 'Review transactions'}
        </ThemedText>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done, back to choosing a statement"
          hitSlop={14}
          style={({ pressed }) => [styles.done, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ThemedText type="link" style={{ color: theme.accent }}>
            Done
          </ThemedText>
        </Pressable>
      </View>

      <ImportStepIndicator current="review" />

      {saved ? (
        <FeedbackBanner
          tone="success"
          wrap
          title={
            saved.savedCount > 0
              ? `${saved.savedCount} transaction${saved.savedCount === 1 ? '' : 's'} saved`
              : 'Statement checked, nothing new to add'
          }
          message={savedMessage(saved)}
        />
      ) : null}

      <Card padding="small" style={styles.summaryCard}>
        <StatStrip>
          <StatTile variant="column" label="Spent" value={formatINR(spentPaise)} color={theme.spend} />
          <StatTile
            variant="column"
            label="Received"
            value={formatINR(receivedPaise)}
            color={theme.income}
          />
          <StatTile variant="column" label="Imported" value={String(sessionCount)} />
        </StatStrip>
      </Card>

      {reviewCount > 0 ? (
        <Card tone="review" padding="small" style={styles.reviewCard}>
          <View style={styles.reviewCopy}>
            <ThemedText type="smallEmphasis" style={{ color: theme.review }} numberOfLines={1}>
              ! &nbsp;{reviewCount} transaction{reviewCount === 1 ? '' : 's'} need review
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
              {scope === 'session'
                ? 'The queue spans every import, not just this session'
                : 'Tap a transaction to set its category'}
            </ThemedText>
          </View>
          <Button
            label="Accept all"
            size="small"
            variant="secondary"
            onPress={onAcceptAll}
            accessibilityHint="Keeps the suggestions and clears every review flag"
          />
        </Card>
      ) : null}

      {lastImport ? (
        <ListSection>
          <Pressable
            onPress={onRevert}
            accessibilityRole="button"
            accessibilityLabel={`Revert last import, ${lastImport.sourceLabel}, ${lastImport.addedCount} transactions`}
            accessibilityHint="Opens a destructive confirmation"
            style={({ pressed }) => [styles.revertRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={[styles.revertIcon, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="caption" themeColor="textSecondary">
                ↶
              </ThemedText>
            </View>
            <View style={styles.grow}>
              <ThemedText type="label">Revert last import</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                {lastImport.sourceLabel || 'Last import'} · {lastImport.addedCount} added ·{' '}
                {lastImport.importedAt.slice(0, 10)}
              </ThemedText>
            </View>
          </Pressable>
        </ListSection>
      ) : null}

      {reviewCount > 0 || scope === 'flagged' ? (
        <SegmentedControl
          options={[
            { value: 'session', label: `This session ${sessionCount}` },
            { value: 'flagged', label: `Needs review ${reviewCount}` },
          ]}
          value={scope}
          onChange={onScopeChange}
          accessibilityLabel="Choose which saved transactions to show"
        />
      ) : null}

      {scope === 'session' && months.length > 0 ? (
        <PeriodTabs months={months} selected={selectedMonth} onSelect={onSelectMonth} />
      ) : null}
    </View>
  );
}

/** The reconciliation sentence under the post-save confirmation. */
function savedMessage(saved: ImportSavedSummary): string {
  const parts = [saved.fileName];
  if (saved.duplicatesChecked > 0) {
    parts.push(
      `${saved.duplicatesChecked} duplicate${saved.duplicatesChecked === 1 ? '' : 's'} checked`,
    );
  }
  if (saved.duplicatesUpdated > 0) {
    parts.push(
      `${saved.duplicatesUpdated} existing row${saved.duplicatesUpdated === 1 ? '' : 's'} updated`,
    );
  }
  if (saved.duplicatesFlagged > 0) {
    parts.push(
      `${saved.duplicatesFlagged} conflict${saved.duplicatesFlagged === 1 ? '' : 's'} flagged`,
    );
  }
  return parts.join(' · ');
}

export function ImportResultFooter({ appVersion }: { appVersion: string }) {
  return (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.footerText}>
      Your full saved history is available in Activity. Finance Tracker v{appVersion}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  titleRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: { flex: 1 },
  done: { minHeight: 34, justifyContent: 'center' },
  summaryCard: { overflow: 'hidden' },
  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  reviewCopy: { flex: 1, minHeight: 36, justifyContent: 'center' },
  revertRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  revertIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: { textAlign: 'center', marginTop: Spacing.two },
});
