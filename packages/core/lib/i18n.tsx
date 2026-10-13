'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  setLocaleInContext: (locale: Locale) => void;
  messages: Record<string, string>;
}>({
  locale: 'en',
  setLocale: () => undefined,
  setLocaleInContext: () => undefined,
  messages: {},
});
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
  const setLocaleInContext = (next: Locale) => setLocaleState(next);
  const setLocale = (next: Locale) => {
    setLocaleInContext(next);
    document.cookie = `lastfind_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <LocaleContext.Provider
      value={{ locale, setLocale, setLocaleInContext, messages }}
    >
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
  const interfaceLanguageLabel =
    locale === 'en' ? 'Interface language' : 'Idioma da interface';
  const visibleLabel = compact
    ? locale === 'en'
      ? 'EN'
      : 'PT'
    : locale === 'en'
      ? 'English'
      : 'Português (BR)';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${interfaceLanguageLabel}: ${visibleLabel}`}
        className={`language-switcher-trigger ${compact ? 'compact' : ''}`}
      >
        {visibleLabel}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="analytics-menu w-56 min-w-56 ring-0"
      >
        <DropdownMenuItem onClick={() => setLocale('en')}>
          English
          {locale === 'en' && (
            <Check className="ml-auto text-primary" aria-hidden="true" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLocale('pt-BR')}>
          Português (BR)
          {locale === 'pt-BR' && (
            <Check className="ml-auto text-primary" aria-hidden="true" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
