/**
 * AI credits on screen (1 US cent of AI cost is 10 credits, kept with decimals): always whole, what is left rounded
 * down and what was spent rounded up, so the screen never promises a credit that is not there.
 */
export const wholeCredits = (value: number, kind: 'left' | 'used') => Math.max(0, kind === 'left' ? Math.floor(value + 1e-9) : Math.ceil(value - 1e-9));
export const creditsFormat = (locale: string, kind: 'left' | 'used') => (value: number) => new Intl.NumberFormat(locale).format(wholeCredits(value, kind));

export function usageMeter(
  used: number | undefined,
  limit: number | null | undefined,
  locale: string,
  /** How a value is written (default: a plain number); e.g. money for a budget. */
  write: (value: number) => string = (value) => new Intl.NumberFormat(locale).format(value),
  /** `left`: the text says what is left of the limit (a balance: "4,509 left") instead of what was used; the bar still fills as it is used. */
  { left = false }: { left?: boolean } = {},
) {
  const format = { format: write };
  if (used === undefined || limit === undefined) {
    return { state: 'unknown' as const, value: undefined, text: '—' };
  }
  if (limit === null) {
    return {
      state: 'unlimited' as const,
      value: undefined,
      text: `${format.format(used)} (${locale === 'pt-BR' ? 'Ilimitado' : 'Unlimited'})`,
    };
  }
  const value =
    limit <= 0 ? 100 : Math.max(0, Math.min(100, (used / limit) * 100));
  return {
    state:
      value >= 100
        ? ('reached' as const)
        : value >= 80
          ? ('warning' as const)
          : ('normal' as const),
    value,
    text: left ? `${format.format(Math.max(0, limit - used))} ${locale === 'pt-BR' ? 'restantes' : 'left'}` : `${format.format(used)} / ${format.format(limit)}`,
  };
}
