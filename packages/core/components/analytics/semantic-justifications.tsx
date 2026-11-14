'use client';
// Why each brand got its note on one attribute, in the layout of the public Semantic Branding report ("Justificativas das notas"):
// one row per brand (favicon, name, note and its band), best note first, that opens on one justification of one sentence and its two evidences
// (older answers may have two to four) as a plain list (those of the answer whose note is closest to the brand's, as the reference shows one evaluation);
// each AI's note, band, reason and evidences, the sources and the question with the full answers are details a click away. A note without
// evidence says so: the scale keeps it at 59 or below (10/11/2026).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import type { Engine } from '@/lib/types';
import { ENGINE_LABELS } from '@/lib/engines';
import type { Linker } from './drill-link';
import { UrlCell } from './url-cell';
import { Note } from '@/components/lastfind/presentation/note';
import { scoreBand } from '@/lib/semantic-perception';
import { EmptyState, ModelMark, SiteFavicon, useCopy, useNumbers } from './shared';
import type { Perception } from './semantic-perception';
import { nextCollectionText } from './semantic-association-report';

type Request = <T>(path: string, method?: string, data?: unknown) => Promise<T>;
export type EvidenceSource = { base: string; scope: string; period: string; request: Request };
type Evidence = {
  id: string;
  engine: Engine;
  /** `scrape`: the AI as its daily collection asks it; `llm`: a model the panel asked itself until 6/11/2026, no longer counted. */
  method: 'llm' | 'scrape';
  model: string;
  question: string;
  date: string;
  readings: { attribute: string; score: number; reason: string | null; evidence: string[] }[];
  answer: string;
  sources: { url: string; domain: string; title: string }[];
};

/** Notes this far apart (points) between the lowest and the highest AI read as a disagreement. */
const DISAGREEMENT = 15;

/** The answers behind a brand and attribute, from the evidence API (one page holds every answer of a round). */
function useEvidence({ base, scope, period, request }: EvidenceSource, brand: string, attribute: string) {
  const [items, setItems] = useState<Evidence[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const path = useMemo(() => {
    const params = new URLSearchParams(scope);
    for (const [key, value] of Object.entries({ period, brand, attribute })) params.set(key, value);
    return `${base}?${params}`;
  }, [scope, period, brand, attribute, base]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => active && setState('loading'));
    request<{ evidence: Evidence[] }>(path)
      .then((page) => { if (active) { setItems(page.evidence); setState('ready'); } })
      .catch((cause) => { if (active && cause?.name !== 'AbortError') setState('failed'); });
    return () => { active = false; };
  }, [path, request, attempt]);
  return { items, state, retry: () => setAttempt((count) => count + 1) };
}

export function SemanticJustifications({ data, brand, attribute, attributeName, evidence, link }: {
  data: Perception;
  /** The brand chosen in the heatmap ('all': none, so the project's own opens). */
  brand: string;
  attribute: string;
  attributeName: (id: string) => string;
  evidence: EvidenceSource;
  link: Linker;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const band = (value: number) => bandName(l, value);
  const [open, setOpen] = useState<string[]>([brand === 'all' ? data.ownBrand : brand]);
  // Best note first, as the public report orders them; a brand without notes goes last, never as a zero.
  const rows = data.scores
    .map((score) => ({ score, cell: score.attributes.find((item) => item.attribute === attribute) ?? null }))
    .sort((a, b) => (b.cell?.samples ? b.cell.score ?? -1 : -1) - (a.cell?.samples ? a.cell.score ?? -1 : -1));
  return (
    <Accordion variant="rows" multiple value={open} onValueChange={(value) => setOpen(value as string[])}>
      {rows.map(({ score, cell }) => {
        const notes = Object.values(cell?.engines ?? {}).map((engine) => engine!.score);
        const spread = notes.length > 1 ? Math.max(...notes) - Math.min(...notes) : 0;
        const own = score.name === data.ownBrand;
        return (
          <AccordionItem key={score.name} value={score.name}>
            <AccordionTrigger>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2">
                  <SiteFavicon domain={score.domain} name={score.name} />
                  <span className={`min-w-0 wrap-anywhere${own ? ' font-(--weight-strong)' : ''}`}>{score.name}</span>
                </span>
                <TagBadge tone="outline">
                  {cell?.score != null ? <><span className="sr-only">{l('Note', 'Nota')} </span>{number(cell.score, 0)}</> : <><span className="sr-only">{l('No note', 'Sem nota')} </span>—</>}
                </TagBadge>
                <span className="inline-flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                  {cell?.score != null && <span>{band(cell.score)}</span>}
                  {cell && cell.samples > 0 && !cell.reliable && <TagBadge tone="muted">{l('little evidence', 'pouca evidência')}</TagBadge>}
                  {spread > DISAGREEMENT && <TagBadge tone="danger">{l('AIs disagree', 'IAs divergem')}</TagBadge>}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {cell?.samples
                ? <Answers source={evidence} brand={score.name} domain={score.domain} attribute={attribute} link={link} />
                : <p className="text-muted-foreground">{data.added.includes(score.name) ? `${nextCollectionText(l).long}.`
                  : l(`No AI gave ${score.name} a note on ${attributeName(attribute)}: no evidence.`, `Nenhuma IA deu nota a ${score.name} em ${attributeName(attribute)}: sem evidência.`)}</p>}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/**
 * The answer that speaks for the brand on the attribute, as the reference report shows one evaluation: the one whose note is closest to the
 * mean of all the answers, one with a reason and evidences first; on a tie, the first in the order given (the higher note).
 */
export function representative<T extends { reading: { score: number; reason: string | null; evidence: string[] } }>(answers: T[]) {
  const mean = answers.reduce((sum, { reading }) => sum + reading.score, 0) / answers.length;
  const key = ({ reading }: T) => [Math.abs(reading.score - mean), reading.reason ? 0 : 1, reading.evidence.length ? 0 : 1];
  return [...answers].sort((a, b) => { const [x, y] = [key(a), key(b)]; return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!; })[0]!;
}

/** The name of the band of a note, in the reader's language. */
const bandName = (l: ReturnType<typeof useCopy>, value: number) => { const { label } = scoreBand(value); return l(label.en, label.pt); };

/** A note's facts, trimmed and once each. */
const factsOf = (reading: { evidence: string[] }) => [...new Set(reading.evidence.map((fact) => fact.trim()).filter(Boolean))];

/** The facts behind a note, or why there are none: without evidence the scale keeps a note at 59 or below. */
function Facts({ reading }: { reading: { score: number; evidence: string[] } }) {
  const l = useCopy();
  const facts = factsOf(reading);
  if (facts.length) return <ul className="semantic-justification-evidence">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>;
  // A note of a round recorded before the evidence rule may be above 59 without a fact: it only says there is none.
  return <p className="text-muted-foreground">{reading.score < 60
    ? l('No evidence given: without a fact the note stays at 59 or below.', 'Nenhuma evidência dada: sem um fato, a nota fica em 59 ou menos.')
    : l('No evidence given.', 'Nenhuma evidência dada.')}</p>;
}

/** One sentence per AI reason, joined: the justification paragraph. A reason without a closing mark gets a full stop. */
export function justificationText(reasons: (string | null)[]) {
  return [...new Set(reasons.map((reason) => reason?.trim()).filter(Boolean))].map((reason) => /[.!?…]$/.test(reason!) ? reason : `${reason}.`).join(' ');
}

/** A secondary detail of a justification: a summary line that opens on its content. */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="semantic-justification-more">
      <summary><ChevronRight size={14} aria-hidden="true" />{summary}</summary>
      {children}
    </details>
  );
}

/** What the AIs answered about one brand and attribute: the justification and the evidence, then each AI, the sources and the answers. */
/** Whether a page is on the evaluated brand's own site (the brand's domain or one of its subdomains). */
export const ownSite = (pageDomain: string, brandDomain: string) => {
  const [page, brand] = [pageDomain, brandDomain].map((value) => value.toLowerCase().replace(/^www\./, ''));
  return !!brand && (page === brand || page.endsWith(`.${brand}`));
};

function Answers({ source, brand, domain, attribute, link }: { source: EvidenceSource; brand: string; domain: string; attribute: string; link: Linker }) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const { items, state, retry } = useEvidence(source, brand, attribute);
  const day = (date: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  // An answer the panel asked a model for itself (until 6/11/2026) stays readable, marked: only the collection's way of asking counts.
  const how = (item: Evidence) => item.method === 'llm'
    ? l('Model asked directly, no longer counted in the score', 'Modelo perguntado direto, não conta mais no score')
    : item.engine === 'claude' ? l('The model alone, from what it knows', 'O modelo puro, pelo que ele sabe')
      : item.engine === 'perplexity' ? l('The model, with its own search', 'O modelo, com a busca dele')
        : l('Interface, with its own search', 'Interface, com a busca da própria IA');
  if (state === 'loading') return <Note className="px-0" status aria-busy="true">{l('Loading the answers…', 'Carregando as respostas…')}</Note>;
  if (state === 'failed')
    return <EmptyState frame="inline" tone="error" title={l('The answers are unavailable.', 'As respostas estão indisponíveis.')} onRetry={retry} />;
  const answers = items.flatMap((item) => {
    const reading = item.readings.find((note) => note.attribute === attribute);
    return reading ? [{ item, reading }] : [];
  }).sort((a, b) => b.reading.score - a.reading.score);
  // The justification speaks for the score: an answer that counts in it.
  const counted = answers.filter(({ item }) => item.method === 'scrape');
  if (!counted.length) return <p className="text-muted-foreground">{l('No answers for this selection.', 'Nenhuma resposta para esta seleção.')}</p>;
  const { item: chosen, reading } = representative(counted);
  const justification = justificationText([reading.reason]);
  const band = (value: number) => bandName(l, value);
  const mixed = new Set(answers.map(({ item }) => how(item))).size > 1;
  const pages = [...new Map(answers.flatMap(({ item }) => item.sources).map((page) => [page.url, page])).values()];
  return (
    <div className="semantic-justification-body">
      <div>
        <h4 className="semantic-justification-label">{l('Justification', 'Justificativa')}</h4>
        <p>{justification || l('The AIs gave the note without a reason (short answer format).', 'As IAs deram a nota sem motivo (formato curto de resposta).')}</p>
      </div>
      <div>
        <h4 className="semantic-justification-label">{l('Evidence', 'Evidências')}</h4>
        <Facts reading={reading} />
      </div>
      {counted.length > 1 && (
        <p className="semantic-justification-source">
          {l(`Justification by ${ENGINE_LABELS[chosen.engine]}, the closest to the mean`, `Justificativa do ${ENGINE_LABELS[chosen.engine]}, a mais próxima da média`)}
        </p>
      )}
      <div className="semantic-justification-details">
        <More summary={l(`By AI (${number(answers.length)})`, `Por IA (${number(answers.length)})`)}>
          {/* How the AIs were asked: said once when it is the same for all of them, on each row only when they differ. */}
          {!mixed && <p className="semantic-justification-source">{how(answers[0]!.item)}</p>}
          <ul className="semantic-justification-answers">
            {answers.map(({ item, reading }) => (
              <li key={item.id}>
                <span className="semantic-justification-ai">
                  <ModelMark model={item.engine} />
                  <TagBadge tone="outline"><span className="sr-only">{l('Note', 'Nota')} </span>{number(reading.score, 0)}</TagBadge>
                  <small>{band(reading.score)}</small>
                  {mixed && <small>{how(item)}</small>}
                </span>
                <span className="semantic-justification-reason">
                  <span>{reading.reason ?? l('This AI gave the note without a reason (short answer format).', 'Esta IA deu a nota sem motivo (formato curto de resposta).')}</span>
                  <Facts reading={reading} />
                </span>
              </li>
            ))}
          </ul>
        </More>
        <More summary={l(`Sources (${number(pages.length)})`, `Fontes (${number(pages.length)})`)}>
          {pages.length
            ? <div className="perception-sources-list">{pages.map((page) => (
              <span key={page.url} className="flex flex-wrap items-center gap-2">
                <UrlCell link={link} url={page.url} title={page.title} domain={page.domain} t={l} />
                {/* The AIs are told not to use a brand's own site as evidence; when one does, the reader sees it. */}
                {ownSite(page.domain, domain) && <TagBadge tone="muted">{l("Brand's own site", 'Site da própria marca')}</TagBadge>}
              </span>
            ))}</div>
            : <p className="text-muted-foreground">{l('The AIs returned no sources.', 'As IAs não devolveram fontes.')}</p>}
        </More>
        <More summary={l('Question asked and full answers', 'Pergunta feita e respostas completas')}>
          <p className="perception-reason">{answers[0].item.question}</p>
          {answers.map(({ item }) => (
            <div key={item.id}>
              <p className="semantic-justification-ai">
                <ModelMark model={item.engine} />
                <small>{how(item)}, {day(item.date)}</small>
              </p>
              <pre className="perception-raw">{item.answer || l('(empty)', '(vazia)')}</pre>
            </div>
          ))}
        </More>
      </div>
    </div>
  );
}
