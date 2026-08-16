/**
 * Export orchestration (Step 7): read the stored transactions, resolve their reference names,
 * build the yearly workbook model, write it to a temporary `.xlsx`, and hand it to the OS share
 * sheet so the user can save it to Drive / Files / email.
 *
 * The interesting logic (sheet layout, totals) lives in the pure `core/export`; this file is the
 * React-Native adapter that touches the database, the filesystem, and sharing.
 */

import { buildYearlyWorkbook, type ExportTxn } from '@/core/export';
import type { Direction } from '@/core/domain/money';
import { getAllTransactions, getCategoryIndex, getLists } from '@/services/db/repository';
import { saveBytesToFolder, shareBytes } from '@/services/file-io';
import { writeWorkbookBytes } from './xlsx-writer';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Map the stored rows into export rows with all reference ids resolved to display names. */
function loadExportTxns(): ExportTxn[] {
  const rows = getAllTransactions();
  const index = getCategoryIndex();
  const lists = getLists();

  const subNames = new Map<number, string>();
  index.categories.forEach((c) => c.subcategories.forEach((s) => subNames.set(s.id, s.name)));
  const pmNames = new Map(lists.paymentModes.map((p) => [p.id, p.name]));
  const personNames = new Map(lists.people.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
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

/** Build the workbook bytes for one year. */
function buildYearBytes(year: number): { bytes: Uint8Array; fileName: string } {
  const model = buildYearlyWorkbook(loadExportTxns(), year);
  return { bytes: writeWorkbookBytes(model), fileName: model.fileName };
}

export interface SaveResult {
  /** False when the user cancelled the folder picker. */
  saved: boolean;
  fileName: string;
}

/**
 * Save the workbook directly to a folder the user picks (Android Storage Access Framework /
 * iOS Files). This is the "download / save to Files" path — the file lands wherever the user
 * chooses (Downloads, Documents, a Drive folder, …), outside the app sandbox.
 *
 * Returns `saved: false` if the user backs out of the folder picker. A genuine write failure
 * throws so the caller can surface it.
 */
export async function saveYearToFolder(year: number): Promise<SaveResult> {
  const { bytes, fileName } = buildYearBytes(year);
  const saved = await saveBytesToFolder(bytes, fileName, XLSX_MIME);
  return { saved, fileName };
}

export interface ShareResult {
  uri: string;
  /** True if the OS share sheet was shown; false if sharing isn't available on this device. */
  shared: boolean;
  fileName: string;
}

/**
 * Write the workbook to the (temporary) cache directory and hand it to the OS share sheet, for
 * sending to Drive / email / etc. On iOS the share sheet also offers "Save to Files".
 */
export async function shareYearToExcel(year: number): Promise<ShareResult> {
  const { bytes, fileName } = buildYearBytes(year);
  const { shared, uri } = await shareBytes(
    bytes,
    fileName,
    XLSX_MIME,
    `Finance Tracker ${year}`,
    'org.openxmlformats.spreadsheetml.sheet',
  );
  return { uri, shared, fileName };
}
