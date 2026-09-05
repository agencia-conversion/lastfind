'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { translations } from './i18n-catalog';

export type Locale = 'en' | 'pt-BR';
export function translate(
  locale: Locale,
  text: string,
  values?: Record<string, string | number>,
  messages: Record<string, string> = {},
): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  let result =
    locale === 'en'
      ? (messages[normalized] ?? translations[normalized] ?? text)
      : text;
  if (locale === 'en') {
    result = result
      .replace(
        /^Linha (\d+): o prompt deve ter entre 5 e 1\.000 caracteres\.$/,
        'Row $1: prompts must contain between 5 and 1,000 characters.',
      )
      .replace(
        /^Linha (\d+): plataforma desconhecida\.$/,
        'Row $1: unknown AI channel.',
      )
      .replace(
        /^Linha (\d+): esta plataforma aceita até (\d+) caracteres\.$/,
        'Row $1: this channel accepts up to $2 characters.',
      );
  }
  if (values)
    for (const [key, value] of Object.entries(values))
      result = result.replaceAll(`{${key}}`, String(value));
  return result;
}
const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Record<string, string>;
}>({ locale: 'en', setLocale: () => undefined, messages: {} });
export function LocaleProvider({
  initialLocale = 'en',
  messages = {},
  children,
}: {
  initialLocale?: Locale;
  messages?: Record<string, string>;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    document.cookie = `lastfind_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <LocaleContext.Provider value={{ locale, setLocale, messages }}>
      {children}
    </LocaleContext.Provider>
  );
}
export function useI18n() {
  const context = useContext(LocaleContext);
  const t = useCallback(
    (text: string, values?: Record<string, string | number>) =>
      translate(context.locale, text, values, context.messages),
    [context.locale, context.messages],
  );
  const formatTime = useCallback(
    (date: string) =>
      new Date(date).toLocaleString(context.locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }),
    [context.locale],
  );
  return {
    ...context,
    t,
    formatTime,
    conversionUrl:
      context.locale === 'pt-BR'
        ? 'https://conversion.com.br'
        : 'https://conversion.ag',
  };
}
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  return (
    <label className={`language-switcher ${compact ? 'compact' : ''}`}>
      <span className="sr-only">
        {locale === 'en' ? 'Interface language' : 'Idioma da interface'}
      </span>
      <select
        aria-label={
          locale === 'en' ? 'Interface language' : 'Idioma da interface'
        }
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">{compact ? 'EN' : 'English'}</option>
        <option value="pt-BR">{compact ? 'PT' : 'Português (BR)'}</option>
      </select>
    </label>
  );
}
