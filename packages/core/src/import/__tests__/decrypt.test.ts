/**
 * Round-trip test for in-app .xlsx decryption: encrypt a workbook with a battle-tested library
 * (officecrypto-tool, dev-only, Node) and prove our pure-JS decryptor recovers the exact contents.
 * This validates the crypto without needing a real (git-ignored) password-protected bank file.
 */

import officeCrypto from 'officecrypto-tool';
import * as XLSX from 'xlsx';

import { decryptWorkbook, isEncryptedWorkbook, WrongPasswordError } from '../decrypt';

// The spin-count hash chain (100k SHA-512) is inherent to the format — give it room.
jest.setTimeout(60000);

function plainWorkbookBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Amount'],
    ['Zomato Ltd', 250],
    ['Zepto', 380],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

async function encrypted(password: string, type?: 'standard'): Promise<Uint8Array> {
  const opts = type ? { password, type } : { password };
  const enc = await officeCrypto.encrypt(Buffer.from(plainWorkbookBytes()), opts);
  return new Uint8Array(enc);
}

it('recognizes encrypted vs plain workbooks', async () => {
  expect(isEncryptedWorkbook(await encrypted('secret123'))).toBe(true);
  expect(isEncryptedWorkbook(plainWorkbookBytes())).toBe(false); // a normal ZIP-based .xlsx
  expect(isEncryptedWorkbook(new Uint8Array([1, 2, 3, 4]))).toBe(false);
});

// Both schemes Excel/banks use: agile (v4.4, AES-CBC) and standard (v4.2, AES-ECB).
const SCHEMES: { name: string; type?: 'standard' }[] = [{ name: 'agile' }, { name: 'standard', type: 'standard' }];

for (const scheme of SCHEMES) {
  describe(`${scheme.name} encryption`, () => {
    it('decrypts with the right password back to the original contents', async () => {
      const decrypted = decryptWorkbook(await encrypted('secret123', scheme.type), 'secret123');
      const wb = XLSX.read(decrypted, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      expect(rows[0]).toEqual(['Name', 'Amount']);
      expect(rows[1]).toEqual(['Zomato Ltd', 250]);
    });

    it('throws WrongPasswordError on a bad password', async () => {
      const enc = await encrypted('secret123', scheme.type);
      expect(() => decryptWorkbook(enc, 'wrongpass')).toThrow(WrongPasswordError);
    });
  });
}
