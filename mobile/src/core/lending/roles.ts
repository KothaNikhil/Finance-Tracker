/**
 * Money-lent / interest tracker — the transfer-role model (pure, no DB / RN imports).
 *
 * A person-to-person transfer can be tagged with a `TransferRole` that says what it means for the
 * lending ledger. This is an ANNOTATION on a transaction (a nullable `transfer_role` column), not a
 * separate loan record: every role corresponds to a real cash movement (imported or manually added).
 *
 * Two rules the rest of the app relies on:
 *  - PRINCIPAL roles (lending/borrowing/repayment) are balance-sheet transfers — they are pulled OUT
 *    of Spent/Received totals (see {@link isPrincipal}; mirrored in `core/analytics` + the SQL aggregates).
 *  - Interest is real income/expense; gifts and donations are real spend/income — those stay in totals.
 *
 * The per-person balance is just a reduction over the tagged rows ({@link perPersonBalances}); there is
 * no interest accrual (v1 records actual interest payments only).
 */

/** What a tagged transfer means for the lending ledger. `null` = an ordinary (untagged) transaction. */
export type TransferRole =
  | 'lent' // principal out, interest-free → they owe me ↑
  | 'lent_interest' // principal out, interest-bearing → they owe me ↑
  | 'repaid_to_me' // principal in, settles what they owe → they owe me ↓
  | 'borrowed' // principal in, I owe it back → I owe them ↑
  | 'repaid_by_me' // principal out, settles what I borrowed → I owe them ↓
  | 'interest_received' // income from interest
  | 'interest_paid' // expense: interest on money I borrowed
  | 'gift_given' // pure outflow (real spend), no ledger effect
  | 'gift_received' // pure inflow (real income), no ledger effect
  | 'donation_given' // pure outflow (real spend)
  | 'donation_received'; // pure inflow (real income)

/** Every role, in the order the picker shows them (money out first, then money in). */
export const ALL_ROLES: readonly TransferRole[] = [
  'lent',
  'lent_interest',
  'repaid_by_me',
  'interest_paid',
  'gift_given',
  'donation_given',
  'borrowed',
  'repaid_to_me',
  'interest_received',
  'gift_received',
  'donation_received',
] as const;

/**
 * The roles that move PRINCIPAL (a loan or its repayment). These are excluded from Spent/Received —
 * they're transfers, not spending or income. Interest / gift / donation roles are NOT in this set.
 */
export const PRINCIPAL_ROLES: ReadonlySet<TransferRole> = new Set<TransferRole>([
  'lent',
  'lent_interest',
  'borrowed',
  'repaid_to_me',
  'repaid_by_me',
]);

/** True when a role moves principal (so it must be excluded from spend/income totals). */
export function isPrincipal(role: TransferRole | null | undefined): boolean {
  return role != null && PRINCIPAL_ROLES.has(role);
}

/** Which way the money moves for a role. Used to derive `direction` for a manual entry. */
export function roleDirection(role: TransferRole): 'in' | 'out' {
  switch (role) {
    case 'lent':
    case 'lent_interest':
    case 'repaid_by_me':
    case 'interest_paid':
    case 'gift_given':
    case 'donation_given':
      return 'out';
    case 'borrowed':
    case 'repaid_to_me':
    case 'interest_received':
    case 'gift_received':
    case 'donation_received':
      return 'in';
  }
}

/** Display metadata for one role — label + emoji + which group it belongs to in the picker. */
export interface RoleMeta {
  label: string;
  emoji: string;
  group: 'out' | 'in';
}

export const ROLE_META: Record<TransferRole, RoleMeta> = {
  lent: { label: 'Lent', emoji: '💸', group: 'out' },
  lent_interest: { label: 'Lent (with interest)', emoji: '💰', group: 'out' },
  repaid_by_me: { label: 'Repaid by me', emoji: '↩️', group: 'out' },
  interest_paid: { label: 'Interest paid', emoji: '📉', group: 'out' },
  gift_given: { label: 'Gift given', emoji: '🎁', group: 'out' },
  donation_given: { label: 'Donation given', emoji: '🙏', group: 'out' },
  borrowed: { label: 'Borrowed', emoji: '📥', group: 'in' },
  repaid_to_me: { label: 'Repaid to me', emoji: '✅', group: 'in' },
  interest_received: { label: 'Interest received', emoji: '📈', group: 'in' },
  gift_received: { label: 'Gift received', emoji: '🎁', group: 'in' },
  donation_received: { label: 'Donation received', emoji: '🙏', group: 'in' },
};

/** Short label for a role, e.g. `💸 Lent`. */
export function roleLabel(role: TransferRole): string {
  const m = ROLE_META[role];
  return `${m.emoji} ${m.label}`;
}

/**
 * Whether an entry is "in your favour" for the Lent tab's colour cue (green vs red). Lending framing,
 * NOT cash-flow: money you lent is green (an asset the person owes you) even though cash left you;
 * money you borrowed is red even though cash came in. Green = grows what you're owed or brings you
 * money with no new liability; red = grows what you owe or is an outflow with no receivable behind it.
 */
export function roleFavorable(role: TransferRole): boolean {
  switch (role) {
    case 'lent':
    case 'lent_interest':
    case 'repaid_to_me':
    case 'interest_received':
    case 'gift_received':
    case 'donation_received':
      return true;
    case 'borrowed':
    case 'repaid_by_me':
    case 'interest_paid':
    case 'gift_given':
    case 'donation_given':
      return false;
  }
}

/** True for a string that is one of our known roles (guards values read back from the DB). */
export function isTransferRole(value: string | null | undefined): value is TransferRole {
  return value != null && (ALL_ROLES as readonly string[]).includes(value);
}

/** A loan's direction: `lent` = they owe me; `borrowed` = I owe them. */
export type LoanKind = 'lent' | 'borrowed';

/** What a transaction contributes to a loan. */
export type LoanPart = 'principal' | 'repayment' | 'interest';

/** The three parts, in display order, with a short label. */
export const LOAN_PARTS: { part: LoanPart; label: string }[] = [
  { part: 'principal', label: 'Principal' },
  { part: 'repayment', label: 'Repayment' },
  { part: 'interest', label: 'Interest' },
];

/** The {@link TransferRole} a transaction gets when attached to a loan of `kind` as `part`. */
export function roleForLoanPart(kind: LoanKind, part: LoanPart): TransferRole {
  if (kind === 'lent') {
    return part === 'principal' ? 'lent' : part === 'repayment' ? 'repaid_to_me' : 'interest_received';
  }
  return part === 'principal' ? 'borrowed' : part === 'repayment' ? 'repaid_by_me' : 'interest_paid';
}

/** Which loan part a role represents (or null for gift/donation/none). */
export function loanPartOf(role: string | null | undefined): LoanPart | null {
  switch (role) {
    case 'lent':
    case 'lent_interest':
    case 'borrowed':
      return 'principal';
    case 'repaid_to_me':
    case 'repaid_by_me':
      return 'repayment';
    case 'interest_received':
    case 'interest_paid':
      return 'interest';
    default:
      return null;
  }
}

/** A loan's running balance rolled up from its attached transactions (all values in paise). */
export interface LoanBalance {
  principalPaise: number;
  repaidPaise: number;
  /** `principal − repaid` — what's still outstanding on this loan. */
  outstandingPaise: number;
  interestPaise: number;
}

/** Roll a loan's attached transactions into principal / repaid / outstanding / interest. */
export function loanBalanceFromTxns(txns: { transferRole: string | null; paise: number }[]): LoanBalance {
  let principal = 0;
  let repaid = 0;
  let interest = 0;
  for (const t of txns) {
    const part = loanPartOf(t.transferRole);
    if (part === 'principal') principal += t.paise;
    else if (part === 'repayment') repaid += t.paise;
    else if (part === 'interest') interest += t.paise;
  }
  return { principalPaise: principal, repaidPaise: repaid, outstandingPaise: principal - repaid, interestPaise: interest };
}

/** The minimal shape {@link perPersonBalances} needs from a tagged transaction. */
export interface LendingTxn {
  personId: number | null;
  paise: number;
  transferRole: TransferRole | null;
}

/** A person's rolled-up lending position (all values in paise). */
export interface PersonBalance {
  personId: number;
  /** Principal they still owe me: Σ(lent + lent_interest) − Σ(repaid_to_me). Can go negative if over-repaid. */
  theyOweMe: number;
  /** Principal I still owe them: Σ(borrowed) − Σ(repaid_by_me). */
  iOweThem: number;
  /** `theyOweMe − iOweThem`. Positive → they owe me; negative → I owe them. */
  net: number;
  /** Interest received from this person (income). */
  interestIn: number;
  /** Interest paid to this person (expense). */
  interestOut: number;
  /** Gifts + donations given to this person (informational; not part of the balance). */
  giftsGiven: number;
  /** Gifts + donations received from this person. */
  giftsReceived: number;
}

function emptyBalance(personId: number): PersonBalance {
  return {
    personId,
    theyOweMe: 0,
    iOweThem: 0,
    net: 0,
    interestIn: 0,
    interestOut: 0,
    giftsGiven: 0,
    giftsReceived: 0,
  };
}

/**
 * Reduce tagged transactions into a per-person lending balance. Rows without a role, or without a
 * `personId`, are ignored (an untagged transfer isn't part of the ledger yet).
 */
export function perPersonBalances(txns: LendingTxn[]): Map<number, PersonBalance> {
  const byPerson = new Map<number, PersonBalance>();

  for (const txn of txns) {
    if (txn.personId == null || txn.transferRole == null) continue;
    let b = byPerson.get(txn.personId);
    if (!b) byPerson.set(txn.personId, (b = emptyBalance(txn.personId)));

    switch (txn.transferRole) {
      case 'lent':
      case 'lent_interest':
        b.theyOweMe += txn.paise;
        break;
      case 'repaid_to_me':
        b.theyOweMe -= txn.paise;
        break;
      case 'borrowed':
        b.iOweThem += txn.paise;
        break;
      case 'repaid_by_me':
        b.iOweThem -= txn.paise;
        break;
      case 'interest_received':
        b.interestIn += txn.paise;
        break;
      case 'interest_paid':
        b.interestOut += txn.paise;
        break;
      case 'gift_given':
      case 'donation_given':
        b.giftsGiven += txn.paise;
        break;
      case 'gift_received':
      case 'donation_received':
        b.giftsReceived += txn.paise;
        break;
    }
  }

  for (const b of byPerson.values()) b.net = b.theyOweMe - b.iOweThem;
  return byPerson;
}
