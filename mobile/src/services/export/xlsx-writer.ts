/**
 * Turns the pure {@link WorkbookModel} into `.xlsx` bytes using SheetJS (`xlsx`).
 *
 * We use SheetJS (already in the app for import) rather than ExcelJS: it runs on React Native
 * with no Node polyfills, and `XLSX.write(..., { type: 'array' })` returns an ArrayBuffer we can
 * write straight to a file. The community build doesn't do font/fill styling, but it does support
 * what we need here — multiple sheets, column widths, and per-cell number formats (the ₹ format
 * on money cells).
 */

import * as XLSX from 'xlsx';

import type { SheetModel, WorkbookModel } from '@/core/export';

/** Excel number format for rupee amounts (standard thousands grouping + 2 decimals). */
const MONEY_FMT = '"₹"#,##0.00';

/** Convert one sheet model to a SheetJS worksheet with widths and money number-formats applied. */
function toWorksheet(sheet: SheetModel): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    sheet.columns.map((c) => c.header),
    ...sheet.rows.map((row) => row.map((cell) => cell.value)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = sheet.columns.map((c) => ({ wch: c.width }));

  // Header is row 0; data rows start at row 1. Give money cells a numeric type + ₹ format.
  sheet.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.kind !== 'money') return;
      const ref = XLSX.utils.encode_cell({ r: r + 1, c });
      const wsCell = ws[ref];
      if (wsCell) {
        wsCell.t = 'n';
        wsCell.z = MONEY_FMT;
      }
    });
  });

  return ws;
}

/** Build the whole workbook and return it as raw `.xlsx` bytes. */
export function writeWorkbookBytes(model: WorkbookModel): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const sheet of model.sheets) {
    // Sheet names are capped at 31 chars by Excel; our names are short, but clamp defensively.
    XLSX.utils.book_append_sheet(wb, toWorksheet(sheet), sheet.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}
