/**
 * Decrypt password-protected `.xlsx` (and `.xlsm`) workbooks entirely in JavaScript, so a locked
 * bank statement can be unlocked in-app without a native crypto module.
 *
 * A password-protected OOXML file isn't a ZIP — it's an OLE/CFB container holding two streams:
 * `EncryptionInfo` (describes the scheme) and `EncryptedPackage` (the AES-encrypted real ZIP). We
 * implement BOTH schemes Excel/banks use (see [MS-OFFCRYPTO]):
 *   - **Agile** (v4.4, Excel 2013+): XML descriptor, AES-CBC, per-segment IV, configurable hash.
 *   - **Standard** (v3.2/4.2, Excel 2010 & many bank tools): binary header, AES-ECB, SHA-1, 50k iters.
 * Both derive a key from the password via a big iteration loop, verify it, then decrypt the package.
 *
 * Pure JS (crypto-js + XLSX.CFB) — no Buffer, no native crypto — so it runs unchanged in RN and Node.
 */

import CryptoJS from 'crypto-js';
import * as XLSX from 'xlsx';

/** Thrown when the supplied password doesn't match (verifier mismatch). */
export class WrongPasswordError extends Error {
  constructor() {
    super('Incorrect password');
    this.name = 'WrongPasswordError';
  }
}

/** Thrown when the file is encrypted with a scheme we don't implement (e.g. legacy .xls RC4). */
export class UnsupportedEncryptionError extends Error {
  constructor(message = 'This file uses an unsupported encryption scheme') {
    super(message);
    this.name = 'UnsupportedEncryptionError';
  }
}

type WordArray = CryptoJS.lib.WordArray;

// Block keys from [MS-OFFCRYPTO] used to derive distinct keys for each purpose.
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const SEGMENT_LENGTH = 4096;

// ---- byte / WordArray helpers -------------------------------------------------------------------

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

function bytesToWordArray(bytes: number[]): WordArray {
  return u8ToWordArray(Uint8Array.from(bytes));
}

function base64ToWordArray(b64: string): WordArray {
  return CryptoJS.enc.Base64.parse(b64);
}

/** 32-bit little-endian integer as a 4-byte WordArray (used as the spin iterator / block number). */
function uint32LE(n: number): WordArray {
  return u8ToWordArray(Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff));
}

/** UTF-16LE encoding of the password, as a WordArray. */
function passwordToWordArray(password: string): WordArray {
  const u8 = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    u8[i * 2] = c & 0xff;
    u8[i * 2 + 1] = (c >>> 8) & 0xff;
  }
  return u8ToWordArray(u8);
}

/** First `n` bytes of a WordArray (agile keys are the hash truncated to keyBits/8). */
function truncate(wa: WordArray, n: number): WordArray {
  return CryptoJS.lib.WordArray.create(wa.words.slice(0, Math.ceil(n / 4)), n);
}

/** Concatenate WordArrays without mutating the inputs. */
function concat(...parts: WordArray[]): WordArray {
  const out = CryptoJS.lib.WordArray.create();
  for (const p of parts) out.concat(p.clone());
  return out;
}

// ---- the encryption descriptor (parsed from the EncryptionInfo XML) -----------------------------

interface KeyBlock {
  saltValue: WordArray;
  blockSize: number;
  keyBits: number;
  hashSize: number;
}
interface AgileInfo extends KeyBlock {
  spinCount: number;
  hash: (wa: WordArray) => WordArray;
  encryptedVerifierHashInput: WordArray;
  encryptedVerifierHashValue: WordArray;
  encryptedKeyValue: WordArray;
  // keyData (used to decrypt the package itself)
  keyDataSalt: WordArray;
  keyDataBlockSize: number;
  keyDataHash: (wa: WordArray) => WordArray;
}

function hashFn(algorithm: string): (wa: WordArray) => WordArray {
  switch (algorithm.toUpperCase().replace('-', '')) {
    case 'SHA512':
      return (wa) => CryptoJS.SHA512(wa);
    case 'SHA384':
      return (wa) => CryptoJS.SHA384(wa);
    case 'SHA256':
      return (wa) => CryptoJS.SHA256(wa);
    case 'SHA1':
      return (wa) => CryptoJS.SHA1(wa);
    default:
      throw new UnsupportedEncryptionError(`Unsupported hash algorithm: ${algorithm}`);
  }
}

function attr(xml: string, tag: string, name: string): string {
  // Grab `name="..."` from the first occurrence of `<...tag...>` (namespaces vary: keyData, p:encryptedKey).
  const tagRe = new RegExp(`<[^>]*${tag}\\b[^>]*>`, 'i');
  const el = tagRe.exec(xml)?.[0] ?? '';
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(el);
  return m?.[1] ?? '';
}

function parseAgileInfo(info: Uint8Array): AgileInfo {
  // Bytes 0..7: version (major/minor) + reserved flags; XML descriptor follows.
  const major = info[0] | (info[1] << 8);
  const minor = info[2] | (info[3] << 8);
  if (major !== 4 || minor !== 4) {
    throw new UnsupportedEncryptionError('Only ECMA-376 agile encryption is supported');
  }
  const xml = wordArrayToU8AsString(info.subarray(8));

  const keyDataHashAlgo = attr(xml, 'keyData', 'hashAlgorithm');
  const encHashAlgo = attr(xml, 'encryptedKey', 'hashAlgorithm') || keyDataHashAlgo;

  return {
    spinCount: parseInt(attr(xml, 'encryptedKey', 'spinCount'), 10),
    saltValue: base64ToWordArray(attr(xml, 'encryptedKey', 'saltValue')),
    blockSize: parseInt(attr(xml, 'encryptedKey', 'blockSize'), 10),
    keyBits: parseInt(attr(xml, 'encryptedKey', 'keyBits'), 10),
    hashSize: parseInt(attr(xml, 'encryptedKey', 'hashSize'), 10),
    hash: hashFn(encHashAlgo),
    encryptedVerifierHashInput: base64ToWordArray(attr(xml, 'encryptedKey', 'encryptedVerifierHashInput')),
    encryptedVerifierHashValue: base64ToWordArray(attr(xml, 'encryptedKey', 'encryptedVerifierHashValue')),
    encryptedKeyValue: base64ToWordArray(attr(xml, 'encryptedKey', 'encryptedKeyValue')),
    keyDataSalt: base64ToWordArray(attr(xml, 'keyData', 'saltValue')),
    keyDataBlockSize: parseInt(attr(xml, 'keyData', 'blockSize'), 10),
    keyDataHash: hashFn(keyDataHashAlgo),
  };
}

/** Decode a UTF-8 byte range to a string (the EncryptionInfo XML is small ASCII/UTF-8). */
function wordArrayToU8AsString(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // The descriptor is ASCII; decodeURIComponent(escape()) upgrades any UTF-8 bytes.
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

// ---- key derivation + AES ------------------------------------------------------------------------

function aesCbcNoPad(cipher: WordArray, key: WordArray, iv: WordArray): WordArray {
  return CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: cipher }), key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.NoPadding,
  });
}

function aesEcbNoPad(cipher: WordArray, key: WordArray): WordArray {
  return CryptoJS.AES.decrypt(CryptoJS.lib.CipherParams.create({ ciphertext: cipher }), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });
}

function u16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] * 0x1000000;
}

/**
 * The expensive part: hash the salt+password, then iterate the hash `spinCount` (typically 100k)
 * times. This chain is identical for every purpose, so we compute it ONCE and finish per block key.
 */
function passwordHashChain(info: AgileInfo, password: string): WordArray {
  let h = info.hash(concat(info.saltValue, passwordToWordArray(password)));
  for (let i = 0; i < info.spinCount; i++) {
    h = info.hash(concat(uint32LE(i), h));
  }
  return h;
}

/** Finish the chain for one purpose: hash(chain || blockKey), truncated to the key length. */
function keyForBlock(info: AgileInfo, chain: WordArray, blockKey: number[]): WordArray {
  return truncate(info.hash(concat(chain, bytesToWordArray(blockKey))), info.keyBits / 8);
}

// ---- public API ----------------------------------------------------------------------------------

/** True when these bytes are an encrypted OOXML workbook (CFB container with an EncryptionInfo stream). */
export function isEncryptedWorkbook(bytes: Uint8Array): boolean {
  // Encrypted OOXML is an OLE/CFB file (D0 CF 11 E0). A normal .xlsx is a ZIP (PK, 50 4B).
  if (!(bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) return false;
  try {
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    return !!XLSX.CFB.find(cfb, 'EncryptionInfo');
  } catch {
    return false; // a CFB that isn't an encrypted package (e.g. a legacy .xls) — let the parser handle it
  }
}

/** Agile (v4.4): AES-CBC, per-segment IV, configurable hash + spin count. */
function decryptAgile(infoBytes: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  const info = parseAgileInfo(infoBytes);

  // Run the pricey spin-count chain once, then finish it cheaply for each purpose.
  const chain = passwordHashChain(info, password);

  // Verify the password: decrypt the verifier, hash it, and compare with the stored verifier hash.
  const verifierHash = aesCbcNoPad(info.encryptedVerifierHashInput, keyForBlock(info, chain, BLOCK_VERIFIER_INPUT), info.saltValue);
  const expected = aesCbcNoPad(info.encryptedVerifierHashValue, keyForBlock(info, chain, BLOCK_VERIFIER_VALUE), info.saltValue);
  const actual = info.hash(verifierHash);
  if (truncate(actual, info.hashSize).toString() !== truncate(expected, info.hashSize).toString()) {
    throw new WrongPasswordError();
  }

  // Decrypt the package key, then the package itself (4 KB segments, per-segment IV).
  const keyForKey = keyForBlock(info, chain, BLOCK_KEY_VALUE);
  const secretKey = truncate(aesCbcNoPad(info.encryptedKeyValue, keyForKey, info.saltValue), info.keyBits / 8);

  const total = u32LE(pkg, 0);
  const enc = pkg.subarray(8);
  const out = new Uint8Array(enc.length);
  for (let i = 0, off = 0; off < enc.length; i++, off += SEGMENT_LENGTH) {
    const chunk = enc.subarray(off, Math.min(off + SEGMENT_LENGTH, enc.length));
    const iv = truncate(info.keyDataHash(concat(info.keyDataSalt, uint32LE(i))), info.keyDataBlockSize);
    const plain = aesCbcNoPad(u8ToWordArray(chunk), secretKey, iv);
    out.set(wordArrayToU8(plain), off);
  }
  return out.subarray(0, total);
}

/**
 * Standard (v3.2/4.2): binary header, AES-ECB, SHA-1, 50 000 iterations. The key is
 * `SHA1(0x36-pad ⊕ hFinal) ‖ SHA1(0x5c-pad ⊕ hFinal)` truncated to the key length.
 */
function decryptStandard(infoBytes: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  // EncryptionInfo: 4B version, 4B flags, 4B headerSize, header, then the verifier.
  const headerSize = u32LE(infoBytes, 8);
  const HEADER_START = 12;
  const algId = u32LE(infoBytes, HEADER_START + 8);
  let keyBits = u32LE(infoBytes, HEADER_START + 16);
  // AES only (0x660E/0x660F/0x6610). RC4 (0x6801) and others aren't supported.
  if (algId !== 0x660e && algId !== 0x660f && algId !== 0x6610) {
    throw new UnsupportedEncryptionError('Only AES-encrypted files are supported');
  }
  if (!keyBits) keyBits = algId === 0x6610 ? 256 : algId === 0x660f ? 192 : 128;

  let p = HEADER_START + headerSize;
  const saltSize = u32LE(infoBytes, p);
  p += 4;
  const salt = u8ToWordArray(infoBytes.subarray(p, p + saltSize));
  p += saltSize;
  const encVerifier = u8ToWordArray(infoBytes.subarray(p, p + 16));
  p += 16;
  const verifierHashSize = u32LE(infoBytes, p);
  p += 4;
  const encVerifierHash = u8ToWordArray(infoBytes.subarray(p, p + 32));

  // Key derivation: SHA1(salt‖pw), iterate 50k with the counter prepended, then a zero block.
  let h = CryptoJS.SHA1(concat(salt, passwordToWordArray(password)));
  for (let i = 0; i < 50000; i++) h = CryptoJS.SHA1(concat(uint32LE(i), h));
  const hFinal = CryptoJS.SHA1(concat(h, u8ToWordArray(new Uint8Array(4))));
  const hFinalU8 = wordArrayToU8(hFinal);
  const derive = (pad: number): WordArray => {
    const buf = new Uint8Array(64).fill(pad);
    for (let i = 0; i < hFinalU8.length; i++) buf[i] ^= hFinalU8[i];
    return CryptoJS.SHA1(u8ToWordArray(buf));
  };
  const key = truncate(concat(derive(0x36), derive(0x5c)), keyBits / 8);

  // Verify: decrypt the verifier, SHA1 it, compare with the decrypted verifier hash (first 20 bytes).
  const verifier = aesEcbNoPad(encVerifier, key);
  const expected = CryptoJS.SHA1(verifier);
  const stored = truncate(aesEcbNoPad(encVerifierHash, key), Math.min(verifierHashSize, 20));
  if (expected.toString() !== stored.toString()) throw new WrongPasswordError();

  // Decrypt the whole package with AES-ECB (pad to a 16-byte multiple), then truncate to length.
  const total = u32LE(pkg, 0);
  let enc = pkg.subarray(8);
  if (enc.length % 16 !== 0) {
    const padded = new Uint8Array(enc.length + (16 - (enc.length % 16)));
    padded.set(enc);
    enc = padded;
  }
  const plain = aesEcbNoPad(u8ToWordArray(enc), key);
  return wordArrayToU8(plain).subarray(0, total);
}

/**
 * Decrypt a password-protected OOXML workbook to its underlying `.xlsx` (ZIP) bytes.
 * Throws {@link WrongPasswordError} on a bad password, {@link UnsupportedEncryptionError} otherwise.
 */
export function decryptWorkbook(bytes: Uint8Array, password: string): Uint8Array {
  const cfb = XLSX.CFB.read(bytes, { type: 'array' });
  const infoEntry = XLSX.CFB.find(cfb, 'EncryptionInfo');
  const pkgEntry = XLSX.CFB.find(cfb, 'EncryptedPackage');
  if (!infoEntry || !pkgEntry) throw new UnsupportedEncryptionError('Not an encrypted OOXML package');

  const infoBytes = Uint8Array.from(infoEntry.content as ArrayLike<number>);
  const pkg = Uint8Array.from(pkgEntry.content as ArrayLike<number>);
  const major = u16LE(infoBytes, 0);
  const minor = u16LE(infoBytes, 2);

  if (major === 4 && minor === 4) return decryptAgile(infoBytes, pkg, password);
  if (minor === 2 && (major === 2 || major === 3 || major === 4)) return decryptStandard(infoBytes, pkg, password);
  throw new UnsupportedEncryptionError(`Unsupported encryption (version ${major}.${minor})`);
}
