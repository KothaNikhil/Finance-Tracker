# Finance Tracker Redesign — Feature Coverage

This checklist is the implementation contract for the redesign. The mockups show representative
states; implementation must preserve every shipped capability below even when a secondary sheet or
confirmation is not shown on the main overview board.

## Non-negotiable finance semantics

- [ ] Self-transfers stay visually distinct and are excluded from spend, income, and transaction totals.
- [ ] Refunds are available only for incoming transactions that are not self-transfers; they offset
      spending and never count as income.
- [ ] Lending principal remains excluded from normal spend/income. A credit-card bill payment is
      excluded only once it is **linked** to its statement — together with that statement's own
      payment-received leg — so exactly one side of a card bill ever counts. An **unlinked** bill
      payment keeps counting, because the statement's line items may never have been imported and
      excluding it would drop that spending entirely.
- [ ] Credit-card statement purchases are ordinary expenses: they carry no transfer role, so they
      appear as normal rows in the Activity list and count in the Home totals, trend chart, and
      category breakdown, before and after their bank bill payment is linked.
- [ ] The SQL aggregates and the pure `countablePaise` predicate are two implementations of one
      counting rule and must agree row-for-row; the Excel export totals must agree with both.
- [ ] Interest and other countable lending parts remain separate from outstanding principal.
- [ ] All money remains integer paise internally and displays as Indian Rupees.
- [ ] The same Activity filter continues to drive its summary, list, breakdowns, and Excel export.

## Shell, identity, and protection

- [ ] Five tabs remain available, presented as Home, Activity, Import, Lending, and Settings.
- [ ] Native and web navigation keep equivalent destinations and selected states.
- [ ] Google sign-in, session persistence, web OAuth completion, per-account databases, and Drive
      restore after login remain intact.
- [ ] The unauthenticated startup gate clearly presents the single shipped login method,
      “Continue with Google,” plus progress/error feedback; it does not imply email OTP exists.
- [ ] A Drive restore remains best-effort after sign-in and never blocks entry when Drive is
      unavailable.
- [ ] Biometric/device-credential lock still gates the app at launch and resume.
- [ ] Splash, database warm-up, loading gates, and light/dark/system appearance remain supported.
- [ ] The last-edited transaction pill remains available above the tab bar.
- [ ] The single-editor lock keeps working: the In-use prompt (Take over / View only), the
      View-only banner under every screen title, every editing control disabled with
      “View only. Take over to edit.”, and the offline-changes warning / discard alert.

Primary sources: [mobile/src/app/_layout.tsx](../../mobile/src/app/_layout.tsx),
[mobile/src/components/app-tabs.tsx](../../mobile/src/components/app-tabs.tsx),
[mobile/src/hooks/use-auth.tsx](../../mobile/src/hooks/use-auth.tsx), and
[mobile/src/hooks/use-app-lock.tsx](../../mobile/src/hooks/use-app-lock.tsx).

## Home

- [ ] All-time and year selection remain available, including month drill-down and whole-year reset.
- [ ] Net spent, spent, received, refunds, and transaction count remain visible. Exclusion guidance
      stays reachable in full — verbatim, screen-reader accessible — behind an `InfoDisclosure`
      rather than rendered permanently.
- [ ] Monthly/yearly bar selection still changes the active period.
- [ ] The complete category breakdown is rendered inline in the scroll; there is no truncated
      “View all” category destination.
- [ ] Category, subcategory, uncategorized, spent, received, and refund taps still deep-link to the
      matching Activity filter.
- [ ] Category drill-down remains available before opening Activity.
- [ ] Empty, loading, error, and retry states are designed.

Primary source: [mobile/src/app/index.tsx](../../mobile/src/app/index.tsx).

## Import

The flow is pick → preview → review. **The preview owns the save**, so the review step operates on
stored records and its rows are editable — that is the reason for the order. Done on the review step
ends the run back at pick, so importing several statements is one loop. The pick step is the
screen’s home on every mount, because the device lock unmounts the tab tree on every return from the
file picker.

- [ ] File landing explains supported Paytm, Axis Bank, KVB, SBI, and Axis Credit Card formats.
- [ ] The operating-system picker still accepts XLS/XLSX/PDF and supports cancellation.
- [ ] Encrypted workbook/PDF password entry, incorrect-password retry, pending-file resume, and
      app-lock reload behavior remain intact.
- [ ] Parsing/saving progress and errors are non-blocking and unambiguous.
- [ ] Preview shows total rows, new rows, duplicates, salvaged rows, skipped rows, debit, and credit,
      and lists **every** parsed transaction — it is the step the user commits from, so nothing is
      truncated.
- [ ] Preview categories and review counts come from a dry-run categorization pass that writes
      nothing. “Save and review” on the preview is the only operation that writes transactions, and
      it performs final deduplication, duplicate reconciliation, auto-categorization, and
      credit-card statement metadata capture.
- [ ] Cancel on the preview is the guarantee that nothing was written. It discards only a
      re-derivable parse, so it needs no confirmation.
- [ ] A preview row opens a read-only detail of what it parsed to and why that category was
      suggested. Preview rows have no stored record, so the detail cannot be edited and says so.
- [ ] The review step reports what the save wrote — count, statement and reconciliation tally — and
      shows this session’s Spent, Received and imported count, month tabs, transaction rows, review
      badges, global review count, Accept all, and last-import revert. Its rows are stored records,
      so tapping one opens the app-wide, editable transaction detail sheet.
- [ ] The review step has no Cancel: the save has already happened, and undoing a whole import is
      last-import revert. Done returns to the pick step. There is no separate “Import another”
      action.
- [ ] The review step is also the destination of the pick step’s session and needs-review rows, so
      it is reachable without importing anything.
- [ ] Needs-review work happens on Import, not by handing off to Activity. The review step can be
      scoped to this session or to the needs-review queue, and that queue is filtered from the
      durable `needs_review` flag — so it stays reachable from the pick step after a Done and in a
      brand-new session, when the session filter matches nothing.
- [ ] On the preview step the header stays fixed, only the transaction list scrolls, and the action
      bar is pinned directly above the tab bar. The list stays virtualized. The tab bar is laid out
      below this screen’s content and carries the system inset itself, so a fixed bar here adds no
      bottom inset of its own.
- [ ] Each step-indicator label is centred under its own circle, and the joining line runs between
      circle centres.
- [ ] Revert-last-import rows are actions, not navigation: they carry no chevron.
- [ ] Supported-formats and password sheets receive the approved visual system.
- [ ] Sample/seed/parity controls remain development-only; diagnostic logs are retained but moved
      out of the primary production path.

Primary sources: [mobile/src/app/import.tsx](../../mobile/src/app/import.tsx),
[mobile/src/components/import-preview.tsx](../../mobile/src/components/import-preview.tsx),
[mobile/src/components/import-result.tsx](../../mobile/src/components/import-result.tsx),
[mobile/src/components/import-row-detail.tsx](../../mobile/src/components/import-row-detail.tsx),
[packages/core/src/import/pipeline.ts](../../packages/core/src/import/pipeline.ts), and
[packages/core/src/import/formats.ts](../../packages/core/src/import/formats.ts).

## Activity

- [ ] Debounced merchant/note/UPI search remains available.
- [ ] Filters preserve period, category, subcategory, account, person, direction, amount range, and
      needs-review dimensions.
- [ ] Refund-only deep links remain supported and the redesigned filter sheet exposes the state
      clearly.
- [ ] Active filters can be removed individually or cleared together, from inside the filter sheet
      as well as from the chip bar.
- [ ] The filter sheet keeps one row per dimension that states its current value and expands in
      place. No picker may hide the sheet behind it, and every row reports whether it is set.
- [ ] The sheet previews how many transactions match before the filter is applied.
- [ ] The period dimension is whole months (`MonthKey`), matching `filter.ts` and `filter-sql.ts`.
      It is picked from a month grid, never typed, and the range cannot be inverted. A day-precision
      picker would silently round and must not be substituted without changing those semantics.
- [ ] Virtualized transaction history, sticky month headers, review badges, and pagination remain.
- [ ] Merchant, account, person, and cashback/refund breakdowns remain reachable.
- [ ] Filtered Excel export retains filename entry and save/share choices.
- [ ] No-data and no-matches states remain distinct.

Primary sources: [mobile/src/app/reports.tsx](../../mobile/src/app/reports.tsx) and
[mobile/src/components/reports-filters.tsx](../../mobile/src/components/reports-filters.tsx).

## Transaction detail and counting actions

- [ ] Direction, amount, counterparty, date/time, category status, and review status remain prominent.
- [ ] Category change, category/subcategory creation, remove category, re-categorize, and per-row
      “Looks right” review acceptance remain available.
- [ ] “How it’s counted” uses conditional controls:
  - [ ] Self-transfer is always available and can be toggled.
  - [ ] Refund appears only for eligible incoming transactions.
  - [ ] Money Lent is always available.
  - [ ] Card bill appears only for linked transactions or eligible outgoing transactions when card
        statements exist.
- [ ] Self-transfer, lending, and card-bill selections explain why the transaction is excluded.
- [ ] Notes can be added/edited with optional re-categorization; imported remarks and Paytm tags stay
      read-only.
- [ ] Statement provenance, source, UPI reference, order ID, account, raw description, and added date
      remain accessible.
- [ ] Payment mode and “For” remain display-only unless a separate product change adds setters.
- [ ] Delete remains behind confirmation and full record details.
- [ ] Card-bill linking preserves suggested amount matches, all-statement selection, statement-item
      drill-down, reconciliation, and unlink.
- [ ] Money Lent preserves one-loan attach, inline loan creation, part selection, remove, and
      split-across-loans allocation with validation.
- [ ] Any transaction can enter Money Lent management; Split across loans is available when active
      loans exist and supports multiple loan slices plus multiple parts for the same loan.
- [ ] Split validation preserves the current rules: every slice has a loan, part, and positive
      amount; all slices move money in the same direction; and the allocated total never exceeds the
      source transaction. A partially unallocated remainder remains valid.

Primary sources: [mobile/src/components/transaction-detail.tsx](../../mobile/src/components/transaction-detail.tsx),
[mobile/src/components/transaction-detail-controller.tsx](../../mobile/src/components/transaction-detail-controller.tsx),
[mobile/src/components/card-bill-sheet.tsx](../../mobile/src/components/card-bill-sheet.tsx), and
[mobile/src/components/add-to-money-lent-sheet.tsx](../../mobile/src/components/add-to-money-lent-sheet.tsx).

## Lending

- [ ] Headline totals preserve person-netted “Owed to you” and “You owe” calculations.
- [ ] People mode is a denser presentation of current person groups, including single- and
      multi-loan people without oversized cards.
- [ ] Loans mode presents every active loan as a compact flat list using existing `LoanView` data.
- [ ] Closed loans remain separate, excluded from active totals, and can be reopened.
- [ ] Loan detail preserves balance, principal/repaid/interest breakdown, direct and split
      transaction rows, and transaction-detail drill-through.
- [ ] New/edit loan preserves lent/borrowed direction, person creation/selection, and optional name.
- [ ] Manual principal, repayment, and interest entries remain available.
- [ ] A hand-entered loan entry stays correctable afterwards — its date, amount, part and note can
      all be changed, and it can be deleted outright. Creation-time amount and date validation
      applies equally to an edit.
- [ ] Editing a loan's person or lent/borrowed direction re-derives the roles and person on the
      transactions attached to it, including split slices, so per-person balances never keep signing
      against the side the loan used to be on.
- [ ] An imported transaction attached to a loan keeps its parsed facts read-only: its amount, date
      and statement text are what the bank reported. Only its loan link, part and classification are
      editable, and detaching — not deleting — is how it leaves a loan.
- [ ] Dates are chosen from a picker rather than typed, with fast year navigation, bounded by any
      minimum/maximum the caller sets.
- [ ] Attach-existing preserves search, amount, direction, part selection, and multi-select.
- [ ] Close, reopen, and delete retain their existing data semantics.
- [ ] Empty/loading/error states exist for People, Loans, loan detail, and attach results.

Primary sources: [mobile/src/app/lending.tsx](../../mobile/src/app/lending.tsx),
[mobile/src/hooks/use-lending.ts](../../mobile/src/hooks/use-lending.ts), and
[mobile/src/components/loan-detail.tsx](../../mobile/src/components/loan-detail.tsx).

## Settings and reference data

- [ ] Categories support add, rename, emoji, reorder, archive/delete, and nested subcategory editing.
- [ ] Payment modes and people/groups support add, rename, reorder, and archive/delete.
- [ ] Appearance retains System, Light, and Dark.
- [ ] Backup retains local folder, share, and Google Drive destinations on native.
- [ ] Restore retains file and latest-Drive choices with destructive confirmation.
- [ ] Delete-all retains typed confirmation and optional backup-first action.
- [ ] Signed-in account and backup-before-sign-out behavior remain available.
- [ ] Web correctly omits unavailable Drive operations.

Primary source: [mobile/src/app/explore.tsx](../../mobile/src/app/explore.tsx).

## Shared quality and navigation

- [ ] Dashboard deep links still seed Activity and can reapply the same filter. Import no longer
      deep-links into Activity: its needs-review queue is handled on Import itself.
- [ ] Routine success uses inline feedback; destructive and irreversible actions still require
      explicit confirmation.
- [ ] Sheets preserve keyboard, drag-dismiss, safe-area, and one-child-sheet-at-a-time behavior.
- [ ] All screens include readable dynamic text, screen-reader labels/states, minimum touch targets,
      reduced motion, contrast-safe colors, and compact/wide layouts.
- [ ] System, Light, and Dark use the same information hierarchy; dark mode uses semantic surface,
      border, text, income, spend, review, and accent tokens without hardcoded light surfaces.
- [ ] Existing finance, import, export, database, Drive, and lending tests continue to pass.
- [ ] New component and screen-state tests cover the redesigned controls and conditional actions.

## Requirements not represented as shipped redesign features

The redesign must not imply that these already exist: email OTP, manual general transactions,
editable transaction amount/payment mode/person, category splitting, event tags, budgets, recurring
items, net worth, EMI schedules, per-account balances, merchant-history pages, PhonePe/GPay
adapters, formal interest accrual, one-tap yearly export UI, Drive backup selection, or family
sharing. They require separate product and data work.
