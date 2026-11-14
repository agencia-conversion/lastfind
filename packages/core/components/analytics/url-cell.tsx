'use client';
import { ExternalLink } from 'lucide-react';
import { DrillLink, type DrillTarget, type Linker } from './drill-link';
import { Hint } from '@/components/ui/tooltip';
import { SiteFavicon } from './shared';
import './source-types.css';

/** The label of a listed URL: the page title when known, else the URL itself (never empty). */
export const urlLabel = (url: string, title?: string | null) => (title && title !== url ? title : url);

/**
 * The one cell for a listed URL. A click opens the URL's page inside the app (entity page);
 * the icon beside it opens the original address in a new tab. The URL is the tooltip when a title is shown.
 */
export function UrlCell({
  link,
  url,
  title,
  domain,
  secondary,
  t,
  kind,
}: {
  link: Linker;
  url: string;
  title?: string | null;
  domain?: string;
  /** Shows the URL under the title (wide lists); otherwise it only travels in the tooltip. */
  secondary?: boolean;
  t: (en: string, pt: string) => string;
  /** The Sources citation filter the page opens with (a page never cited opens on its consultations). */
  kind?: DrillTarget['kind'];
}) {
  const label = urlLabel(url, title);
  return (
    <span className="url-cell">
      <span className="url-cell-text">
        <DrillLink link={link} to={{ tab: 'sources', run: null, entity: { kind: 'url', key: url }, ...(kind ? { kind } : {}) }} disabled={!url} className="url-cell-link" title={url}>
          {domain && <SiteFavicon domain={domain} name={domain} />}
          <span className="truncate">{label}</span>
        </DrillLink>
        {secondary && label !== url && <small className="st-url">{url}</small>}
      </span>
      {url && (
        <Hint text={t('Open page in a new tab', 'Abrir página em nova aba')}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="url-cell-open" aria-label={`${t('Open page in a new tab', 'Abrir página em nova aba')}: ${url}`}>
          <ExternalLink size={12} aria-hidden="true" />
        </a>
        </Hint>
      )}
    </span>
  );
}
