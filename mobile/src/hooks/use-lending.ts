/**
 * Live hooks for the money-lent tracker (loan-grouping model). `useLoans` reads every loan and every
 * loan-attached transaction, rolls each loan up with the pure `loanBalanceFromTxns`, resolves person
 * names, splits active vs closed, and sums the two headline figures (owed to you / you owe) from the
 * active loans' outstanding. `useUnattachedTxns` backs the "attach existing" picker.
 */

import { asc, eq } from 'drizzle-orm';
import { useMemo } from 'react';

import type { TxnFilter } from '@/core/analytics';
import { loanBalanceFromTxns, type LoanBalance, type LoanKind } from '@/core/lending/roles';
import { people, type LoanRow, type TransactionRow } from '@/core/db/schema';
import { useLiveQuery } from '@/hooks/use-live-query';
import { getDb } from '@/services/db/database';
import { loansQuery, loanTxnsQuery, unattachedTxnsQuery } from '@/services/db/queries/lending';

/** A loan with its resolved name, balance and attached transactions. */
export interface LoanView {
  id: number;
  name: string;
  personId: number;
  personName: string;
  kind: LoanKind;
  closed: boolean;
  balance: LoanBalance;
  /**
   * Signed net principal position: positive → they owe you this much; negative → you owe them
   * (e.g. an over-repaid loan). For a lent loan it's `outstanding`; for a borrowed loan it's negated.
   */
  netOwedToMePaise: number;
  txns: TransactionRow[];
}

export interface LoansOverview {
  active: LoanView[];
  closed: LoanView[];
  /** Σ outstanding (≥0) of active LENT loans — total others still owe you (paise). */
  owedToMePaise: number;
  /** Σ outstanding (≥0) of active BORROWED loans — total you still owe (paise). */
  iOwePaise: number;
  /** Look up a single loan view by id (for the detail sheet). */
  byId: (id: number | null) => LoanView | null;
  personName: (id: number | null) => string;
  loading: boolean;
}

export function useLoans(): LoansOverview {
  const db = getDb();
  const loansRes = useLiveQuery(loansQuery(db), []);
  const txnsRes = useLiveQuery(loanTxnsQuery(db), []);
  const peopleRes = useLiveQuery(
    db.select({ id: people.id, name: people.name }).from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)),
    [],
  );

  return useMemo(() => {
    const loanRows = (loansRes.data ?? []) as LoanRow[];
    const txns = (txnsRes.data ?? []) as TransactionRow[];
    const nameOf = new Map((peopleRes.data ?? []).map((p) => [p.id, p.name]));
    const personName = (id: number | null) => (id != null ? (nameOf.get(id) ?? `Person #${id}`) : 'No person');

    const byLoan = new Map<number, TransactionRow[]>();
    for (const t of txns) {
      if (t.loanId != null) {
        const list = byLoan.get(t.loanId) ?? [];
        list.push(t);
        byLoan.set(t.loanId, list);
      }
    }

    const views: LoanView[] = loanRows.map((l) => {
      const loanTxns = byLoan.get(l.id) ?? [];
      const kind = l.kind as LoanKind;
      const balance = loanBalanceFromTxns(loanTxns);
      // Over-repayment flips who owes whom: a lent loan repaid beyond principal means YOU owe them.
      const netOwedToMePaise = kind === 'lent' ? balance.outstandingPaise : -balance.outstandingPaise;
      return {
        id: l.id,
        name: l.name,
        personId: l.personId,
        personName: personName(l.personId),
        kind,
        closed: l.closed,
        balance,
        netOwedToMePaise,
        txns: loanTxns,
      };
    });

    const active = views.filter((v) => !v.closed);
    const closed = views.filter((v) => v.closed);

    let owedToMePaise = 0;
    let iOwePaise = 0;
    for (const v of active) {
      if (v.netOwedToMePaise > 0) owedToMePaise += v.netOwedToMePaise;
      else if (v.netOwedToMePaise < 0) iOwePaise += -v.netOwedToMePaise;
    }

    const byId = (id: number | null) => (id != null ? (views.find((v) => v.id === id) ?? null) : null);

    return {
      active,
      closed,
      owedToMePaise,
      iOwePaise,
      byId,
      personName,
      loading: loansRes.updatedAt === undefined,
    };
  }, [loansRes.data, loansRes.updatedAt, txnsRes.data, peopleRes.data]);
}

/** Live list of unattached transactions (candidates to attach to a loan), narrowed by a filter. */
export function useUnattachedTxns(filter: TxnFilter = {}, limit = 100): TransactionRow[] {
  const db = getDb();
  const key = JSON.stringify(filter);
  const { data } = useLiveQuery(unattachedTxnsQuery(db, filter, limit), [key, limit]);
  return (data ?? []) as TransactionRow[];
}
