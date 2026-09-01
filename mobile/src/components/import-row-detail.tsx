import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { FeedbackBanner } from '@/components/feedback-banner';
import { ListSection } from '@/components/list-section';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { formatINR } from '@/core/domain/money';
import type { ImportPreviewRow } from '@/core/import/pipeline';
import type { TxnKind } from '@/core/import/types';
import { useTheme } from '@/hooks/use-theme';

const KIND_LABELS: Record<TxnKind, string> = {
  paid: 'Paid',
  sent: 'Money sent',
  received: 'Received',
  self: 'Self transfer',
  billpay: 'Card bill payment',
  recharge: 'Recharge',
  gold: 'Gold',
  refund: 'Refund or cashback',
  other: 'Other',
};

export interface ImportRowDetailProps {
  row: ImportPreviewRow | null;
  sourceName: string;
  fileName: string;
  salvaged: boolean;
  onClose: () => void;
}

/**
 * What a statement row will become, before anything is written. A previewed transaction has no
 * database row yet — no id to load, edit or delete — so this is deliberately read-only: it explains
 * the parse and the suggested category. Editing happens on the review step, after the save.
 */
export function ImportRowDetail({
  row,
  sourceName,
  fileName,
  salvaged,
  onClose,
}: ImportRowDetailProps) {
  const theme = useTheme();
  // Keep the last row rendered while the sheet slides back out.
  const [shown, setShown] = useState(row);
  if (row != null && row !== shown) setShown(row);
  if (!shown) return null;

  const txn = shown.txn;
  const incoming = txn.direction === 'in';
  const transfer = txn.direction === 'self';
  const sign = transfer ? '⇄' : incoming ? '+' : '−';
  const amountColor = transfer ? theme.review : incoming ? theme.income : theme.text;
  const details: { label: string; value: string }[] = [
    { label: 'Date', value: txn.time ? `${txn.isoDate} · ${txn.time}` : txn.isoDate },
    { label: 'Type', value: KIND_LABELS[txn.kind] },
    { label: 'Account', value: txn.accountName ?? '—' },
    { label: 'UPI id', value: txn.counterpartyVpa ?? '—' },
    { label: 'Reference', value: txn.sourceRef ?? txn.orderId ?? '—' },
    { label: 'Statement', value: `${fileName} · ${sourceName}` },
    { label: 'Statement text', value: txn.rawDetails ?? '—' },
    { label: 'Remarks', value: txn.remarks ?? '—' },
    { label: 'Tag', value: txn.rawTag ?? '—' },
  ];

  return (
    <BottomSheet visible={row != null} onClose={onClose}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heading}>
          <ThemedText type={TextRole.summaryHeadline} style={{ color: amountColor }}>
            {sign}
            {formatINR(txn.paise)}
          </ThemedText>
          <ThemedText type={TextRole.sheetTitle} numberOfLines={2}>
            {txn.counterpartyName ?? txn.rawDetails ?? 'Transaction'}
          </ThemedText>
        </View>

        <View style={[styles.suggestion, { borderColor: theme.border }]}>
          <ThemedText type={TextRole.fieldLabel}>
            {shown.categoryLabel ?? 'No category yet'}
          </ThemedText>
          <ThemedText type={TextRole.helper} themeColor="textSecondary">
            {shown.reason || 'Nothing in the row matched a category'}
            {shown.confidence === 'none' ? '' : ` · ${shown.confidence} confidence`}
          </ThemedText>
        </View>

        {shown.needsReview ? (
          <FeedbackBanner
            tone="review"
            wrap
            title="Flagged for review"
            message="It will be waiting in the needs-review list on the next step, where you can set its category."
          />
        ) : null}

        {salvaged ? (
          <FeedbackBanner
            tone="info"
            wrap
            title="Salvaged row"
            message="Some columns could not be read, so this was kept for review rather than dropped."
          />
        ) : null}

        <ListSection title="PARSED FROM THE STATEMENT">
          {details.map((detail) => (
            <View key={detail.label} style={styles.detailRow}>
              <ThemedText
                type={TextRole.detailLabel}
                themeColor="textSecondary"
                style={styles.detailLabel}
              >
                {detail.label}
              </ThemedText>
              <ThemedText type={TextRole.detailValue} style={styles.detailValue} selectable>
                {detail.value}
              </ThemedText>
            </View>
          ))}
        </ListSection>

        <ThemedText type="caption" themeColor="textSecondary">
          Nothing here is saved yet, so it cannot be edited. Categories, notes and splits become
          available on the review step, once Save and review has written it.
        </ThemedText>

        <Button label="Close" variant="secondary" onPress={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.four, gap: Spacing.two },
  heading: { gap: Spacing.half },
  suggestion: {
    gap: Spacing.half,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  detailLabel: { width: 104 },
  detailValue: { flex: 1, minWidth: 0, textAlign: 'right' },
});
