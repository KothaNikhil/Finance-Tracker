import { parsePaytmDate, normalizeTime, daysInMonth } from '../date';

describe('parsePaytmDate', () => {
  it('parses Indian DD/MM/YYYY into ISO date-only', () => {
    expect(parsePaytmDate('29/05/2026')).toEqual({ isoDate: '2026-05-29', time: null });
    expect(parsePaytmDate('12/05/2026')).toEqual({ isoDate: '2026-05-12', time: null });
    expect(parsePaytmDate('01/01/2026')).toEqual({ isoDate: '2026-01-01', time: null });
  });

  it('does NOT mis-read as US MM/DD (day > 12 proves order)', () => {
    // 29 can only be a day, so this confirms we read day-first.
    expect(parsePaytmDate('29/05/2026').isoDate).toBe('2026-05-29');
  });

  it('attaches a normalized time when given', () => {
    expect(parsePaytmDate('29/05/2026', '22:32:45')).toEqual({
      isoDate: '2026-05-29',
      time: '22:32:45',
    });
  });

  it('rejects wrong formats and impossible dates', () => {
    expect(() => parsePaytmDate('2026-05-12')).toThrow(); // ISO, not DD/MM/YYYY
    expect(() => parsePaytmDate('31/02/2026')).toThrow(); // Feb has no 31st
    expect(() => parsePaytmDate('00/05/2026')).toThrow();
    expect(() => parsePaytmDate('13/13/2026')).toThrow();
  });
});

describe('normalizeTime', () => {
  it('normalizes HH:MM:SS and pads', () => {
    expect(normalizeTime('9:02:22')).toBe('09:02:22');
    expect(normalizeTime('22:32')).toBe('22:32:00');
  });

  it('returns null for missing/empty', () => {
    expect(normalizeTime(undefined)).toBeNull();
    expect(normalizeTime(null)).toBeNull();
    expect(normalizeTime('')).toBeNull();
  });

  it('rejects invalid times', () => {
    expect(() => normalizeTime('25:00:00')).toThrow();
    expect(() => normalizeTime('nope')).toThrow();
  });
});

describe('daysInMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(daysInMonth(2026, 5)).toBe(31); // May
    expect(daysInMonth(2026, 2)).toBe(28); // Feb 2026 (not leap)
    expect(daysInMonth(2024, 2)).toBe(29); // Feb 2024 (leap)
    expect(daysInMonth(2026, 4)).toBe(30); // April
  });
});
