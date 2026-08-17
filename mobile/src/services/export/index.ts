/**
 * Export orchestration (Step 7): read the stored transactions, resolve their reference names,
 * build the yearly workbook model, write it to a temporary `.xlsx`, and hand it to the OS share
 * sheet so the user can save it to Drive / Files / email.
 *
 * The interesting logic (sheet layout, totals) lives in the pure `core/export`; this file is the
 * React-Native adapter that touches the database, the filesystem, and sharing.
 */

import { buildFilteredWorkbook, type ExportTxn } from '@/core/export';
import { matchesFilter, type TxnFilter } from '@/core/analytics';
import type { Direction } from '@/core/domain/money';
import { getAllTransactions, getCategoryIndex, getLists } from '@/services/db/repository';
import { saveBytesToFolder, shareBytes } from '@/services/file-io';
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
 * resolved to display names. Filtering happens on the RAW rows (which still have the ids) so the
 * same {@link TxnFilter} that drives the Reports view drives the export.
 */
function loadExportTxns(filter: TxnFilter): ExportTxn[] {
  const index = getCategoryIndex();
  const lists = getLists();

  const subNames = new Map<number, string>();
  index.categories.forEach((c) => c.subcategories.forEach((s) => subNames.set(s.id, s.name)));
  const pmNames = new Map(lists.paymentModes.map((p) => [p.id, p.name]));
  const personNames = new Map(lists.people.map((p) => [p.id, p.name]));

  return getAllTransactions()
    .filter((r) =>
      matchesFilter(
        {
          isoDate: r.isoDate,
          direction: r.direction as Direction,
          categoryId: r.categoryId,
          subcategoryId: r.subcategoryId,
          accountName: r.accountName,
          personId: r.personId,
        },
        filter,
      ),
    )
    .map((r) => ({
      isoDate: r.isoDate,
      time: r.time ?? '',
      paise: r.paise,
      direction: r.direction as Direction,
      isRefund: r.isRefund,
      counterparty: r.counterpartyName ?? r.rawDetails ?? '',
      categoryName: r.categoryId != null ? (index.byId.get(r.categoryId)?.name ?? '') : '',
      subcategoryName: r.subcategoryId != null ? (subNames.get(r.subcategoryId) ?? '') : '',
      paymentMode: r.paymentModeId != null ? (pmNames.get(r.paymentModeId) ?? '') : '',
      person: r.personId != null ? (personNames.get(r.personId) ?? '') : '',
      account: r.accountName ?? '',
      remarks: r.remarks ?? '',
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
