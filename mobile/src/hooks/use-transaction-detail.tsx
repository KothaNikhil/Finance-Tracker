/**
 * App-wide "current transaction" state, so the transaction detail sheet lives ONCE at the app root
 * (see {@link TransactionDetailController}) instead of being re-wired on every screen. Any screen
 * opens a transaction with `openTxn(id)`; the sheet resolves the row by id (live), so it works from
 * any tab — even one that never loaded that row.
 *
 * It also remembers the LAST-EDITED transaction (`lastEditedId`) — set whenever an edit action fires
 * in the sheet — so a floating pill can reopen it from any page ({@link LastEditedPill}). Editing is
 * category set/remove, accept, or attach/detach to a loan; a delete clears it (the row is gone).
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TransactionDetailValue {
  /** The transaction currently shown in the global detail sheet, or null when closed. */
  openId: number | null;
  /** The most recently edited transaction, for the "reopen last edited" pill. */
  lastEditedId: number | null;
  /** Open the global detail sheet for a transaction. */
  openTxn: (id: number) => void;
  /** Reopen the last-edited transaction (no-op when there isn't one). */
  openLast: () => void;
  /** Close the global detail sheet. */
  close: () => void;
  /** Record that a transaction was just edited (drives the pill). */
  noteEdited: (id: number) => void;
  /** Forget the last-edited transaction (e.g. after it's deleted, or when the pill is dismissed). */
  clearLastEdited: () => void;
}

const TransactionDetailContext = createContext<TransactionDetailValue | null>(null);

export function TransactionDetailProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [lastEditedId, setLastEditedId] = useState<number | null>(null);

  const value = useMemo<TransactionDetailValue>(
    () => ({
      openId,
      lastEditedId,
      openTxn: (id) => setOpenId(id),
      openLast: () => {
        if (lastEditedId != null) setOpenId(lastEditedId);
      },
      close: () => setOpenId(null),
      noteEdited: (id) => setLastEditedId(id),
      clearLastEdited: () => setLastEditedId(null),
    }),
    [openId, lastEditedId],
  );

  return <TransactionDetailContext.Provider value={value}>{children}</TransactionDetailContext.Provider>;
}

export function useTransactionDetail(): TransactionDetailValue {
  const ctx = useContext(TransactionDetailContext);
  if (!ctx) throw new Error('useTransactionDetail must be used within a TransactionDetailProvider');
  return ctx;
}
