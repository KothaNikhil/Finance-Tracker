import { firstText } from '../text';

describe('firstText', () => {
  it('skips the empty string a NOT NULL DEFAULT \'\' column returns', () => {
    expect(firstText(null, '', 'Shekhar')).toBe('Shekhar');
  });

  it('skips whitespace-only values and trims what it returns', () => {
    expect(firstText('   ', '\n\t', '  Zomato  ')).toBe('Zomato');
  });

  it('returns the first usable value, not the last', () => {
    expect(firstText('Zomato', 'Original statement text')).toBe('Zomato');
  });

  it('returns null when nothing has visible text, so the caller picks the fallback', () => {
    expect(firstText(null, undefined, '', '  ')).toBeNull();
  });
});
