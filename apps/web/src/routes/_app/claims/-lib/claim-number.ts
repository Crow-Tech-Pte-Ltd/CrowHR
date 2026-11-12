/**
 * Claim numbers in numeric order, as the server sorts them (`claimNumberOrder` in core): they are
 * `C-` and at least four digits, so a shorter number is a smaller one. No number (a draft) sorts last.
 */
export function compareClaimNumbers(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
