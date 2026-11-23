import { nextDataUpdatedAt } from '../data-updated-at';

describe('nextDataUpdatedAt', () => {
  it('advances the marker when two edits happen in the same millisecond', () => {
    const now = new Date('2026-03-01T10:00:00.000Z').getTime();

    expect(nextDataUpdatedAt(new Date(now).toISOString(), now)).toBe(
      new Date(now + 1).toISOString(),
    );
  });

  it('uses the current time when there is no previous marker', () => {
    const now = new Date('2026-03-01T10:00:00.000Z').getTime();

    expect(nextDataUpdatedAt(null, now)).toBe(new Date(now).toISOString());
  });
});
