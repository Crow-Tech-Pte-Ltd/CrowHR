/**
 * The app's label styles. Four roles cover every heading and label below a page title; screens
 * use these instead of hand-rolling `font-azeret text-2xs uppercase tracking-wider`, so a section
 * heading, a field label and a column header look different and the page has a hierarchy.
 *
 * - `section`: an `h2` under the page title, and card titles. Sentence case, Azeret Mono.
 * - `group`: a smaller heading inside a card, form, sheet or drawer (fieldset legends,
 *   sub-sections). Sentence case, Azeret Mono.
 * - `field`: the label beside or above a read-only value (definition lists, totals, payslip
 *   lines). Sentence case body font, muted, so the value reads first. Form controls use `<Label>`.
 * - `column`: table and grid column headers, and navigation group labels (sidebar, menus,
 *   command palette). The only uppercase text in the app.
 *
 * Numbers stay `num` (Azeret Mono, tabular). Status chips are `StatusPill` (sentence case).
 */
export const textStyle = {
  section: "font-azeret text-sm font-semibold leading-5 tracking-tight text-ink",
  group: "font-azeret text-xs font-semibold leading-4 text-ink",
  field: "text-xs leading-4 text-primary-200",
  column: "font-azeret text-2xs font-medium uppercase leading-4 tracking-wider text-primary-200",
} as const;

export type TextStyle = keyof typeof textStyle;
