'use client';

import { useId, useState } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import { enUS, ptBR } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { FilterTrigger } from './filter-trigger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { longestLabel, useCopy, useNumbers } from './shared';
import type { DemoFilters } from './demo-data';
import {
  comparisonRange,
  dateKey,
  DEMO_FIRST_DATE,
  DEMO_LAST_DATE,
  DEMO_TODAY,
  getDateRange,
  isValidComparison,
  isValidDateRange,
  parseISODate,
  type Comparison,
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

/**
 * The header's period: presets, typed dates and a calendar (two months, one on phones), applied together. With `comparison`
 * it also sets what the reports compare with: the period right before (default), chosen dates or nothing.
 */
export function DateRangePicker({
  value,
  onChange,
  bounds,
  comparison,
}: {
  value: Period;
  onChange: (period: Period, comparison: Comparison) => void;
  bounds?: DateRangeBounds;
  comparison?: Comparison;
}) {
  const l = useCopy();
  const { locale, number } = useNumbers();
  const id = useId();
  const narrow = useIsMobile();
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
  // Two months end on the month of the last date shown, so a recent range is seen whole.
  const firstMonth = (key: string) => {
    const date = parseISODate(key)!;
    return narrow ? date : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  };
  const [month, setMonth] = useState(() => firstMonth(applied.to));
  const appliedComparison = comparison ?? { mode: 'previous' as const };
  const comparisonDraft = (current: Comparison) =>
    current.mode === 'custom' ? { from: formatInput(current.from), to: formatInput(current.to) } : { from: '', to: '' };
  const [compareMode, setCompareMode] = useState<Comparison['mode']>(appliedComparison.mode);
  const [compareDraft, setCompareDraft] = useState(() => comparisonDraft(appliedComparison));
  // Which dates the calendar picks: the period's or, with chosen comparison dates, those.
  const [target, setTarget] = useState<'period' | 'compare'>('period');
  const from = parseInput(draft.from);
  const to = parseInput(draft.to);
  const periodValid = !!from && !!to && isValidDateRange(from, to, limits);
  const draftRange = periodValid ? getDateRange({ days: 'custom', from, to }, limits) : null;
  const compareFrom = parseInput(compareDraft.from);
  const compareTo = parseInput(compareDraft.to);
  const compareValid = compareMode !== 'custom' || (!!draftRange && !!compareFrom && compareFrom >= limits.firstDate && isValidComparison(draftRange, compareFrom, compareTo, limits.maxDays));
  const valid = periodValid && compareValid;
  const nextComparison: Comparison = compareMode === 'custom' ? { mode: 'custom', from: compareFrom!, to: compareTo! } : { mode: compareMode };
  const previousRange = draftRange ? comparisonRange(draftRange, { mode: 'previous' }, limits.maxDays) : null;
  const rangeOf = (start?: string, end?: string) =>
    start ? { from: parseISODate(start), to: end && end >= start ? parseISODate(end) : undefined } : undefined;
  const editingComparison = compareMode === 'custom' && target === 'compare';
  const selected = editingComparison ? rangeOf(compareFrom, compareTo) : rangeOf(from, to);
  // The other range stays visible, marked, while the calendar picks one.
  const shown = editingComparison ? rangeOf(from, to) : compareMode === 'custom' ? rangeOf(compareFrom, compareTo) : previousRange ? rangeOf(previousRange.from, previousRange.to) : undefined;
  // Between the first click and the second, the range the second click makes: up to the day under the pointer.
  const [hovered, setHovered] = useState<Date | null>(null);
  const picking = selected?.from && !selected.to ? selected.from : null;
  const preview = picking && hovered ? (hovered < picking ? { from: hovered, to: picking } : { from: picking, to: hovered }) : null;
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const describeRange = (start: string, end: string) => dateFormat.formatRange(parseISODate(start)!, parseISODate(end)!);
  const summary =
    applied.from === applied.to
      ? dateFormat.format(parseISODate(applied.from))
      : `${dateFormat.format(parseISODate(applied.from))} – ${dateFormat.format(parseISODate(applied.to))}`;
  // The trigger names a custom range briefly ("Aug 25 – Sep 7", "25/08 – 07/09"), with the year only when it is not the
  // latest date's; the full range is its title.
  const compactRange = (fromKey: string, toKey: string) => {
    const year = limits.lastDate.slice(0, 4);
    const format = new Intl.DateTimeFormat(locale, {
      ...(locale === 'pt-BR' ? { day: '2-digit', month: '2-digit' } : { day: 'numeric', month: 'short' }),
      year: fromKey.startsWith(year) && toKey.startsWith(year) ? undefined : 'numeric',
      timeZone: 'UTC',
    });
    return fromKey === toKey
      ? format.format(parseISODate(fromKey))
      : format.formatRange(parseISODate(fromKey)!, parseISODate(toKey)!);
  };
  const triggerPreset = presets.find((p) => p.id === value.days);
  const numericDays = Number(value.days);
  const validNumericDays = Number.isInteger(numericDays) && numericDays >= 1 && numericDays <= limits.maxDays;
  const triggerLabel = !value.from && !value.to && validNumericDays
    ? triggerPreset ? l(triggerPreset.en, triggerPreset.pt) : l(`Last ${numericDays} days`, `Últimos ${numericDays} dias`)
    : compactRange(applied.from, applied.to);
  // Sized for the longest preset or a two-month range, so changing the period never resizes the trigger.
  const triggerReserve = longestLabel([
    ...presets.map((preset) => l(preset.en, preset.pt)),
    compactRange(`${limits.lastDate.slice(0, 4)}-09-28`, `${limits.lastDate.slice(0, 4)}-10-27`),
  ]);

  // What the applied period is compared with, for the trigger's title and accessible name.
  const appliedCompared = comparison ? comparisonRange(applied, comparison, limits.maxDays) : null;
  const comparisonSummary = !comparison
    ? ''
    : appliedCompared
      ? l(`compared with ${describeRange(appliedCompared.from, appliedCompared.to)}`, `comparado a ${describeRange(appliedCompared.from, appliedCompared.to)}`)
      : l('no comparison', 'sem comparação');
  const openChange = (next: boolean) => {
    if (next) {
      setDraft({
        from: formatInput(applied.from),
        to: formatInput(applied.to),
      });
      setPresetId(selectedPreset(value));
      setMonth(firstMonth(applied.to));
      setCompareMode(appliedComparison.mode);
      setCompareDraft(comparisonDraft(appliedComparison));
      setTarget('period');
    }
    setOpen(next);
  };
  const choosePreset = (preset: Preset) => {
    const range = getDateRange(preset, limits);
    setDraft({ from: formatInput(range.from), to: formatInput(range.to) });
    setPresetId(preset.id);
    setTarget('period');
    setMonth(firstMonth(range.to));
  };
  const apply = () => {
    const preset = presets.find((p) => p.id === presetId);
    onChange(preset ? { days: preset.days, from: preset.from, to: preset.to } : { days: 'custom', from, to }, nextComparison);
    setOpen(false);
  };
  const dateInputs = (group: 'period' | 'compare') => {
    const [values, setValues] = group === 'period' ? [draft, setDraft] : [compareDraft, setCompareDraft];
    return (
      <div className="date-range-inputs">
        {(['from', 'to'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={`${id}-${group}-${key}`}>
              {group === 'period'
                ? key === 'from' ? l('Start date', 'Data inicial') : l('End date', 'Data final')
                : key === 'from' ? l('Comparison start', 'Início da comparação') : l('Comparison end', 'Fim da comparação')}
            </label>
            <Input
              id={`${id}-${group}-${key}`}
              value={values[key]}
              placeholder={
                locale === 'pt-BR' ? 'DD/MM/AAAA' : 'MM/DD/YYYY'
              }
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              aria-describedby={`${id}-feedback`}
              aria-invalid={values[key] !== '' && !parseInput(values[key])}
              onFocus={() => setTarget(group)}
              onChange={(e) => {
                setValues((s) => ({ ...s, [key]: e.target.value }));
                if (group === 'period') setPresetId('custom');
              }}
              onBlur={() => {
                const parsed = parseInput(values[key]);
                if (parsed) {
                  setMonth(firstMonth(parsed));
                  setValues((previous) => ({
                    ...previous,
                    [key]: formatInput(parsed),
                  }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) apply();
              }}
            />
          </div>
        ))}
      </div>
    );
  };
  const validation =
    !periodValid ? (!from || !to
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
          ))
      : l(
          `Compare with up to ${limits.maxDays} days that end before the period starts.`,
          `Compare com até ${limits.maxDays} dias que terminem antes do início do período.`,
        );

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        render={
          <FilterTrigger
            className="date-range-trigger"
            aria-label={`${l('Date range', 'Período')}: ${triggerLabel}${comparisonSummary ? `, ${comparisonSummary}` : ''}`}
            title={comparisonSummary ? `${summary}\n${comparisonSummary}` : summary}
            reserve={triggerReserve}
          />
        }
      >
        <CalendarDays />
        <span className="truncate">{triggerLabel}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="date-range-popover"
      >
        <PopoverTitle className="sr-only">{l('Date range', 'Período')}</PopoverTitle>
        <PopoverDescription className="sr-only">
          {l(
            'Select a preset or choose a custom range.',
            'Selecione um atalho ou escolha um período personalizado.',
          )}
        </PopoverDescription>
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
            {dateInputs('period')}
            {comparison && (
              <div className="date-range-compare">
                <label htmlFor={`${id}-compare`}>{l('Compare with', 'Comparar com')}</label>
                <SelectField<Comparison['mode']>
                  id={`${id}-compare`}
                  size="sm"
                  className="w-auto"
                  value={compareMode}
                  onValueChange={(mode) => {
                    setCompareMode(mode);
                    setTarget(mode === 'custom' ? 'compare' : 'period');
                  }}
                  options={[
                    { value: 'previous', label: l('Previous period', 'Período anterior') },
                    { value: 'custom', label: l('Custom period', 'Período personalizado') },
                    { value: 'none', label: l('No comparison', 'Sem comparação') },
                  ]}
                />
                {/* Only once the period is whole: while it is picked the line stays as it is, so the calendar does not move. */}
                {compareMode === 'previous' && previousRange && (
                  <p className="date-range-compared-note">{describeRange(previousRange.from, previousRange.to)}</p>
                )}
              </div>
            )}
            {compareMode === 'custom' && comparison && (
              <>
                {dateInputs('compare')}
                <ToggleGroup
                  multiple={false}
                  value={[target]}
                  onValueChange={(next) => { if (next[0] === 'period' || next[0] === 'compare') setTarget(next[0]); }}
                  size="sm"
                  variant="outline"
                  spacing={0}
                  aria-label={l('The calendar picks', 'O calendário escolhe')}
                  className="date-range-target"
                >
                  <ToggleGroupItem value="period">{l('Period dates', 'Datas do período')}</ToggleGroupItem>
                  <ToggleGroupItem value="compare">{l('Comparison dates', 'Datas da comparação')}</ToggleGroupItem>
                </ToggleGroup>
              </>
            )}
            <Calendar
              mode="range"
              timeZone="UTC"
              locale={locale === 'pt-BR' ? ptBR : enUS}
              weekStartsOn={0}
              numberOfMonths={narrow ? 1 : 2}
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              className={editingComparison ? 'date-range-picking-compare' : undefined}
              modifiers={{
                ...(shown?.from ? { compared: { from: shown.from, to: shown.to ?? shown.from }, comparedStart: shown.from, comparedEnd: shown.to ?? shown.from } : {}),
                ...(preview ? { preview, previewStart: preview.from, previewEnd: preview.to } : {}),
              }}
              modifiersClassNames={{
                compared: 'date-range-compared',
                comparedStart: 'date-range-compared-start',
                comparedEnd: 'date-range-compared-end',
                preview: 'date-range-preview',
                previewStart: 'date-range-preview-start',
                previewEnd: 'date-range-preview-end',
              }}
              onDayMouseEnter={(day, modifiers) => setHovered(modifiers.disabled ? null : day)}
              onDayMouseLeave={() => setHovered(null)}
              today={bounds ? lastDate : parseISODate(DEMO_TODAY)}
              startMonth={firstAllowedDate}
              endMonth={lastDate}
              disabled={[{ before: firstAllowedDate }, { after: lastDate }]}
              showOutsideDays={false}
              onSelect={(next, day) => {
                // With a whole range shown, a click starts a new one there instead of moving the nearest end.
                const range = selected?.from && selected.to ? { from: day, to: undefined } : next;
                const picked = {
                  from: range?.from ? formatInput(dateKey(range.from)) : '',
                  to: range?.to ? formatInput(dateKey(range.to)) : '',
                };
                if (editingComparison) setCompareDraft(picked);
                else {
                  setDraft(picked);
                  setPresetId('custom');
                }
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
                    modifiers.compared ? (editingComparison ? l('in the period', 'no período') : l('in the comparison', 'na comparação')) : null,
                  ]
                    .filter(Boolean)
                    .join(', '),
              }}
            />
          </div>
        </div>
        <div className="date-range-footer">
          <div>
            <p className="date-range-feedback" id={`${id}-feedback`} aria-live="polite">
              {draftRange && compareValid
                ? l(
                    `${number(draftRange.days)} ${draftRange.days === 1 ? 'day' : 'days'} selected, up to ${limits.maxDays}`,
                    `${number(draftRange.days)} ${draftRange.days === 1 ? 'dia selecionado' : 'dias selecionados'}, até ${limits.maxDays}`,
                  )
                : validation}
            </p>
            {!bounds && (
              <p>
                {l('Sample data', 'Dados de exemplo')}: {dateFormat.format(parseISODate(DEMO_FIRST_DATE))} – {dateFormat.format(lastDate)}
              </p>
            )}
          </div>
          <div>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {l('Cancel', 'Cancelar')}
            </Button>
            <Button disabled={!valid} onClick={apply}>
              {l('Apply', 'Aplicar')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
