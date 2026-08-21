import {
  ALL_ROLES,
  isPrincipal,
  isTransferRole,
  loanBalanceFromTxns,
  loanPartOf,
  perPersonBalances,
  PRINCIPAL_ROLES,
  roleDirection,
  roleFavorable,
  roleForLoanPart,
  ROLE_META,
  type LendingTxn,
  type TransferRole,
} from '../roles';

describe('transfer roles', () => {
  it('every role has direction + display metadata', () => {
    for (const role of ALL_ROLES) {
      expect(['in', 'out']).toContain(roleDirection(role));
      expect(ROLE_META[role].label.length).toBeGreaterThan(0);
      expect(ROLE_META[role].emoji.length).toBeGreaterThan(0);
      expect(ROLE_META[role].group).toBe(roleDirection(role));
    }
  });

  it('marks exactly the five principal roles as principal', () => {
    expect([...PRINCIPAL_ROLES].sort()).toEqual(
      ['borrowed', 'lent', 'lent_interest', 'repaid_by_me', 'repaid_to_me'].sort(),
    );
    expect(isPrincipal('lent')).toBe(true);
    expect(isPrincipal('repaid_to_me')).toBe(true);
    expect(isPrincipal('interest_received')).toBe(false);
    expect(isPrincipal('gift_given')).toBe(false);
    expect(isPrincipal(null)).toBe(false);
    expect(isPrincipal(undefined)).toBe(false);
  });

  it('directions match the taxonomy (out = money leaving)', () => {
    expect(roleDirection('lent')).toBe('out');
    expect(roleDirection('repaid_by_me')).toBe('out');
    expect(roleDirection('interest_paid')).toBe('out');
    expect(roleDirection('gift_given')).toBe('out');
    expect(roleDirection('borrowed')).toBe('in');
    expect(roleDirection('repaid_to_me')).toBe('in');
    expect(roleDirection('interest_received')).toBe('in');
  });

  it('colours lending framing (favourable) not raw cash flow', () => {
    expect(roleFavorable('lent')).toBe(true); // money out, but it's an asset owed to you → favourable
    expect(roleFavorable('repaid_to_me')).toBe(true);
    expect(roleFavorable('interest_received')).toBe(true);
    expect(roleFavorable('borrowed')).toBe(false); // money in, but a liability → unfavourable
    expect(roleFavorable('repaid_by_me')).toBe(false);
    expect(roleFavorable('gift_given')).toBe(false);
  });

  it('guards unknown role strings', () => {
    expect(isTransferRole('lent')).toBe(true);
    expect(isTransferRole('nonsense')).toBe(false);
    expect(isTransferRole(null)).toBe(false);
  });
});

describe('perPersonBalances', () => {
  const row = (personId: number | null, transferRole: TransferRole | null, paise: number): LendingTxn => ({
    personId,
    transferRole,
    paise,
  });

  it('nets lending principal against repayment (they owe me)', () => {
    const balances = perPersonBalances([
      row(1, 'lent', 500000), // ₹5,000 lent
      row(1, 'lent_interest', 300000), // ₹3,000 lent (interest-bearing)
      row(1, 'repaid_to_me', 200000), // ₹2,000 back
    ]);
    const b = balances.get(1)!;
    expect(b.theyOweMe).toBe(600000); // 5000 + 3000 − 2000
    expect(b.iOweThem).toBe(0);
    expect(b.net).toBe(600000); // positive → they owe me
  });

  it('nets borrowing against my repayments (I owe them)', () => {
    const b = perPersonBalances([
      row(2, 'borrowed', 1000000),
      row(2, 'repaid_by_me', 400000),
    ]).get(2)!;
    expect(b.iOweThem).toBe(600000);
    expect(b.theyOweMe).toBe(0);
    expect(b.net).toBe(-600000); // negative → I owe them
  });

  it('keeps interest and gifts out of the principal balance', () => {
    const b = perPersonBalances([
      row(3, 'lent', 100000),
      row(3, 'interest_received', 5000),
      row(3, 'gift_given', 20000),
      row(3, 'donation_given', 10000),
      row(3, 'gift_received', 7000),
    ]).get(3)!;
    expect(b.theyOweMe).toBe(100000); // interest/gift do NOT change principal
    expect(b.net).toBe(100000);
    expect(b.interestIn).toBe(5000);
    expect(b.giftsGiven).toBe(30000); // gift + donation given
    expect(b.giftsReceived).toBe(7000);
  });

  it('ignores rows with no role or no person', () => {
    const balances = perPersonBalances([
      row(null, 'lent', 100000), // no person → skipped
      row(4, null, 100000), // no role → skipped
      row(5, 'lent', 100000), // counted
    ]);
    expect(balances.has(4)).toBe(false);
    expect(balances.get(5)!.theyOweMe).toBe(100000);
    expect(balances.size).toBe(1);
  });
});

describe('loan grouping helpers', () => {
  it('maps (kind, part) → role', () => {
    expect(roleForLoanPart('lent', 'principal')).toBe('lent');
    expect(roleForLoanPart('lent', 'repayment')).toBe('repaid_to_me');
    expect(roleForLoanPart('lent', 'interest')).toBe('interest_received');
    expect(roleForLoanPart('borrowed', 'principal')).toBe('borrowed');
    expect(roleForLoanPart('borrowed', 'repayment')).toBe('repaid_by_me');
    expect(roleForLoanPart('borrowed', 'interest')).toBe('interest_paid');
  });

  it('maps role → loan part', () => {
    expect(loanPartOf('lent')).toBe('principal');
    expect(loanPartOf('borrowed')).toBe('principal');
    expect(loanPartOf('repaid_to_me')).toBe('repayment');
    expect(loanPartOf('interest_paid')).toBe('interest');
    expect(loanPartOf('gift_given')).toBeNull();
    expect(loanPartOf(null)).toBeNull();
  });

  it('rolls up a loan spanning several principal + repayment + interest transactions', () => {
    // The screenshot case: ₹6L lent across 3 txns; ₹8L back + ₹15,200 interest.
    const bal = loanBalanceFromTxns([
      { transferRole: 'lent', paise: 140000_00 },
      { transferRole: 'lent', paise: 180000_00 },
      { transferRole: 'lent', paise: 280000_00 },
      { transferRole: 'repaid_to_me', paise: 500000_00 },
      { transferRole: 'repaid_to_me', paise: 300000_00 },
      { transferRole: 'interest_received', paise: 15200_00 },
    ]);
    expect(bal.principalPaise).toBe(600000_00); // 1.4L + 1.8L + 2.8L
    expect(bal.repaidPaise).toBe(800000_00); // 5L + 3L
    expect(bal.outstandingPaise).toBe(-200000_00); // over-repaid by the interest-ish surplus
    expect(bal.interestPaise).toBe(15200_00);
  });
});
