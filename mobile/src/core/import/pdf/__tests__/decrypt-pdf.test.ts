/**
 * PDF V5/R6 (AES-256) decryption. The fixture `synthetic-aes256.pdf` is a SYNTHETIC file (no personal
 * data) generated independently by PyMuPDF with user password `test` — decrypting it here cross-checks
 * our pure-JS Algorithm 2.B + AES-256 against another implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { inflateSync, unzlibSync } from 'fflate';

import { WrongPasswordError } from '../../decrypt';
import { decryptPdfData, isEncryptedPdf, pdfFileKey } from '../decrypt-pdf';

const FIXTURE = path.join(__dirname, 'fixtures', 'synthetic-aes256.pdf');
const bytes = new Uint8Array(fs.readFileSync(FIXTURE));

describe('isEncryptedPdf', () => {
  it('is true for an encrypted PDF', () => {
    expect(isEncryptedPdf(bytes)).toBe(true);
  });

  it('is false for a plain PDF and for non-PDF bytes', () => {
    const plain = new TextEncoder().encode('%PDF-1.7\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>');
    expect(isEncryptedPdf(plain)).toBe(false);
    expect(isEncryptedPdf(new TextEncoder().encode('PK\x03\x04 not a pdf'))).toBe(false);
  });
});

describe('pdfFileKey', () => {
  it('derives a 32-byte AES key for the correct password', () => {
    const key = pdfFileKey(bytes, 'test');
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('throws WrongPasswordError for a bad password', () => {
    expect(() => pdfFileKey(bytes, 'nope')).toThrow(WrongPasswordError);
  });

  it('accepts the owner password too', () => {
    expect(pdfFileKey(bytes, 'owner-secret').length).toBe(32);
  });
});

describe('decryptPdfData', () => {
  it('decrypts a content stream to valid PDF text-drawing operators', () => {
    const key = pdfFileKey(bytes, 'test');
    const latin1 = Buffer.from(bytes).toString('latin1');

    // Decrypt every stream (inflating when FlateDecode) and check one yields text-drawing operators.
    let found = false;
    const re = /(\d+)\s+\d+\s+obj([\s\S]*?)stream\r?\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(latin1)) !== null) {
      const start = m.index + m[0].length;
      let end = latin1.indexOf('endstream', start);
      if (end === -1) continue;
      if (bytes[end - 1] === 0x0a) end--; // strip trailing EOL that isn't part of the data
      if (bytes[end - 1] === 0x0d) end--;
      let dec = decryptPdfData(key, bytes.subarray(start, end));
      if (/FlateDecode/.test(m[2])) {
        try {
          dec = unzlibSync(dec);
        } catch {
          try {
            dec = inflateSync(dec);
          } catch {
            continue;
          }
        }
      }
      const text = Buffer.from(dec).toString('latin1');
      if (text.includes('BT') && (text.includes('Tf') || text.includes('Tj') || text.includes('TJ'))) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
