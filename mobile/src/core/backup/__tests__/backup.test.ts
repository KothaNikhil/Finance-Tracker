import { backupFileName, hasRequiredTables, isSqliteFile, REQUIRED_TABLES } from '../backup';

/** Build bytes that start with the real SQLite header "SQLite format 3\0". */
function sqliteHeaderBytes(extra = 0): Uint8Array {
  const header = 'SQLite format 3';
  const bytes = new Uint8Array(16 + extra);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes[15] = 0; // NUL
  return bytes;
}

describe('isSqliteFile', () => {
  it('accepts bytes with the SQLite 3 magic header', () => {
    expect(isSqliteFile(sqliteHeaderBytes(100))).toBe(true);
  });

  it('rejects a header missing the terminating NUL (e.g. a space instead)', () => {
    const b = sqliteHeaderBytes();
    b[15] = 0x20; // space, not NUL
    expect(isSqliteFile(b)).toBe(false);
  });

  it('rejects non-SQLite content and too-short input', () => {
    expect(isSqliteFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false); // a zip (xlsx) header
    expect(isSqliteFile(new Uint8Array(4))).toBe(false);
  });
});

describe('hasRequiredTables', () => {
  it('is true only when every required table is present', () => {
    expect(hasRequiredTables([...REQUIRED_TABLES])).toBe(true);
    expect(hasRequiredTables([...REQUIRED_TABLES, 'sqlite_sequence', 'android_metadata'])).toBe(true);
    expect(hasRequiredTables(['categories', 'transactions'])).toBe(false);
    expect(hasRequiredTables([])).toBe(false);
  });
});

describe('backupFileName', () => {
  it('zero-pads into a chronologically sortable name', () => {
    expect(backupFileName({ year: 2026, month: 8, day: 16, hour: 8, minute: 5 })).toBe(
      'FinanceTracker-backup-2026-08-16-0805.db',
    );
    expect(backupFileName({ year: 2026, month: 12, day: 1, hour: 23, minute: 59 })).toBe(
      'FinanceTracker-backup-2026-12-01-2359.db',
    );
  });
});
