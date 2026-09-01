import type { ThemedTextProps } from '@/components/themed-text';

type TextType = NonNullable<ThemedTextProps['type']>;

/**
 * The canonical type for each role in the UI. Roles are unified across screens: a list row on
 * Activity, Lending, Import and inside the transaction sheet is the same role and therefore the
 * same size. A summary figure may legitimately be larger than a row amount — that is a different
 * role, not a different screen.
 *
 * Read this together with `docs/design/TYPE_SCALE.md`. Anything picking a `ThemedText` type for one
 * of these roles should reference this map rather than naming a type inline, so the app cannot
 * drift back into per-screen scales.
 */
export const TextRole = {
  /** The screen's own name, e.g. "Activity". */
  screenTitle: 'subtitle',
  /** The title bar of a bottom sheet or focused panel. */
  sheetTitle: 'heading',
  /** The small chrome title on a compact sheet header. */
  sheetHeader: 'smallEmphasis',
  /** A tracked, muted label above a group of rows. */
  sectionLabel: 'overline',
  /** The label naming a form input, sitting directly above it. */
  fieldLabel: 'smallEmphasis',

  /** The muted caption naming a figure inside a summary block. */
  summaryLabel: 'caption',
  /** A figure in a summary strip, sitting under its `summaryLabel`. */
  summaryFigure: 'stat',
  /** The single headline figure of a summary card. */
  summaryHeadline: 'amount',
  /** The one hero figure a screen leads with. */
  summaryHero: 'amountLarge',

  /** The primary line of a list row: merchant, person, loan, setting, statement. */
  rowTitle: 'label',
  /** The supporting line under a row title. */
  rowSecondary: 'caption',
  /** The money figure on the right of a list row. */
  rowAmount: 'label',

  /** A row nested under another row; subordinate by indent, colour and this step. */
  nestedRowTitle: 'small',
  nestedRowSecondary: 'caption',
  nestedRowAmount: 'smallEmphasis',

  /** Read-only label/value pairs in a details panel. */
  detailLabel: 'small',
  detailValue: 'small',

  /** Helper text, inline errors, empty states. */
  helper: 'small',
  /** Pills, badges and chips. */
  badge: 'caption',
} as const satisfies Record<string, TextType>;

/**
 * `adjustsFontSizeToFit` shrinks by this much at most. At the 14px row scale that floors a figure
 * at 11.9px, which stays above the 11px minimum the app guarantees.
 */
export const MIN_FONT_SCALE = 0.85;
