import type { TextStyle } from 'react-native';

import { MAX_FONT_WEIGHT, TEXT_STYLES } from '../themed-text';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#142321' }) }));

const entries = Object.entries(TEXT_STYLES as Record<string, TextStyle>);
const styleOf = (name: string): TextStyle => (TEXT_STYLES as Record<string, TextStyle>)[name];

describe('the type scale', () => {
  it('caps every weight at 500, so hierarchy never leans on boldness', () => {
    expect(MAX_FONT_WEIGHT).toBe(500);

    const tooHeavy = entries
      .filter(([, style]) => style.fontWeight != null && Number(style.fontWeight) > MAX_FONT_WEIGHT)
      .map(([name]) => name);

    expect(tooHeavy).toEqual([]);
  });

  it('keeps every size at or above the readable floor', () => {
    const tooSmall = entries
      .filter(([, style]) => style.fontSize != null && style.fontSize < 11)
      .map(([name]) => name);

    expect(tooSmall).toEqual([]);
  });

  it('separates emphasis from body at the same size without extra weight', () => {
    expect(styleOf('smallEmphasis').fontSize).toBe(styleOf('small').fontSize);
    expect(Number(styleOf('smallEmphasis').fontWeight)).toBeGreaterThan(
      Number(styleOf('small').fontWeight),
    );
  });
});
