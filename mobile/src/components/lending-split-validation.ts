import type { Direction } from '@/core/domain/money';
import type { LoanPart } from '@/core/lending/roles';

export interface LendingSplitDraft {
  loanId: number | null;
  part: LoanPart | null;
  paise: number | undefined;
  direction: 'in' | 'out' | undefined;
}

export interface ValidLendingAllocation {
  loanId: number;
  part: LoanPart;
  paise: number;
}

export interface LendingSplitValidation {
  valid: boolean;
  allocations: ValidLendingAllocation[];
  allocatedPaise: number;
  remainingPaise: number;
  rowErrors: (string | null)[];
  errors: string[];
}

/**
 * Validate the complete split draft before replacing a transaction's allocations.
 *
 * A draft is deliberately all-or-nothing: an incomplete row cannot be silently dropped while the
 * other rows save. Partial allocation of the source amount is valid, as is using the same loan in
 * several rows (for example, repayment plus interest).
 */
export function validateLendingSplit(
  source: { direction: Direction; paise: number; enforceDirection?: boolean },
  rows: LendingSplitDraft[],
): LendingSplitValidation {
  const allocations: ValidLendingAllocation[] = [];
  const rowErrors = rows.map((row) => {
    if (row.loanId == null) return 'Choose a loan.';
    if (row.part == null) return 'Choose principal, repayment or interest.';
    if (row.paise == null || !Number.isInteger(row.paise) || row.paise <= 0) {
      return 'Enter an amount greater than zero.';
    }
    if (row.direction == null) return 'Choose a valid loan and part.';
    allocations.push({ loanId: row.loanId, part: row.part, paise: row.paise });
    return null;
  });

  const errors: string[] = [];
  if (rows.length === 0) errors.push('Add at least one slice.');
  if (source.paise <= 0) errors.push('The source transaction amount must be greater than zero.');

  const directions = rows
    .map((row) => row.direction)
    .filter((direction): direction is 'in' | 'out' => direction != null);
  if (new Set(directions).size > 1) {
    errors.push('All slices must move money in the same direction.');
  }

  // Imported rows must retain the direction printed by their statement. A manual loan entry can be
  // reclassified safely because the repository updates its direction to the chosen representative role.
  if (source.enforceDirection !== false) {
    if (source.direction === 'self') {
      errors.push('A self-transfer cannot be allocated to a loan.');
    } else if (directions.some((direction) => direction !== source.direction)) {
      errors.push(
        `Slices must be money ${source.direction} to match this transaction.`,
      );
    }
  }

  const allocatedPaise = rows.reduce(
    (sum, row) => sum + (row.paise != null && Number.isInteger(row.paise) && row.paise > 0 ? row.paise : 0),
    0,
  );
  if (allocatedPaise > source.paise) {
    errors.push('Allocated total cannot exceed the source transaction.');
  }

  return {
    valid:
      rows.length > 0 &&
      rowErrors.every((error) => error == null) &&
      errors.length === 0 &&
      allocations.length === rows.length,
    allocations,
    allocatedPaise,
    remainingPaise: Math.max(0, source.paise - allocatedPaise),
    rowErrors,
    errors,
  };
}
