/**
 * Export orchestration (Step 7): read the stored transactions, resolve their reference names,
 * build the yearly workbook model, write it to a temporary `.xlsx`, and hand it to the OS share
 * sheet so the user can save it to Drive / Files / email.
 *
 * The interesting logic (sheet layout, totals) lives in the pure `core/export`; this file is the
 * React-Native adapter that touches the database, the filesystem, and sharing.
 */

import type { LendingLoanRef } from '@/components/lending-row-label';
import { countablePaise, type TxnFilter } from '@/core/analytics';
import { loanAllocations, loans } from '@/core/db/schema';
import type { Direction } from '@/core/domain/money';
import { buildFilteredWorkbook, type ExportTxn } from '@/core/export';
import { isTransferRole, type LoanPart } from '@/core/lending/roles';
import { getDb } from '@/services/db/database';
import { selectFilteredTxns } from '@/services/db/queries/transactions';
import { getCategoryIndex, getLists } from '@/services/db/repository';
import { saveBytesToFolder, shareBytes } from '@/services/file-io';
import { exportCounterparty } from './counterparty';
import { writeWorkbookBytes } from './xlsx-writer';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

/** Ensure a user-entered name is a safe `.xlsx` file name. */
function normalizeXlsxName(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'Finance-Tracker';
  return trimmed.toLowerCase().endsWith('.xlsx') ? trimmed : `${trimmed}.xlsx`;
}

/**
 * Load the stored rows that match the filter and map them to export rows with reference ids
 * resolved to display names. Filtering runs SERVER-SIDE via {@link selectFilteredTxns} using the
 * SAME `buildTxnConditions` the Reports list uses — so "what you see is what you export", and we
 * never load the whole table just to filter it in JS.
 */
function loadExportTxns(filter: TxnFilter): ExportTxn[] {
  const index = getCategoryIndex();
  const lists = getLists();
  const db = getDb();

  const subNames = new Map<number, string>();
  index.categories.forEach((c) => c.subcategories.forEach((s) => subNames.set(s.id, s.name)));
  const pmNames = new Map(lists.paymentModes.map((p) => [p.id, p.name]));
  const personNames = new Map(lists.people.map((p) => [p.id, p.name]));
  // Loans, so a lending row that has no merchant of its own can still be named in the Details
  // column by the person and loan it belongs to.
  const loanRefs = new Map<number, LendingLoanRef>();
  for (const loan of db
    .select({ id: loans.id, name: loans.name, personId: loans.personId })
    .from(loans)
    .all()) {
    loanRefs.set(loan.id, { id: loan.id, name: loan.name, personName: personNames.get(loan.personId) ?? '' });
  }

  const allocationsByTxn = new Map<number, { part: LoanPart | null; paise: number }[]>();
  const splitLoansByTxn = new Map<number, LendingLoanRef[]>();
  for (const allocation of db
    .select({
      txnId: loanAllocations.txnId,
      loanId: loanAllocations.loanId,
      part: loanAllocations.part,
      paise: loanAllocations.paise,
    })
    .from(loanAllocations)
    .all()) {
    const part: LoanPart | null =
      allocation.part === 'principal' ||
      allocation.part === 'repayment' ||
      allocation.part === 'interest'
        ? allocation.part
        : null;
    const slices = allocationsByTxn.get(allocation.txnId) ?? [];
    slices.push({ part, paise: allocation.paise });
    allocationsByTxn.set(allocation.txnId, slices);

    const ref = loanRefs.get(allocation.loanId);
    if (ref) {
      const refs = splitLoansByTxn.get(allocation.txnId) ?? [];
      // Two slices on one loan (part repayment, part interest) are still one loan.
      if (!refs.some((existing) => existing.id === ref.id)) refs.push(ref);
      splitLoansByTxn.set(allocation.txnId, refs);
    }
  }

  return selectFilteredTxns(db, filter)
    .map((r) => ({
      isoDate: r.isoDate,
      time: r.time ?? '',
      paise: r.paise,
      countablePaise: countablePaise({
        isoDate: r.isoDate,
        paise: r.paise,
        direction: r.direction as Direction,
        isRefund: r.isRefund,
        categoryId: r.categoryId,
        subcategoryId: r.subcategoryId,
        counterpartyName: r.counterpartyName,
        counterpartyVpa: r.counterpartyVpa,
        accountName: r.accountName,
        personId: r.personId,
        transferRole: isTransferRole(r.transferRole) ? r.transferRole : null,
        loanAllocations: allocationsByTxn.get(r.id),
      }),
      direction: r.direction as Direction,
      isRefund: r.isRefund,
      counterparty: exportCounterparty(r, {
        personName: r.personId != null ? (personNames.get(r.personId) ?? null) : null,
        loan: r.loanId != null ? (loanRefs.get(r.loanId) ?? null) : null,
        splitLoans: splitLoansByTxn.get(r.id) ?? [],
      }),
      categoryName: r.categoryId != null ? (index.byId.get(r.categoryId)?.name ?? '') : '',
      subcategoryName: r.subcategoryId != null ? (subNames.get(r.subcategoryId) ?? '') : '',
      paymentMode: r.paymentModeId != null ? (pmNames.get(r.paymentModeId) ?? '') : '',
      person: r.personId != null ? (personNames.get(r.personId) ?? '') : '',
      account: r.accountName ?? '',
      remarks: [r.note?.trim(), r.remarks?.trim()].filter(Boolean).join(' · '),
      ref: r.sourceRef ?? '',
    }));
}

/** Build the workbook bytes for the filtered set under the given (user-chosen) file name. */
function buildFilteredBytes(filter: TxnFilter, fileName: string): { bytes: Uint8Array; fileName: string } {
  const safeName = normalizeXlsxName(fileName);
  const model = buildFilteredWorkbook(loadExportTxns(filter), safeName);
  return { bytes: writeWorkbookBytes(model), fileName: safeName };
}

export interface SaveResult {
  /** False when the user cancelled the folder picker. */
  saved: boolean;
  fileName: string;
}

/**
 * Save the filtered workbook directly to a folder the user picks (Android Storage Access Framework /
 * iOS Files) — the "download / save to Files" path. The file lands wherever the user chooses,
 * outside the app sandbox. Returns `saved: false` if the user backs out; a real write error throws.
 */
export async function saveFilteredToFolder(filter: TxnFilter, fileName: string): Promise<SaveResult> {
  const { bytes, fileName: name } = buildFilteredBytes(filter, fileName);
  const saved = await saveBytesToFolder(bytes, name, XLSX_MIME);
  return { saved, fileName: name };
}

export interface ShareResult {
  uri: string;
  /** True if the OS share sheet was shown; false if sharing isn't available on this device. */
  shared: boolean;
  fileName: string;
}

/**
 * Write the filtered workbook to the cache directory and hand it to the OS share sheet (Drive /
 * email / etc.). On iOS the share sheet also offers "Save to Files".
 */
export async function shareFilteredToExcel(filter: TxnFilter, fileName: string): Promise<ShareResult> {
  const { bytes, fileName: name } = buildFilteredBytes(filter, fileName);
  const { shared, uri } = await shareBytes(bytes, name, XLSX_MIME, 'Finance Tracker export', XLSX_UTI);
  return { uri, shared, fileName: name };
}
