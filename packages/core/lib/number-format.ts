// One number/percent formatter per UI language: pt-BR uses comma decimals
// (30,6%), English keeps the dot. Screens must not hand-roll `toFixed` + `%`.
const formatters = new Map<string, Intl.NumberFormat>();

export const numberLocale = (language: string) =>
  language === 'pt-BR' ? 'pt-BR' : 'en-US';

export function formatNumber(language: string, value: number, digits = 0) {
  const locale = numberLocale(language);
  const key = `${locale}:${digits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

export const formatPercent = (language: string, value: number, digits = 1) =>
  `${formatNumber(language, value, digits)}%`;
