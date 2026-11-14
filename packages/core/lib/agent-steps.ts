// What a step of the agent did, read from what it asked and what came back: in a few words (the trace's hover) and in
// detail (its inspector). Plain words only: no tool or parameter names, never where Lastfind gets data from. Pure.
import type { ToolStep } from './agent';

export const STEP_SUMMARY_MAX = 120;
type T = (en: string, pt: string) => string;
type Item = { text: string; href?: string };
export type StepDetail = { facts: { label: string; value: string; href?: string }[]; lists: { title: string; items: Item[] }[] };

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const plain = (value: unknown) => String(value ?? '').replace(/data\s*for\s*seo/gi, 'Lastfind').replace(/\s+/g, ' ').trim();
const clip = (text: string, max = STEP_SUMMARY_MAX) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** A link only to a web address (what a model or a page wrote may be anything else). */
export const web = (value: unknown) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A page as people say it: its site and path, without the scheme or `www.`. */
export function pageName(url: unknown) {
  try {
    const parsed = new URL(String(url));
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return plain(url);
  }
}

function period(input: Record<string, unknown>, t: T) {
  if (typeof input.start === 'string' && typeof input.end === 'string') return t(`From ${input.start} to ${input.end}`, `De ${input.start} a ${input.end}`);
  return num(input.days) ? t(`Last ${input.days} days`, `Últimos ${input.days} dias`) : '';
}

/** One line on what the step did (empty when there is nothing to add to its name). */
export function stepSummary(step: ToolStep, t: T, locale: string): string {
  const input = record(step.input);
  const output = record(step.output);
  const n = (value: number) => value.toLocaleString(locale);
  const joined = (...parts: unknown[]) => clip(parts.filter((part) => typeof part === 'string' && part).join(', '));
  if (step.state === 'declined') return t('Declined by the person', 'Recusado pela pessoa');
  const error = record(output.error).message;
  if (step.state === 'error') return clip(plain(error ?? '') || t('It did not complete', 'Não foi concluído'));
  const words = num(record(output.words).total) ?? num(output.words);
  // `en` and `pt`: the word for one and for many.
  const count = (value: unknown, en: [string, string], pt: [string, string]) => {
    const size = list(value).length;
    return size ? t(`${n(size)} ${en[size === 1 ? 0 : 1]}`, `${n(size)} ${pt[size === 1 ? 0 : 1]}`) : '';
  };
  switch (step.name) {
    case 'read_page':
    case 'page_audit':
      return joined(pageName(input.url), words !== null && t(`${n(words)} words`, `${n(words)} palavras`));
    case 'search_results':
      return joined(`“${plain(input.keyword)}”`, count(output.organic, ['result', 'results'], ['resultado', 'resultados']), count(output.people_also_ask, ['question', 'questions'], ['pergunta', 'perguntas']));
    case 'keyword_volume':
      return count(input.keywords, ['keyword', 'keywords'], ['palavra-chave', 'palavras-chave']);
    case 'keyword_ideas':
      return joined(`“${plain(input.keyword)}”`, count(output.ideas, ['idea', 'ideas'], ['ideia', 'ideias']));
    case 'ranked_keywords':
    case 'competing_domains':
      return plain(input.domain);
    case 'backlinks':
      return plain(input.target);
    case 'create_artifact':
    case 'update_artifact':
    case 'read_artifact':
      return clip(plain(input.title ?? record(output.artifact).title));
    case 'patch_artifact':
      return clip(plain(input.section ?? record(output.artifact).title));
    case 'edit_artifact':
      return clip(plain(record(output.artifact).title));
    case 'set_content_overview':
      return joined(count(input.competitors, ['page', 'pages'], ['página', 'páginas']), count(input.topics, ['topic', 'topics'], ['tema', 'temas']), count(input.questions, ['question', 'questions'], ['pergunta', 'perguntas']), input.meta ? t('publication fields', 'campos de publicação') : '');
    case 'activate_skill':
      return plain(input.name);
    case 'read_skill_resource':
      return plain(input.path);
    case 'remember':
      return clip(plain(input.text));
  }
  return period(input, t);
}

/** What the step's inspector shows: the facts it found and the lists it read, at most a screenful each. */
export function stepDetail(step: ToolStep, t: T, locale: string): StepDetail {
  const input = record(step.input);
  const output = record(step.output);
  const n = (value: unknown) => (num(value) === null ? t('not measured', 'não medido') : (value as number).toLocaleString(locale));
  const facts: StepDetail['facts'] = [];
  const lists: StepDetail['lists'] = [];
  const fact = (label: string, value: unknown, href?: string) => {
    const text = typeof value === 'number' ? n(value) : plain(value);
    if (text) facts.push({ label, value: clip(text, 300), ...(href ? { href } : {}) });
  };
  const items = (title: string, values: Item[], max = 20) => {
    const kept = values.filter((item) => item.text).slice(0, max);
    if (kept.length) lists.push({ title, items: kept });
  };
  const error = record(output.error).message;
  if (step.state === 'error' || step.state === 'declined') {
    fact(t('What happened', 'O que houve'), step.state === 'declined' ? t('The person declined it.', 'A pessoa recusou.') : plain(error ?? '') || t('It did not complete.', 'Não foi concluído.'));
    return { facts, lists };
  }
  const when = period(input, t);
  if (when) fact(t('Period', 'Período'), when);
  switch (step.name) {
    case 'read_page': {
      const words = record(output.words);
      fact(t('Page', 'Página'), pageName(input.url), web(input.url));
      fact(t('Words of running text', 'Palavras de texto corrido'), words.running ?? null);
      fact(t('Words in all', 'Palavras no total'), words.total ?? null);
      items(
        t('Its headings', 'Seus títulos'),
        String(output.text ?? '')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) => ({ text: clip(line.replace(/^#+\s*/, ''), 160) })),
        40,
      );
      break;
    }
    case 'page_audit':
      fact(t('Page', 'Página'), pageName(input.url), web(input.url));
      fact(t('Status', 'Status'), output.status ?? '');
      fact(t('Title', 'Título'), output.title ?? '');
      fact(t('Meta description', 'Meta description'), output.description ?? '');
      fact(t('Words', 'Palavras'), output.words ?? null);
      items(t('Problems found', 'Problemas encontrados'), list(output.problems).map((item) => ({ text: plain(item).replace(/_/g, ' ') })));
      break;
    case 'search_results':
      fact(t('Search', 'Busca'), `“${plain(input.keyword)}”`);
      items(
        t('Google results', 'Resultados do Google'),
        list(output.organic).map((item) => {
          const row = record(item);
          return { text: `${row.position ?? ''}. ${plain(row.title)} (${plain(row.domain)})`, href: web(row.url) };
        }),
        10,
      );
      items(t('People also ask', 'Perguntas relacionadas'), list(output.people_also_ask).map((item) => ({ text: plain(item) })));
      items(t('Pages the AI Overview cites', 'Páginas citadas na Visão geral criada por IA'), list(output.ai_overview_sources).map((item) => ({ text: pageName(item), href: web(item) })));
      break;
    case 'keyword_volume':
      items(
        t('Monthly searches', 'Buscas por mês'),
        list(output.keywords).map((item) => ({ text: `${plain(record(item).keyword)}: ${n(record(item).volume)}` })),
        30,
      );
      break;
    case 'keyword_ideas':
      items(t('Ideas and monthly searches', 'Ideias e buscas por mês'), list(output.ideas).map((item) => ({ text: `${plain(record(item).keyword)}: ${n(record(item).volume)}` })), 30);
      break;
    case 'ranked_keywords':
      items(t('Keywords and positions', 'Palavras-chave e posições'), list(output.keywords).map((item) => ({ text: `${plain(record(item).keyword)}: ${n(record(item).position)}` })), 30);
      break;
    case 'competing_domains':
      items(t('Competing sites', 'Sites concorrentes'), list(output.competitors).map((item) => ({ text: `${plain(record(item).domain)}: ${n(record(item).shared_keywords)}` })), 30);
      break;
    case 'set_content_overview': {
      const comparison = record(output.comparison);
      const columns = list(comparison.columns).map(plain);
      const row = (label: string, values: unknown) =>
        fact(label, list(values).map((value, index) => `${index ? columns[index]?.split(': ')[0] : t('this text', 'este texto')} ${typeof value === 'number' ? n(value) : plain(value)}`).join('; '));
      row(t('Running words', 'Palavras de texto corrido'), comparison.running_words);
      row(t('Topics covered', 'Temas cobertos'), comparison.topics_covered);
      row(t('Google questions answered', 'Perguntas do Google respondidas'), comparison.questions_answered);
      items(t('Where the text was behind', 'Onde o texto ficou atrás'), list(output.behind).map((item) => ({ text: plain(item) })));
      break;
    }
    case 'create_artifact':
    case 'update_artifact':
    case 'patch_artifact':
    case 'edit_artifact':
    case 'read_artifact':
      fact(t('Artifact', 'Artefato'), input.title ?? record(output.artifact).title ?? '');
      if (input.section) fact(t('Section', 'Seção'), input.section);
      items(t('Its sections', 'Suas seções'), list(output.sections ?? record(output.artifact).sections).map((item) => ({ text: plain(item) })));
      break;
    case 'remember':
      fact(t('Added', 'Adicionado'), input.text ?? '');
      break;
    default:
      // A reading of the project's data: its figures as they came, and how many of each list.
      for (const [key, value] of Object.entries(output).filter(([key]) => !/(^|_)id$|url$|token/i.test(key)).slice(0, 12)) {
        const label = key.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase());
        if (typeof value === 'number' || (typeof value === 'string' && value.length <= 200)) fact(label, value);
        else if (Array.isArray(value)) fact(label, t(`${value.length} items`, `${value.length} itens`));
      }
  }
  return { facts, lists };
}
