/**
 * The ONE transaction detail sheet for the whole app, mounted at the root (see `app/_layout.tsx`).
 * Every screen opens a transaction through {@link useTransactionDetail}'s `openTxn(id)`; this
 * component resolves the row by id (live, so edits reflect immediately) and hosts the detail sheet
 * plus its category picker and "Add to Money Lent" flow — wiring that used to be copy-pasted on
 * Reports, Import and Lending.
 *
 * Any edit here records the transaction as "last edited" so the floating pill can reopen it from any
 * tab; a delete clears that instead (the row no longer exists).
 */

import { useMemo, useState } from 'react';

import { AddToMoneyLentSheet, type LoanChoice } from '@/components/add-to-money-lent-sheet';
import { CardBillSheet, cardStatementLabel } from '@/components/card-bill-sheet';
import { CategoryPicker } from '@/components/category-picker';
import { TransactionDetail } from '@/components/transaction-detail';
import type { ImportRow, TransactionRow } from '@/core/db/schema';
import { loanPartOf } from '@/core/lending/roles';
import { useLoans } from '@/hooks/use-lending';
import { useLiveQuery } from '@/hooks/use-live-query';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { getDb } from '@/services/db/database';
import {
  cardStatementByIdQuery,
  cardStatementItemsQuery,
  cardStatementsQuery,
  matchingCardStatementsQuery,
} from '@/services/db/queries/cards';
import { allocationsForTxnQuery } from '@/services/db/queries/lending';
import { txnByIdQuery } from '@/services/db/queries/transactions';
import {
  acceptTransactionReview,
  addCategory,
  addPerson,
  addSubcategory,
  attachTransactionToLoan,
  clearTransactionCategory,
  createLoan,
  deleteTransaction,
  detachTransactionFromLoan,
  linkTxnToCardStatement,
  recategorizeTransaction,
  setTransactionCategory,
  setTransactionNote,
  setTransactionRefund,
  setTransactionSelfTransfer,
  splitTransactionAcrossLoans,
  unlinkCardStatement,
} from '@/services/db/repository';

export function TransactionDetailController() {
  const { openId, openTxn, close, noteEdited, clearLastEdited } = useTransactionDetail();
  const db = getDb();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [moneyLentOpen, setMoneyLentOpen] = useState(false);
  const [cardBillOpen, setCardBillOpen] = useState(false);

  // Resolve the open transaction by id — live, so category/loan edits refresh the sheet in place.
  const { data } = useLiveQuery(txnByIdQuery(db, openId ?? -1), [openId]);
  const txn = (data?.[0] as TransactionRow | undefined) ?? null;

  // Split slices for this transaction (empty unless it's split across loans).
  const { data: allocData } = useLiveQuery(allocationsForTxnQuery(db, openId ?? -1), [openId]);
  const allocations = (allocData ?? []) as { loanId: number; paise: number }[];

  const index = useCategoryIndex();
  const lists = useLists();
  const { active: activeLoans, byId: loanById } = useLoans();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);
  // Only OPEN loans are pickable when attaching/splitting — a closed loan is done. (If the txn is
  // itself attached to a closed loan, its name still resolves via `loanById` for the header.)
  const loanChoices: LoanChoice[] = useMemo(
    () => activeLoans.map((l) => ({ id: l.id, name: l.name, personName: l.personName, kind: l.kind })),
    [activeLoans],
  );

  const loan = txn?.loanId != null ? loanById(txn.loanId) : null;
  const loanLabel = loan
    ? `${loan.personName}${loan.name ? ` · ${loan.name}` : ''}`
    : allocations.length > 0
      ? `Split across ${allocations.length} loans`
      : null;

  // --- Credit-card bill linking ---
  // All imported card statements (for manual picking), the statement this txn is linked to (if any),
  // that statement's card spends, and statements whose Total Payment Due matches this txn (suggested).
  const { data: cardStmtData } = useLiveQuery(cardStatementsQuery(db), []);
  const cardStatements = (cardStmtData ?? []) as ImportRow[];
  const linkedImportId = txn?.linkedImportId ?? null;
  const { data: linkedData } = useLiveQuery(cardStatementByIdQuery(db, linkedImportId ?? -1), [linkedImportId]);
  const linkedStatement = (linkedData?.[0] as ImportRow | undefined) ?? null;
  const { data: itemData } = useLiveQuery(cardStatementItemsQuery(db, linkedImportId ?? -1), [linkedImportId]);
  const cardItems = (itemData ?? []) as TransactionRow[];
  const { data: matchData } = useLiveQuery(matchingCardStatementsQuery(db, txn?.paise ?? -1), [txn?.paise ?? -1]);
  const matchingStatements = (matchData ?? []) as ImportRow[];
  const suggestedIds = matchingStatements.map((s) => s.id);

  // Show the section for an already-linked row, or a money-out row once any card statement exists.
  const cardBillEligible =
    txn != null && (linkedImportId != null || (txn.direction === 'out' && cardStatements.length > 0));
  const cardBillLabel = linkedStatement ? cardStatementLabel(linkedStatement) : null;
  const cardBillSuggestion = !linkedStatement && matchingStatements.length > 0 ? cardStatementLabel(matchingStatements[0]) : null;

  const closeAll = () => {
    close();
    setPickerOpen(false);
    setMoneyLentOpen(false);
    setCardBillOpen(false);
  };

  return (
    <>
      <TransactionDetail
        visible={txn !== null && !pickerOpen && !moneyLentOpen && !cardBillOpen}
        txn={txn}
        categoryLabel={txn ? categoryLabelFor(txn, index.byId, subNames) : null}
        paymentModeName={txn?.paymentModeId != null ? (pmNames.get(txn.paymentModeId) ?? null) : null}
        personName={txn?.personId != null ? (personNames.get(txn.personId) ?? null) : null}
        moneyLentLabel={loanLabel}
        cardBillLabel={cardBillLabel}
        cardSpendCount={cardItems.length}
        cardBillSuggestion={cardBillSuggestion}
        onManageCardBill={cardBillEligible ? () => setCardBillOpen(true) : undefined}
        onSaveNote={(note, recategorize) => {
          if (openId != null) {
            setTransactionNote(openId, note);
            if (recategorize) recategorizeTransaction(openId);
            noteEdited(openId);
          }
        }}
        onRecategorize={() => {
          if (openId != null) {
            recategorizeTransaction(openId);
            noteEdited(openId);
          }
        }}
        onSetRefund={(isRefund) => {
          if (openId != null) {
            setTransactionRefund(openId, isRefund);
            noteEdited(openId);
          }
        }}
        onSetSelfTransfer={(isSelf) => {
          if (openId != null) {
            setTransactionSelfTransfer(openId, isSelf);
            noteEdited(openId);
          }
        }}
        onClose={closeAll}
        onChangeCategory={() => setPickerOpen(true)}
        onRemoveCategory={() => {
          if (openId != null) {
            clearTransactionCategory(openId);
            noteEdited(openId);
          }
        }}
        onAccept={() => {
          if (openId != null) {
            acceptTransactionReview(openId);
            noteEdited(openId);
          }
        }}
        onManageMoneyLent={() => setMoneyLentOpen(true)}
        onDelete={() => {
          if (openId != null) {
            deleteTransaction(openId);
            clearLastEdited();
          }
        }}
      />

      <AddToMoneyLentSheet
        visible={txn !== null && moneyLentOpen}
        txn={txn}
        loans={loanChoices}
        people={lists.people}
        currentLoanId={txn?.loanId ?? null}
        currentLoanName={loanLabel ?? undefined}
        currentPart={txn ? loanPartOf(txn.transferRole) : null}
        currentAllocations={allocations}
        onAddPerson={(name) => addPerson(name)}
        onCreateLoan={(input) => createLoan(input)}
        onAttach={(loanId, part) => {
          if (openId != null) {
            attachTransactionToLoan(openId, loanId, part);
            noteEdited(openId);
          }
          setMoneyLentOpen(false);
        }}
        onSplit={(part, allocs) => {
          if (openId != null) {
            splitTransactionAcrossLoans(openId, part, allocs);
            noteEdited(openId);
          }
          setMoneyLentOpen(false);
        }}
        onDetach={() => {
          if (openId != null) {
            detachTransactionFromLoan(openId);
            noteEdited(openId);
          }
          setMoneyLentOpen(false);
        }}
        onClose={() => setMoneyLentOpen(false)}
      />

      <CardBillSheet
        visible={txn !== null && cardBillOpen}
        linkedStatement={linkedStatement}
        items={cardItems}
        statements={cardStatements}
        suggestedIds={suggestedIds}
        onLink={(importId) => {
          if (openId != null) {
            linkTxnToCardStatement(openId, importId);
            noteEdited(openId);
          }
          setCardBillOpen(false);
        }}
        onUnlink={() => {
          if (openId != null) {
            unlinkCardStatement(openId);
            noteEdited(openId);
          }
          setCardBillOpen(false);
        }}
        onPressSpend={(spendId) => {
          setCardBillOpen(false);
          openTxn(spendId); // jump the app-wide sheet to the selected card spend
        }}
        onClose={() => setCardBillOpen(false)}
      />

      <CategoryPicker
        visible={txn !== null && pickerOpen}
        categories={index.categories}
        title={txn ? (txn.counterpartyName ?? txn.rawDetails) : undefined}
        onClose={() => setPickerOpen(false)}
        onPick={(categoryId, subcategoryId) => {
          if (openId != null) {
            setTransactionCategory(openId, categoryId, subcategoryId, { learn: true });
            noteEdited(openId);
          }
          setPickerOpen(false);
        }}
        onAddCategory={(name, emoji) => addCategory(name, emoji)}
        onAddSubcategory={(categoryId, name) => addSubcategory(categoryId, name)}
      />
    </>
  );
}

/** Resolved "🍽️ Food & Dining · Restaurant" for a row, or null when uncategorized. */
function categoryLabelFor(
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
