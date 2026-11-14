/**
 * The header's Brands filter: which brands the reports list, never which answers they count (share of voice keeps
 * every identified brand). In the address as `brands`, commas between its parts: `monitored` (only the project's brand and
 * its monitored competitors) or `picked` (only the brands named), then brand keys to show and `-<key>` to hide. Nothing
 * means every brand found, by relevance. The project's own brand is always listed.
 *
 *   ?brands=monitored            the monitored brands
 *   ?brands=monitored,max        and Max
 *   ?brands=-globoplay           every brand but Globoplay
 *   ?brands=picked,netflix,max   Netflix and Max (and the project's own)
 */
import { brandKey } from './brand-decisions.ts';

export type BrandFilter = { base: 'all' | 'monitored' | 'picked'; show: string[]; hide: string[] };
/** What a brand is to the project: its own, monitored, or found by the discovery. */
export type BrandKind = 'own' | 'monitored' | 'discovered';

export const ALL_BRANDS: BrandFilter = { base: 'all', show: [], hide: [] };

export function readBrandFilter(value: string | null | undefined): BrandFilter {
  const parts = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const base = parts.includes('picked') ? 'picked' : parts.includes('monitored') ? 'monitored' : 'all';
  const keys = parts.filter((part) => part !== 'picked' && part !== 'monitored');
  const hide = base === 'picked' ? [] : [...new Set(keys.filter((key) => key.startsWith('-')).map((key) => key.slice(1)).filter(Boolean))];
  const show = base === 'all' ? [] : [...new Set(keys.filter((key) => !key.startsWith('-')))].filter((key) => !hide.includes(key));
  return { base, show, hide };
}

export function writeBrandFilter(filter: BrandFilter): string {
  return [...(filter.base === 'all' ? [] : [filter.base]), ...filter.show, ...filter.hide.map((key) => `-${key}`)].join(',');
}

const listedByBase = (base: BrandFilter['base'], kind: BrandKind) => kind === 'own' || base === 'all' || (base === 'monitored' && kind === 'monitored');

export function brandShown(filter: BrandFilter, key: string, kind: BrandKind) {
  if (kind === 'own') return true;
  if (filter.hide.includes(key)) return false;
  return filter.show.includes(key) || listedByBase(filter.base, kind);
}

/** The filter with one brand shown or hidden: an exception to the base only when the base says otherwise. */
export function toggleBrand(filter: BrandFilter, key: string, kind: BrandKind, shown: boolean): BrandFilter {
  const show = filter.show.filter((item) => item !== key);
  const hide = filter.hide.filter((item) => item !== key);
  if (shown !== listedByBase(filter.base, kind)) (shown ? show : hide).push(key);
  return { base: filter.base, show, hide };
}

export const brandFilterActive = (filter: BrandFilter) => filter.base !== 'all' || filter.hide.length > 0;

/**
 * The keys of the brands the header's menu lists: every one before a search (the menu scrolls under its search field), then
 * every one whose name (accents and case aside) or domain has the search.
 */
export function brandsListed<B extends { key: string; name: string; domain: string }>(brands: B[], query: string) {
  const words = brandKey(query);
  const domain = query.trim().toLowerCase();
  const found = words ? brands.filter((brand) => brandKey(brand.name).includes(words) || brand.domain.toLowerCase().includes(domain)) : brands;
  return new Set(found.map((brand) => brand.key));
}
