'use client';

import { useId, useState } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { enUS, ptBR } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCopy, useNumbers } from './shared';
import type { DemoFilters } from './demo-data';
import {
  dateKey,
  DEMO_FIRST_DATE,
  DEMO_LAST_DATE,
  DEMO_TODAY,
  getDateRange,
  isValidDateRange,
  parseISODate,
  type DateRangeBounds,
} from './date-range';

type Period = Pick<DemoFilters, 'days' | 'from' | 'to'>;
type Preset = Period & { id: string; en: string; pt: string };
const presetsFor = (lastDateKey: string, live: boolean): Preset[] => {
  const lastDate = parseISODate(lastDateKey)!;
  return [
  { id: '1', days: '1', en: live ? 'Today' : 'Yesterday', pt: live ? 'Hoje' : 'Ontem' },
  ...['7', '14', '28', '30'].map((days) => ({
    id: days,
    days,
    en: `Last ${days} days`,
    pt: `Últimos ${days} dias`,
  })),
  {
    id: 'this-month',
    days: 'custom',
    from: dateKey(
      new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), 1)),
    ),
    to: lastDateKey,
    en: 'This month',
    pt: 'Este mês',
  },
  {
    id: 'last-month',
    days: 'custom',
    from: dateKey(
      new Date(
        Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() - 1, 1),
      ),
    ),
    to: dateKey(
      new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), 0)),
    ),
    en: 'Last month',
    pt: 'Mês passado',
  },
  ];
};

export function DateRangePicker({
  value,
  onChange,
  bounds,
}: {
  value: Period;
  onChange: (period: Period) => void;
  bounds?: DateRangeBounds;
}) {
  const l = useCopy();
  const { locale, number } = useNumbers();
  const mobile = useIsMobile();
  const id = useId();
  const limits = bounds ?? { lastDate: DEMO_LAST_DATE, firstDate: '2000-01-01', maxDays: 366 };
  const firstAllowedDate = parseISODate(limits.firstDate)!;
  const lastDate = parseISODate(limits.lastDate)!;
  const presets = presetsFor(limits.lastDate, !!bounds);
  const applied = getDateRange(value, limits);
  const [open, setOpen] = useState(false);
  const formatInput = (key: string) => {
    const [year, month, day] = key.split('-');
    return locale === 'pt-BR'
      ? `${day}/${month}/${year}`
      : `${month}/${day}/${year}`;
  };
  const parseInput = (text: string) => {
    const parts =
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim()) ??
      /^(\d{2})(\d{2})(\d{4})$/.exec(text.trim());
    if (!parts) return undefined;
    const month = locale === 'pt-BR' ? parts[2] : parts[1];
    const day = locale === 'pt-BR' ? parts[1] : parts[2];
    const key = `${parts[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return parseISODate(key) ? key : undefined;
  };
  const selectedPreset = (period: Period) => {
    const range = getDateRange(period, limits);
    return (
      presets.find((preset) => {
        const option = getDateRange(preset, limits);
        return range.from === option.from && range.to === option.to;
      })?.id ?? 'custom'
    );
  };
  const [draft, setDraft] = useState(() => ({
    from: formatInput(applied.from),
    to: formatInput(applied.to),
  }));
  const [presetId, setPresetId] = useState(() => selectedPreset(value));
  const [month, setMonth] = useState(() => parseISODate(applied.from)!);
  const from = parseInput(draft.from);
  const to = parseInput(draft.to);
  const valid = !!from && !!to && isValidDateRange(from, to, limits);
  const draftRange = valid ? getDateRange({ days: 'custom', from, to }, limits) : null;
  const selected = from
    ? {
        from: parseISODate(from),
        to: to && to >= from ? parseISODate(to) : undefined,
      }
    : undefined;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const summary =
    applied.from === applied.to
      ? dateFormat.format(parseISODate(applied.from))
      : `${dateFormat.format(parseISODate(applied.from))} – ${dateFormat.format(parseISODate(applied.to))}`;
  const triggerPreset = presets.find((p) => p.id === value.days);
  const numericDays = Number(value.days);
  const validNumericDays = Number.isInteger(numericDays) && numericDays >= 1 && numericDays <= limits.maxDays;
  const triggerLabel = !value.from && !value.to && validNumericDays
    ? triggerPreset ? l(triggerPreset.en, triggerPreset.pt) : l(`Last ${numericDays} days`, `Últimos ${numericDays} dias`)
    : summary;

  const openChange = (next: boolean) => {
    if (next) {
      setDraft({
        from: formatInput(applied.from),
        to: formatInput(applied.to),
      });
      setPresetId(selectedPreset(value));
      setMonth(parseISODate(applied.from)!);
    }
    setOpen(next);
  };
  const choosePreset = (preset: Preset) => {
    const range = getDateRange(preset, limits);
    setDraft({ from: formatInput(range.from), to: formatInput(range.to) });
    setPresetId(preset.id);
    setMonth(parseISODate(range.from)!);
  };
  const validation =
    !from || !to
      ? l(
          'Enter both dates or select them in the calendar.',
          'Informe as duas datas ou selecione no calendário.',
        )
      : from > to
        ? l(
            'The end date must be on or after the start date.',
            'A data final deve ser igual ou posterior à inicial.',
          )
        : l(
            `Choose up to ${limits.maxDays} days, ending by the latest available date.`,
            `Escolha até ${limits.maxDays} dias, até a última data disponível.`,
          );

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="date-range-trigger"
            aria-label={`${l('Date range', 'Período')}: ${triggerLabel}`}
          />
        }
      >
        <CalendarDays />
        <span>{triggerLabel}</span>
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="date-range-popover"
      >
        <div className="date-range-heading">
          <PopoverTitle>{l('Date range', 'Período')}</PopoverTitle>
          <PopoverDescription>
            {l(
              'Select a preset or choose a custom range.',
              'Selecione um atalho ou escolha um período personalizado.',
            )}
          </PopoverDescription>
        </div>
        <div className="date-range-body">
          <fieldset className="date-range-presets">
            <legend className="sr-only">
              {l('Date presets', 'Atalhos de período')}
            </legend>
            {presets.map((preset) => (
              <Button
                key={preset.id}
                variant="ghost"
                aria-pressed={presetId === preset.id}
                className="date-range-preset"
                onClick={() => choosePreset(preset)}
              >
                {l(preset.en, preset.pt)}
                {presetId === preset.id && <Check />}
              </Button>
            ))}
            <Button
              variant="ghost"
              aria-pressed={presetId === 'custom'}
              className="date-range-preset"
              onClick={() => {
                setPresetId('custom');
                setDraft({ from: '', to: '' });
              }}
            >
              {l('Custom', 'Personalizado')}
              {presetId === 'custom' && <Check />}
            </Button>
          </fieldset>
          <div className="date-range-selection">
            <div className="date-range-inputs">
              {(['from', 'to'] as const).map((key) => (
                <div key={key}>
                  <label htmlFor={`${id}-${key}`}>
                    {key === 'from'
                      ? l('Start date', 'Data inicial')
                      : l('End date', 'Data final')}
                  </label>
                  <Input
                    id={`${id}-${key}`}
                    value={draft[key]}
                    placeholder={
                      locale === 'pt-BR' ? 'DD/MM/AAAA' : 'MM/DD/YYYY'
                    }
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                    aria-describedby={`${id}-feedback`}
                    aria-invalid={draft[key] !== '' && !parseInput(draft[key])}
                    onChange={(e) => {
                      setDraft((s) => ({ ...s, [key]: e.target.value }));
                      setPresetId('custom');
                    }}
                    onBlur={() => {
                      const parsed = parseInput(draft[key]);
                      if (parsed) {
                        setMonth(parseISODate(parsed)!);
                        setDraft((previous) => ({
                          ...previous,
                          [key]: formatInput(parsed),
                        }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && valid) {
                        onChange({ days: 'custom', from, to });
                        setOpen(false);
                      }
                    }}
                  />
                </div>
              ))}
            </div>
            <Calendar
              mode="range"
              timeZone="UTC"
              locale={locale === 'pt-BR' ? ptBR : enUS}
              weekStartsOn={0}
              numberOfMonths={mobile ? 1 : 2}
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              today={bounds ? lastDate : parseISODate(DEMO_TODAY)}
              startMonth={firstAllowedDate}
              endMonth={lastDate}
              disabled={[{ before: firstAllowedDate }, { after: lastDate }]}
              showOutsideDays={false}
              onSelect={(range) => {
                setDraft({
                  from: range?.from ? formatInput(dateKey(range.from)) : '',
                  to: range?.to ? formatInput(dateKey(range.to)) : '',
                });
                setPresetId('custom');
              }}
              labels={{
                labelNext: () => l('Next month', 'Próximo mês'),
                labelPrevious: () => l('Previous month', 'Mês anterior'),
                labelDayButton: (day, modifiers) =>
                  [
                    new Intl.DateTimeFormat(locale, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(day),
                    modifiers.today ? l('today', 'hoje') : null,
                    modifiers.selected ? l('selected', 'selecionado') : null,
                  ]
                    .filter(Boolean)
                    .join(', '),
              }}
            />
            <p
              className="date-range-feedback"
              id={`${id}-feedback`}
              aria-live="polite"
            >
              {draftRange
                ? l(
                    `${number(draftRange.days)} ${draftRange.days === 1 ? 'day' : 'days'} selected`,
                    `${number(draftRange.days)} ${draftRange.days === 1 ? 'dia selecionado' : 'dias selecionados'}`,
                  )
                : validation}
            </p>
          </div>
        </div>
        <div className="date-range-footer">
          <p>
            {bounds ? l(`Up to ${limits.maxDays} days`, `Até ${limits.maxDays} dias`) : <>{l('Sample data', 'Dados de exemplo')}: {dateFormat.format(parseISODate(DEMO_FIRST_DATE))} – {dateFormat.format(lastDate)}</>}
          </p>
          <div>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {l('Cancel', 'Cancelar')}
            </Button>
            <Button
              disabled={!valid}
              onClick={() => {
                const preset = presets.find((p) => p.id === presetId);
                onChange(
                  preset
                    ? { days: preset.days, from: preset.from, to: preset.to }
                    : { days: 'custom', from, to },
                );
                setOpen(false);
              }}
            >
              {l('Apply', 'Aplicar')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
