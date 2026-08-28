/**
 * Live hooks for the money-lent tracker (loan-grouping model). `useLoans` reads every loan and every
 * loan-attached transaction, rolls each loan up with the pure `loanBalanceFromTxns`, resolves person
 * names, splits active vs closed, and sums the two headline figures (owed to you / you owe) from the
 * active loans' outstanding. `useUnattachedTxns` backs the "attach existing" picker.
 */

import { asc, eq } from 'drizzle-orm';
import { useMemo } from 'react';

import type { TxnFilter } from '@/core/analytics';
import { loanBalanceFromParts, loanPartOf, type LoanBalance, type LoanContribution, type LoanKind, type LoanPart } from '@/core/lending/roles';
import { people, type LoanRow, type TransactionRow } from '@/core/db/schema';
import { useLiveQuery } from '@/hooks/use-live-query';
import { getDb } from '@/services/db/database';
import { loanAllocationsQuery, loansQuery, loanTxnsQuery, unattachedTxnsQuery } from '@/services/db/queries/lending';

/** A slice of one transaction applied to a loan (from a split payment). */
export interface LoanAllocationView {
  id: number;
  txnId: number;
  paise: number;
  part: LoanPart | null;
  isoDate: string;
  /** A short label for the underlying transaction (counterparty or note). */
  label: string;
  direction: string;
}

/** A loan with its resolved name, balance, directly-attached transactions, and split slices. */
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
  /** Portions of split payments applied to this loan (shown under the attached transactions). */
  allocations: LoanAllocationView[];
}

/** All of one person's active loans, netted — the Lent tab groups by this. */
export interface PersonGroup {
  personId: number;
  personName: string;
  loans: LoanView[];
  /** Net across this person's ACTIVE loans: positive → they owe you; negative → you owe them. */
  netOwedToMePaise: number;
  /** Total interest across this person's active loans. */
  interestPaise: number;
}

/** The joined shape `loanAllocationsQuery` returns. */
interface AllocRow {
  id: number;
  loanId: number;
  txnId: number;
  part: string | null;
  paise: number;
  transferRole: string | null;
  isoDate: string;
  counterpartyName: string | null;
  remarks: string | null;
  direction: string;
}

export interface LoansOverview {
  active: LoanView[];
  closed: LoanView[];
  /** Active loans grouped by person (netted), most-owed first — the Lent tab's top level. */
  people: PersonGroup[];
  /** Σ (≥0) of each person's positive net — total others still owe you, netted per person (paise). */
  owedToMePaise: number;
  /** Σ (≥0) of each person's negative net — total you still owe, netted per person (paise). */
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
  const allocsRes = useLiveQuery(loanAllocationsQuery(db), []);
  const peopleRes = useLiveQuery(
    db.select({ id: people.id, name: people.name }).from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)),
    [],
  );

  return useMemo(() => {
    const loanRows = (loansRes.data ?? []) as LoanRow[];
    const txns = (txnsRes.data ?? []) as TransactionRow[];
    const allocRows = (allocsRes.data ?? []) as AllocRow[];
    const nameOf = new Map((peopleRes.data ?? []).map((p) => [p.id, p.name]));
    const personName = (id: number | null) => (id != null ? (nameOf.get(id) ?? `Person #${id}`) : 'No person');

    const txnsByLoan = new Map<number, TransactionRow[]>();
    for (const t of txns) {
      if (t.loanId != null) {
        const list = txnsByLoan.get(t.loanId) ?? [];
        list.push(t);
        txnsByLoan.set(t.loanId, list);
      }
    }

    const allocsByLoan = new Map<number, LoanAllocationView[]>();
    for (const a of allocRows) {
      const view: LoanAllocationView = {
        id: a.id,
        txnId: a.txnId,
        paise: a.paise,
        // The slice's own part; legacy rows (null) fall back to the txn's single transfer_role.
        part: (a.part as LoanPart | null) ?? loanPartOf(a.transferRole),
        isoDate: a.isoDate,
        label: a.counterpartyName ?? a.remarks ?? '',
        direction: a.direction,
      };
      const list = allocsByLoan.get(a.loanId) ?? [];
      list.push(view);
      allocsByLoan.set(a.loanId, list);
    }

    const views: LoanView[] = loanRows.map((l) => {
      const loanTxns = txnsByLoan.get(l.id) ?? [];
      const allocations = allocsByLoan.get(l.id) ?? [];
      const kind = l.kind as LoanKind;
      const contribs: LoanContribution[] = [
        ...loanTxns.map((t) => ({ part: loanPartOf(t.transferRole), paise: t.paise })),
        ...allocations.map((a) => ({ part: a.part, paise: a.paise })),
      ];
      const balance = loanBalanceFromParts(contribs);
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
        allocations,
      };
    });

    const active = views.filter((v) => !v.closed);
    const closed = views.filter((v) => v.closed);

    // Group ACTIVE loans by person and net each person, so one person owed for several reasons reads
    // as a single position (e.g. a loan they over-repaid cancels another they still owe).
    const groupMap = new Map<number, PersonGroup>();
    for (const v of active) {
      let g = groupMap.get(v.personId);
      if (!g) groupMap.set(v.personId, (g = { personId: v.personId, personName: v.personName, loans: [], netOwedToMePaise: 0, interestPaise: 0 }));
      g.loans.push(v);
      g.netOwedToMePaise += v.netOwedToMePaise;
      g.interestPaise += v.balance.interestPaise;
    }
    const people_ = [...groupMap.values()].sort((a, b) => Math.abs(b.netOwedToMePaise) - Math.abs(a.netOwedToMePaise));

    let owedToMePaise = 0;
    let iOwePaise = 0;
    for (const g of people_) {
      if (g.netOwedToMePaise > 0) owedToMePaise += g.netOwedToMePaise;
      else if (g.netOwedToMePaise < 0) iOwePaise += -g.netOwedToMePaise;
    }

    const byId = (id: number | null) => (id != null ? (views.find((v) => v.id === id) ?? null) : null);

    return {
      active,
      closed,
      people: people_,
      owedToMePaise,
      iOwePaise,
      byId,
      personName,
      loading: loansRes.updatedAt === undefined,
    };
  }, [loansRes.data, loansRes.updatedAt, txnsRes.data, allocsRes.data, peopleRes.data]);
}

/** Live list of unattached transactions (candidates to attach to a loan), narrowed by a filter. */
export function useUnattachedTxns(filter: TxnFilter = {}, limit = 100): TransactionRow[] {
  const db = getDb();
  const key = JSON.stringify(filter);
  const { data } = useLiveQuery(unattachedTxnsQuery(db, filter, limit), [key, limit]);
  return (data ?? []) as TransactionRow[];
}
