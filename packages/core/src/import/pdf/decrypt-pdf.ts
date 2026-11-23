/**
 * Decrypt password-protected PDFs that use the **Standard Security Handler, revision 6 (V5/R6),
 * AES-256** — the scheme Axis (and most Indian banks) use for credit-card / account statement PDFs.
 * Pure JS (crypto-js only, no Buffer / native crypto), so it runs unchanged in React Native and Node,
 * mirroring the pure-JS `.xlsx` unlocker in {@link ../decrypt}.
 *
 * V5/R6 (see ISO 32000-2 / the Adobe Supplement, "Algorithm 2.A/2.B"):
 *  - the `/Encrypt` dict carries `O`,`U` (48 bytes each: 32 hash · 8 validation-salt · 8 key-salt),
 *    `OE`,`UE` (32-byte wrapped file keys) and the AES-256 file-encryption-key marker `CFM /AESV3`.
 *  - the password is run through the hardening hash **Algorithm 2.B** (SHA-256/384/512 chosen per
 *    round by an AES-128 mix), verified against `U[0:32]`, then used to unwrap `UE` → the file key.
 *  - unlike V4, the object key IS the file key directly: each stream/string is `AES-256-CBC` with the
 *    IV as its own first 16 bytes.
 *
 * We only need to READ these statements, so rather than re-serialize a fully-decrypted PDF we expose
 * the derived file key and a per-stream decryptor; {@link ../pdf-text} decrypts streams lazily as it
 * reads them. `WrongPasswordError` / `UnsupportedEncryptionError` are reused from the xlsx unlocker so
 * the import screen's existing unlock UX (reopen the prompt on a bad password) works unchanged.
 */

import CryptoJS from 'crypto-js';

import { UnsupportedEncryptionError, WrongPasswordError } from '../decrypt';
import { ilog } from '../import-log';

type WordArray = CryptoJS.lib.WordArray;

// ---- byte / WordArray helpers (local; the xlsx unlocker's are not exported) ---------------------

function u8ToWordArray(u8: Uint8Array): WordArray {
  const words: number[] = [];
  for (let i = 0; i < u8.length; i++) words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
  return CryptoJS.lib.WordArray.create(words, u8.length);
}

function wordArrayToU8(wa: WordArray): Uint8Array {
  const { words, sigBytes } = wa;
  const u8 = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  return u8;
}

function concatU8(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Latin1 bytes of a password. PDF passwords are compared as UTF-8 (SASLprep) but ASCII (the common
 * statement case) is identical; we encode as UTF-8 so non-ASCII passwords still work. */
function passwordBytes(password: string): Uint8Array {
  const utf8 = unescape(encodeURIComponent(password)); // string → UTF-8 code units in a latin1 string
  const u8 = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) u8[i] = utf8.charCodeAt(i) & 0xff;
  return u8;
}

// ---- AES / hash primitives -----------------------------------------------------------------------

function sha256(u8: Uint8Array): Uint8Array {
  return wordArrayToU8(CryptoJS.SHA256(u8ToWordArray(u8)));
}
function sha384(u8: Uint8Array): Uint8Array {
  return wordArrayToU8(CryptoJS.SHA384(u8ToWordArray(u8)));
}
function sha512(u8: Uint8Array): Uint8Array {
  return wordArrayToU8(CryptoJS.SHA512(u8ToWordArray(u8)));
}

/** AES-CBC encrypt with NO padding. Key length (16/32 bytes) selects AES-128/256. */
function aesCbcEncryptNoPad(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const out = CryptoJS.AES.encrypt(u8ToWordArray(data), u8ToWordArray(key), {
    iv: u8ToWordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.NoPadding,
  });
  return wordArrayToU8(out.ciphertext);
}

/** AES-CBC decrypt with NO padding. Key length (16/32 bytes) selects AES-128/256. */
function aesCbcDecryptNoPad(cipher: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const plain = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: u8ToWordArray(cipher) }),
    u8ToWordArray(key),
    { iv: u8ToWordArray(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding },
  );
  return wordArrayToU8(plain);
}

/**
 * Algorithm 2.B — the R6 password-hardening hash. Start with SHA-256(password‖salt‖udata), then
 * repeatedly AES-128-CBC-mix `(password‖K‖udata)×64` and re-hash with SHA-256/384/512 chosen by
 * `E mod 3`, for at least 64 rounds, stopping once the last byte of `E ≤ round − 32`. Returns 32 bytes.
 * `udata` is the 48-byte owner-key hash when hashing an owner password; empty for a user password.
 */
function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha256(concatU8(password, salt, udata));
  let round = 0;
  for (; ; round++) {
    // K1 = (password ‖ K ‖ udata) repeated 64 times
    const block = concatU8(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);

    const e = aesCbcEncryptNoPad(k1, k.subarray(0, 16), k.subarray(16, 32));

    // First 16 bytes of E as a big-endian number mod 3. Since 256 ≡ 1 (mod 3), this is Σbytes mod 3.
    let mod = 0;
    for (let i = 0; i < 16; i++) mod = (mod + e[i]) % 3;
    k = mod === 0 ? sha256(e) : mod === 1 ? sha384(e) : sha512(e);

    if (round >= 63 && e[e.length - 1] <= round - 32) break;
    if (round > 100000) {
      // Safety valve: R6 normally terminates well under a few hundred rounds. If we somehow don't,
      // bail rather than spin forever (this would be the on-device "stuck spinner").
      ilog(`hash2B: SAFETY BREAK at round ${round} (did not converge)`);
      break;
    }
  }
  ilog(`hash2B done in ${round + 1} rounds`);
  return k.subarray(0, 32);
}

// ---- the /Encrypt descriptor ---------------------------------------------------------------------

interface EncryptV5 {
  o: Uint8Array; // 48 bytes
  u: Uint8Array; // 48 bytes
  oe: Uint8Array; // 32 bytes
  ue: Uint8Array; // 32 bytes
}

function hexToU8(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Read the whole file as a latin1 string for regex scanning (bytes 1:1 with char codes). */
function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  // Chunked to avoid call-stack limits on String.fromCharCode(...spread) for large files.
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  }
  return s;
}

/** Parse a literal PDF string `(…)` body (with escapes) into bytes. */
function literalToU8(body: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const n = body[++i];
      if (n >= '0' && n <= '7') {
        let oct = n;
        if (body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
        if (body[i + 1] >= '0' && body[i + 1] <= '7') oct += body[++i];
        out.push(parseInt(oct, 8) & 0xff);
        continue;
      }
      const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      out.push(escapes[n] ?? n.charCodeAt(0));
    } else {
      out.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Grab a byte-string value (`/Name <hex>` or `/Name (literal)`) from an object's text. */
function stringField(objText: string, name: string): Uint8Array | null {
  const at = new RegExp(`/${name}\\b`).exec(objText);
  if (!at) return null;
  let i = at.index + at[0].length;
  while (i < objText.length && /\s/.test(objText[i])) i++;
  if (objText[i] === '<') {
    const end = objText.indexOf('>', i);
    return hexToU8(objText.slice(i + 1, end));
  }
  if (objText[i] === '(') {
    // balanced parens honouring escapes
    let depth = 0;
    let j = i;
    for (; j < objText.length; j++) {
      if (objText[j] === '\\') {
        j++;
        continue;
      }
      if (objText[j] === '(') depth++;
      else if (objText[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    return literalToU8(objText.slice(i + 1, j));
  }
  return null;
}

/** Extract the balanced `<<…>>` dictionary beginning at/after `from` in `s`. */
function balancedDict(s: string, from: number): string {
  const open = s.indexOf('<<', from);
  if (open === -1) return '';
  let depth = 0;
  let i = open;
  for (; i < s.length; i++) {
    if (s[i] === '<' && s[i + 1] === '<') {
      depth++;
      i++;
    } else if (s[i] === '>' && s[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  return s.slice(open);
}

/** True when these bytes are a PDF whose trailer/`/Encrypt` marks it password-protected. */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return false; // %PDF
  const s = bytesToLatin1(bytes.subarray(0, bytes.length));
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(s) || /\/Encrypt\s*<</.test(s);
}

/** Locate and parse the `/Encrypt` dictionary (V5/R6, AESV3 only). Throws if unsupported. */
function parseEncrypt(bytes: Uint8Array): EncryptV5 {
  const s = bytesToLatin1(bytes);

  // `/Encrypt` may be an indirect ref (`N G R` → object `N 0 obj … endobj`, classic Axis statements)
  // or an inline dictionary (`/Encrypt<< … >>`, e.g. an xref-stream trailer). Handle both.
  const ref = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(s);
  let objText: string;
  if (ref) {
    const num = ref[1];
    const m = new RegExp(`\\b${num}\\s+\\d+\\s+obj([\\s\\S]*?)endobj`).exec(s);
    if (!m) throw new UnsupportedEncryptionError('PDF /Encrypt object not found');
    objText = m[1];
  } else {
    const inlineAt = /\/Encrypt\s*<</.exec(s);
    if (!inlineAt) throw new UnsupportedEncryptionError('PDF is not encrypted');
    objText = balancedDict(s, inlineAt.index);
  }

  const v = /\/V\s+(\d+)/.exec(objText);
  const r = /\/R\s+(\d+)/.exec(objText);
  const isAesV3 = /\/CFM\s*\/AESV3/.test(objText);
  if (!v || !r || parseInt(v[1], 10) !== 5 || parseInt(r[1], 10) !== 6 || !isAesV3) {
    throw new UnsupportedEncryptionError('Only PDF V5/R6 (AES-256) encryption is supported');
  }

  const o = stringField(objText, 'O');
  const u = stringField(objText, 'U');
  const oe = stringField(objText, 'OE');
  const ue = stringField(objText, 'UE');
  if (!o || !u || !oe || !ue || u.length < 48 || ue.length < 32) {
    throw new UnsupportedEncryptionError('PDF /Encrypt dictionary is malformed');
  }
  return { o, u, oe, ue };
}

const ZERO_IV = new Uint8Array(16);

/**
 * Verify the password and derive the 32-byte AES-256 file-encryption key. Throws
 * {@link WrongPasswordError} on a bad password, {@link UnsupportedEncryptionError} for any scheme we
 * don't implement. Handles both the user and (fallback) owner password.
 */
export function pdfFileKey(bytes: Uint8Array, password: string): Uint8Array {
  ilog('pdfFileKey: parseEncrypt start');
  const enc = parseEncrypt(bytes);
  ilog(`pdfFileKey: parseEncrypt ok (U=${enc.u.length}b UE=${enc.ue.length}b), pw len=${password.length}`);
  const pw = passwordBytes(password);

  // Try the USER password: hash(pw ‖ validationSalt) must equal U[0:32]; then unwrap UE with hash(pw ‖ keySalt).
  const uValidationSalt = enc.u.subarray(32, 40);
  const uKeySalt = enc.u.subarray(40, 48);
  ilog('pdfFileKey: user verify hash…');
  const userHash = hash2B(pw, uValidationSalt, new Uint8Array(0));
  if (u8Equals(userHash, enc.u.subarray(0, 32))) {
    ilog('pdfFileKey: user password matched, deriving key…');
    const ik = hash2B(pw, uKeySalt, new Uint8Array(0));
    ilog('pdfFileKey: done (user)');
    return aesCbcDecryptNoPad(enc.ue, ik, ZERO_IV);
  }

  // Fall back to the OWNER password: owner hashes mix in the 48-byte U string as `udata`.
  ilog('pdfFileKey: user no-match, trying owner…');
  const oValidationSalt = enc.o.subarray(32, 40);
  const oKeySalt = enc.o.subarray(40, 48);
  const ownerHash = hash2B(pw, oValidationSalt, enc.u.subarray(0, 48));
  if (u8Equals(ownerHash, enc.o.subarray(0, 32))) {
    ilog('pdfFileKey: owner password matched, deriving key…');
    const ik = hash2B(pw, oKeySalt, enc.u.subarray(0, 48));
    ilog('pdfFileKey: done (owner)');
    return aesCbcDecryptNoPad(enc.oe, ik, ZERO_IV);
  }

  ilog('pdfFileKey: WRONG PASSWORD (neither user nor owner matched)');
  throw new WrongPasswordError();
}

function u8Equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Decrypt one stream/string with the file key (V5/R6 uses the file key directly as the object key).
 * The 16-byte IV is the data's own prefix; the remainder is AES-256-CBC ciphertext. Trailing PKCS#7
 * padding is stripped. Returns the plaintext bytes.
 */
export function decryptPdfData(fileKey: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 16) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  if (body.length === 0 || body.length % 16 !== 0) {
    // Not a valid AES-CBC block run — return as-is rather than throwing (defensive).
    return body;
  }
  const plain = aesCbcDecryptNoPad(body, fileKey, iv);
  // Strip PKCS#7 padding (1..16).
  const pad = plain[plain.length - 1];
  if (pad >= 1 && pad <= 16 && pad <= plain.length) return plain.subarray(0, plain.length - pad);
  return plain;
}
