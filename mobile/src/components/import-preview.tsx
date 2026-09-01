import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ImportRowDetail } from '@/components/import-row-detail';
import { ImportStepIndicator } from '@/components/import-step-indicator';
import { InfoDisclosure } from '@/components/info-disclosure';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { formatINR } from '@/core/domain/money';
import type {
  ImportDryRun,
  ImportPreview as ImportPreviewData,
  ImportPreviewRow,
} from '@/core/import/pipeline';
import { useTheme } from '@/hooks/use-theme';

const DRY_RUN_NOTE =
  'Categories and review labels are a dry-run preview. Nothing is written until you tap Save and review.';

export interface ImportPreviewProps {
  fileName: string;
  sourceName: string;
  preview: ImportPreviewData;
  dryRun: ImportDryRun;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * Every transaction the statement will add, still unsaved: the step where the user decides whether
 * to commit. Cancel writes nothing; Save and review commits the batch and hands it to the review
 * step, where the rows are real records that can be edited.
 */
export function ImportPreview({
  fileName,
  sourceName,
  preview,
  dryRun,
  saving,
  error,
  onBack,
  onCancel,
  onSave,
}: ImportPreviewProps) {
  const theme = useTheme();
  const [openRow, setOpenRow] = useState<ImportPreviewRow | null>(null);
  const salvagedKeys = new Set(preview.salvaged.map((txn) => txn.dedupeKey));
  const hasWork = preview.newTxns.length > 0 || preview.duplicates.length > 0;
  const saveLabel =
    preview.newTxns.length > 0
      ? `Save and review ${preview.newTxns.length} transaction${preview.newTxns.length === 1 ? '' : 's'}`
      : preview.duplicates.length > 0
        ? `Check ${preview.duplicates.length} duplicate${preview.duplicates.length === 1 ? '' : 's'}`
        : 'Nothing to save';

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to choose file"
            hitSlop={12}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="subtitle" style={{ color: theme.accent }}>
              ‹
            </ThemedText>
          </Pressable>
          <ThemedText type="heading" style={styles.title}>
            {saving ? 'Saving import' : 'Import preview'}
          </ThemedText>
          <Pressable
            onPress={onCancel}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Cancel import, nothing is saved"
            hitSlop={14}
            style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="link" style={{ color: theme.accent }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>

        <ImportStepIndicator current="preview" />

        <Card padding="small" style={styles.fileCard}>
          <View style={[styles.fileIcon, { backgroundColor: theme.accentMuted }]}>
            <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
              ▤
            </ThemedText>
          </View>
          <View style={styles.grow}>
            <ThemedText type="label" numberOfLines={1}>
              {fileName}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
              {sourceName} · {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'}
            </ThemedText>
          </View>
          <ThemedText type="caption" style={{ color: theme.income }}>
            ✓ Recognized
          </ThemedText>
        </Card>

        <Card padding="none" style={styles.summaryCard}>
          <View style={styles.metricGrid}>
            <Metric label="Total" value={preview.totalRows} />
            <Metric label="New" value={preview.newTxns.length} />
            <Metric label="Duplicates" value={preview.duplicates.length} />
            <Metric label="Need review" value={dryRun.reviewCount} tone="review" />
            <Metric label="Salvaged" value={preview.salvaged.length} tone="review" />
            <Metric label="Skipped" value={preview.errors.length} />
          </View>
          <View style={[styles.totals, { borderTopColor: theme.border }]}>
            <View style={styles.total}>
              <ThemedText type="caption" themeColor="textSecondary">
                Total debit
              </ThemedText>
              <ThemedText type="stat" style={{ color: theme.spend }}>
                {formatINR(preview.totalDebitPaise)}
              </ThemedText>
            </View>
            <View style={[styles.total, styles.totalDivider, { borderLeftColor: theme.border }]}>
              <ThemedText type="caption" themeColor="textSecondary">
                Total credit
              </ThemedText>
              <ThemedText type="stat" style={{ color: theme.income }}>
                {formatINR(preview.totalCreditPaise)}
              </ThemedText>
            </View>
          </View>
        </Card>

        <InfoDisclosure
          label="How preview categories are decided"
          text={DRY_RUN_NOTE}
          style={styles.sectionHeader}
        >
          <View style={styles.sectionHeaderRow}>
            <ThemedText type="overline" themeColor="textSecondary">
              PREVIEW
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.accent }}>
              {dryRun.reviewCount > 0 ? `${dryRun.reviewCount} need review` : 'Nothing flagged'}
            </ThemedText>
          </View>
        </InfoDisclosure>
      </View>

      <FlatList
        style={styles.fill}
        data={dryRun.rows}
        keyExtractor={(row, index) => `${row.txn.dedupeKey}:${index}`}
        renderItem={({ item, index }) => (
          <PreviewRow
            row={item}
            sourceName={sourceName}
            salvaged={salvagedKeys.has(item.txn.dedupeKey)}
            divided={index > 0}
            onPress={() => setOpenRow(item)}
          />
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRows}>
            Every recognized transaction is already in your history.
          </ThemedText>
        }
        ListFooterComponent={
          <View style={styles.listFooter}>
            {preview.duplicates.length > 0 || preview.errors.length > 0 ? (
              <Card tone="subtle" padding="small" style={styles.detailCard}>
                <ThemedText type="smallEmphasis">
                  {preview.duplicates.length} duplicate
                  {preview.duplicates.length === 1 ? '' : 's'} and {preview.errors.length} skipped
                  row{preview.errors.length === 1 ? '' : 's'}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Duplicates are checked again when you save. Skipped rows could not be safely
                  interpreted as transactions.
                </ThemedText>
                {preview.errors.slice(0, 3).map((item) => (
                  <ThemedText
                    key={`${item.rowNumber}:${item.message}`}
                    type="caption"
                    themeColor="textSecondary"
                  >
                    Row {item.rowNumber}: {item.message}
                  </ThemedText>
                ))}
              </Card>
            ) : null}
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <View
        style={[
          styles.confirmBar,
          { backgroundColor: theme.background, borderTopColor: theme.border },
        ]}
      >
        {error ? (
          <ThemedText
            type="small"
            style={{ color: theme.spend }}
            accessibilityLiveRegion="polite"
          >
            {error}
          </ThemedText>
        ) : null}
        {saving ? (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary">
              Rechecking duplicates and saving securely on this device…
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.confirmNote}>
            Cancel leaves your history untouched.
          </ThemedText>
        )}
        <Button
          label={saveLabel}
          variant="primary"
          onPress={onSave}
          disabled={!hasWork}
          loading={saving}
          accessibilityHint="Rechecks duplicates, categorizes, saves, and opens the review step"
        />
      </View>

      <ImportRowDetail
        row={openRow}
        sourceName={sourceName}
        fileName={fileName}
        salvaged={openRow != null && salvagedKeys.has(openRow.txn.dedupeKey)}
        onClose={() => setOpenRow(null)}
      />
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'review';
}) {
  const theme = useTheme();
  return (
    <View style={styles.metric}>
      <ThemedText type="stat" style={tone === 'review' ? { color: theme.review } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.center}>
        {label}
      </ThemedText>
    </View>
  );
}

function PreviewRow({
  row,
  sourceName,
  salvaged,
  divided,
  onPress,
}: {
  row: ImportPreviewRow;
  sourceName: string;
  salvaged: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const txn = row.txn;
  const incoming = txn.direction === 'in';
  const transfer = txn.direction === 'self';
  const sign = transfer ? '⇄' : incoming ? '+' : '−';
  const fallback = transfer
    ? 'Transfer'
    : incoming
      ? 'Received'
      : row.needsReview
        ? 'Pending category'
        : 'Uncategorized';
  const label = row.categoryLabel ?? fallback;
  const chipColors = row.needsReview
    ? { backgroundColor: theme.reviewMuted, color: theme.review }
    : incoming
      ? { backgroundColor: theme.incomeMuted, color: theme.income }
      : { backgroundColor: theme.accentMuted, color: theme.accent };
  const name = txn.counterpartyName ?? txn.rawDetails ?? 'Transaction';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatINR(txn.paise)}, ${label}`}
      accessibilityHint="Shows what this row parsed to; nothing is saved yet"
      style={({ pressed }) => [
        styles.previewRow,
        divided && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={styles.grow}>
        <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {txn.isoDate} · {sourceName}
          {salvaged ? ' · Salvaged' : ''}
        </ThemedText>
      </View>
      <View style={styles.rowEnd}>
        <ThemedText
          type={TextRole.rowAmount}
          style={[
            styles.tabular,
            { color: transfer ? theme.review : incoming ? theme.income : theme.text },
          ]}
        >
          {sign}
          {formatINR(txn.paise)}
        </ThemedText>
        <View style={[styles.chip, { backgroundColor: chipColors.backgroundColor }]}>
          <ThemedText type="caption" style={{ color: chipColors.color }} numberOfLines={1}>
            {label}
            {row.needsReview ? ' · Review' : ''}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  listFooter: { gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1 },
  back: { width: 28, minHeight: 34, alignItems: 'flex-start', justifyContent: 'center' },
  cancel: { minHeight: 34, justifyContent: 'center' },
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fileIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: { overflow: 'hidden' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: Spacing.one },
  metric: {
    width: '33.333%',
    alignItems: 'center',
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
  },
  center: { textAlign: 'center' },
  totals: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  total: { flex: 1, alignItems: 'center' },
  totalDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  tabular: { fontVariant: ['tabular-nums'] },
  sectionHeader: {
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.half,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  previewRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  rowEnd: { alignItems: 'flex-end', gap: Spacing.half, maxWidth: '48%' },
  chip: {
    maxWidth: '100%',
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  emptyRows: { padding: Spacing.two },
  detailCard: { gap: Spacing.half },
  // The native tab bar is laid out BELOW this screen's content, and carries the system gesture /
  // navigation inset itself, so a fixed bar here needs no bottom inset of its own.
  confirmBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  progress: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  confirmNote: { textAlign: 'center' },
});
