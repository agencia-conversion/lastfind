'use client';
import { Cpu } from 'lucide-react';
import { CompactEngineIcons, EngineIcon } from '@/components/lastfind/identity-icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ENGINE_LABELS } from '@/lib/engines';
import type { Engine } from '@/lib/types';
import { FilterTrigger } from './filter-trigger';
import { longestLabel, useCopy } from './shared';

/**
 * Top-bar AI model filter, the only place the selection shows: the trigger sums it up (one model's icon and name, a few
 * models' icons and count, or all) and the menu changes it. `value` is 'all' or a comma list of engines.
 */
export function ModelFilter({
  engines,
  value,
  onChange,
}: {
  engines: Engine[];
  value: string;
  onChange: (value: string) => void;
}) {
  const l = useCopy();
  const selected = value === 'all' ? [] : (value.split(',').filter(Boolean) as Engine[]);
  const names = selected.map((engine) => ENGINE_LABELS[engine]).join(', ');
  // A summary, never the list of names: the trigger keeps its width whatever is selected.
  const summary = !selected.length
    ? l('All models', 'Todos os modelos')
    : selected.length === 1
      ? ENGINE_LABELS[selected[0]]
      : l(`${selected.length} models`, `${selected.length} modelos`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <FilterTrigger
            reserve={longestLabel([l('All models', 'Todos os modelos'), l(`${engines.length} models`, `${engines.length} modelos`), ...engines.map((engine) => ENGINE_LABELS[engine])])}
            aria-label={`${l('AI models', 'Modelos de IA')}: ${names || summary}`}
            title={names || undefined}
          />
        }
      >
        {selected.length === 1 ? <EngineIcon engine={selected[0]} /> : selected.length ? <CompactEngineIcons engines={selected} max={3} size={12} /> : <Cpu />}
        <span className="min-w-0 truncate">{summary}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="analytics-menu">
        {engines.map((engine) => (
          <DropdownMenuCheckboxItem
            key={engine}
            checked={value === 'all' || selected.includes(engine)}
            closeOnClick={false}
            onCheckedChange={(checked) => {
              const current = value === 'all' ? [...engines] : selected;
              const next = checked ? [...new Set([...current, engine])] : current.filter((item) => item !== engine);
              if (next.length) onChange(next.length === engines.length ? 'all' : next.join(','));
            }}
          >
            <EngineIcon engine={engine} />
            {ENGINE_LABELS[engine]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onChange('all')}>{l('All models', 'Todos os modelos')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
