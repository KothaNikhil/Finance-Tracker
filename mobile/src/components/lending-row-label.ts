/**
 * Builds the identifying text for a lending transaction row.
 *
 * A lending entry added in-app carries no merchant or description — `addLoanTransaction` never sets
 * `counterparty_name`, and `raw_details` defaults to `''` — so the row has nothing of its own to
 * show. What it does carry is the person, the loan it is attached to (or the loans it is split
 * across) and its transfer role. This turns those into a title plus an optional detail, and returns
 * null when none of them resolve so the caller can fall back.
 */

import { firstText } from '@/core/domain/text';
import { isTransferRole } from '@/core/lending/roles';

export interface LendingLoanRef {
  id: number;
  name: string;
  personName: string;
}

export interface LendingRowSources {
  /** The person on the transaction, when one is set. */
  personName: string | null;
  /** The loan this row is directly attached to (`transactions.loan_id`). */
  loan: LendingLoanRef | null;
  /**
   * The loans this row is split across; empty unless it has allocation slices. Deduplicated here
   * as well as by callers, since a slice count is not a loan count.
   */
  splitLoans: LendingLoanRef[];
}

export interface LendingRowLabel {
  title: string;
  detail: string | null;
}

export function lendingRowLabel(
  txn: { transferRole: string | null },
  sources: LendingRowSources,
): LendingRowLabel | null {
  if (!isTransferRole(txn.transferRole)) return null;

  const splitLoans = [...new Map(sources.splitLoans.map((loan) => [loan.id, loan])).values()];
  // One loan is nameable even when the payment was sliced into it more than once; only a genuine
  // spread over several loans has to be summarised as one.
  const loanName = firstText(sources.loan?.name, splitLoans.length === 1 ? splitLoans[0].name : null);
  const splitSummary = splitLoans.length > 1 ? `Split across ${splitLoans.length} loans` : null;
  // A split whose slices all belong to one person still identifies that person, even though the
  // repository leaves `person_id` null once more than one person is involved.
  const splitPeople = [...new Set(splitLoans.map((loan) => firstText(loan.personName) ?? ''))].filter(Boolean);
  const splitPerson = splitPeople.length === 1 ? splitPeople[0] : null;

  const title = firstText(sources.personName) ?? splitPerson ?? loanName ?? splitSummary;
  if (!title) return null;

  const detail = [loanName, splitSummary].filter((part) => part && part !== title).join(' · ');
  return { title, detail: detail || null };
}
