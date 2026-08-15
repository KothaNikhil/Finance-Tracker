/**
 * Turn a SheetJS workbook into our simple `SheetLike[]` shape (headers + rows keyed by header).
 *
 * SheetJS (`xlsx`) works in both Node (for tests) and React Native. In the app we read the
 * picked file as base64 and call `XLSX.read(base64, { type: 'base64' })`; in tests we call
 * `XLSX.readFile(path)`. Either way we hand the resulting workbook to `workbookToSheets`.
 */

import * as XLSX from 'xlsx';
import type { RawRow, SheetLike } from './types';

/** Convert a parsed workbook into sheets, treating row 1 of each sheet as the header row. */
export function workbookToSheets(workbook: XLSX.WorkBook): SheetLike[] {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    // header:1 → array of rows; raw:false → formatted text; defval:'' → no missing cells.
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });

    const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
    const rows: RawRow[] = aoa.slice(1).map((cols, i) => {
      const cells: Record<string, string> = {};
      headers.forEach((h, idx) => {
        cells[h] = String((cols as unknown[])[idx] ?? '');
      });
      return { cells, rowNumber: i + 2 }; // +2: row 1 is the header, data starts at row 2
    });

    return { name, headers, rows };
  });
}

/** Parse a base64-encoded .xlsx into sheets. */
export function parseXlsxBase64(base64: string): SheetLike[] {
  return workbookToSheets(XLSX.read(base64, { type: 'base64' }));
}

/** Parse raw .xlsx bytes into sheets (used in the app after reading the picked file). */
export function parseXlsxBytes(bytes: Uint8Array): SheetLike[] {
  return workbookToSheets(XLSX.read(bytes, { type: 'array' }));
}
