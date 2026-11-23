import {
  parsePaytmAmount,
  decimalStringToPaise,
  rupeesToPaise,
  paiseToRupees,
  formatINR,
} from '../money';

describe('parsePaytmAmount', () => {
  it('reads a debit (money out) with a leading minus', () => {
    expect(parsePaytmAmount('-3,000.00')).toEqual({ paise: 300000, direction: 'out' });
  });

  it('reads a credit (money in) with a leading plus', () => {
    expect(parsePaytmAmount('+5,000.00')).toEqual({ paise: 500000, direction: 'in' });
  });

  it('treats an UNSIGNED amount as a self-transfer', () => {
    expect(parsePaytmAmount('27,000.00')).toEqual({ paise: 2700000, direction: 'self' });
  });

  it('handles small amounts with paise precisely', () => {
    expect(parsePaytmAmount('-63.03')).toEqual({ paise: 6303, direction: 'out' });
    expect(parsePaytmAmount('-7.00')).toEqual({ paise: 700, direction: 'out' });
  });

  it('handles large amounts', () => {
    expect(parsePaytmAmount('+70,000.00')).toEqual({ paise: 7000000, direction: 'in' });
  });

  it('throws on empty or non-numeric input', () => {
    expect(() => parsePaytmAmount('')).toThrow();
    expect(() => parsePaytmAmount('   ')).toThrow();
    expect(() => parsePaytmAmount('abc')).toThrow();
  });
});

describe('decimalStringToPaise', () => {
  it('parses without floating-point error', () => {
    expect(decimalStringToPaise('63.03')).toBe(6303);
    expect(decimalStringToPaise('0.10')).toBe(10);
    expect(decimalStringToPaise('100')).toBe(10000);
    expect(decimalStringToPaise('100.')).toBe(10000);
    expect(decimalStringToPaise('.5')).toBe(50);
  });

  it('rejects garbage', () => {
    expect(() => decimalStringToPaise('')).toThrow();
    expect(() => decimalStringToPaise('.')).toThrow();
    expect(() => decimalStringToPaise('1.2.3')).toThrow();
  });
});

describe('rupees <-> paise', () => {
  it('rounds rupees to paise safely', () => {
    expect(rupeesToPaise(63.03)).toBe(6303);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
  });

  it('converts paise back to rupees', () => {
    expect(paiseToRupees(6303)).toBeCloseTo(63.03, 5);
  });
});

describe('formatINR', () => {
  it('formats with the ₹ symbol and Indian grouping', () => {
    expect(formatINR(300000)).toBe('₹3,000.00');
    expect(formatINR(10000000)).toBe('₹1,00,000.00');
    expect(formatINR(6303)).toBe('₹63.03');
  });
});
