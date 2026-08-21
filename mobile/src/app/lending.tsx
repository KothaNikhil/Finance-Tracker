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

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddToMoneyLentSheet, type LoanChoice } from '@/components/add-to-money-lent-sheet';
import { AttachExistingSheet } from '@/components/attach-existing-sheet';
import { CategoryPicker } from '@/components/category-picker';
import { EmptyState } from '@/components/empty-state';
import { LoanDetail } from '@/components/loan-detail';
import { LoanFormModal } from '@/components/loan-form-modal';
import { LoanTxnForm } from '@/components/loan-txn-form';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionDetail } from '@/components/transaction-detail';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { loanPartOf, type LoanPart } from '@/core/lending/roles';
import { useLoans, type LoanView } from '@/hooks/use-lending';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useTheme } from '@/hooks/use-theme';
import {
  acceptTransactionReview,
  addCategory,
  addLoanTransaction,
  addPerson,
  addSubcategory,
  attachTransactionToLoan,
  clearTransactionCategory,
  createLoan,
  deleteLoan,
  deleteTransaction,
  detachTransactionFromLoan,
  setLoanClosed,
  setTransactionCategory,
  updateLoan,
} from '@/services/db/repository';

export default function LendingScreen() {
  const theme = useTheme();
  const { active, closed, owedToMePaise, iOwePaise, byId, personName, loading } = useLoans();
  const { people: peopleList } = useLists();
  const index = useCategoryIndex();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);

  const loanChoices: LoanChoice[] = useMemo(
    () => [...active, ...closed].map((l) => ({ id: l.id, name: l.name, personName: l.personName, kind: l.kind })),
    [active, closed],
  );

  const [showClosed, setShowClosed] = useState(false);
  const [loanForm, setLoanForm] = useState<{ mode: 'create' | 'edit'; loanId?: number } | null>(null);
  const [openLoanId, setOpenLoanId] = useState<number | null>(null);
  const [addTxnFor, setAddTxnFor] = useState<number | null>(null);
  const [attachFor, setAttachFor] = useState<number | null>(null);
  const [editTxnId, setEditTxnId] = useState<number | null>(null);
  const [moneyLentOpen, setMoneyLentOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openLoan = byId(openLoanId);
  const editTxn: TransactionRow | null = editTxnId != null ? (openLoan?.txns.find((t) => t.id === editTxnId) ?? null) : null;
  const editLoanInitial = loanForm?.mode === 'edit' ? byId(loanForm.loanId ?? null) : null;

  const loanDetailVisible = openLoanId != null && addTxnFor == null && attachFor == null && editTxnId == null && loanForm == null;

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

          {!loading && active.length === 0 && closed.length === 0 ? (
            <EmptyState
              style={styles.empty}
              title="No loans yet"
              message="Create a loan with ＋ New loan, or open a transaction on Reports and tap 'Add to Money Lent'."
            />
          ) : (
            <>
              <View style={styles.list}>
                {active.map((l) => (
                  <LoanRow key={l.id} loan={l} onPress={() => setOpenLoanId(l.id)} />
                ))}
                {active.length === 0 && (
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
        onPressTxn={(id) => setEditTxnId(id)}
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

      <TransactionDetail
        visible={editTxn !== null && !moneyLentOpen && !pickerOpen}
        txn={editTxn}
        categoryLabel={editTxn ? rowCategoryLabel(editTxn, index.byId, subNames) : null}
        paymentModeName={null}
        personName={editTxn?.personId != null ? personName(editTxn.personId) : null}
        moneyLentLabel={openLoan ? `${openLoan.personName}${openLoan.name ? ` · ${openLoan.name}` : ''}` : null}
        onClose={() => setEditTxnId(null)}
        onChangeCategory={() => setPickerOpen(true)}
        onRemoveCategory={() => {
          if (editTxnId != null) clearTransactionCategory(editTxnId);
        }}
        onAccept={() => {
          if (editTxnId != null) acceptTransactionReview(editTxnId);
        }}
        onManageMoneyLent={() => setMoneyLentOpen(true)}
        onDelete={() => {
          if (editTxnId != null) deleteTransaction(editTxnId);
          setEditTxnId(null);
        }}
      />

      <AddToMoneyLentSheet
        visible={editTxn !== null && moneyLentOpen}
        txn={editTxn}
        loans={loanChoices}
        people={peopleList}
        currentLoanId={editTxn?.loanId ?? null}
        currentLoanName={openLoan ? `${openLoan.personName}${openLoan.name ? ` · ${openLoan.name}` : ''}` : undefined}
        currentPart={editTxn ? loanPartOf(editTxn.transferRole) : null}
        onAddPerson={(name) => addPerson(name)}
        onCreateLoan={(input) => createLoan(input)}
        onAttach={(loanId, part) => {
          if (editTxnId != null) attachTransactionToLoan(editTxnId, loanId, part);
          setMoneyLentOpen(false);
        }}
        onDetach={() => {
          if (editTxnId != null) detachTransactionFromLoan(editTxnId);
          setMoneyLentOpen(false);
          setEditTxnId(null);
        }}
        onClose={() => setMoneyLentOpen(false)}
      />

      <CategoryPicker
        visible={editTxn !== null && pickerOpen}
        categories={index.categories}
        title={editTxn ? (editTxn.counterpartyName ?? editTxn.rawDetails) : undefined}
        onClose={() => setPickerOpen(false)}
        onPick={(categoryId, subcategoryId) => {
          if (editTxnId != null) setTransactionCategory(editTxnId, categoryId, subcategoryId, { learn: true });
          setPickerOpen(false);
        }}
        onAddCategory={(name, emoji) => addCategory(name, emoji)}
        onAddSubcategory={(categoryId, name) => addSubcategory(categoryId, name)}
      />
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

/** Resolved "🍽️ Food & Dining · Restaurant" for a row, or null when uncategorized. */
function rowCategoryLabel(
  txn: TransactionRow,
  byId: Map<number, { name: string; emoji: string | null }>,
  subNames: Map<number, string>,
): string | null {
  if (txn.categoryId == null) return null;
  const cat = byId.get(txn.categoryId);
  if (!cat) return null;
  const sub = txn.subcategoryId != null ? subNames.get(txn.subcategoryId) : null;
  return `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}${sub ? ` · ${sub}` : ''}`;
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
});
