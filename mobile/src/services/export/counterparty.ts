/**
 * The "Details" column of an exported transaction.
 *
 * A spreadsheet row has no surrounding UI to explain it, so this column has to name the transaction
 * on its own. Imported rows carry a merchant or the original statement text; a lending row added
 * in-app carries neither (`addLoanTransaction` never writes `counterparty_name`, and `raw_details`
 * is `NOT NULL DEFAULT ''`, so it is blank rather than null). Those are named by the person and loan
 * behind them, via the same resolver the Activity list and the detail sheet use — the export then
 * reads the same as the app. A lending row with nothing left to resolve falls back to its role
 * ("Lent", "Repaid to me"), spelled out without the app's emoji, which belongs on screen and not in
 * a cell someone may sort, filter or pivot on.
 */

import { lendingRowLabel, type LendingRowSources } from '@/components/lending-row-label';
import { firstText } from '@/core/domain/text';
import { isTransferRole, ROLE_META } from '@/core/lending/roles';

export interface ExportCounterpartyTxn {
  counterpartyName: string | null;
  rawDetails: string;
  transferRole: string | null;
}

export function exportCounterparty(txn: ExportCounterpartyTxn, sources: LendingRowSources): string {
  const lending = lendingRowLabel(txn, sources);
  return (
    firstText(
      txn.counterpartyName,
      txn.rawDetails,
      lending ? [lending.title, lending.detail].filter(Boolean).join(' · ') : null,
      isTransferRole(txn.transferRole) ? ROLE_META[txn.transferRole].label : null,
    ) ?? ''
  );
}
