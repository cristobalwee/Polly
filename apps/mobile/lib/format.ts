/**
 * Cross-platform formatting helpers for money / cents / percentages.
 *
 * Every monetary number we touch is integer cents. Display formats follow the
 * same conventions Kalshi's own UI uses: dollar amounts with two decimals,
 * and contract prices as `NN¢`.
 */

/** Format an integer-cents value as `$X.YZ` (or `−$X.YZ` for negatives). */
export function formatDollars(cents: number, opts: { showSign?: boolean } = {}): string {
  const sign = cents < 0 ? '−' : opts.showSign && cents > 0 ? '+' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`;
}

/** A 0–100 cents price (a binary-contract quote). `null` shows as `—`. */
export function formatContractCents(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${value}¢`;
}

/** Format a signed-cents delta with a leading `+` or `−` and 2-decimal $. */
export function formatChange(cents: number): string {
  return formatDollars(cents, { showSign: true });
}

/** Pick a Tamagui colour token for P&L colouring. */
export function pnlColor(cents: number): string {
  if (cents > 0) return '$green10';
  if (cents < 0) return '$red10';
  return '$placeholderColor';
}
