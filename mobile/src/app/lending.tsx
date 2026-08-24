/**
 * Lent — the money-lent tracker. The top level lists LOANS (groupings), each spanning any number of
 * principal / repayment / interest transactions with one person. Tapping a loan opens its detail
 * (running balance + attached transactions), where you can add a manual entry, attach existing
 * imported transactions, edit, close, or delete it. Two headline totals (owed to you / you owe) come
 * from the active loans' outstanding.
 *
 * Lending principal + repayments are excluded from the Dashboard/Reports Spent & Received totals
 * (see `core/lending` + the SQL aggregates); interest still counts.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AttachExistingSheet } from '@/components/attach-existing-sheet';
import { EmptyState } from '@/components/empty-state';
import { LoanDetail } from '@/components/loan-detail';
import { LoanFormModal } from '@/components/loan-form-modal';
import { LoanTxnForm } from '@/components/loan-txn-form';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
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
  setLoanClosed,
  updateLoan,
} from '@/services/db/repository';

export default function LendingScreen() {
  const theme = useTheme();
  const { people, closed, owedToMePaise, iOwePaise, byId, loading } = useLoans();
  const { people: peopleList } = useLists();
  // Tapping a transaction inside a loan opens the app-wide detail sheet (mounted at the root).
  const { openTxn, openId } = useTransactionDetail();

  const [showClosed, setShowClosed] = useState(false);
  const [loanForm, setLoanForm] = useState<{ mode: 'create' | 'edit'; loanId?: number } | null>(null);
  const [openLoanId, setOpenLoanId] = useState<number | null>(null);
  const [addTxnFor, setAddTxnFor] = useState<number | null>(null);
  const [attachFor, setAttachFor] = useState<number | null>(null);

  const openLoan = byId(openLoanId);
  const editLoanInitial = loanForm?.mode === 'edit' ? byId(loanForm.loanId ?? null) : null;

  // Hide the loan sheet while the root transaction detail (or its pickers) is open, so only one
  // sheet shows at a time; it reappears when the detail closes (openId → null).
  const loanDetailVisible =
    openLoanId != null && addTxnFor == null && attachFor == null && loanForm == null && openId == null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle">Lent</ThemedText>
            <Pressable
              onPress={() => setLoanForm({ mode: 'create' })}
              accessibilityRole="button"
              accessibilityLabel="New loan"
              style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
            >
              <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                ＋ New loan
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.tiles}>
            <StatTile label="Owed to you" value={formatINR(owedToMePaise)} color={theme.income} />
            <StatTile label="You owe" value={formatINR(iOwePaise)} color={theme.spend} />
          </View>

          {!loading && people.length === 0 && closed.length === 0 ? (
            <EmptyState
              style={styles.empty}
              title="No loans yet"
              message="Create a loan with ＋ New loan, or open a transaction on Reports and tap 'Add to Money Lent'."
            />
          ) : (
            <>
              <View style={styles.list}>
                {/* Grouped by person: a person with one loan shows a plain row; several loans show a
                    netted person header with the loans nested under it. */}
                {people.map((g) =>
                  g.loans.length > 1 ? (
                    <PersonGroupCard key={g.personId} group={g} onPressLoan={setOpenLoanId} />
                  ) : (
                    <LoanRow key={g.loans[0].id} loan={g.loans[0]} onPress={() => setOpenLoanId(g.loans[0].id)} />
                  ),
                )}
                {people.length === 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.noneNote}>
                    No open loans.
                  </ThemedText>
                )}
              </View>

              {closed.length > 0 && (
                <View style={styles.list}>
                  <Pressable onPress={() => setShowClosed((v) => !v)} hitSlop={8} accessibilityRole="button" style={styles.closedToggle}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {showClosed ? '▾' : '▸'} Closed ({closed.length})
                    </ThemedText>
                  </Pressable>
                  {showClosed && closed.map((l) => <LoanRow key={l.id} loan={l} onPress={() => setOpenLoanId(l.id)} dimmed />)}
                </View>
              )}
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
      />

      <LoanTxnForm
        visible={addTxnFor != null}
        onSubmit={(v) => {
          if (addTxnFor != null) addLoanTransaction({ loanId: addTxnFor, part: v.part, paise: v.paise, isoDate: v.isoDate, remarks: v.remarks });
          setAddTxnFor(null);
        }}
        onClose={() => setAddTxnFor(null)}
      />

      <AttachExistingSheet
        visible={attachFor != null}
        onAttach={(ids, part) => {
          if (attachFor != null) ids.forEach((id) => attachTransactionToLoan(id, attachFor, part));
          setAttachFor(null);
        }}
        onClose={() => setAttachFor(null)}
      />
    </ThemedView>
  );
}

/**
 * A person with several active loans: a netted header (their overall position + total interest) with
 * each loan nested under it. This is where lending across reasons reads correctly — e.g. a loan
 * they've over-repaid cancels another they still owe, so the person nets to "settled".
 */
function PersonGroupCard({ group, onPressLoan }: { group: PersonGroup; onPressLoan: (id: number) => void }) {
  const theme = useTheme();
  const net = group.netOwedToMePaise;
  const status = net > 0 ? 'They owe you' : net < 0 ? 'You owe them' : 'Settled';
  const color = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;
  const interestNote = group.interestPaise > 0 ? ` · interest ${formatINR(group.interestPaise)}` : '';

  return (
    <ThemedView type="backgroundElement" style={[styles.groupCard, { borderColor: theme.border }]}>
      <View style={styles.groupHeader}>
        <View style={styles.rowLeft}>
          <ThemedText type="default" numberOfLines={1}>
            {group.personName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {status}
            {interestNote}
          </ThemedText>
        </View>
        <ThemedText type="amount" style={{ color }}>
          {formatINR(Math.abs(net))}
        </ThemedText>
      </View>
      {group.loans.map((l) => {
        const lnet = l.netOwedToMePaise;
        const lcolor = lnet > 0 ? theme.income : lnet < 0 ? theme.spend : theme.textSecondary;
        return (
          <Pressable
            key={l.id}
            onPress={() => onPressLoan(l.id)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.subRow, { borderTopColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="small" numberOfLines={1} style={styles.rowLeft}>
              {l.name || (l.kind === 'lent' ? 'Lent' : 'Borrowed')}
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: lcolor }}>
              {formatINR(Math.abs(lnet))}
            </ThemedText>
          </Pressable>
        );
      })}
    </ThemedView>
  );
}

/** One loan row on the top-level list. */
function LoanRow({ loan, onPress, dimmed }: { loan: LoanView; onPress: () => void; dimmed?: boolean }) {
  const theme = useTheme();
  const net = loan.netOwedToMePaise;
  const status = net > 0 ? 'owes you' : net < 0 ? 'you owe' : 'settled';
  const color = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;
  const interestNote = loan.balance.interestPaise > 0 ? ` · interest ${formatINR(loan.balance.interestPaise)}` : '';

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [{ opacity: pressed ? 0.7 : dimmed ? 0.6 : 1 }]}>
      <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.border }]}>
        <View style={styles.rowLeft}>
          <ThemedText type="default" numberOfLines={1}>
            {loan.personName}
            {loan.name ? ` · ${loan.name}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {status}
            {interestNote}
          </ThemedText>
        </View>
        <ThemedText type="amount" style={{ color }}>
          {formatINR(Math.abs(net))}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  empty: { marginTop: Spacing.four },
  list: { gap: Spacing.two },
  noneNote: { paddingVertical: Spacing.two },
  closedToggle: { paddingVertical: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  rowLeft: { flex: 1, gap: Spacing.half },
  groupCard: {
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
});
