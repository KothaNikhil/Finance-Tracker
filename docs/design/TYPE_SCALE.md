# Type scale

Two rules govern every piece of text in the app.

**Nothing is heavier than weight 500.** Hierarchy comes from size, from `text` versus
`textSecondary`, and from the semantic `spend` / `income` / `accent` / `review` colours. Never from
boldness. `src/components/__tests__/themed-text.test.tsx` fails if any type exceeds 500.

**Type is chosen by role, not by screen.** A list row on Activity, on Lending, on Import and inside
the transaction sheet is the same role, so it renders at the same size. This is the rule that broke
once already: Lending's row titles and amounts were raised above Activity's to rebuild the
hierarchy bold used to carry, and the two screens visibly diverged.

The canonical mapping lives in `mobile/src/constants/typography.ts` as `TextRole`. Reference it
rather than naming a `ThemedText` type inline.

| Role | Type | Size / line height | Notes |
|---|---|---|---|
| `screenTitle` | `subtitle` | 22 / 27 | The screen's own name |
| `sheetTitle` | `heading` | 16 / 21 | Bottom sheet or focused panel title |
| `sheetHeader` | `smallEmphasis` | 13 / 17 | Compact sheet chrome |
| `sectionLabel` | `overline` | 11 / 14 | Tracked, muted, above a group |
| `summaryLabel` | `caption` | 11 / 14 | Names a figure in a summary block |
| `summaryFigure` | `stat` | 16 / 20 | Figure in a summary strip |
| `summaryHeadline` | `amount` | 20 / 24 | A summary card's headline figure |
| `summaryHero` | `amountLarge` | 26 / 30 | The one figure a screen leads with |
| `rowTitle` | `label` | 14 / 18 | Merchant, person, loan, setting |
| `rowSecondary` | `caption` | 11 / 14 | Supporting line under a row title |
| `rowAmount` | `label` | 14 / 18 | Money on the right of a row, tabular |
| `nestedRowTitle` | `small` | 13 / 17 | Child row, also `textSecondary` |
| `nestedRowSecondary` | `caption` | 11 / 14 | |
| `nestedRowAmount` | `smallEmphasis` | 13 / 17 | |
| `detailLabel` | `small` | 13 / 17 | `textSecondary`, in a details panel |
| `detailValue` | `small` | 13 / 17 | |
| `helper` | `small` | 13 / 17 | Helper text, inline errors, empty states |
| `badge` | `caption` | 11 / 14 | Pills, badges, chips |

## Summary figures may be larger than row amounts

`summaryHero` at 26 and `summaryHeadline` at 20 sit above `rowAmount` at 14 on purpose. They are a
different role: one figure a screen leads with, versus one of many comparable figures in a list.
The transaction sheet's header keeps its own three-step ladder — amount 20, title 16, meta 13 —
for the same reason: it is a summary block, not a row. The rows *inside* that sheet are list rows
and match list rows everywhere else.

## Nesting without a size step

Lending's nested loan rows sit under a person row. They are subordinate through indentation, the
absence of an avatar, a `textSecondary` title, a shorter row, and the `nestedRow*` step — not
through making the parent bigger than rows on other screens.

## Floors

No text below 11px. Content the user reads stays at 13px or above. `adjustsFontSizeToFit` uses
`MIN_FONT_SCALE` (0.85), which floors a 14px figure at 11.9px.
