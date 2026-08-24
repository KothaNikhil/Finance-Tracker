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
import { CategoryPicker } from '@/components/category-picker';
import { TransactionDetail } from '@/components/transaction-detail';
import type { TransactionRow } from '@/core/db/schema';
import { loanPartOf } from '@/core/lending/roles';
import { useLoans } from '@/hooks/use-lending';
import { useLiveQuery } from '@/hooks/use-live-query';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { getDb } from '@/services/db/database';
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
  setTransactionCategory,
  splitTransactionAcrossLoans,
} from '@/services/db/repository';

export function TransactionDetailController() {
  const { openId, close, noteEdited, clearLastEdited } = useTransactionDetail();
  const db = getDb();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [moneyLentOpen, setMoneyLentOpen] = useState(false);

  // Resolve the open transaction by id — live, so category/loan edits refresh the sheet in place.
  const { data } = useLiveQuery(txnByIdQuery(db, openId ?? -1), [openId]);
  const txn = (data?.[0] as TransactionRow | undefined) ?? null;

  // Split slices for this transaction (empty unless it's split across loans).
  const { data: allocData } = useLiveQuery(allocationsForTxnQuery(db, openId ?? -1), [openId]);
  const allocations = (allocData ?? []) as { loanId: number; paise: number }[];

  const index = useCategoryIndex();
  const lists = useLists();
  const { active: activeLoans, closed: closedLoans, byId: loanById } = useLoans();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);
  const loanChoices: LoanChoice[] = useMemo(
    () => [...activeLoans, ...closedLoans].map((l) => ({ id: l.id, name: l.name, personName: l.personName, kind: l.kind })),
    [activeLoans, closedLoans],
  );

  const loan = txn?.loanId != null ? loanById(txn.loanId) : null;
  const loanLabel = loan
    ? `${loan.personName}${loan.name ? ` · ${loan.name}` : ''}`
    : allocations.length > 0
      ? `Split across ${allocations.length} loans`
      : null;

  const closeAll = () => {
    close();
    setPickerOpen(false);
    setMoneyLentOpen(false);
  };

  return (
    <>
      <TransactionDetail
        visible={txn !== null && !pickerOpen && !moneyLentOpen}
        txn={txn}
        categoryLabel={txn ? categoryLabelFor(txn, index.byId, subNames) : null}
        paymentModeName={txn?.paymentModeId != null ? (pmNames.get(txn.paymentModeId) ?? null) : null}
        personName={txn?.personId != null ? (personNames.get(txn.personId) ?? null) : null}
        moneyLentLabel={loanLabel}
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
