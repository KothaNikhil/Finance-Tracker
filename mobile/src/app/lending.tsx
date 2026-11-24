/**
 * Lending — the money-lent tracker. The top level switches between dense person groups and a flat
 * active-loan list. Each loan spans any number of principal / repayment / interest transactions.
 * Tapping a loan opens its detail
 * (running balance + attached transactions), where you can add a manual entry, attach existing
 * imported transactions, edit, close, or delete it. Two headline totals (owed to you / you owe) come
 * from the active loans' outstanding.
 *
 * Lending principal + repayments are excluded from the Dashboard/Reports Spent & Received totals
 * (see `core/lending` + the SQL aggregates); interest still counts.
 */

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AttachExistingSheet } from '@/components/attach-existing-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { LoanDetail } from '@/components/loan-detail';
import { ListSection } from '@/components/list-section';
import { LoanFormModal } from '@/components/loan-form-modal';
import { LoanTxnForm } from '@/components/loan-txn-form';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import { Skeleton } from '@/components/skeleton';
import { StatStrip, StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { MIN_FONT_SCALE, TextRole } from '@/constants/typography';
import { formatINR } from '@/core/domain/money';
import { useLoans, type LoanView, type PersonGroup } from '@/hooks/use-lending';
import { useLists } from '@/hooks/use-reference-data';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import {
  addLoanTransaction,
  addPerson,
  attachTransactionToLoan,
  createLoan,
  deleteLoan,
  deleteLoanTransaction,
  getEditableLoanTransaction,
  setLoanClosed,
  updateLoan,
  updateLoanTransaction,
} from '@/services/db/repository';

export default function LendingScreen() {
  const theme = useTheme();
  const { active, people, closed, owedToMePaise, iOwePaise, byId, loading, error } = useLoans();
  const { people: peopleList } = useLists();
  // Tapping a transaction inside a loan opens the app-wide detail sheet (mounted at the root).
  const { openTxn, openId } = useTransactionDetail();

  const [mode, setMode] = useState<'people' | 'loans'>('people');
  const [showClosed, setShowClosed] = useState(false);
  const [expandedPeople, setExpandedPeople] = useState<Set<number>>(new Set());
  const [loanForm, setLoanForm] = useState<{ mode: 'create' | 'edit'; loanId?: number } | null>(null);
  const [openLoanId, setOpenLoanId] = useState<number | null>(null);
  const [addTxnFor, setAddTxnFor] = useState<number | null>(null);
  const [editTxnId, setEditTxnId] = useState<number | null>(null);
  const [attachFor, setAttachFor] = useState<number | null>(null);

  const editTxnInitial = editTxnId != null ? getEditableLoanTransaction(editTxnId) : null;

  const openLoan = byId(openLoanId);
  const editLoanInitial = loanForm?.mode === 'edit' ? byId(loanForm.loanId ?? null) : null;

  // Hide the loan sheet while the root transaction detail (or its pickers) is open, so only one
  // sheet shows at a time; it reappears when the detail closes (openId → null).
  const loanDetailVisible =
    openLoanId != null && addTxnFor == null && attachFor == null && loanForm == null && openId == null;

  const openPerson = (group: PersonGroup) => {
    if (group.loans.length === 1) {
      setOpenLoanId(group.loans[0].id);
      return;
    }
    setExpandedPeople((previous) => {
      const next = new Set(previous);
      if (next.has(group.personId)) next.delete(group.personId);
      else next.add(group.personId);
      return next;
    });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader
            title="Lending"
            action={
              <Button
                label="New loan"
                icon={{ ios: 'plus', android: 'add', web: 'add' }}
                variant="primary"
                size="small"
                onPress={() => setLoanForm({ mode: 'create' })}
              />
            }
          />

          <LendingSummary
            owedToMePaise={owedToMePaise}
            iOwePaise={iOwePaise}
            activeLoans={active.length}
            people={people.length}
          />

          <SegmentedControl
            accessibilityLabel="Lending view"
            options={[
              { value: 'people', label: 'People' },
              { value: 'loans', label: 'Loans' },
            ]}
            value={mode}
            onChange={setMode}
          />

          {loading ? (
            <LendingLoading />
          ) : error ? (
            <EmptyState
              style={styles.empty}
              title="Couldn’t load lending"
              message="Your lending data is still safe. Close and reopen this screen to try again."
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
            />
          ) : active.length === 0 && closed.length === 0 ? (
            <EmptyState
              style={styles.empty}
              title="No loans yet"
              message="Create a loan here, or open any Activity transaction and choose Money Lent."
              actionLabel="Create a loan"
              onAction={() => setLoanForm({ mode: 'create' })}
              icon={{ ios: 'person.2', android: 'group', web: 'group' }}
            />
          ) : (
            <>
              {mode === 'people' ? (
                <ListSection title="PEOPLE">
                  {people.length === 0 ? (
                    <NoActiveLoans />
                  ) : (
                    people.map((group) => (
                      <PersonGroupRow
                        key={group.personId}
                        group={group}
                        expanded={expandedPeople.has(group.personId)}
                        onPress={() => openPerson(group)}
                        onPressLoan={setOpenLoanId}
                      />
                    ))
                  )}
                </ListSection>
              ) : (
                <ListSection title="ACTIVE LOANS">
                  {active.length === 0 ? (
                    <NoActiveLoans />
                  ) : (
                    active.map((loan) => (
                      <LoanRow key={loan.id} loan={loan} onPress={() => setOpenLoanId(loan.id)} />
                    ))
                  )}
                </ListSection>
              )}

              {closed.length > 0 ? (
                <ListSection style={styles.closedSection}>
                  <Pressable
                    onPress={() => setShowClosed((value) => !value)}
                    accessibilityRole="button"
                    accessibilityLabel={`Closed loans, ${closed.length}`}
                    accessibilityState={{ expanded: showClosed }}
                    style={({ pressed }) => [
                      styles.closedToggle,
                      { opacity: pressed ? Opacity.pressed : 1 },
                    ]}
                  >
                    <ThemedText type="small" themeColor="textSecondary">
                      Closed loans
                    </ThemedText>
                    <View style={styles.closedMeta}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
                        {closed.length}
                      </ThemedText>
                      <SymbolView
                        name={{
                          ios: showClosed ? 'chevron.up' : 'chevron.down',
                          android: showClosed ? 'expand_less' : 'expand_more',
                          web: showClosed ? 'expand_less' : 'expand_more',
                        }}
                        size={16}
                        tintColor={theme.textSecondary}
                      />
                    </View>
                  </Pressable>
                  {showClosed
                    ? closed.map((loan) => (
                        <LoanRow
                          key={loan.id}
                          loan={loan}
                          closed
                          onPress={() => setOpenLoanId(loan.id)}
                        />
                      ))
                    : null}
                </ListSection>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <LoanFormModal
        visible={loanForm != null}
        mode={loanForm?.mode ?? 'create'}
        initial={editLoanInitial ? { name: editLoanInitial.name, personId: editLoanInitial.personId, kind: editLoanInitial.kind } : undefined}
        people={peopleList}
        onAddPerson={(name) => addPerson(name)}
        onSubmit={(v) => {
          if (loanForm?.mode === 'edit' && loanForm.loanId != null) {
            updateLoan(loanForm.loanId, v);
          } else {
            const id = createLoan(v);
            setOpenLoanId(id); // jump straight into the new loan
          }
          setLoanForm(null);
        }}
        onClose={() => setLoanForm(null)}
      />

      <LoanDetail
        visible={loanDetailVisible}
        loan={openLoan}
        onClose={() => setOpenLoanId(null)}
        onAddTxn={() => setAddTxnFor(openLoanId)}
        onAttachExisting={() => setAttachFor(openLoanId)}
        onEditLoan={() => setLoanForm({ mode: 'edit', loanId: openLoanId ?? undefined })}
        onToggleClosed={() => {
          if (openLoanId != null && openLoan) setLoanClosed(openLoanId, !openLoan.closed);
        }}
        onDeleteLoan={() => {
          if (openLoanId != null) deleteLoan(openLoanId);
          setOpenLoanId(null);
        }}
        onPressTxn={openTxn}
        onEditTxn={setEditTxnId}
      />

      <LoanTxnForm
        visible={addTxnFor != null}
        loanKind={byId(addTxnFor)?.kind}
        onSubmit={(v) => {
          if (addTxnFor != null) addLoanTransaction({ loanId: addTxnFor, part: v.part, paise: v.paise, isoDate: v.isoDate, remarks: v.remarks });
          setAddTxnFor(null);
        }}
        onClose={() => setAddTxnFor(null)}
      />

      <LoanTxnForm
        visible={editTxnId != null && editTxnInitial != null}
        mode="edit"
        initial={editTxnInitial ?? undefined}
        loanKind={byId(editTxnInitial?.loanId ?? null)?.kind}
        onSubmit={(v) => {
          if (editTxnId != null) {
            updateLoanTransaction(editTxnId, {
              part: v.part,
              paise: v.paise,
              isoDate: v.isoDate,
              remarks: v.remarks,
            });
          }
          setEditTxnId(null);
        }}
        onDelete={() => {
          if (editTxnId != null) deleteLoanTransaction(editTxnId);
          setEditTxnId(null);
        }}
        onClose={() => setEditTxnId(null)}
      />

      <AttachExistingSheet
        visible={attachFor != null}
        loanKind={openLoan?.kind}
        onAttach={(ids, part) => {
          if (attachFor != null) ids.forEach((id) => attachTransactionToLoan(id, attachFor, part));
          setAttachFor(null);
        }}
        onClose={() => setAttachFor(null)}
      />
    </ThemedView>
  );
}

function LendingSummary({
  owedToMePaise,
  iOwePaise,
  activeLoans,
  people,
}: {
  owedToMePaise: number;
  iOwePaise: number;
  activeLoans: number;
  people: number;
}) {
  const theme = useTheme();
  return (
    <Card padding="small" style={styles.summaryCard}>
      <StatStrip>
        <StatTile variant="column" label="Owed to you" value={formatINR(owedToMePaise)} color={theme.income} />
        <StatTile variant="column" label="You owe" value={formatINR(iOwePaise)} color={theme.spend} />
      </StatStrip>
      <ThemedText type="caption" themeColor="textSecondary">
        {activeLoans} active {activeLoans === 1 ? 'loan' : 'loans'} · {people}{' '}
        {people === 1 ? 'person' : 'people'}
      </ThemedText>
    </Card>
  );
}

function LendingLoading() {
  return (
    <View style={styles.section} accessibilityLabel="Loading lending">
      <Skeleton width={92} height={11} />
      <Card padding="small" style={styles.loadingCard}>
        {[0, 1, 2, 3, 4].map((key) => (
          <View key={key} style={styles.loadingRow}>
            <Skeleton width={30} height={30} radius={Radius.pill} />
            <View style={styles.loadingText}>
              <Skeleton width="52%" height={14} />
              <Skeleton width="78%" height={11} />
            </View>
            <Skeleton width={72} height={16} />
          </View>
        ))}
      </Card>
    </View>
  );
}

function NoActiveLoans() {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
      No active loans. Reopen one below or create a new loan.
    </ThemedText>
  );
}

function PersonGroupRow({
  group,
  expanded,
  onPress,
  onPressLoan,
}: {
  group: PersonGroup;
  expanded: boolean;
  onPress: () => void;
  onPressLoan: (id: number) => void;
}) {
  const theme = useTheme();
  const net = group.netOwedToMePaise;
  const status = net > 0 ? 'owed to you' : net < 0 ? 'you owe' : 'settled';
  const color = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;
  const principal = group.loans.reduce((sum, loan) => sum + loan.balance.principalPaise, 0);
  const repaid = group.loans.reduce((sum, loan) => sum + loan.balance.repaidPaise, 0);
  const progress = principal > 0 ? Math.min(100, Math.round((repaid / principal) * 100)) : 0;
  const onlyLoan = group.loans.length === 1 ? group.loans[0] : null;
  const repaymentNote =
    repaid > 0
      ? `${formatINR(repaid)} repaid of ${formatINR(principal)}`
      : 'no repayments yet';

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${group.personName}, ${group.loans.length} active ${
          group.loans.length === 1 ? 'loan' : 'loans'
        }, ${formatINR(Math.abs(net))} ${status}`}
        accessibilityHint={group.loans.length > 1 ? 'Shows this person’s loans' : 'Opens loan details'}
        accessibilityState={group.loans.length > 1 ? { expanded } : undefined}
        style={({ pressed }) => [styles.personRow, { opacity: pressed ? Opacity.pressed : 1 }]}
      >
        <Avatar name={group.personName} negative={net < 0} />
        <View style={styles.rowLeft}>
          <View style={styles.nameLine}>
            <ThemedText type={TextRole.rowTitle} numberOfLines={1} style={styles.name}>
              {group.personName}
            </ThemedText>
            <StatusBadge
              label={
                onlyLoan
                  ? onlyLoan.kind === 'lent'
                    ? 'Lent'
                    : 'Borrowed'
                  : `${group.loans.length} active`
              }
              tone={
                onlyLoan
                  ? onlyLoan.kind === 'lent'
                    ? 'accent'
                    : 'danger'
                  : net < 0
                    ? 'danger'
                    : net > 0
                      ? 'accent'
                      : 'neutral'
              }
            />
          </View>
          <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
            {group.loans.length} active · {repaymentNote} · {progress}% repaid
          </ThemedText>
        </View>
        <View style={styles.amountColumn}>
          <ThemedText
            type={TextRole.rowAmount}
            style={[styles.tabular, { color }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={MIN_FONT_SCALE}
          >
            {formatINR(Math.abs(net))}
          </ThemedText>
          <ThemedText type={TextRole.rowSecondary} style={{ color }} numberOfLines={1}>
            {status}
          </ThemedText>
        </View>
        <SymbolView
          name={{
            ios: expanded ? 'chevron.down' : 'chevron.right',
            android: expanded ? 'expand_more' : 'chevron_right',
            web: expanded ? 'expand_more' : 'chevron_right',
          }}
          size={16}
          tintColor={theme.textSecondary}
        />
      </Pressable>
      {expanded
        ? group.loans.map((loan) => (
            <LoanRow key={loan.id} loan={loan} nested divider onPress={() => onPressLoan(loan.id)} />
          ))
        : null}
    </View>
  );
}

function LoanRow({
  loan,
  onPress,
  closed = false,
  divider = false,
  nested = false,
}: {
  loan: LoanView;
  onPress: () => void;
  closed?: boolean;
  divider?: boolean;
  nested?: boolean;
}) {
  const theme = useTheme();
  const net = loan.netOwedToMePaise;
  const status = net > 0 ? 'owed to you' : net < 0 ? 'you owe' : 'settled';
  const color = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;
  const interestNote =
    loan.balance.interestPaise > 0
      ? ` · Interest ${formatINR(loan.balance.interestPaise)}`
      : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${loan.personName}${loan.name ? `, ${loan.name}` : ''}, ${
        closed ? 'closed' : 'active'
      } ${loan.kind} loan, ${formatINR(Math.abs(net))} ${status}`}
      accessibilityHint="Opens loan details"
      style={({ pressed }) => [
        styles.loanRow,
        nested && styles.nestedLoanRow,
        divider && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? Opacity.pressed : closed ? 0.72 : 1 },
      ]}
    >
      {nested ? null : <Avatar name={loan.personName} negative={loan.kind === 'borrowed'} />}
      <View style={styles.rowLeft}>
        <View style={styles.nameLine}>
          <ThemedText
            type={nested ? TextRole.nestedRowTitle : TextRole.rowTitle}
            themeColor={nested ? 'textSecondary' : 'text'}
            numberOfLines={1}
            style={styles.name}
          >
            {loan.personName}
            {loan.name ? ` · ${loan.name}` : ''}
          </ThemedText>
          <StatusBadge
            label={
              closed
                ? `Closed · ${loan.kind === 'lent' ? 'Lent' : 'Borrowed'}`
                : loan.kind === 'lent'
                  ? 'Lent'
                  : 'Borrowed'
            }
            tone={closed ? 'neutral' : loan.kind === 'lent' ? 'accent' : 'danger'}
          />
        </View>
        <ThemedText
          type={nested ? TextRole.nestedRowSecondary : TextRole.rowSecondary}
          themeColor="textSecondary"
          numberOfLines={1}
        >
          Principal {formatINR(loan.balance.principalPaise)} · Repaid{' '}
          {formatINR(loan.balance.repaidPaise)}
          {interestNote}
        </ThemedText>
      </View>
      <View style={styles.amountColumn}>
        <ThemedText
          type={nested ? TextRole.nestedRowAmount : TextRole.rowAmount}
          style={[styles.tabular, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit={!nested}
          minimumFontScale={MIN_FONT_SCALE}
        >
          {formatINR(Math.abs(net))}
        </ThemedText>
        <ThemedText
          type={nested ? TextRole.nestedRowSecondary : TextRole.rowSecondary}
          style={{ color }}
          numberOfLines={1}
        >
          {status}
        </ThemedText>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={16}
        tintColor={theme.textSecondary}
      />
    </Pressable>
  );
}

function Avatar({ name, negative }: { name: string; negative: boolean }) {
  const theme = useTheme();
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={[styles.avatar, { backgroundColor: negative ? theme.spendMuted : theme.accentMuted }]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <ThemedText type="smallEmphasis" style={{ color: negative ? theme.spend : theme.accent }}>
        {letter}
      </ThemedText>
    </View>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'accent' | 'danger' | 'neutral' }) {
  const theme = useTheme();
  const backgroundColor =
    tone === 'accent' ? theme.accentMuted : tone === 'danger' ? theme.spendMuted : theme.backgroundSelected;
  const color = tone === 'accent' ? theme.accent : tone === 'danger' ? theme.spend : theme.textSecondary;
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <ThemedText type="caption" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  empty: { marginTop: Spacing.three },
  section: { gap: Spacing.one },
  summaryCard: { gap: Spacing.half },
  tabular: { fontVariant: ['tabular-nums'] },
  emptyRow: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  loadingCard: { gap: Spacing.two },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  loadingText: { flex: 1, gap: Spacing.one },
  personRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  loanRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  nestedLoanRow: { paddingLeft: Spacing.six, minHeight: TouchTarget },
  rowLeft: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minWidth: 0 },
  name: { flexShrink: 1 },
  amountColumn: { alignItems: 'flex-end', minWidth: 96 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badge: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    flexShrink: 0,
  },
  closedSection: { marginTop: Spacing.one },
  closedToggle: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  closedMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
