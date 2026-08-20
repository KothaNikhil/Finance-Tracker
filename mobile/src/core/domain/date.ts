/**
 * Date/time helpers for parsing Paytm statement cells.
 *
 * Paytm stores dates as text in Indian style `DD/MM/YYYY` and times as `HH:MM:SS`.
 * We must NEVER use the native `Date` string parser here: it assumes US `MM/DD` or ISO and
 * would silently mis-read Indian dates and shift days across time zones. We parse the text
 * ourselves and keep dates as a plain `YYYY-MM-DD` string (date-only, no time zone).
 *
 * Pure TypeScript (no React Native imports) — unit-testable in Node, reusable on web.
 */

export interface ParsedDateTime {
  /** Date-only string, `YYYY-MM-DD`. */
  isoDate: string;
  /** Normalized `HH:MM:SS`, or null when no time was given. */
  time: string | null;
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const HMS = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Parse a Paytm `DD/MM/YYYY` date (and optional `HH:MM:SS` time) into ISO parts. */
export function parsePaytmDate(dateStr: string, timeStr?: string | null): ParsedDateTime {
  const m = DMY.exec(String(dateStr).trim());
  if (!m) throw new Error(`Invalid date (expected DD/MM/YYYY): "${dateStr}"`);

  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);

  if (month < 1 || month > 12) throw new Error(`Invalid month in date: "${dateStr}"`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid day in date: "${dateStr}"`);
  }

  return { isoDate: `${pad4(year)}-${pad2(month)}-${pad2(day)}`, time: normalizeTime(timeStr) };
}

// Axis: "19-02-2026" (DD-MM-YYYY). KVB: "01-MAR-2026 16:36:46" (DD-MMM-YYYY, optional time).
const DMY_DASH = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const D_MON_Y = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?$/;
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function buildDate(day: number, month: number, year: number, label: string): string {
  if (month < 1 || month > 12) throw new Error(`Invalid month in date: "${label}"`);
  if (day < 1 || day > daysInMonth(year, month)) throw new Error(`Invalid day in date: "${label}"`);
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Parse a bank `DD-MM-YYYY` date (e.g. Axis) into a `YYYY-MM-DD` ISO string. */
export function parseDashDate(dateStr: string): string {
  const s = String(dateStr).trim();
  const m = DMY_DASH.exec(s);
  if (!m) throw new Error(`Invalid date (expected DD-MM-YYYY): "${dateStr}"`);
  return buildDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), s);
}

/** Parse a `DD-MMM-YYYY` date with an optional trailing `HH:MM[:SS]` time (e.g. KVB). */
export function parseTextMonthDateTime(dateStr: string): ParsedDateTime {
  const s = String(dateStr).trim();
  const m = D_MON_Y.exec(s);
  if (!m) throw new Error(`Invalid date (expected DD-MMM-YYYY): "${dateStr}"`);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) throw new Error(`Invalid month name in date: "${dateStr}"`);
  return { isoDate: buildDate(parseInt(m[1], 10), month, parseInt(m[3], 10), s), time: normalizeTime(m[4] ?? null) };
}

/** Normalize a `HH:MM[:SS]` time string; returns null for empty/missing input. */
export function normalizeTime(timeStr?: string | null): string | null {
  if (timeStr == null) return null;
  const t = String(timeStr).trim();
  if (t === '') return null;

  const m = HMS.exec(t);
  if (!m) throw new Error(`Invalid time (expected HH:MM:SS): "${timeStr}"`);
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  if (h > 23 || min > 59 || s > 59) throw new Error(`Invalid time value: "${timeStr}"`);

  return `${pad2(h)}:${pad2(min)}:${pad2(s)}`;
}

/** Number of days in a given 1-based month, correct for leap years. */
export function daysInMonth(year: number, month1Based: number): number {
  // Day 0 of the next month rolls back to the last day of the wanted month (UTC = no TZ shift).
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
function pad4(n: number): string {
  return n.toString().padStart(4, '0');
}
