/**
 * PDF text extraction. Uses a SYNTHETIC PDF assembled in-test (a ToUnicode CMap font + a FlateDecode
 * content stream drawing positioned glyphs, exactly the structure Axis statements use: per-glyph `Tj`
 * with `Tm`/`Td` moves) — no real statement or PII. Exercises the object scan, inflate, CMap parse,
 * content-stream text walk, line grouping and column merging end to end.
 */

import { zlibSync } from 'fflate';

import { parsePdfPositionedText, parsePdfToSheets } from '../pdf-text';

const enc = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 0xff));

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** A minimal ToUnicode CMap mapping byte codes → letters. */
function cmap(pairs: [number, string][]): string {
  const body = pairs.map(([code, ch]) => `<${code.toString(16).padStart(2, '0')}> <${ch.charCodeAt(0).toString(16).padStart(4, '0')}>`).join('\n');
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
${pairs.length} beginbfchar
${body}
endbfchar
endcmap end end`;
}

/** Assemble a tiny single-page PDF with a ToUnicode font and a FlateDecode content stream. */
function buildPdf(content: string, cmapText: string): Uint8Array {
  const objs: string[] = [];
  objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>';

  const deflated = zlibSync(enc(content));
  const cmapBytes = enc(cmapText);

  const parts: Uint8Array[] = [enc('%PDF-1.7\n')];
  const emitDict = (n: number) => parts.push(enc(`${n} 0 obj\n${objs[n]}\nendobj\n`));
  emitDict(1);
  emitDict(2);
  emitDict(3);
  emitDict(4);
  // Content stream (obj 5, FlateDecode)
  parts.push(enc(`5 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`), deflated, enc('\nendstream\nendobj\n'));
  // ToUnicode CMap (obj 6, uncompressed)
  parts.push(enc(`6 0 obj\n<< /Length ${cmapBytes.length} >>\nstream\n`), cmapBytes, enc('\nendstream\nendobj\n'));
  parts.push(enc('trailer\n<< /Root 1 0 R >>\n%%EOF'));
  return concat(parts);
}

describe('parsePdfPositionedText', () => {
  it('maps glyph codes via ToUnicode and reconstructs positioned lines top-down', () => {
    // Two rows; each has a "date-ish" cell on the left and another cell far to the right.
    const content = [
      'BT /F1 12 Tf 1 0 0 1 50 700 Tm <01> Tj 6 0 Td <02> Tj ET',
      'BT /F1 12 Tf 1 0 0 1 200 700 Tm <03> Tj 6 0 Td <04> Tj ET',
      'BT /F1 12 Tf 1 0 0 1 50 680 Tm <02> Tj 6 0 Td <01> Tj ET',
    ].join('\n');
    const pdf = buildPdf(content, cmap([[0x01, 'H'], [0x02, 'i'], [0x03, 'A'], [0x04, 'B']]));

    const lines = parsePdfPositionedText(pdf);
    expect(lines.length).toBe(2);

    // Reading order: y=700 first (higher up the page), then y=680.
    expect(Math.round(lines[0].y)).toBe(700);
    expect(Math.round(lines[1].y)).toBe(680);

    // Row 1: two cells (gap 150 > cellGap), merged glyphs within each.
    expect(lines[0].spans.map((s) => s.text)).toEqual(['Hi', 'AB']);
    expect(Math.round(lines[0].spans[0].x)).toBe(50);
    expect(Math.round(lines[0].spans[1].x)).toBe(200);

    // Row 2: single cell.
    expect(lines[1].spans.map((s) => s.text)).toEqual(['iH']);
  });

  it('exposes lines on the SheetLike from parsePdfToSheets', () => {
    const content = 'BT /F1 12 Tf 1 0 0 1 50 700 Tm <01> Tj ET';
    const pdf = buildPdf(content, cmap([[0x01, 'H']]));
    const sheets = parsePdfToSheets(pdf);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].pdfLines).toBeDefined();
    expect(sheets[0].pdfLines?.[0].spans[0].text).toBe('H');
    expect(sheets[0].matrix[0][0]).toBe('H');
  });
});
