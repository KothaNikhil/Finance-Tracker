import { countablePaise } from '@finance-tracker/core/analytics/analytics';
import type { TxnFilter } from '@finance-tracker/core/analytics/filter';
import { loanAllocations, loans, type TransactionRow } from '@finance-tracker/core/db/schema';
import { getCategoryIndex, getLists } from '@finance-tracker/core/db/repository';
import { selectFilteredTxns } from '@finance-tracker/core/db/queries/transactions';
import { isTransferRole, ROLE_META, type LoanPart } from '@finance-tracker/core/lending/roles';
import { buildFilteredWorkbook } from '@finance-tracker/core/export/build-workbook';
import type { ExportTxn, SheetModel, WorkbookModel } from '@finance-tracker/core/export/types';
import { getDb } from '@finance-tracker/core/db/runtime';
import * as XLSX from 'xlsx';

const MONEY_FORMAT = '"₹"#,##0.00';

function safeName(name: string): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'Finance-Tracker';
  return clean.toLowerCase().endsWith('.xlsx') ? clean : `${clean}.xlsx`;
}

function worksheet(sheet: SheetModel): XLSX.WorkSheet {
  const values: (string | number)[][] = [
    sheet.columns.map((column) => column.header),
    ...sheet.rows.map((row) => row.map((cell) => cell.value)),
  ];
  const result = XLSX.utils.aoa_to_sheet(values);
  result['!cols'] = sheet.columns.map((column) => ({ wch: column.width }));
  sheet.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (cell.kind !== 'money') return;
    const ref = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
    if (result[ref]) {
      result[ref].t = 'n';
      result[ref].z = MONEY_FORMAT;
    }
  }));
  return result;
}

function workbookBytes(model: WorkbookModel): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of model.sheets) {
    XLSX.utils.book_append_sheet(workbook, worksheet(sheet), sheet.name.slice(0, 31));
  }
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export function buildExportBytes(filter: TxnFilter = {}, name = 'Finance-Tracker'): { bytes: Uint8Array; fileName: string } {
  const db = getDb();
  const index = getCategoryIndex();
  const lists = getLists();
  const personNames = new Map(lists.people.map((person) => [person.id, person.name]));
  const paymentModeNames = new Map(lists.paymentModes.map((mode) => [mode.id, mode.name]));
  const subcategoryNames = new Map<number, string>();
  for (const category of index.categories) {
    for (const subcategory of category.subcategories) subcategoryNames.set(subcategory.id, subcategory.name);
  }
  const loanRefs = new Map(db.select({ id: loans.id, name: loans.name, personId: loans.personId }).from(loans).all().map((loan) => [
    loan.id,
    { name: loan.name, personName: personNames.get(loan.personId) ?? '' },
  ]));
  const allocationsByTxn = new Map<number, { part: LoanPart | null; paise: number }[]>();
  const splitLoanLabels = new Map<number, string[]>();
  for (const item of db.select().from(loanAllocations).all()) {
    const part: LoanPart | null = item.part === 'principal' || item.part === 'repayment' || item.part === 'interest'
      ? item.part
      : null;
    const slices = allocationsByTxn.get(item.txnId) ?? [];
    slices.push({ part, paise: item.paise });
    allocationsByTxn.set(item.txnId, slices);
    const loan = loanRefs.get(item.loanId);
    if (loan) {
      const labels = splitLoanLabels.get(item.txnId) ?? [];
      const label = [loan.personName, loan.name].filter(Boolean).join(' · ');
      if (label && !labels.includes(label)) labels.push(label);
      splitLoanLabels.set(item.txnId, labels);
    }
  }

  const rows: ExportTxn[] = selectFilteredTxns(db, filter).map((row: TransactionRow) => {
    const transferRole = isTransferRole(row.transferRole) ? row.transferRole : null;
    const person = row.personId == null ? '' : personNames.get(row.personId) ?? '';
    const loan = row.loanId == null ? null : loanRefs.get(row.loanId);
    const display = row.counterpartyName
      || row.rawDetails
      || [person, loan?.name].filter(Boolean).join(' · ')
      || (splitLoanLabels.get(row.id) ?? []).join(' · ')
      || (transferRole ? ROLE_META[transferRole].label : '');
    return {
      isoDate: row.isoDate,
      time: row.time ?? '',
      paise: row.paise,
      countablePaise: countablePaise({
        isoDate: row.isoDate,
        paise: row.paise,
        direction: row.direction as 'in' | 'out' | 'self',
        isRefund: row.isRefund,
        categoryId: row.categoryId,
        subcategoryId: row.subcategoryId,
        counterpartyName: row.counterpartyName,
        counterpartyVpa: row.counterpartyVpa,
        accountName: row.accountName,
        personId: row.personId,
        transferRole,
        loanAllocations: allocationsByTxn.get(row.id),
      }),
      direction: row.direction as 'in' | 'out' | 'self',
      isRefund: row.isRefund,
      counterparty: display,
      categoryName: row.categoryId == null ? '' : index.byId.get(row.categoryId)?.name ?? '',
      subcategoryName: row.subcategoryId == null ? '' : subcategoryNames.get(row.subcategoryId) ?? '',
      paymentMode: row.paymentModeId == null ? '' : paymentModeNames.get(row.paymentModeId) ?? '',
      person,
      account: row.accountName ?? '',
      remarks: [row.note?.trim(), row.remarks?.trim()].filter(Boolean).join(' · '),
      ref: row.sourceRef ?? '',
    };
  });
  const fileName = safeName(name);
  return { bytes: workbookBytes(buildFilteredWorkbook(rows, fileName)), fileName };
}

export function downloadExport(filter: TxnFilter = {}, name = 'Finance-Tracker'): string {
  const { bytes, fileName } = buildExportBytes(filter, name);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
