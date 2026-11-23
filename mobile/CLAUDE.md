@AGENTS.md

## Auto-categorization (`src/core/categorize/categorize.ts`)

- **Note first.** If a note matches (learned `note` rule, then static note keyword), it picks the
  category and beats the learned payee and merchant brand. A Paytm tag only confirms it: tag agrees →
  no review; tag differs → keep the note's category and flag for review. Intentional transfers
  (transfer tag, or untagged self/received rows) are never re-filed by a note.
- **No note:** learned payee (VPA, then merchant) → Paytm tag → merchant brand → statement kind.
- **Learning (`learnFromTxn` in `src/services/db/repository.ts`):** a concise note (≤ 2 words) is
  learned *instead of* the payee, so one "snacks" payment doesn't overwrite what a person is usually
  paid for. Without a learnable note, the payee (VPA + merchant) is learned.
