/**
 * Minimal, dependency-light PDF **text extractor**, scoped to the simple statement PDFs this app
 * imports (classic xref, single page, FlateDecode content, Type3 fonts each with a `ToUnicode` CMap).
 * It is NOT a general PDF engine — it deliberately handles only what these bank / credit-card
 * statements use, so it stays small and testable in Node + React Native (pure JS: `fflate` for
 * inflate, {@link ./decrypt-pdf} for AES-256 streams).
 *
 * Pipeline: raw bytes → object table (regex scan) → resolve the page's content + fonts → decrypt
 * (if a file key is supplied) + inflate each stream → parse each font's ToUnicode CMap → walk the
 * content stream's text operators with a CTM / text-matrix stack → **positioned text spans**, grouped
 * into visual lines. {@link parsePdfToSheets} then packs those lines into the pipeline's `SheetLike`
 * shape so a source adapter consumes them exactly like an xlsx sheet.
 */

import { unzlibSync, inflateSync } from 'fflate';

import type { PdfPositionedLine, RawRow, SheetLike } from '../types';
import { decryptPdfData } from './decrypt-pdf';

/** Text spans sharing a baseline, left-to-right (re-exported alias of the shared type). */
export type PositionedLine = PdfPositionedLine;

// ---- affine matrix (row-vector convention: p' = p · M) ------------------------------------------

/** A 2-D affine transform `[a b c d e f]` (PDF matrix). */
interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m1` followed by `m2` (transform a point by m1, then m2). */
function mul(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

// ---- object table --------------------------------------------------------------------------------

interface PdfObject {
  dict: string; // text between `obj` and `stream`/`endobj` (dictionary + any inline content)
  streamStart: number; // byte offset of stream data, or -1
  streamEnd: number; // byte offset of `endstream`, or -1
}

interface PdfDoc {
  bytes: Uint8Array;
  latin1: string;
  objects: Map<number, PdfObject>;
  fileKey?: Uint8Array;
}

function toLatin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  }
  return s;
}

/** Scan the file for `N G obj … (stream …) … endobj` and index by object number. */
function parseObjects(bytes: Uint8Array, latin1: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin1)) !== null) {
    const num = parseInt(m[1], 10);
    const bodyStart = m.index + m[0].length;
    const endobj = latin1.indexOf('endobj', bodyStart);
    const streamKw = latin1.indexOf('stream', bodyStart);

    let dictEnd = endobj === -1 ? latin1.length : endobj;
    let streamStart = -1;
    let streamEnd = -1;
    if (streamKw !== -1 && (endobj === -1 || streamKw < endobj)) {
      dictEnd = streamKw;
      let s = streamKw + 6;
      if (bytes[s] === 0x0d) s++;
      if (bytes[s] === 0x0a) s++;
      const end = latin1.indexOf('endstream', s);
      if (end !== -1) {
        streamStart = s;
        // trailing EOL before `endstream` is not part of the data
        let e = end;
        if (bytes[e - 1] === 0x0a) e--;
        if (bytes[e - 1] === 0x0d) e--;
        streamEnd = e;
      }
    }
    // Keep the LAST definition of an object number (updates via incremental xref win).
    objects.set(num, { dict: latin1.slice(bodyStart, dictEnd), streamStart, streamEnd });
  }
  return objects;
}

/** Resolve `N 0 R` → object number, or null. */
function refNum(text: string): number | null {
  const m = /(\d+)\s+\d+\s+R/.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

/** Decoded (decrypted + inflated) bytes of an object's stream, or null when it has none. */
function streamBytes(doc: PdfDoc, obj: PdfObject): Uint8Array | null {
  if (obj.streamStart < 0) return null;
  let data = doc.bytes.subarray(obj.streamStart, obj.streamEnd);
  if (doc.fileKey) data = decryptPdfData(doc.fileKey, data);
  if (/\/FlateDecode/.test(obj.dict)) {
    try {
      return unzlibSync(data);
    } catch {
      try {
        return inflateSync(data);
      } catch {
        return data;
      }
    }
  }
  return data;
}

// ---- ToUnicode CMap ------------------------------------------------------------------------------

function hexToCodepoints(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  // UTF-16BE code units, 4 hex chars each.
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.substr(i, 4), 16));
  }
  return out;
}

/** Parse a `ToUnicode` CMap's `bfchar` / `bfrange` sections → char code → unicode string. */
function parseCMap(cmapText: string): Map<number, string> {
  const map = new Map<number, string>();

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;
  while ((block = charRe.exec(cmapText)) !== null) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(block[1])) !== null) {
      map.set(parseInt(p[1], 16), hexToCodepoints(p[2]));
    }
  }

  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = rangeRe.exec(cmapText)) !== null) {
    const rowRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(block[1])) !== null) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      const base = parseInt(r[3], 16);
      for (let code = lo; code <= hi; code++) {
        map.set(code, String.fromCharCode(base + (code - lo)));
      }
    }
  }
  return map;
}

// ---- content-stream text walk --------------------------------------------------------------------

/** One run of text drawn at a device position (origin of the run's baseline). */
export interface TextSpan {
  x: number;
  y: number;
  text: string;
}

/** Parse a hex-or-literal PDF string operand into raw byte codes. */
function decodeStringOperand(op: string): number[] {
  const codes: number[] = [];
  if (op[0] === '<') {
    const hex = op.slice(1, -1).replace(/\s+/g, '');
    for (let i = 0; i + 2 <= hex.length; i += 2) codes.push(parseInt(hex.substr(i, 2), 16));
  } else {
    // literal (...) with escapes
    const body = op.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      let ch = body[i];
      if (ch === '\\') {
        const n = body[++i];
        if (n >= '0' && n <= '7') {
          let oct = n;
          if (body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
          if (body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
          codes.push(parseInt(oct, 8));
          continue;
        }
        const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        codes.push(escapes[n] ?? n.charCodeAt(0));
      } else {
        codes.push(ch.charCodeAt(0));
      }
    }
  }
  return codes;
}

/**
 * Walk a page's content stream and emit positioned text spans (one per `BT…ET` run). Coordinates are
 * device-space after the current CTM, so y increases down the page (matching the on-screen layout).
 */
function extractSpans(content: string, fonts: Map<string, Map<number, string>>): TextSpan[] {
  const spans: TextSpan[] = [];

  // Graphics state: CTM stack.
  let ctm: Mat = { ...IDENTITY };
  const ctmStack: Mat[] = [];

  // Text state (valid between BT and ET).
  let tm: Mat = { ...IDENTITY };
  let tlm: Mat = { ...IDENTITY };
  let leading = 0;
  let curFont: Map<number, string> | null = null;
  let runText = '';
  let runStarted = false;
  let runX = 0;
  let runY = 0;

  const flushRun = () => {
    if (runStarted && runText !== '') spans.push({ x: runX, y: runY, text: runText });
    runStarted = false;
    runText = '';
  };

  const showCodes = (codes: number[]) => {
    if (!runStarted) {
      const origin = mul(tm, ctm);
      runX = origin.e;
      runY = origin.f;
      runStarted = true;
    }
    for (const code of codes) runText += curFont?.get(code) ?? '';
  };

  // Tokenize into operators + operands. Numbers, names, strings (<…>/(…)), arrays [ … ], operators.
  const tokens = tokenize(content);
  const operands: string[] = [];

  for (const tok of tokens) {
    if (tok.type === 'op') {
      const op = tok.value;
      switch (op) {
        case 'q':
          ctmStack.push({ ...ctm });
          break;
        case 'Q':
          ctm = ctmStack.pop() ?? { ...IDENTITY };
          break;
        case 'cm': {
          const [a, b, c, d, e, f] = operands.slice(-6).map(Number);
          ctm = mul({ a, b, c, d, e, f }, ctm);
          break;
        }
        case 'BT':
          tm = { ...IDENTITY };
          tlm = { ...IDENTITY };
          break;
        case 'ET':
          flushRun();
          break;
        case 'Tf':
          flushRun();
          curFont = fonts.get(operands[operands.length - 2]?.replace('/', '')) ?? curFont;
          break;
        case 'Tm': {
          flushRun();
          const [a, b, c, d, e, f] = operands.slice(-6).map(Number);
          tm = { a, b, c, d, e, f };
          tlm = { ...tm };
          break;
        }
        case 'Td': {
          flushRun();
          const [tx, ty] = operands.slice(-2).map(Number);
          tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, tlm);
          tm = { ...tlm };
          break;
        }
        case 'TD': {
          flushRun();
          const [tx, ty] = operands.slice(-2).map(Number);
          leading = -ty;
          tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, tlm);
          tm = { ...tlm };
          break;
        }
        case 'TL':
          leading = Number(operands[operands.length - 1]);
          break;
        case 'T*':
          flushRun();
          tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, tlm);
          tm = { ...tlm };
          break;
        case 'Tj':
          showCodes(decodeStringOperand(operands[operands.length - 1]));
          break;
        case "'":
          flushRun();
          tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -leading }, tlm);
          tm = { ...tlm };
          showCodes(decodeStringOperand(operands[operands.length - 1]));
          break;
        case 'TJ': {
          // Array of strings + numeric kerns; kerns are spacing, ignored for grouping.
          const arr = operands[operands.length - 1] ?? '';
          const partRe = /<[0-9A-Fa-f\s]*>|\([^)]*\)/g;
          let pm: RegExpExecArray | null;
          while ((pm = partRe.exec(arr)) !== null) showCodes(decodeStringOperand(pm[0]));
          break;
        }
        default:
          break;
      }
      operands.length = 0;
    } else {
      operands.push(tok.value);
    }
  }
  flushRun();
  return spans;
}

interface Token {
  type: 'op' | 'operand';
  value: string;
}

/** Tokenize a content stream: strings, arrays, names, numbers = operands; bare words = operators. */
function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\0') {
      i++;
      continue;
    }
    if (ch === '%') {
      // comment to end of line
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (ch === '<' && s[i + 1] === '<') {
      // dictionary — skip (not needed for text); find matching >>
      let depth = 0;
      while (i < n) {
        if (s[i] === '<' && s[i + 1] === '<') {
          depth++;
          i += 2;
        } else if (s[i] === '>' && s[i + 1] === '>') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      continue;
    }
    if (ch === '<') {
      const end = s.indexOf('>', i);
      tokens.push({ type: 'operand', value: s.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    if (ch === '(') {
      // literal string, honouring escaped parens + balanced parens
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (s[j] === '\\') {
          j++;
          continue;
        }
        if (s[j] === '(') depth++;
        else if (s[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      tokens.push({ type: 'operand', value: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === '[') {
      // array — capture verbatim (used by TJ)
      const end = s.indexOf(']', i);
      tokens.push({ type: 'operand', value: s.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    if (ch === '/') {
      let j = i + 1;
      while (j < n && !isDelim(s[j]) && !isWs(s[j])) j++;
      tokens.push({ type: 'operand', value: s.slice(i, j) });
      i = j;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      let j = i;
      while (j < n && /[0-9.+\-eE]/.test(s[j])) j++;
      tokens.push({ type: 'operand', value: s.slice(i, j) });
      i = j;
      continue;
    }
    // bare word → operator
    let j = i;
    while (j < n && !isDelim(s[j]) && !isWs(s[j])) j++;
    tokens.push({ type: 'op', value: s.slice(i, j) });
    i = j === i ? i + 1 : j;
  }
  return tokens;
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
}
function isDelim(c: string): boolean {
  return c === '(' || c === ')' || c === '<' || c === '>' || c === '[' || c === ']' || c === '/' || c === '%' || c === '{' || c === '}';
}

// ---- document assembly ---------------------------------------------------------------------------

/** Resolve the first page object (single-page statements). */
function findFirstPage(doc: PdfDoc): PdfObject | null {
  for (const obj of doc.objects.values()) {
    if (/\/Type\s*\/Page\b/.test(obj.dict) && !/\/Type\s*\/Pages\b/.test(obj.dict)) return obj;
  }
  return null;
}

/** Build resource-font-name → ToUnicode map for a page. */
function pageFonts(doc: PdfDoc, page: PdfObject): Map<string, Map<number, string>> {
  const fonts = new Map<string, Map<number, string>>();

  // The `/Font << … >>` sub-dictionary (font entries are all `N 0 R` refs — no nesting to balance).
  // Resources is usually inline in the page dict; fall back to a `/Resources N 0 R` indirect object.
  // A regex on the page dict is enough since we only need the `/Font` sub-dict, not full dict parsing.
  const searchTexts = [page.dict];
  const resRef = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(page.dict);
  if (resRef) searchTexts.push(doc.objects.get(parseInt(resRef[1], 10))?.dict ?? '');

  let fontDict: string | undefined;
  for (const text of searchTexts) {
    const inline = /\/Font\s*<<([\s\S]*?)>>/.exec(text);
    if (inline) {
      fontDict = inline[1];
      break;
    }
    const fontRef = /\/Font\s+(\d+)\s+\d+\s+R/.exec(text);
    if (fontRef) {
      fontDict = doc.objects.get(parseInt(fontRef[1], 10))?.dict ?? '';
      break;
    }
  }
  if (!fontDict) return fonts;

  const entryRe = /\/([A-Za-z0-9.+_-]+)\s+(\d+)\s+\d+\s+R/g;
  let e: RegExpExecArray | null;
  while ((e = entryRe.exec(fontDict)) !== null) {
    const fontObj = doc.objects.get(parseInt(e[2], 10));
    if (!fontObj) continue;
    const tuRef = refNum(/\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(fontObj.dict)?.[1] ?? '');
    if (tuRef == null) continue;
    const tuObj = doc.objects.get(tuRef);
    if (!tuObj) continue;
    const cmapBytes = streamBytes(doc, tuObj);
    if (cmapBytes) fonts.set(e[1], parseCMap(toLatin1(cmapBytes)));
  }
  return fonts;
}

/** Concatenated, decoded content-stream text for a page (Contents may be a ref or array of refs). */
function pageContent(doc: PdfDoc, page: PdfObject): string {
  const contentsMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(page.dict);
  const arrMatch = /\/Contents\s*\[([\s\S]*?)\]/.exec(page.dict);
  const refs: number[] = [];
  if (arrMatch) {
    const rr = /(\d+)\s+\d+\s+R/g;
    let r: RegExpExecArray | null;
    while ((r = rr.exec(arrMatch[1])) !== null) refs.push(parseInt(r[1], 10));
  } else if (contentsMatch) {
    refs.push(parseInt(contentsMatch[1], 10));
  }
  let out = '';
  for (const num of refs) {
    const obj = doc.objects.get(num);
    if (!obj) continue;
    const bytes = streamBytes(doc, obj);
    if (bytes) out += toLatin1(bytes) + '\n';
  }
  return out;
}

/**
 * Extract positioned text lines from a PDF. Pass `fileKey` (from {@link pdfFileKey}) for an encrypted
 * document; omit it for a plain PDF. Lines are top-to-bottom, spans within each left-to-right.
 */
export function parsePdfPositionedText(bytes: Uint8Array, fileKey?: Uint8Array): PositionedLine[] {
  const latin1 = toLatin1(bytes);
  const doc: PdfDoc = { bytes, latin1, objects: parseObjects(bytes, latin1), fileKey };

  const page = findFirstPage(doc);
  if (!page) return [];

  const fonts = pageFonts(doc, page);
  const content = pageContent(doc, page);
  const spans = extractSpans(content, fonts);

  return groupIntoLines(spans);
}

/**
 * Group spans into visual lines and merge adjacent glyphs into word/column cells.
 *
 * The content stream draws each glyph as its own run (a `Td` move between every character), so raw
 * spans are single glyphs. We (1) bucket them into lines by baseline y — note PDF y is bottom-up, so
 * reading order is DESCENDING y — and (2) within a line, join glyphs into a cell until the horizontal
 * gap to the next glyph exceeds `cellGap`, which cleanly separates table columns (~60+ apart) from
 * intra-word/space gaps (~10). Each cell's x is its first glyph's origin.
 */
function groupIntoLines(spans: TextSpan[], yTolerance = 3, cellGap = 20): PositionedLine[] {
  const sorted = [...spans].sort((a, b) => b.y - a.y || a.x - b.x); // top-of-page first (high y), then L→R

  // Bucket into lines by y.
  const rawLines: TextSpan[][] = [];
  for (const sp of sorted) {
    const last = rawLines[rawLines.length - 1];
    if (last && Math.abs(sp.y - last[0].y) <= yTolerance) last.push(sp);
    else rawLines.push([sp]);
  }

  // Merge glyphs → cells within each line.
  return rawLines.map((glyphs) => {
    glyphs.sort((a, b) => a.x - b.x);
    const cells: { x: number; text: string }[] = [];
    let curX = glyphs[0].x;
    let curText = '';
    let prevX = glyphs[0].x;
    for (const g of glyphs) {
      if (curText !== '' && g.x - prevX > cellGap) {
        cells.push({ x: curX, text: curText });
        curX = g.x;
        curText = '';
      }
      curText += g.text;
      prevX = g.x;
    }
    if (curText !== '') cells.push({ x: curX, text: curText });
    return { y: glyphs[0].y, spans: cells };
  });
}

// ---- SheetLike packaging -------------------------------------------------------------------------

/**
 * Pack a PDF's positioned lines into a single {@link SheetLike}. The extracted `PdfPositionedLine[]`
 * ride along on `sheet.pdfLines` (with x-positions intact) so a PDF adapter can band columns; the
 * plain `matrix` (one row of cell texts per line) is kept for detection / debugging and to satisfy
 * the `SheetLike` contract. Pass `fileKey` (from {@link pdfFileKey}) for an encrypted PDF.
 */
export function parsePdfToSheets(bytes: Uint8Array, fileKey?: Uint8Array): SheetLike[] {
  const lines = parsePdfPositionedText(bytes, fileKey);
  const matrix: string[][] = lines.map((l) => l.spans.map((s) => s.text));
  const rows: RawRow[] = matrix.map((cells, i) => ({
    cells: Object.fromEntries(cells.map((c, idx) => [String(idx), c])),
    rowNumber: i + 1,
  }));
  return [{ name: 'PDF', headers: [], rows, matrix, pdfLines: lines }];
}
