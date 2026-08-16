/**
 * Export orchestration (Step 7): read the stored transactions, resolve their reference names,
 * build the yearly workbook model, write it to a temporary `.xlsx`, and hand it to the OS share
 * sheet so the user can save it to Drive / Files / email.
 *
 * The interesting logic (sheet layout, totals) lives in the pure `core/export`; this file is the
 * React-Native adapter that touches the database, the filesystem, and sharing.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { buildYearlyWorkbook, type ExportTxn } from '@/core/export';
import type { Direction } from '@/core/domain/money';
import { getAllTransactions, getCategoryIndex, getLists } from '@/services/db/repository';
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

export interface ExportResult {
  uri: string;
  /** True if the OS share sheet was shown; false if sharing isn't available on this device. */
  shared: boolean;
  fileName: string;
}

/**
 * Build and share the Excel workbook for one calendar year. Returns the file URI (kept in the
 * cache directory) so the caller can tell the user where it went if sharing isn't available.
 */
export async function exportYearToExcel(year: number): Promise<ExportResult> {
  const model = buildYearlyWorkbook(loadExportTxns(), year);
  const bytes = writeWorkbookBytes(model);

  const file = new File(Paths.cache, model.fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, {
      mimeType: XLSX_MIME,
      dialogTitle: `Finance Tracker ${year}`,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }
  return { uri: file.uri, shared: canShare, fileName: model.fileName };
}
