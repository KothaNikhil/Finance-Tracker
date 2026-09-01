import { validateLendingSplit, type LendingSplitDraft } from '../lending-split-validation';

const slice = (overrides: Partial<LendingSplitDraft> = {}): LendingSplitDraft => ({
  loanId: 1,
  part: 'repayment',
  paise: 5_000,
  direction: 'in',
  ...overrides,
});

describe('Lending split validation', () => {
  it('allows a partial split and repeated loan with multiple parts', () => {
    const result = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [
        slice({ loanId: 7, part: 'repayment', paise: 6_000 }),
        slice({ loanId: 7, part: 'interest', paise: 1_000 }),
      ],
    );

    expect(result.valid).toBe(true);
    expect(result.allocatedPaise).toBe(7_000);
    expect(result.remainingPaise).toBe(3_000);
    expect(result.allocations).toEqual([
      { loanId: 7, part: 'repayment', paise: 6_000 },
      { loanId: 7, part: 'interest', paise: 1_000 },
    ]);
  });

  it('does not silently drop incomplete or non-positive slices', () => {
    const result = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [
        slice(),
        slice({ loanId: null }),
        slice({ paise: 0 }),
        slice({ paise: -1 }),
      ],
    );

    expect(result.valid).toBe(false);
    expect(result.rowErrors).toEqual([
      null,
      'Choose a loan.',
      'Enter an amount greater than zero.',
      'Enter an amount greater than zero.',
    ]);
    expect(result.allocations).toEqual([{ loanId: 1, part: 'repayment', paise: 5_000 }]);
  });

  it('rejects slices that mix cash directions', () => {
    const result = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [slice({ direction: 'in' }), slice({ direction: 'out' })],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('All slices must move money in the same direction.');
  });

  it('rejects a uniform slice direction that contradicts the source transaction', () => {
    const result = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [slice({ direction: 'out' }), slice({ direction: 'out' })],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Slices must be money in to match this transaction.');
  });

  it('allows a manual entry to adopt the split direction', () => {
    const result = validateLendingSplit(
      { direction: 'in', paise: 10_000, enforceDirection: false },
      [slice({ direction: 'out' }), slice({ direction: 'out' })],
    );

    expect(result.valid).toBe(true);
  });

  it('rejects over-allocation but permits allocating the exact source total', () => {
    const over = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [slice({ paise: 10_001 })],
    );
    const exact = validateLendingSplit(
      { direction: 'in', paise: 10_000 },
      [slice({ paise: 10_000 })],
    );

    expect(over.valid).toBe(false);
    expect(over.errors).toContain('Allocated total cannot exceed the source transaction.');
    expect(exact.valid).toBe(true);
    expect(exact.remainingPaise).toBe(0);
  });

  it('keeps self-transfers visible but prevents allocating them to a loan', () => {
    const result = validateLendingSplit(
      { direction: 'self', paise: 10_000 },
      [slice()],
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('A self-transfer cannot be allocated to a loan.');
  });
});
