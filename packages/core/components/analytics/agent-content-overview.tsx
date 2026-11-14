'use client';
// A content's Overview tab (both editions): its publication fields (title tag, meta description, slug and the rest), kept
// out of the text, and the comparison with Google's top 3 for its main keyword: words, topics covered and Google questions
// answered, our text first. The agent fills both (set_content_overview); the person edits the fields. Our words are
// counted from the text on screen, so they follow every edit; the coverage is the agent's last judgment, and says so when
// the text changed after it. Only catalog components.
import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { compareOverview, coverageTone, META_LIMITS, readMeta, wordCount, type Cell, type ContentMeta, type ContentOverview, type Coverage, type Tone } from '@/lib/content-overview';
import { pageName, web } from '@/lib/agent-steps';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { EmptyState } from './shared';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge, type TagTone } from '@/components/lastfind/presentation/tag-badge';
import { Note } from '@/components/lastfind/presentation/note';
import { Hint } from '@/components/ui/tooltip';

type T = (en: string, pt: string) => string;
const TONES: Record<Tone, TagTone> = { good: 'success', partial: 'warning', bad: 'danger' };

const FIELDS: { key: keyof ContentMeta; label: [string, string]; hint: [string, string]; long?: boolean }[] = [
  { key: 'title', label: ['Title tag', 'Title tag'], hint: ['The title search shows; the main keyword near the start.', 'O título que a busca mostra; a palavra-chave principal no começo.'] },
  { key: 'description', label: ['Meta description', 'Meta description'], hint: ['The text under the title in search.', 'O texto sob o título na busca.'], long: true },
  { key: 'slug', label: ['Slug', 'Slug'], hint: ['The end of the address: short, no accents.', 'O fim do endereço: curto, sem acentos.'] },
  { key: 'schema', label: ['Schema', 'Schema'], hint: ['The structured data to mark it up with.', 'Os dados estruturados para marcar a página.'] },
  { key: 'links', label: ['Internal links', 'Links internos'], hint: ['Pages of the site to link, one per line.', 'Páginas do site para linkar, uma por linha.'], long: true },
  { key: 'images', label: ['Images', 'Imagens'], hint: ['Ideas with their alt text, one per line.', 'Ideias com o texto alternativo, uma por linha.'], long: true },
  { key: 'open', label: ['Open items', 'Pendências'], hint: ['What only the team can answer (proof, author, decisions).', 'O que só o time responde (provas, autor, decisões).'], long: true },
];

/** The publication fields: typed by the person (saved after a pause, like the text) or read; each with its length. */
function MetaFields({ meta, canEdit, onChange, t }: { meta: ContentMeta; canEdit: boolean; onChange: (meta: ContentMeta) => void; t: T }) {
  const [values, setValues] = useState(meta);
  const set = (key: keyof ContentMeta, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    onChange(next);
  };
  const filled = FIELDS.filter((field) => canEdit || values[field.key]);
  if (!filled.length)
    return <Note>{t('The agent fills these in when it writes the content.', 'O agente preenche quando escreve o conteúdo.')}</Note>;
  return (
    <FieldGroup className="agent-overview-meta">
      {filled.map((field) => {
        const id = `content-meta-${field.key}`;
        const limit = META_LIMITS[field.key];
        const length = values[field.key].length;
        const counter = limit ? (
          <span data-over={length > limit || undefined} className="agent-overview-count tabular-nums">
            {t(`${length} of ${limit} characters`, `${length} de ${limit} caracteres`)}
          </span>
        ) : null;
        return (
          <Field key={field.key}>
            <FieldLabel htmlFor={id}>{t(...field.label)}</FieldLabel>
            {!canEdit ? (
              <p id={id} className="text-body whitespace-pre-line">
                {values[field.key]}
              </p>
            ) : field.long ? (
              <Textarea id={id} rows={field.key === 'description' ? 2 : 3} maxLength={2000} value={values[field.key]} onChange={(event) => set(field.key, event.target.value)} />
            ) : (
              <Input id={id} maxLength={2000} value={values[field.key]} onChange={(event) => set(field.key, event.target.value)} />
            )}
            <FieldDescription>
              {t(...field.hint)} {counter}
            </FieldDescription>
          </Field>
        );
      })}
    </FieldGroup>
  );
}

function Figure({ cell, children }: { cell: Cell; children: ReactNode }) {
  if (cell.value === null) return <span className="text-muted-foreground">{children}</span>;
  return cell.tone ? <TagBadge tone={TONES[cell.tone]}>{children}</TagBadge> : <>{children}</>;
}

function Mark({ value, t }: { value: Coverage; t: T }) {
  const name = value === 'yes' ? t('Covers it', 'Cobre') : value === 'partial' ? t('In part', 'Em parte') : t('Does not', 'Não cobre');
  return (
    <TagBadge tone={TONES[coverageTone(value)]}>
      <span aria-hidden="true">{value === 'no' ? '—' : '✓'}</span>
      <span className="sr-only">{name}</span>
    </TagBadge>
  );
}

export function ContentOverviewTab({
  overview,
  text,
  version,
  canEdit,
  onMeta,
  t,
}: {
  overview: ContentOverview | undefined;
  /** The text as it is on screen (unsaved edits included). */
  text: string;
  /** The text's version now: a later one than the analysis judged shows the coverage may be out of date. */
  version: number;
  canEdit: boolean;
  onMeta: (meta: ContentMeta) => void;
  t: T;
}) {
  const { locale } = useI18n();
  const analysis = overview?.analysis;
  const n = (value: number | null) => (value === null ? t('not measured', 'não medido') : value.toLocaleString(locale));
  // A page the agent tried and could not read says so (its words were never counted).
  const words = (value: number | null, at: number) => (value === null && analysis?.competitors[at - 1]?.unreadable ? t('could not be read', 'não pôde ser lida') : n(value));
  const table = analysis && compareOverview(analysis, wordCount(text));
  const ordinal = (position: number | null) => (position === null ? t('Top 3', 'Top 3') : locale === 'pt-BR' ? `${position}º` : `#${position}`);
  return (
    <div className="agent-overview">
      <SectionCard
        title={t('Against Google’s top 3', 'Contra o top 3 do Google')}
        info={t(
          'Words counted by Lastfind on this text and on the pages the agent read; topics and questions judged by the agent from those pages and Google’s questions.',
          'Palavras contadas pelo Lastfind neste texto e nas páginas que o agente leu; temas e perguntas avaliados pelo agente a partir dessas páginas e das perguntas do Google.',
        )}
      >
        {!analysis || !table ? (
          <EmptyState
            frame="inline"
            title={t('Not compared yet', 'Ainda sem comparação')}
            description={t(
              'The agent compares the text with the top 3 Google results for its keyword when it writes it: words, topics covered and Google questions answered.',
              'O agente compara o texto com os 3 primeiros resultados do Google para a palavra-chave quando o escreve: palavras, temas cobertos e perguntas do Google respondidas.',
            )}
          />
        ) : (
          <>
            <DataTable
              singleLine
              compact
              className="agent-overview-grid"
              ariaLabel={t('Against Google’s top 3', 'Contra o top 3 do Google')}
              rows={[
                { key: 'running', label: t('Words of running text', 'Palavras de texto corrido'), cells: table.running.map((cell, at) => <Figure key={at} cell={cell}>{words(cell.value, at)}</Figure>) },
                { key: 'total', label: t('Words in all', 'Palavras totais'), cells: table.total.map((cell, at) => <Figure key={at} cell={cell}>{words(cell.value, at)}</Figure>) },
                ...(analysis.topics.length
                  ? [{ key: 'topics', group: true, label: t(`Topics covered (of ${analysis.topics.length})`, `Temas cobertos (de ${analysis.topics.length})`), cells: table.topics.map((cell, at) => <Figure key={at} cell={cell}>{n(cell.value)}</Figure>) }]
                  : []),
                ...analysis.topics.map((topic) => ({ key: `topic:${topic.name}`, item: true, label: topic.name, cells: [topic.ours, ...topic.them].map((value, at) => <Mark key={at} value={value} t={t} />) })),
                ...(analysis.questions.length
                  ? [
                      {
                        key: 'questions',
                        group: true,
                        label: t('Google questions answered', 'Perguntas do Google respondidas'),
                        cells: table.questions.map((cell, at) => <Figure key={at} cell={cell}>{t(`${cell.value} of ${analysis.questions.length}`, `${cell.value} de ${analysis.questions.length}`)}</Figure>),
                      },
                    ]
                  : []),
                ...analysis.questions.map((question) => ({ key: `question:${question.text}`, item: true, label: question.text, cells: [question.ours, ...question.them].map((value, at) => <Mark key={at} value={value} t={t} />) })),
              ]}
              rowKey={(row) => row.key}
              rowState={(row) => ('group' in row ? 'group' : 'item' in row ? 'item' : undefined)}
              columns={[
                {
                  key: 'indicator',
                  header: analysis.keyword ? `“${analysis.keyword}”` : t('Indicator', 'Indicador'),
                  rowHeader: true,
                  maxWidth: '12rem',
                  hint: (row) => row.label,
                  cell: (row) => row.label,
                },
                ...[t('Our text', 'Nosso texto'), ...analysis.competitors.map((competitor) => competitor.url)].map((name, index) => {
                  const competitor = index ? analysis.competitors[index - 1] : null;
                  return {
                    key: `column:${index}`,
                    align: 'end' as const,
                    cellClassName: 'tabular-nums',
                    header: competitor ? (
                      <span className="agent-overview-site-head">
                        {web(competitor.url) ? (
                          <Hint text={competitor.title || competitor.url}>
                            <a href={web(competitor.url)} target="_blank" rel="noopener noreferrer">
                              {ordinal(competitor.position)}
                            </a>
                          </Hint>
                        ) : (
                          ordinal(competitor.position)
                        )}
                        <span className="agent-overview-site">{pageName(competitor.url).split('/')[0]}</span>
                      </span>
                    ) : (
                      name
                    ),
                    cell: (row: { cells: ReactNode[] }) => row.cells[index],
                  };
                }),
              ]}
            />
            <Note>
              {t(
                'Green meets it; yellow meets it in part, or would need a fact the brand has not published; red does not. Words: green from 90% of the best of the row, yellow from 60%; topics and questions: the same, of all of them.',
                'Verde atende; amarelo atende em parte, ou depende de um fato que a marca não publicou; vermelho não atende. Palavras: verde a partir de 90% do melhor da linha, amarelo a partir de 60%; temas e perguntas: o mesmo, sobre o total.',
              )}
            </Note>
            {analysis.gaps && <Note>{analysis.gaps}</Note>}
            {version > analysis.version && (
              <Note>
                {t(
                  'The text changed after the agent judged its topics and questions: the words are current; ask the agent in the chat to check the rest again.',
                  'O texto mudou depois que o agente avaliou temas e perguntas: as palavras estão atualizadas; peça ao agente no chat para conferir o resto de novo.',
                )}
              </Note>
            )}
          </>
        )}
      </SectionCard>
      <SectionCard title={t('Publication', 'Publicação')} info={t('Outside the text: what goes in the page’s head and the team’s checklist.', 'Fora do texto: o que vai no cabeçalho da página e a lista do time.')} inset="padded">
        <MetaFields meta={readMeta(overview?.meta)} canEdit={canEdit} onChange={onMeta} t={t} />
      </SectionCard>
    </div>
  );
}
