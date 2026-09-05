'use client';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { useReport } from '@/hooks/use-report';
import type { SourcesPage, SourceDetail, SourceRow } from '@/lib/report-types';
import type { Run } from '@/lib/types';
import { ENGINE_LABELS } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { SourceList } from './source-explorer';

function Detail({
  base,
  row,
  onOpen,
}: {
  base: string;
  row: SourceRow;
  onOpen: (run: Run) => void;
}) {
  const { t, locale } = useI18n();
  const [cursors, setCursors] = useState<(string | null)[]>([null]),
    [page, setPage] = useState(0);
  const { data, error, loading } = useReport<SourceDetail>(
    `${base}&view=source-detail&key=${encodeURIComponent(row.key)}&cursor=${encodeURIComponent(cursors[page] || '')}`,
  );
  if (loading) return <Skeleton className="h-24" />;
  if (error) return <p role="alert">{error}</p>;
  return (
    data && (
      <div className="source-drilldown">
        <SourceList sources={data.sources} empty={t('Nenhuma página.')} />
        <b>{t('Respostas que encontraram esta fonte')}</b>
        {data.runs.map((run) => (
          <button
            key={run.id}
            className="prompt-open"
            onClick={() => onOpen(run)}
          >
            <EngineIcon engine={run.engine} />
            {run.prompt_text}
          </button>
        ))}
        {(page > 0 || data.nextCursor) && (
          <div className="table-pagination">
            <Button
              variant="outline"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              {t('Anterior')}
            </Button>
            <span>
              {t('Página')} {page + 1}
            </span>
            <Button
              variant="outline"
              disabled={!data.nextCursor}
              onClick={() => {
                setCursors([...cursors.slice(0, page + 1), data.nextCursor]);
                setPage(page + 1);
              }}
            >
              {t('Próxima')}
            </Button>
          </div>
        )}
        {data.hasMore && (
          <p className="form-hint">
            {locale === 'en'
              ? 'Showing up to 50 source pages. Use pagination to explore more matching answers.'
              : 'Exibindo até 50 páginas da fonte. Use a paginação para explorar mais respostas relacionadas.'}
          </p>
        )}
      </div>
    )
  );
}
export function RemoteSources({
  reportBase,
  refresh,
  onOpen,
}: {
  reportBase: string;
  refresh: number;
  onOpen: (r: Run) => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState('cited'),
    [group, setGroup] = useState('domain'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState<string | null>(null);
  const base = `${reportBase}&kind=${kind}&group=${group}`;
  const { data, error, loading } = useReport<SourcesPage>(
    `${base}&view=sources&q=${encodeURIComponent(query)}&page=${page}`,
    refresh,
  );
  return (
    <Card className="gap-0 py-0 ring-0 panel source-explorer">
      <div className="table-toolbar">
        <Tabs
          value={kind}
          onValueChange={(v) => {
            setKind(String(v));
            setPage(1);
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
          onChange={(v) => {
            setGroup(v);
            setPage(1);
            setExpanded(null);
          }}
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
        {kind === 'consulted' && data && (
          <small>
            {t('Dados de consulta informados em')} {data.available} {t('de')}{' '}
            {data.complete}{' '}
            {t('respostas. Nem todas as plataformas fornecem essa lista.')}
          </small>
        )}
      </div>
      <div className="prompt-filters">
        <Input
          aria-label={t('Buscar fontes')}
          placeholder={t('Buscar domínio ou página')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <Skeleton className="m-5 h-48" />
      ) : data?.rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('FONTE')}</TableHead>
              <TableHead>{t('RESPOSTAS')}</TableHead>
              <TableHead>{t('VISIBILIDADE')}</TableHead>
              <TableHead>{t('PLATAFORMAS')}</TableHead>
              <TableHead>{t('PÁGINAS')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <button
                    className="source-row-button"
                    aria-expanded={expanded === row.key}
                    onClick={() =>
                      setExpanded(expanded === row.key ? null : row.key)
                    }
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
                    <Detail base={base} row={row} onOpen={onOpen} />
                  )}
                </TableCell>
                <TableCell>{row.responses}</TableCell>
                <TableCell>
                  {row.visibility.toLocaleString(locale, {
                    maximumFractionDigits: 1,
                  })}
                  %
                  <small className="cell-meta">
                    {row.mentions}{' '}
                    {locale === 'en' ? 'brand mentions' : 'menções à marca'}
                  </small>
                </TableCell>
                <TableCell>
                  <div className="engine-icon-list">
                    {row.engines.map((engine) => (
                      <span key={engine} title={ENGINE_LABELS[engine]}>
                        <EngineIcon engine={engine} />
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{row.pages}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        !error && (
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
        )
      )}
      {(page > 1 || data?.hasMore) && (
        <div className="table-pagination">
          <Button
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('Anterior')}
          </Button>
          <span>
            {t('Página')} {page}
          </span>
          <Button
            variant="outline"
            disabled={!data?.hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('Próxima')}
          </Button>
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
