'use client';
import { useState, type KeyboardEvent } from 'react';
import { Trophy } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { brandShown, brandsListed, readBrandFilter, toggleBrand, writeBrandFilter, type BrandFilter, type BrandKind } from '@/lib/brand-filter';
import { BRAND_REPORT_VIEWS, type BrandReportView } from './brand-report-tabs';
import { FilterTrigger } from './filter-trigger';
import { SearchField, SiteFavicon, longestLabel, useCopy } from './shared';

/** A brand the filter lists: the project's own and monitored ones, then the discoveries by relevance. */
export type BrandChoice = { key: string; name: string; domain: string; kind: BrandKind };

// Inside the menu the search keeps its typing: letters would jump to an item (the menu's type-ahead). ArrowDown goes to the
// first discovered brand under it, whatever the menu had highlighted; ArrowUp, Esc and Tab still reach the menu.
const keepTyping = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'ArrowDown') {
    const first = event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[data-slot="brands-discovered"] [role="menuitemcheckbox"]:not([aria-disabled="true"]):not([data-disabled])');
    if (!first) return;
    event.preventDefault();
    event.stopPropagation();
    first.focus();
    return;
  }
  if (!['ArrowUp', 'Escape', 'Tab'].includes(event.key)) event.stopPropagation();
};

/**
 * Top-bar Brands filter (benchmarked on Peec AI's brand filter): every brand found (the default), only the monitored
 * ones, or only the ones picked, and any brand shown or hidden on top. It changes which brands the reports list, never their
 * numbers. `discovered` is null while the discoveries load and 'failed' when they could not be read; `onOpen` lets the app
 * read them only when someone opens the menu. `status` (the Brands screen) adds its lists: the brands listed, the discovered
 * ones still to decide, or the rejected ones.
 */
export function BrandsFilter({
  value,
  onChange,
  monitored,
  discovered,
  onOpen,
  status,
}: {
  value: string;
  onChange: (value: string) => void;
  monitored: BrandChoice[];
  discovered: BrandChoice[] | null | 'failed';
  onOpen?: () => void;
  status?: { value: BrandReportView; onChange: (value: BrandReportView) => void };
}) {
  const l = useCopy();
  const [query, setQuery] = useState('');
  const filter = readBrandFilter(value);
  const set = (next: BrandFilter) => onChange(writeBrandFilter(next));
  const listed = [...monitored, ...(Array.isArray(discovered) ? discovered : [])];
  const shown = listed.filter((brand) => brandShown(filter, brand.key, brand.kind));
  // Short: the header has six filters on one row.
  const label = { all: l('All brands', 'Todas as marcas'), monitored: l('Monitored', 'Monitoradas') };
  // A summary, never the list of names: the trigger keeps its width whatever is chosen.
  const view = status && (BRAND_REPORT_VIEWS.find(([name]) => name === status.value) ?? BRAND_REPORT_VIEWS[0]);
  const list = view && view[0] !== 'general' ? view : undefined;
  const summary = list ? l(...list[1]) : filter.base === 'all'
    ? filter.hide.length ? l(`All but ${filter.hide.length}`, `Todas menos ${filter.hide.length}`) : label.all
    : filter.base === 'monitored' && !filter.show.length && !filter.hide.length
      ? label.monitored
      : l(`${shown.length} brands`, `${shown.length} marcas`);
  const names = filter.base === 'all' && !filter.hide.length ? '' : shown.map((brand) => brand.name).join(', ');
  // The search narrows the discoveries only: the monitored brands are few and stay in view above it.
  const found = Array.isArray(discovered) ? brandsListed(discovered, query) : new Set<string>();
  const discoveredListed = Array.isArray(discovered) ? discovered.filter((brand) => found.has(brand.key)) : [];
  const item = (brand: BrandChoice) => (
    <DropdownMenuCheckboxItem
      key={brand.key}
      checked={brandShown(filter, brand.key, brand.kind)}
      // The project's own brand is in every report.
      disabled={brand.kind === 'own'}
      closeOnClick={false}
      onCheckedChange={(checked) => set(toggleBrand(filter, brand.key, brand.kind, checked))}
    >
      <SiteFavicon domain={brand.domain} name={brand.name} />
      <span className="min-w-0 truncate">{brand.name}</span>
      {brand.kind === 'own' && <span className="text-caption text-muted-foreground">{l('You', 'Você')}</span>}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) onOpen?.(); else setQuery(''); }}>
      <DropdownMenuTrigger
        render={
          <FilterTrigger
            reserve={longestLabel([...Object.values(label), l('All but 99', 'Todas menos 99'), l('99 brands', '99 marcas'), ...(status ? [l('Rejected', 'Rejeitadas')] : [])])}
            aria-label={`${l('Brands', 'Marcas')}: ${names || summary}`}
            title={names || undefined}
          />
        }
      >
        <Trophy />
        <span className="min-w-0 truncate">{summary}</span>
      </DropdownMenuTrigger>
      {/* Wider than its trigger: brand names are long. The choices and the monitored brands stay put; the search sits right
          above the discoveries it narrows, and only that list scrolls: 5 rows tall, the rest scroll inside it (docs/design/
          shell.md section 6). On a window too short for that, the list gives up height first. */}
      <DropdownMenuContent className="analytics-menu flex w-72 flex-col [&>:not(:last-child)]:shrink-0">
        <DropdownMenuRadioGroup value={filter.base} onValueChange={(base) => set({ base: base as BrandFilter['base'], show: [], hide: [] })}>
          <DropdownMenuRadioItem value="all" closeOnClick={false}>{l('All brands found', 'Todas as marcas encontradas')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="monitored" closeOnClick={false}>{l('Monitored brands', 'Marcas monitoradas')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="picked" closeOnClick={false}>{l('Only the ones I pick', 'Só as que eu escolher')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {status && (
          <>
            <DropdownMenuSeparator />
            {/* One row, so the brands keep the menu's height: the screen's list opens beside it. */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {l('On this screen', 'Nesta tela')}
                <span className="ml-auto min-w-0 truncate text-muted-foreground">{view && l(...view[1])}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="analytics-menu w-56">
                <DropdownMenuRadioGroup value={status.value} onValueChange={(view) => status.onChange(view as BrandReportView)}>
                  {BRAND_REPORT_VIEWS.map(([value, name]) => (
                    <DropdownMenuRadioItem key={value} value={value} closeOnClick={false}>{l(...name)}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{l('Monitored', 'Monitoradas')}</DropdownMenuLabel>
          {monitored.map(item)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* Its rows join the menu's column, so the list is the one row that gives up height. */}
        <DropdownMenuGroup className="contents">
          <DropdownMenuLabel>{l('Discovered, most mentioned first', 'Descobertas, mais mencionadas primeiro')}</DropdownMenuLabel>
          <div className="px-1 pb-1">
            <SearchField fullWidth value={query} onChange={setQuery} onKeyDown={keepTyping} placeholder={l('Search discovered brands…', 'Buscar marcas descobertas…')} />
          </div>
          <div data-slot="brands-discovered" className={discoveredListed.length > 5 ? 'h-[calc(var(--nav-row-height)*5)] overflow-y-auto' : 'shrink-0'}>
            {discovered === null ? (
              <DropdownMenuItem disabled>{l('Loading brands…', 'Carregando marcas…')}</DropdownMenuItem>
            ) : discovered === 'failed' ? (
              <DropdownMenuItem disabled>{l('Could not load the discovered brands.', 'Não foi possível carregar as marcas descobertas.')}</DropdownMenuItem>
            ) : discoveredListed.length ? (
              discoveredListed.map(item)
            ) : query ? (
              <DropdownMenuItem disabled>{l('No discovered brand matches.', 'Nenhuma marca descoberta encontrada.')}</DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>{l('No competitor confirmed among the discoveries yet; names still to review wait in Brands.', 'Nenhuma concorrente confirmada entre as descobertas ainda; nomes a revisar aguardam em Marcas.')}</DropdownMenuItem>
            )}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
