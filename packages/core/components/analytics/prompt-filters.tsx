'use client';
// The Prompts filter panel: the conditions beyond the header's, edited as a draft and applied at once (one history entry), with the
// number of prompts the draft would show. Tags are the header's filter alone. The everyday conditions are always in view (your
// brand mentioned, your domain cited, visibility); the rarer ones (share of voice, position, sentiment, creation date) wait under Advanced, which opens by
// itself when one of them is set, so the panel fits a laptop screen without scrolling. The trigger counts the applied conditions.
import { useId, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InfoHint } from '@/components/lastfind/presentation/info-hint';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { activeConditions, EMPTY_PROMPT_FILTERS, METRIC_KEYS, type MetricKey, type PromptFilters, type Range, type YesNo } from '@/lib/prompt-filters';
import { FilterTrigger } from './filter-trigger';
import { useCopy, useNumbers } from './shared';
import './prompt-filters.css';

type Draft = Record<MetricKey, [string, string]> & { mention: YesNo; citation: YesNo; created: [string, string] };

const METRIC: Record<MetricKey, { en: string; pt: string; unit: string; min: number; max?: number; step: string }> = {
  visibility: { en: 'Visibility', pt: 'Visibilidade', unit: '%', min: 0, max: 100, step: '1' },
  shareOfVoice: { en: 'Share of voice', pt: 'Share of voice', unit: '%', min: 0, max: 100, step: '1' },
  sentiment: { en: 'Sentiment', pt: 'Sentimento', unit: '', min: 0, max: 100, step: '1' },
  position: { en: 'Position', pt: 'Posição', unit: '', min: 1, step: '0.1' },
};
/** Under Advanced: the ranges used least, in order of use. Visibility stays in view. */
const ADVANCED_METRICS: MetricKey[] = ['shareOfVoice', 'position', 'sentiment'];
const text = (value: number | null) => (value == null ? '' : String(value));
const numberOrNull = (value: string) => (value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const toDraft = (value: PromptFilters): Draft => ({
  ...(Object.fromEntries(METRIC_KEYS.map((key) => [key, [text(value[key][0]), text(value[key][1])]])) as Record<MetricKey, [string, string]>),
  mention: value.mention, citation: value.citation, created: value.created,
});
const fromDraft = (draft: Draft, base: PromptFilters): PromptFilters => ({
  ...base,
  ...(Object.fromEntries(METRIC_KEYS.map((key) => [key, [numberOrNull(draft[key][0]), numberOrNull(draft[key][1])]])) as Record<MetricKey, Range>),
  mention: draft.mention, citation: draft.citation, created: draft.created,
});
const inverted = ([min, max]: [string, string]) => numberOrNull(min) != null && numberOrNull(max) != null && numberOrNull(min)! > numberOrNull(max)!;
/** The Advanced conditions a draft sets (the count on its disclosure). */
const advancedCount = (draft: Draft) =>
  ADVANCED_METRICS.filter((key) => draft[key][0].trim() || draft[key][1].trim()).length + (draft.created[0] || draft.created[1] ? 1 : 0);

export function PromptFiltersButton({ value, onChange, preview }: {
  value: PromptFilters;
  onChange: (next: PromptFilters) => void;
  /** How many prompts the draft would show. */
  preview: (next: PromptFilters) => number;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [advanced, setAdvanced] = useState(false);
  const count = activeConditions(value).length;
  const advancedSet = advancedCount(draft);
  const createdInverted = Boolean(draft.created[0] && draft.created[1] && draft.created[0] > draft.created[1]);
  const invalid = METRIC_KEYS.some((key) => inverted(draft[key])) || createdInverted;
  const empty = activeConditions(fromDraft(draft, EMPTY_PROMPT_FILTERS)).length === 0;
  // Counted only while the panel is open: the list re-renders far more often than the panel changes.
  const shown = !open || invalid ? null : preview(fromDraft(draft, value));
  const choice = (key: 'mention' | 'citation') => (
    <ToggleGroup multiple={false} value={[draft[key] || 'any']} onValueChange={(next) => setDraft((current) => ({ ...current, [key]: (next[0] === 'yes' || next[0] === 'no' ? next[0] : '') as YesNo }))}
      size="sm" variant="outline" spacing={0} aria-labelledby={`${id}-${key}`} className="prompt-filters-choice">
      {([['', l('Any', 'Todos')], ['yes', l('Yes', 'Sim')], ['no', l('No', 'Não')]] as const).map(([option, label]) => (
        <ToggleGroupItem key={option || 'any'} value={option || 'any'}>{label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
  const range = (key: MetricKey) => {
    const metric = METRIC[key];
    const name = `${l(metric.en, metric.pt)}${metric.unit ? ` (${metric.unit})` : ''}`;
    return (
      <div key={key} className="prompt-filters-range">
        <span id={`${id}-${key}`}>{name}</span>
        {([0, 1] as const).map((side) => (
          <Input key={side} type="number" inputMode="decimal" min={metric.min} max={metric.max} step={metric.step}
            placeholder={side ? l('Max', 'Máx') : l('Min', 'Mín')}
            aria-label={`${name}, ${side ? l('maximum', 'máximo') : l('minimum', 'mínimo')}`}
            aria-invalid={inverted(draft[key]) || undefined}
            value={draft[key][side]}
            onChange={(event) => setDraft((current) => {
              const next: [string, string] = [...current[key]];
              next[side] = event.target.value;
              return { ...current, [key]: next };
            })} />
        ))}
      </div>
    );
  };
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) {
        const fresh = toDraft(value);
        setDraft(fresh);
        // An Advanced condition already applied opens its section, so nothing set is hidden.
        setAdvanced(advancedCount(fresh) > 0);
      }
      setOpen(next);
    }}>
      <PopoverTrigger render={<FilterTrigger className="prompt-filters-trigger" aria-label={count ? l(`More filters, ${count} applied`, `Mais filtros, ${count} aplicados`) : l('More filters', 'Mais filtros')} />}>
        <SlidersHorizontal />
        <span className="prompt-filters-label">{l('More filters', 'Mais filtros')}</span>
        {count > 0 && <TagBadge tone="primary">{number(count)}</TagBadge>}
      </PopoverTrigger>
      {/* A touch opens it without raising the keyboard on the first field. */}
      <PopoverContent align="end" side="bottom" sideOffset={8} className="prompt-filters-popover" initialFocus={(openType) => openType !== 'touch'}>
        <div className="prompt-filters-heading">
          <PopoverTitle>{l('Filter prompts', 'Filtrar prompts')}</PopoverTitle>
          <InfoHint text={l('Prompts must match every filter. Metrics use the period and AI models of the header.', 'Os prompts precisam atender a todos os filtros. As métricas usam o período e os modelos de IA do cabeçalho.')} />
        </div>
        <div className="prompt-filters-body">
          <div className="prompt-filters-row">
            <span id={`${id}-mention`}>{l('Your brand mentioned', 'Sua marca mencionada')}</span>
            {choice('mention')}
          </div>
          <div className="prompt-filters-row">
            <span id={`${id}-citation`}>{l('Your domain cited', 'Seu domínio citado')}</span>
            {choice('citation')}
          </div>
          {range('visibility')}
          <Collapsible open={advanced} onOpenChange={setAdvanced} className="prompt-filters-advanced">
            <CollapsibleTrigger render={<Button variant="ghost" className="prompt-filters-advanced-trigger"
              aria-label={advancedSet ? l(`Advanced filters, ${advancedSet} set`, `Filtros avançados, ${advancedSet} definidos`) : undefined} />}>
              {l('Advanced filters', 'Filtros avançados')}
              {advancedSet > 0 && <TagBadge tone="primary">{number(advancedSet)}</TagBadge>}
              <ChevronDown aria-hidden="true" className="prompt-filters-advanced-chevron" />
            </CollapsibleTrigger>
            <CollapsibleContent className="prompt-filters-advanced-body">
              {ADVANCED_METRICS.map(range)}
              <fieldset className="prompt-filters-created">
                <legend>{l('Created between', 'Criado entre')}</legend>
                {([0, 1] as const).map((side) => (
                  <Input key={side} type="date" value={draft.created[side]} aria-label={side ? l('Created until', 'Criado até') : l('Created from', 'Criado de')}
                    aria-invalid={createdInverted || undefined}
                    onChange={(event) => setDraft((current) => {
                      const created: [string, string] = [...current.created];
                      created[side] = event.target.value;
                      return { ...current, created };
                    })} />
                ))}
              </fieldset>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="prompt-filters-footer">
          <Button variant="ghost" disabled={empty} onClick={() => setDraft(toDraft(EMPTY_PROMPT_FILTERS))}>{l('Clear all', 'Limpar tudo')}</Button>
          <Button disabled={invalid} onClick={() => { onChange(fromDraft(draft, value)); setOpen(false); }}>
            {invalid ? l('Check the ranges', 'Confira os intervalos')
              : shown === null ? l('Apply', 'Aplicar')
                : l(`Show ${number(shown)} ${shown === 1 ? 'prompt' : 'prompts'}`, `Mostrar ${number(shown)} ${shown === 1 ? 'prompt' : 'prompts'}`)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
