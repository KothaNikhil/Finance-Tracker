import { Colors, Motion, Radius, Spacing, TouchTarget } from '../theme';

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('calm-fintech theme', () => {
  it('keeps identical semantic tokens in light and dark modes', () => {
    expect(Object.keys(Colors.light).sort()).toEqual(Object.keys(Colors.dark).sort());
  });

  it.each(['light', 'dark'] as const)('%s mode keeps core text and actions readable', (scheme) => {
    const colors = Colors[scheme];
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textSecondary, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes a consistent spacing, radius, motion, and touch-target scale', () => {
    expect(Spacing.sm).toBe(8);
    expect(Spacing.md).toBe(12);
    expect(Radius.md).toBe(10);
    expect(Radius.lg).toBe(14);
    expect(Motion.fast).toBeLessThan(Motion.slow);
    expect(TouchTarget).toBeGreaterThanOrEqual(44);
  });
});
