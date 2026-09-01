/**
 * The registry of statement formats the importer supports — the single source of truth for both
 * the adapter dispatch order (used by {@link ./pipeline}'s `runImport`) AND the user-facing
 * "Supported statements" legend on the Import screen.
 *
 * Detection stays fully automatic: the user picks any file and the pipeline tries each adapter's
 * `detect()` in this order. The legend just tells them, up front, which banks/sources and file
 * types work — nothing here is tappable or format-picking.
 *
 * Adding a new source = add its adapter here (with display metadata) in the right dispatch order.
 */

import { axisAdapter } from './adapters/axis';
import { axisCcAdapter } from './adapters/axis-cc';
import { kvbAdapter } from './adapters/kvb';
import { paytmAdapter } from './adapters/paytm';
import { sbiAdapter } from './adapters/sbi';
import type { SourceAdapter } from './types';

/** Display metadata for one supported statement format, paired with its parsing adapter. */
export interface ImportFormat {
  /** Stable id (for React keys / analytics). */
  id: string;
  /** The parser used by the pipeline. */
  adapter: SourceAdapter;
  /** User-facing name of the bank / money source. */
  name: string;
  /** A small icon: 💳 for UPI/card sources, 🏦 for bank accounts. */
  icon: string;
  /** File type(s) the export comes in, shown as a badge (e.g. ".xlsx", ".xls · .xlsx", ".pdf"). */
  fileTypes: string;
  /** True when this format is ALWAYS password-protected (shows a 🔒 badge). */
  locked?: boolean;
}

/**
 * Supported formats, in adapter-dispatch order (the order `detect()` is tried). This order is also
 * the order shown in the legend.
 */
export const IMPORT_FORMATS: readonly ImportFormat[] = [
  { id: 'paytm', adapter: paytmAdapter, name: 'Paytm UPI', icon: '💳', fileTypes: '.xlsx' },
  { id: 'axis', adapter: axisAdapter, name: 'Axis Bank', icon: '🏦', fileTypes: '.xls · .xlsx' },
  { id: 'kvb', adapter: kvbAdapter, name: 'Karur Vysya Bank', icon: '🏦', fileTypes: '.xlsx' },
  { id: 'sbi', adapter: sbiAdapter, name: 'State Bank of India', icon: '🏦', fileTypes: '.xlsx' },
  { id: 'axis-cc', adapter: axisCcAdapter, name: 'Axis Credit Card', icon: '💳', fileTypes: '.pdf', locked: true },
];

/** The adapters in dispatch order — pass straight to `runImport`. */
export const IMPORT_ADAPTERS: readonly SourceAdapter[] = IMPORT_FORMATS.map((f) => f.adapter);
