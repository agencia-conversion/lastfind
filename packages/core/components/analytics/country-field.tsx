'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import { countryName, countryOptions, type CountryLocale } from '@/lib/countries';
import { engineCollectsIn, engineUnavailable, ENGINE_LABELS, type Engine } from '@/lib/engines';
type Copy = (en: string, pt: string) => string;
type Option<V> = { value: V; label: string };

/**
 * A searchable choice among many options (countries, time zones): the catalog's Combobox drawn as a field. With `name` it also
 * carries the value in a native field, so a form reads, resets and tracks it as any input.
 */
export function SearchSelect<V extends string | number>({
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  locale,
  search,
  empty,
  disabled,
  id,
}: {
  name?: string;
  value?: V;
  defaultValue: V;
  onValueChange?: (value: V) => void;
  options: Option<V>[];
  locale: string;
  /** The search box's placeholder and name. */
  search: string;
  empty: string;
  disabled?: boolean;
  id?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    const reset = () => setOwn(defaultValue);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue]);
  return (
    <>
      <Combobox
        items={options}
        value={options.find((item) => item.value === current) ?? null}
        locale={locale}
        autoHighlight
        disabled={disabled}
        onValueChange={(item: Option<V> | null) => {
          if (!item) return;
          setOwn(item.value);
          onValueChange?.(item.value);
          if (field.current) {
            field.current.value = String(item.value);
            field.current.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }}
      >
        <ComboboxTrigger id={id} render={<Button variant="outline" className="w-full justify-between text-body font-(--weight-text)" />}>
          <ComboboxValue />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput showTrigger={false} placeholder={search} aria-label={search} />
          <ComboboxEmpty>{empty}</ComboboxEmpty>
          <ComboboxList>
            {(item: Option<V>) => (
              <ComboboxItem key={item.value} value={item}>
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {name && <input ref={field} name={name} defaultValue={defaultValue} hidden readOnly />}
    </>
  );
}

/** Searchable country picker: the countries where at least one of the account's AIs collects, by name in the interface language. */
export function CountrySelect({
  name,
  value,
  defaultValue = 2840,
  onValueChange,
  engines,
  locale,
  t,
}: {
  name?: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (code: number) => void;
  /** The account's AIs; a country none of them collects in is not offered (the current one always is). */
  engines: readonly Engine[];
  locale: CountryLocale;
  t: Copy;
}) {
  const current = value ?? defaultValue;
  const options = useMemo<Option<number>[]>(
    () =>
      countryOptions(locale)
        .filter((item) => item.code === current || engines.some((engine) => engineCollectsIn(engine, item.code)))
        .map((item) => ({ value: item.code, label: item.name })),
    [locale, engines, current],
  );
  return (
    <SearchSelect name={name} value={value} defaultValue={defaultValue} onValueChange={onValueChange} options={options} locale={locale}
      search={t('Search a country', 'Busque um país')} empty={t('No country found.', 'Nenhum país encontrado.')} />
  );
}

/** The IANA time zones this browser knows, each with its current offset ("America/Sao_Paulo (GMT-3)"); `current` is always offered. */
export function timeZoneOptions(locale: string, current: string): Option<string>[] {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([current, ...zones])].sort().map((zone) => {
    const offset = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
    return { value: zone, label: offset ? `${zone.replaceAll('_', ' ')} (${offset})` : zone.replaceAll('_', ' ') };
  });
}

/** Which of the account's AIs cannot collect in this country; nothing when all can (every AI answers in both languages). */
export function EngineAvailability({
  engines,
  location,
  locale,
  t,
}: {
  engines: readonly Engine[];
  location: number;
  locale: CountryLocale;
  t: Copy;
}) {
  const country = engines.filter((engine) => engineUnavailable(engine, location)).map((engine) => ENGINE_LABELS[engine]).join(', ');
  if (!country) return null;
  const place = countryName(location, locale);
  return (
    <span className="block text-caption text-muted-foreground">
      {t(`Not available in the project's country (${place}): ${country}.`, `Indisponível no país do projeto (${place}): ${country}.`)}
    </span>
  );
}
