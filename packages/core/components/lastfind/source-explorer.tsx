'use client';
import { useI18n } from '@/lib/i18n';
import { RemoteSources } from './remote-sources';
import { Card } from '@/components/ui/card';
import { useMemo, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
  TableBody,
} from '@/components/ui/table';
import { Choice } from './forms';
import { EngineIcon, Favicon } from './identity-icons';
import { ENGINE_LABELS, type Run, type Citation } from '@/lib/types';
export function SourceList({
  sources,
  empty,
}: {
  sources: Citation[] | null | undefined;
  empty: string;
}) {
  const { t } = useI18n();
  if (!sources?.length)
    return (
      <p className="form-hint">
        {sources == null
          ? t('O provedor não informou as fontes consultadas nesta coleta.')
          : empty}
      </p>
    );
  return (
    <div className="response-sources">
      {sources.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
          <Favicon domain={s.domain} size={22} />
          <span className="source-copy">
            {s.title}
            <small>{s.domain}</small>
          </span>
          <ExternalLink size={14} />
        </a>
      ))}
    </div>
  );
}
function DemoSources({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (r: Run) => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState('cited'),
    [group, setGroup] = useState('domain'),
    [query, setQuery] = useState(''),
    [expanded, setExpanded] = useState<string | null>(null);
  const complete = runs.filter((r) => r.status === 'complete');
  const available = complete.filter((r) => r.consulted_sources != null).length;
  const rows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        domain: string;
        title: string;
        urls: Map<string, Citation>;
        runs: Map<string, Run>;
      }
    >();
    for (const r of runs.filter((r) => r.status === 'complete'))
      for (const s of kind === 'cited'
        ? r.sources
        : (r.consulted_sources ?? [])) {
        const key = group === 'domain' ? s.domain : s.url;
        const row = map.get(key) ?? {
          key,
          domain: s.domain,
          title: group === 'domain' ? s.domain : s.title,
          urls: new Map(),
          runs: new Map(),
        };
        row.urls.set(s.url, s);
        row.runs.set(r.id, r);
        map.set(key, row);
      }
    return [...map.values()]
      .filter((r) =>
        `${r.title} ${r.key}`.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => b.runs.size - a.runs.size);
  }, [runs, kind, group, query]);
  return (
    <Card className="gap-0 py-0 ring-0 panel source-explorer">
      <div className="table-toolbar">
        <Tabs
          value={kind}
          onValueChange={(v) => {
            setKind(String(v));
            setExpanded(null);
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="cited">{t('Fontes citadas')}</TabsTrigger>
            <TabsTrigger value="consulted">
              {t('Fontes consultadas')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Choice
          label={t('Agrupar fontes')}
          value={group}
          onChange={setGroup}
          options={[
            { value: 'domain', label: t('Domínios') },
            { value: 'url', label: 'URLs' },
          ]}
        />
      </div>
      <div className="source-context">
        <p>
          {kind === 'cited'
            ? t('Páginas referenciadas pelas IAs nas respostas.')
            : t(
                'Resultados de busca recuperados pela IA, incluindo páginas que não foram citadas na resposta final.',
              )}
        </p>
        {kind === 'consulted' && (
          <small>
            {t('Dados de consulta informados em')} {available} {t('de')}{' '}
            {complete.length}{' '}
            {t('respostas. Nem todas as plataformas fornecem essa lista.')}
          </small>
        )}
      </div>
      <div className="prompt-filters">
        <div className="search-input">
          <Search size={16} />
          <Input
            placeholder={t('Buscar domínio ou página')}
            aria-label={t('Buscar fontes')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="muted">
          {rows.length} {group === 'domain' ? t('domínios') : t('páginas')}
        </span>
      </div>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('FONTE')}</TableHead>
              <TableHead>{t('RESPOSTAS')}</TableHead>
              <TableHead>{t('PLATAFORMAS')}</TableHead>
              <TableHead>{t('PÁGINAS')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <button
                    className="source-row-button"
                    onClick={() =>
                      setExpanded(expanded === row.key ? null : row.key)
                    }
                    aria-expanded={expanded === row.key}
                  >
                    <Favicon domain={row.domain} />
                    <span>
                      {row.title}
                      <small>
                        {group === 'url' ? row.key : t('Ver páginas e prompts')}
                      </small>
                    </span>
                  </button>
                  {expanded === row.key && (
                    <div className="source-drilldown">
                      <SourceList
                        sources={[...row.urls.values()]}
                        empty={t('Nenhuma página.')}
                      />
                      <b>{t('Prompts que encontraram esta fonte')}</b>
                      {[...row.runs.values()].slice(0, 20).map((r) => (
                        <button
                          className="prompt-open"
                          key={r.id}
                          onClick={() => onOpen(r)}
                        >
                          <EngineIcon engine={r.engine} />
                          {r.prompt_text}
                        </button>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>{row.runs.size}</TableCell>
                <TableCell>
                  <div className="engine-icon-list">
                    {[
                      ...new Set([...row.runs.values()].map((r) => r.engine)),
                    ].map((e) => (
                      <span key={e} title={ENGINE_LABELS[e]}>
                        <EngineIcon engine={e} />
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{row.urls.size}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="prompt-empty">
          <h3>
            {kind === 'cited'
              ? t('Nenhuma citação neste período')
              : t('Nenhuma fonte consultada informada')}
          </h3>
          <p>
            {t(
              'As fontes aparecem após as coletas. Experimente ajustar os filtros.',
            )}
          </p>
        </div>
      )}
      <div className="table-footnote">
        {t(
          'Cada fonte é contada uma vez por resposta. Uma fonte consultada não implica citação ou recomendação.',
        )}
      </div>
    </Card>
  );
}

type SourceExplorerProps = { onOpen: (r: Run) => void } & (
  | { demo: true; runs: Run[] }
  | { demo?: false; reportBase: string; refresh: number }
);

export function SourceExplorer(props: SourceExplorerProps) {
  return props.demo ? (
    <DemoSources runs={props.runs} onOpen={props.onOpen} />
  ) : (
    <RemoteSources
      key={props.reportBase}
      reportBase={props.reportBase}
      refresh={props.refresh}
      onOpen={props.onOpen}
    />
  );
}
