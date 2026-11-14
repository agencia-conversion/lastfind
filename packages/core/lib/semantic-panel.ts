// The query panel of Semantic Branding.
// Semantic Branding does not evaluate the answers of the Prompts. On its own schedule it asks each AI ONE question that
// covers every monitored brand (the project's and its competitors') and every attribute, and the AI answers with a score
// from 0 to 100 per brand and attribute, with a reason and an evidence.
// Every AI the project monitors (8/11/2026: every AI, the same AIs as the project), asked the way its daily collection asks it
// (COLLECTION_SETUP): ChatGPT and Gemini through their interfaces, Google AI Mode and AI Overviews through Google, all scraped by the search
// data provider; Claude as the pure model and Perplexity as Sonar with its own search, the models the collection uses, through the same
// provider. The panel's own model calls through OpenRouter (`llm`, until 6/11/2026) are no longer asked; their stored answers stay readable
// in the justifications of their period and no longer count in any score. AI Overviews, AI Mode and ChatGPT are not asked to score
// (SEARCHED_ENGINES): Google shows no AI Overview for a scoring prompt, AI Mode answers it without searching and ChatGPT cites nothing in it. They get a natural search (brands vs brands,
// with the attributes), one per group of at most OVERVIEW_GROUP brands so every brand is in one; its notes, like those of any AI that answers in prose, are read out of the whole answer by cheap LLM calls
// (`readings`, no web search).
// The question is blind (31/10/2026): the brands go in a shuffled order, and the next round of an AI reverses it, so the place of a brand
// in the list cannot favour it; no brand is named as the project's or the main one. Each attribute goes with its name and its whole neutral
// definition. The evaluation follows the Brand-Attribute-Score method: for every brand and attribute a score from 0 to 100 and a reason of
// at most 12 words; facts (`evidence`, up to two) only those the AI is sure of, never guessed. A note an AI did not give, or that does not
// parse, is absent, never a zero.
import { ENGINES, type Engine } from './engines.ts';

/**
 * How a query is stored. `scrape`: the way the daily collection asks that AI (its interface, scraped; since 8/11/2026 also Claude's pure model
 * and Perplexity's Sonar, which have no interface to scrape): the only notes that count. `llm`: the panel's own model calls, until 6/11/2026
 * (OpenRouter; before 31/10/2026 DataForSEO), no longer asked or counted. The value keeps its old name: renaming it would rebuild the table.
 */
export type PanelMethod = 'llm' | 'scrape';

/** The AIs Semantic Branding asks (8/11/2026): every AI, as its collection asks it; the project's own list and country narrow it. */
export const PANEL_ENGINES = ENGINES;
/**
 * The AIs asked a natural search ("A vs B vs C category: attribute, attribute") whose answer in prose has its notes read afterwards
 * (readOverview): AI Overviews, and since 12/11/2026 AI Mode and ChatGPT. Asked the scoring task in JSON, AI Mode answered a code block
 * without searching (pilot: 0 references, the natural search 12), and ChatGPT searched but cited nothing in its JSON (pilot: 80+ pages read,
 * `sources` null; the natural search 3 cited), so neither showed a source in any project. Gemini cites with the JSON task and keeps it.
 */
export const SEARCHED_ENGINES: readonly Engine[] = ['chat_gpt', 'google_ai_mode', 'google_ai_overviews'];
/**
 * A search naming more brands gets a shorter paragraph each: a round asks a searched AI once per group of at most this many brands (balanced),
 * so every brand of the roster is in one search (until 8/11/2026 only the first five were, and the rest had no note).
 */
export const OVERVIEW_GROUP = 5;
/** The brands of each question an AI gets in a round: a searched AI one search per group (panelGroups), every other AI the whole roster at once. */
export function panelGroups<T>(engine: Engine, order: T[]): T[][] {
  if (!SEARCHED_ENGINES.includes(engine) || order.length <= OVERVIEW_GROUP) return [order];
  const count = Math.ceil(order.length / OVERVIEW_GROUP);
  return Array.from({ length: count }, (_, at) => order.slice(Math.round((at * order.length) / count), Math.round(((at + 1) * order.length) / count)));
}
/** The stored `model` of a query: the model the collection asks (Claude, Perplexity) or the engine id; a later group of a searched AI adds its number (unique per round). */
export const panelModel = (engine: Engine, group: number, model?: string | null) => `${model || engine}${group ? `:${group + 1}` : ''}`;
/** The evidences a note keeps: what the question asks for. Readings stored before keep all they had (evidenceList). */
export const PANEL_EVIDENCES = 2;
/**
 * The two orders of the brands: run 1 lists them in the reverse order of run 0. Since 3/11/2026 a round asks each AI once, and the
 * order alternates from one round to the next (nextRun), so two consecutive rounds still measure the order effect at no extra cost. The
 * pilot asks both in one go.
 */
export const PANEL_RUNS = [0, 1] as const;
/** The run of an AI's next round: the other order of its previous round (the brands reversed), or a new shuffle after a run 1. */
export const nextRun = (previous: { run: number; order: string[] } | undefined) =>
  previous && previous.run === 0 && previous.order.length ? { run: 1 as const, order: [...previous.order].reverse() } : { run: 0 as const, order: null };

export type PanelFrequency = 'daily' | 'weekly' | 'monthly';
export const PANEL_FREQUENCIES: readonly PanelFrequency[] = ['daily', 'weekly', 'monthly'];
/** Daily since 3/11/2026 (one round a day, each AI once); an edition may fix another for an account. */
export const DEFAULT_PANEL_FREQUENCY: PanelFrequency = 'daily';
/** In the period key of an operator's redo round (`<period start>~redo~<round id>`): unique beside the period's round, and out of the plan's monthly round count. */
export const REDO_PERIOD = '~redo~';
/** Queries a month at each frequency (a week is 52/12 of a month). */
export const RUNS_PER_MONTH: Record<PanelFrequency, number> = { daily: 30, weekly: 52 / 12, monthly: 1 };
/**
 * AIs a round needs and an attribute needs to be scored (one is enough, so a plan with a single AI has Semantic Branding).
 * The margin, from the disagreement between AIs (the sampling unit), needs two or more (lib/semantic-perception.ts).
 */
export const PANEL_MIN_ENGINES = 1;

export type PanelObservation = {
  /** Day (UTC) of the query. The chart buckets days by the frequency the project chose. */
  day: string;
  brand: string;
  attribute: string;
  engine: Engine;
  method: PanelMethod;
  score: number;
  model: string;
  /** The answer that carried this reading (one per AI and day, shared by every brand and attribute in it). */
  answerId: string;
  /** The tangible evidences the AI gave (at most PANEL_EVIDENCES since 3/11/2026, two to four from 31/10/2026, one or none before). */
  evidence: string[];
  reason: string | null;
};
export type PanelAnswer = {
  id: string;
  day: string;
  engine: Engine;
  method: PanelMethod;
  /** 0 or 1: the order of the brands (run 1 reverses run 0). */
  run?: number;
  model: string;
  question: string;
  response: string;
  sources: { url: string; domain: string; title: string }[];
};
export type PanelData = {
  /** True for synthetic data made to show the screen: it must never be shown as a measurement. */
  example: boolean;
  answers: PanelAnswer[];
  observations: PanelObservation[];
};

/** `aliases`: the other names the project gave the brand (a round keeps them in its roster since 13/11/2026). */
type Brand = { name: string; domain: string; aliases?: string[] };
/** The aliases a question names: at most three, in the order the owner gave them. */
const ROSTER_ALIASES = 3;
const aliasesOf = (brand: Brand) => (brand.aliases ?? []).filter((alias) => typeof alias === 'string' && alias.trim() && alias.trim() !== brand.name).slice(0, ROSTER_ALIASES);
/**
 * A brand as the roster names it: "Name (domain)", or "Name (domain; also A, B)" with its aliases (13/11/2026: an answer may name a brand
 * the way the project's aliases do, "Grupo FSB" for FSB Comunicação, and until then neither the AI, its reader nor the parser knew it was the brand).
 */
const rosterName = (brand: Brand, br: boolean) => {
  const aliases = aliasesOf(brand);
  return `${brand.name} (${brand.domain}${aliases.length ? `; ${br ? 'também' : 'also'} ${aliases.join(', ')}` : ''})`;
};
type Attribute = { id: string; name: string; description?: string };

const pt = (language: string) => language.toLowerCase().startsWith('pt');

/** A new random order of a list (Fisher-Yates); `random` is injected so a test can fix it. */
export function shuffled<T>(list: readonly T[], random = Math.random) {
  const order = [...list];
  for (let at = order.length - 1; at > 0; at--) {
    const pick = Math.floor(random() * (at + 1));
    [order[at], order[pick]] = [order[pick]!, order[at]!];
  }
  return order;
}
/** The brands in the order of a run: run 1 reverses run 0. */
export const runOrder = <T>(order: T[], run: number) => (run ? [...order].reverse() : order);

/**
 * The scale of a note (8/11/2026), one definition for every place that describes it: the task each AI gets (panelRequest's prompt,
 * chain and keyword), the readers that turn an answer in prose into notes (panelRequest's reader and the decision model's labels, overviewReading), and the
 * heatmap legend (HEAT_BANDS). The notes ran high on
 * "0 none, 50 mixed, 100 very strong"; 90 and above is now kept for the clear reference of the category on that attribute.
 */
export const SCORE_BANDS = [
  // The meaning of each band is the owner's wording (13/11/2026), verbatim in the task every AI gets.
  { id: 'weak', min: 0, max: 59, label: { en: 'Weakly perceived', pt: 'Pouco percebido' }, meaning: { en: 'the attribute is weakly perceived by the market', pt: 'atributo pouco percebido pelo mercado' } },
  { id: 'well', min: 60, max: 79, label: { en: 'Well perceived', pt: 'Bem percebido' }, meaning: { en: 'well perceived', pt: 'bem percebido' } },
  { id: 'fully', min: 80, max: 89, label: { en: 'Fully perceived', pt: 'Totalmente percebido' }, meaning: { en: 'fully perceived, with good quality', pt: 'totalmente percebido, com boa qualidade' } },
  { id: 'excellence', min: 90, max: 100, label: { en: 'Excellence zone', pt: 'Zona de excelência' }, meaning: { en: 'fully recognised by the market as THE reference for excellence', pt: 'totalmente reconhecido pelo mercado como A referência em excelência' }, brief: { en: 'only the one reference for excellence', pt: 'só a única referência em excelência' } },
] as const;
/**
 * The least two consecutive ranks of one answer differ by, in points (13/11/2026: the notes of a roster sat within a few points of each other,
 * whatever the rubric said). It is the margin of error of a change on the screen (semantic-perception.ts MARGIN_OF_ERROR): a brand ranked
 * above another is at least a visible step above it. Brands the AI cannot tell apart share a rank and may share a score.
 */
export const RANK_GAP = 5;
/**
 * The scale as the AIs read it: each band with its meaning, or (`short`: the 700-character keyword and the 500-character reader) with its label,
 * the top band still saying it is only for the category's reference.
 */
export function scoreRubric(language = 'en', short = false) {
  const lang = pt(language) ? 'pt' : 'en';
  const say = (band: (typeof SCORE_BANDS)[number]) => (!short ? band.meaning[lang] : 'brief' in band ? band.brief[lang] : band.label[lang].toLowerCase());
  return SCORE_BANDS.map((band) => `${band.min}-${band.max} ${say(band)}`).join(short ? ', ' : '; ');
}

/**
 * The scale's anchors in a few words (9/11/2026), for a question with no room for the whole rules: the 700-character keyword here and
 * Comparison's question (lib/comparison.ts), so both ask the same scale.
 */
export const scoreAnchors = (language = 'en') => (pt(language)
  ? `60+ só com fato verificável do atributo, senão até 59, 80+ só se destaca da categoria, 90+ só uma marca por atributo, ranks com ${RANK_GAP}+ pontos de diferença`
  : `60+ only with a checkable fact of the attribute, else 59 or less, 80+ only if it stands out in the category, 90+ one brand per attribute, ranks ${RANK_GAP}+ points apart`);

/** DataForSEO limits: a system message, the user prompt and each message of a chain are 500 characters; a scraper keyword is 700. */
const PART_LIMIT = 470;
const KEYWORD_LIMIT = 700;
/** The LLM Scraper (ChatGPT and Gemini interfaces) takes a prompt of up to 2,000 characters. */
const PROMPT_LIMIT = 2000;

/** A text in pieces of at most PART_LIMIT characters, cut at a space when there is one, that join back to the same text. */
function pieces(text: string) {
  const parts: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(text.length, at + PART_LIMIT);
    const space = end < text.length ? text.lastIndexOf(' ', end) : -1;
    if (space > at + PART_LIMIT / 2) end = space + 1;
    parts.push(text.slice(at, end));
    at = end;
  }
  return parts;
}
/** The provider's model APIs take at most 10 messages in a chain, and Perplexity wants them to alternate (user, then ai). */
const CHAIN_LIMIT = 10;
/** The most reading calls one answer in prose gets: enough for the longest AI Overview seen (about 7,000 characters of text, 8/11/2026). */
export const MAX_READINGS = 3;
/** The most brand-attribute pairs Claude and Perplexity are asked to explain (reason and facts, about 60 tokens each); above it, brief notes. */
const FULL_NOTES = 40;

/**
 * The one question to an AI, in the shapes each way of asking accepts. `brands` go in the order given (the caller shuffles them).
 *  keyword:  the same task in one keyword of at most 700 characters, with a bare `{"brand":{"attribute id":[score,"fact"]}}`: the last form
 *            of the prompt and the chain (Google AI Mode was asked it until 12/11/2026). Null when it does not fit.
 *  prompt:   the Gemini interface (2,000 characters; ChatGPT's until 12/11/2026): the whole task and roster as one message, else the keyword.
 *  chain:    Claude and Perplexity (the provider's model APIs, 500 characters a message, at most 10): the same whole question in a chain
 *            of messages (`alternate`: each answered "understood", as Perplexity requires), then the request itself; above FULL_NOTES pairs
 *            the same task with brief notes (a short reason, no facts), with the roster's definitions while they fit, else its names; the
 *            short keyword last; null when nothing fits.
 *  overview: the natural search for AI Overviews, AI Mode and ChatGPT (SEARCHED_ENGINES), which answer a search and not a scoring task: "A vs B vs C category: attribute, attribute"
 *            with every brand given (a group, panelGroups) and as many attributes as fit.
 *  readings: the provider's LLM requests that score the roster from the text of an answer in prose (an AI Overview): the whole text, in as many
 *            calls as it needs (at most MAX_READINGS), or none when the roster does not fit. Pass the text clean of links (plainAnswer).
 *  text:     the whole question as one readable text, shown next to the answer.
 * Each attribute goes with its name and its whole definition (a neutral sentence; the owner's older descriptions until they are replaced).
 */
export function panelRequest(brands: Brand[], attributes: Attribute[], category: string, language = 'en') {
  const br = pt(language);
  const where = category ? ` (${category})` : '';
  const define = (a: Attribute) => `${a.id} = ${a.name}${a.description ? `, ${a.description}` : ''}`;
  const roster = br
    ? `Marcas: ${brands.map((b) => rosterName(b, true)).join('; ')}. Atributos: ${attributes.map(define).join('; ')}.`
    : `Brands: ${brands.map((b) => rosterName(b, false)).join('; ')}. Attributes: ${attributes.map(define).join('; ')}.`;
  // Until 6/11/2026 the question also asked how well the AI knows each brand (`familiarity`), for the pure models; an interface searches.
  // A model that knows little of a brand still scores it and says so in its reason (8/11/2026: Claude's pure model, told by the collection
  // to assess only what it is sure of, answered a roster of small Brazilian agencies with no score at all).
  // The scale is anchored (9/11/2026; the rubric alone moved the averages by a few points, small agencies still got 82-86): the band first,
  // then the number; 60 or more only with a concrete fact of that attribute; a brand the AI barely knows below 60, still scored; 90 or more
  // for one brand per attribute at most. anchorReadings applies the same caps to what comes back.
  // Evidence first (10/11/2026: the notes still bunched within a few points): a fact is concrete and checkable (a generic sentence is
  // none), carries its source when the AI knows it, and every way of asking asks for one; brands with different facts get different notes.
  // Comparative (13/11/2026, the owner: "the scores are very close together; the AI must be more discerning and critical"): an absolute scale
  // asked brand by brand let every known brand into the same band, so per attribute the AI now RANKS the brands first, then scores them,
  // with the bands in the owner's words, a generic anchor for 50, 70, 85 and 95, a brand it knows little about low (never a middle score) and
  // consecutive ranks at least RANK_GAP points apart (anchorReadings enforces the gaps and the caps on what comes back).
  const rules = br
    ? `Avalie quanto o mercado associa cada marca a cada atributo, por fontes independentes (avaliações, imprensa, comparativos, usuários), nunca pelo que a marca diz de si. Seja crítico: a maioria das marcas não é referência. Para cada atributo, PRIMEIRO ordene as marcas listadas da associação mais forte à mais fraca (rank 1 = mais forte; o mesmo rank só para marcas que você não distingue), DEPOIS dê a cada uma a faixa e a nota de 0 a 100: ${scoreRubric('pt')}. Âncoras: 50 o mercado raramente liga a marca a ele, ou você sabe pouco dela; 70 parte de como a marca é descrita, com fato, como outras; 85 entre as poucas citadas primeiro nele, com fato que a destaca; 95 a marca pela qual a categoria se mede. Marca que você conhece pouco, ou sem fato concreto e verificável desse atributo (prêmio, ranking, número, case, avaliação, matéria; fato de outro atributo ou frase genérica não vale), fica em 59 ou menos, nunca numa nota média. 90 ou mais para uma marca por atributo no máximo, só a referência. Ranks consecutivos diferem em pelo menos ${RANK_GAP} pontos. `
    : `Rate how strongly the market associates each brand with each attribute, from independent sources (reviews, press, comparisons, users), never from what the brand says of itself. Be critical: most brands are not references. For every attribute, FIRST rank the brands listed from the strongest association to the weakest (rank 1 = strongest; the same rank only for brands you cannot tell apart), THEN give each its band and score from 0 to 100: ${scoreRubric('en')}. Anchors: 50 the market rarely links the brand to it, or you know little of it; 70 part of how the brand is described, with a fact, like others; 85 among the few named first for it, with a fact that sets it apart; 95 the brand the category measures itself against. A brand you know little about, or without a concrete checkable fact of that attribute (award, ranking, number, case, review, article; a fact of another attribute or a generic phrase does not count), scores 59 or less, never a middle score. 90 or more for one brand per attribute at most, only the reference. Consecutive ranks differ by at least ${RANK_GAP} points. `;
  const system = rules + (br
    ? 'reason em até 12 palavras; evidence com até 2 fatos concretos desse atributo de que você tem certeza (nunca a nota, a faixa ou um elogio), cada um com a fonte entre parênteses quando souber, vazia só abaixo de 60. Nunca invente fatos. Responda só JSON: {"brands":[{"brand":"nome","attributes":[{"id":"id do atributo","rank":1,"band":"faixa","score":0,"reason":"","evidence":[]}]}]}'
    : 'reason in at most 12 words; evidence with up to 2 concrete facts of that attribute you are sure of (never the score, the band or praise), each with its source in parentheses when you know it, empty only below 60. Never invent facts. Answer JSON only: {"brands":[{"brand":"name","attributes":[{"id":"attribute id","rank":1,"band":"band","score":0,"reason":"","evidence":[]}]}]}');
  // The same task with shorter notes (no reason, one fact of at most 10 words), for a roster whose full notes would pass a model's output cap.
  const brief = rules + (br
    ? 'sem reason; evidence com 1 fato desse atributo em até 10 palavras (nunca a nota ou a faixa), vazia só abaixo de 60. Nunca invente fatos. Responda só JSON: {"brands":[{"brand":"nome","attributes":[{"id":"id do atributo","rank":1,"band":"faixa","score":0,"evidence":[]}]}]}'
    : 'no reason; evidence with 1 fact of that attribute in at most 10 words (never the score or band), empty only below 60. Never invent facts. Answer JSON only: {"brands":[{"brand":"name","attributes":[{"id":"attribute id","rank":1,"band":"band","score":0,"evidence":[]}]}]}');
  const user = br
    ? `Dê a nota de cada marca em cada atributo${where}. Inclua todos os pares marca-atributo.`
    : `Score every brand on every attribute${where}. Include every brand-attribute pair.`;
  const parts = pieces(roster);
  // The bare form still asks a fact with each score, and the brand's rank on the attribute: `[score, "fact", rank]` (a note without a fact is
  // capped below 60 and the ranks spaced, anchorReadings).
  const bare = (rubric: string) => br
    ? `Dê de 0 a 100${rubric} a associação de cada marca com cada atributo${where}. Marcas: ${brands.map((b) => b.name).join(', ')}. Atributos: ${attributes.map((a) => `${a.id}=${a.name}`).join('; ')}. Responda só JSON {"marca":{"id do atributo":[nota,"fato, não a nota",rank]}}.`
    : `Score 0 to 100${rubric} how strongly each brand is associated with each attribute${where}. Brands: ${brands.map((b) => b.name).join(', ')}. Attributes: ${attributes.map((a) => `${a.id}=${a.name}`).join('; ')}. Answer JSON only {"brand":{"attribute id":[score,"fact, not the score",rank]}}.`;
  // The keyword carries the scale's labels and its anchors while they fit in 700 characters, else the labels, else the bare task (an AI not
  // asked has no note at all).
  const short = [bare(` (${scoreRubric(language, true)}; ${scoreAnchors(language)})`), bare(` (${scoreRubric(language, true)})`), bare('')].find((text) => text.length <= KEYWORD_LIMIT) ?? bare('');
  // Every attribute while the search fits (until 8/11/2026 only the first four: an attribute left out had no note, and a brand with too few
  // notes had no score in AI Overviews).
  const subject = `${brands.map((b) => b.name).join(' vs ')}${category ? ` ${category}` : ''}: `;
  let topics = attributes.map((a) => a.name);
  while (topics.length > 1 && (subject + topics.join(', ')).length > KEYWORD_LIMIT) topics = topics.slice(0, -1);
  const search = subject + topics.join(', ');
  // The reader's system message is at most 500 characters: the same anchors, a quote of TEXT standing for the fact. What the text must say
  // for each band goes in its user prompt (500 more): an AI answer describes every brand it compares, and a description of what a brand
  // offers read as "fully perceived" put every brand of a comparison at 82-86 (10/11/2026).
  // The reader ranks too (13/11/2026): the search it reads compares the brands, so per attribute it orders them by how TEXT treats them, then
  // scores with the same gaps; its quote of TEXT is the note's evidence (isQuote: TEXT's words, not a restated note), so a note it gives 60 or
  // more keeps its band (until then isFact asked the quote for a number or a name, and nearly every note of the three searched AIs fell to 59).
  const reader = br
    ? `Dê nota a cada marca em cada atributo só por TEXT. Por atributo, ordene as marcas como TEXT as favorece (1 = primeira), depois faixa e nota: ${scoreRubric('pt', true)}. Ranks ${RANK_GAP}+ pontos de diferença; 90+ só a marca que TEXT chama de líder. Omita par fora de TEXT. JSON: {"brands":[{"brand":"nome","attributes":[{"id":"id do atributo","rank":1,"band":"faixa","score":0,"reason":"","evidence":"trecho de TEXT"}]}]}`
    : `Score each brand on each attribute from TEXT only. Per attribute rank the brands as TEXT favours them (1 = first), then band and score: ${scoreRubric('en', true)}. Ranks ${RANK_GAP}+ points apart; 90+ only the brand TEXT calls the leader. Omit a pair TEXT does not cover. JSON only: {"brands":[{"brand":"name","attributes":[{"id":"attribute id","rank":1,"band":"band","score":0,"reason":"","evidence":"quote from TEXT"}]}]}`;
  const readUser = br
    ? 'Junte as mensagens ROSTER e depois as TEXT, em ordem, sem alterar nada. O reason nunca cita TEXT nem ROSTER. Dê as notas só com TEXT. Descrever o que a marca faz, oferece ou diz de si vale 60-79 no máximo; 80+ só se TEXT a destaca nesse atributo frente às outras; 90+ só se TEXT a chama de líder ou referência; desvantagem, ou atrás das outras, abaixo de 60. Marcas que TEXT trata igual dividem o rank. O trecho são palavras de TEXT, nunca a nota, a faixa ou um elogio.'
    : 'Join the ROSTER messages, then the TEXT messages, in order, unchanged. The reason never names TEXT or ROSTER. Score from TEXT only. Describing what a brand does, offers or says of itself is 60-79 at most; 80+ only if TEXT singles it out on that attribute against the others; 90+ only if TEXT calls it the leader or reference; a drawback, or behind the others, below 60. Brands TEXT treats alike share a rank. The quote is TEXT\'s words, never the score, band or praise.';
  const whole = `${system}\n\n${user}\n\n${roster}`;
  const names = br
    ? `Marcas: ${brands.map((b) => b.name).join(', ')}. Atributos: ${attributes.map((a) => `${a.id}=${a.name}`).join('; ')}.`
    : `Brands: ${brands.map((b) => b.name).join(', ')}. Attributes: ${attributes.map((a) => `${a.id}=${a.name}`).join('; ')}.`;
  const understood = br ? 'Entendido.' : 'Understood.';
  const ask = br ? `${user} Responda só JSON, no formato pedido.` : `${user} Answer JSON only, in the format asked.`;
  // Ten messages at most: Perplexity's must alternate user and ai (each piece answered "understood"); Claude takes them one after another.
  const turns = (text: string, alternate: boolean) => {
    const said = pieces(text);
    if (said.length * (alternate ? 2 : 1) > CHAIN_LIMIT) return null;
    return { message_chain: said.flatMap((message) => [{ role: 'user', message }, ...(alternate ? [{ role: 'ai', message: understood }] : [])]), user_prompt: ask };
  };
  return {
    /** The reader's rules (no roster), its system message and its request: the key that lets a project reuse the reading of the same text (readingKey). */
    reader,
    readUser,
    /**
     * Each reading reads a run of the text that follows the last one (8/11/2026: until then one call read what fit beside the roster, a third
     * to three quarters of an AI Overview, and the notes of the rest were lost).
     */
    readings: (answer: string) => {
      const room = CHAIN_LIMIT - parts.length;
      const text = pieces(answer.trim());
      if (room <= 0 || !text.length) return [];
      const runs: string[][] = [];
      for (let at = 0; at < text.length && runs.length < MAX_READINGS; at += room) runs.push(text.slice(at, at + room));
      return runs.map((run) => ({ system_message: reader, message_chain: [...parts.map((message) => ({ role: 'user', message: `ROSTER ${message}` })), ...run.map((message) => ({ role: 'user', message: `TEXT ${message}` }))], user_prompt: readUser }));
    },
    overview: search.length <= KEYWORD_LIMIT ? search : null,
    keyword: short.length <= KEYWORD_LIMIT ? short : null,
    // A roster whose definitions do not fit keeps the whole task with the names (its rules and evidence) before falling to the keyword.
    prompt: [whole, `${system}\n\n${user}\n\n${names}`].find((text) => text.length <= PROMPT_LIMIT) ?? (short.length <= KEYWORD_LIMIT ? short : null),
    // The full notes (reason, facts) of a big roster would pass the model's 4,096 output tokens (with its reasoning): the brief notes then,
    // with every rule of the task (8/11/2026: the bare short form had none, and a model told to assess only what it is sure of answered nothing).
    chain: ({ alternate = false }: { alternate?: boolean } = {}) =>
      (brands.length * attributes.length <= FULL_NOTES ? turns(whole, alternate) : null)
        ?? turns(`${brief}\n\n${user}\n\n${roster}`, alternate) ?? turns(`${brief}\n\n${user}\n\n${names}`, alternate) ?? turns(short, alternate),
    text: `${user}\n\n${roster}`,
  };
}

/**
 * `raw`: the AI's own score when anchorReadings capped it (kept in the query's input_json, `raw`; the stored score is the capped one).
 * `rank`: the brand's place among the brands of the answer on that attribute (1 = strongest; 13/11/2026), as the AI gave it; it spaces the
 * notes (anchorReadings) and is not stored: the anchored score carries it.
 */
export type PanelReading = { brand: string; attribute: string; score: number; reason: string | null; evidence: string[]; raw?: number; rank?: number };

/**
 * A reading's evidences as a list. Since 31/10/2026 they are stored as a JSON array; earlier readings hold one string (or none), kept as it was.
 */
export function evidenceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
  if (typeof value !== 'string' || !value.trim()) return [];
  if (value.trim().startsWith('[')) try { return evidenceList(JSON.parse(value)); } catch { /* a sentence that starts with a bracket */ }
  return [value];
}

/** First balanced {...} of a model reply (models add prose or code fences around the JSON). */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (quoted) { if (char === '\\') at++; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, at + 1);
  }
  return null;
}

const key = (value: string) => value.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** The shortest name that still finds a brand inside a longer label ("FSB" in "Grupo FSB"): shorter ones are too common. */
const MIN_INSIDE = 3;
/**
 * The brand a label in an answer stands for (13/11/2026). The roster names each brand as "Name (domain)" and models often copy that back:
 * its name, domain or one of its aliases, whole, finds it, the names first (an alias never takes another brand's own name). Else the one
 * brand whose name, alias or domain name is inside the label, or whose name holds the label ("Agência liveSEO", "Grupo FSB", "Hedgehog"
 * for "Hedgehog Digital"); a label that fits two brands finds none, so a note is never given to the wrong one.
 */
export function brandMatcher(brands: Brand[]) {
  const exact = new Map<string, string>();
  for (const brand of brands) for (const name of [brand.name, brand.domain ?? '']) if (key(name) && !exact.has(key(name))) exact.set(key(name), brand.name);
  for (const brand of brands) for (const alias of brand.aliases ?? []) if (key(alias) && !exact.has(key(alias))) exact.set(key(alias), brand.name);
  // The domain without its suffix ("conversion" of conversion.com.br) also names the brand inside a label.
  const names = brands.map((brand) => ({ brand: brand.name, keys: [...new Set([brand.name, ...(brand.aliases ?? []), (brand.domain ?? '').split('.')[0] ?? ''].map(key).filter((at) => at.length >= MIN_INSIDE))] }));
  return (label: string) => {
    const whole = exact.get(key(label)) ?? exact.get(key(label.replace(/\s*\([^()]*\)\s*$/, '')));
    if (whole) return whole;
    const said = key(label.replace(/\s*\([^()]*\)\s*$/, ''));
    if (said.length < MIN_INSIDE) return undefined;
    const fits = names.filter(({ keys }) => keys.some((name) => said.includes(name) || name.includes(said)));
    return fits.length === 1 ? fits[0]!.brand : undefined;
  };
}

/** The scale's band names in both languages, lower case: an evidence that names one restates the note. */
const BAND_NAMES = SCORE_BANDS.flatMap((band) => [band.label.en, band.label.pt].map((name) => name.toLowerCase()));
/** A score word next to a number of the 0-100 scale ("Score 92", "nota 85", "92/100"): the note restated. A small rating ("4,6/5") is a fact. */
const RESTATED_SCORE = /\b(?:score|nota|rating|pontua\S*|pontos?|points?)\b\W{0,3}(?:de\s|of\s)?(?:[1-9]\d|100)\b|\b(?:[1-9]\d|100)\s*(?:\/\s*100|pontos|points|pts)\b/i;
/**
 * Whether an evidence the reader of an answer in prose gives is a quote of that answer (13/11/2026): some words that name no band and restate
 * no score. What an AI's answer says of a brand is the measurement, so its quote is the evidence of a note read from it, whatever it holds.
 */
export function isQuote(text: string) {
  const lower = text.toLowerCase();
  return !!lower.trim() && !BAND_NAMES.some((name) => lower.includes(name)) && !RESTATED_SCORE.test(text);
}
/**
 * Whether an evidence is a fact (10/11/2026): it names no band and restates no score, and it holds something checkable: a number, a quote,
 * or a proper noun or acronym other than the brand's and the attribute's own words (a sentence's first word does not count). Generic praise
 * ("boa reputação", "feedback positivo de clientes") has none. `own`: the brand's name and domain and the attribute's name.
 * ponytail: a capitalisation heuristic; a decision model per evidence if it lets generic sentences through at scale.
 */
export function isFact(text: string, own: string[] = []) {
  if (!isQuote(text)) return false;
  if (/\d/.test(text) || /["“”«»][^"“”«»]{3,}["“”«»]/.test(text)) return true;
  const skip = new Set(own.flatMap((value) => value.split(/[^\p{L}\p{N}]+/u)).map((word) => word.toLowerCase()).filter(Boolean));
  // A sentence's first word counts only in a short fragment, a name ("Pixar", "Squid Game"), not in a sentence that merely starts with a capital.
  return text.split(/[.!?;:]\s+/).some((sentence) => sentence.split(/[^\p{L}\p{N}+&-]+/u).filter(Boolean).some((word, at, words) =>
    !skip.has(word.toLowerCase()) && ((/\p{Lu}.*\p{Lu}/u.test(word) && word.length > 1) || ((at > 0 || words.length <= 3) && /^\p{Lu}/u.test(word)))));
}
/**
 * The labels of the reader's messages (`ROSTER …`, `TEXT …`, see readings). A model sometimes writes one as the subject of its reason
 * ("TEXT identifies Netflix as…"): the label is dropped where a note's text starts with it, when it is stored and when it is read.
 */
const READER_LABEL = /^(?:ROSTER|TEXT)\b[\s:,.-]*/;
export const unlabeled = (text: string) => (READER_LABEL.test(text) ? text.replace(READER_LABEL, '').replace(/^\p{Ll}/u, (letter) => letter.toUpperCase()) : text);
// Citation marks some models leave in their text, like [5] or [5,15].
const clean = (value: unknown, limit: number) => (typeof value === 'string' ? unlabeled(value.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '').trim()).slice(0, limit) || null : null);
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/**
 * The readings in an AI's answer, in either shape (full: {"brands":[{brand,attributes:[{id,score,reason,evidence}]}]};
 * short: {"brand":{"attribute id":score}}). A brand or attribute that is not in the roster, or a score that is not a number from 0 to 100,
 * is dropped: that reading is absent, never a zero. Duplicates keep the first.
 * A reply that does not parse whole (cut at its output limit, braces in prose before the JSON, other key names) still gives every complete
 * note in it: each object with a score and an attribute, under the last brand named before it.
 * `quotes` (the reader of an answer in prose, 13/11/2026): its evidence is a quote of the answer (isQuote), not a fact of its own (isFact).
 * A note's `rank` (the brand's place on the attribute, 1 first) comes with it when the answer gives one, as `rank` or the bare form's third item.
 */
export function parsePanelReply(raw: string, brands: Brand[], attributes: Attribute[], limit = 500, { quotes = false }: { quotes?: boolean } = {}): PanelReading[] {
  // An interface's answer comes as Markdown, which escapes brackets and dollar signs (`\[`, `\$`): invalid in JSON, so they are unescaped.
  const text = raw.replace(/\\([[\]$_*#])/g, '$1');
  const json = extractJson(text);
  let root: Record<string, unknown> | null = null;
  try { root = json ? record(JSON.parse(json)) : null; } catch { /* read note by note below */ }
  const brandOf = brandMatcher(brands);
  const attributeByKey = new Map(attributes.flatMap((attribute) => [[key(attribute.id), attribute.id], [key(attribute.name), attribute.id]] as const));
  const found = new Map<string, PanelReading>();
  const add = (brandName: unknown, attributeName: unknown, value: unknown) => {
    const brand = typeof brandName === 'string' ? brandOf(brandName) : undefined;
    const attribute = typeof attributeName === 'string' ? attributeByKey.get(key(attributeName)) : undefined;
    const detail = record(value);
    // The bare form's `[score, "fact", ...]` (10/11/2026).
    const pair = Array.isArray(value) ? value : null;
    // A note as a number, or as a number written as text ("85", "85,5"), under the key asked or the one a model translated it to.
    const given = pair ? pair[0] : typeof value === 'number' || typeof value === 'string' ? value : (detail?.score ?? detail?.nota ?? detail?.rating);
    const score = typeof given === 'string' && /^\s*\d{1,3}(?:[.,]\d+)?\s*$/.test(given) ? Number(given.replace(',', '.')) : given;
    if (!brand || !attribute || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return;
    const id = `${brand}\u0000${attribute}`;
    // Only facts count as evidence (isFact): a restated note, a band or generic praise is dropped, so a note left without one stays below 60.
    // The reader's quote of the answer counts as it is (isQuote).
    const own = [brand, brands.find((item) => item.name === brand)?.domain ?? '', attributes.find((item) => item.id === attribute)?.name ?? ''];
    const evidence = evidenceList(pair ? pair.slice(1) : detail?.evidence ?? detail?.evidences ?? detail?.evidencias ?? detail?.evidencia).map((item) => clean(item, limit))
      .filter((item): item is string => !!item && (quotes ? isQuote(item) : isFact(item, own))).slice(0, PANEL_EVIDENCES);
    const placed = pair ? pair.find((item, at) => at > 0 && typeof item === 'number') : detail?.rank ?? detail?.ranking ?? detail?.posicao ?? detail?.posição;
    const rank = typeof placed === 'number' && Number.isInteger(placed) && placed >= 1 ? placed : typeof placed === 'string' && /^\s*\d{1,3}\s*$/.test(placed) && Number(placed) >= 1 ? Number(placed) : undefined;
    if (!found.has(id)) found.set(id, { brand, attribute, score: Math.round(score), reason: clean(detail?.justification ?? detail?.reason ?? detail?.justificativa, limit), evidence, ...(rank ? { rank } : {}) });
  };
  if (root && Array.isArray(root.brands)) {
    for (const item of root.brands) {
      const entry = record(item);
      if (entry && Array.isArray(entry.attributes)) for (const raw of entry.attributes) { const cell = record(raw); if (cell) add(entry.brand, cell.id ?? cell.attribute, cell); }
    }
  } else if (root) {
    for (const [name, cells] of Object.entries(root)) { const row = record(cells); if (row) for (const [attribute, value] of Object.entries(row)) add(name, attribute, value); }
  }
  if (!found.size) {
    const named = [...text.matchAll(/"(?:brand|marca)"\s*:\s*"([^"\\]*)"/g)];
    for (let at = text.indexOf('{'); at >= 0; at = text.indexOf('{', at + 1)) {
      let cell: Record<string, unknown> | null = null;
      try { const piece = extractJson(text.slice(at)); cell = piece ? record(JSON.parse(piece)) : null; } catch { continue; }
      if (cell && ('score' in cell || 'nota' in cell)) add(named.filter((match) => match.index! < at).at(-1)?.[1], cell.id ?? cell.attribute, cell);
    }
  }
  return [...found.values()];
}

const EVIDENCE_FLOOR = SCORE_BANDS[1].min;
const EXCELLENCE = SCORE_BANDS[3].min;
/**
 * The anchors of the scale applied to the notes of ONE answer as they are recorded (9/11/2026; stored notes are never rewritten, so past
 * periods keep their numbers). A note of 60 or more without evidence is capped at 59, whatever the question (10/11/2026: no evidence,
 * no note above 59; until then only when the question asked for it, and the bare keyword's and the brief notes' 60-95 without a fact kept
 * every brand in the same few points). Per attribute at most one brand stays at 90 or more, the highest; a tie at the top has no single clear
 * reference, so every tied brand is capped at 89 too (a tie broken by name would favour a brand for its spelling). A capped note keeps the
 * AI's own score in `raw`.
 * Ranks (13/11/2026): per attribute, the notes that carry the AI's rank are spaced as the task asks: a note ranks below another only RANK_GAP
 * or more points under it (a note of a lower rank above that is capped, never raised; brands of one rank keep their notes). The gaps go first,
 * on the AI's own scores, then the evidence cap: a brand with a fact is never pulled under 60 by one ranked above it without a fact.
 * `evidenceLed` false (the decision-model reader, whose labels are the judgment of the text and write no quote): no evidence cap.
 */
export function anchorReadings(readings: PanelReading[], { evidenceLed = true }: { evidenceLed?: boolean } = {}): PanelReading[] {
  const cap = (reading: PanelReading, score: number) => (reading.score > score ? { ...reading, score, raw: reading.raw ?? reading.score } : reading);
  const ceilings = new Map<PanelReading, number>();
  for (const attribute of new Set(readings.map((reading) => reading.attribute))) {
    const ranked = readings.filter((reading) => reading.attribute === attribute && reading.rank !== undefined).sort((a, b) => a.rank! - b.rank!);
    let ceiling = Infinity;
    for (const rank of new Set(ranked.map((reading) => reading.rank))) {
      const group = ranked.filter((reading) => reading.rank === rank);
      for (const reading of group) ceilings.set(reading, ceiling);
      ceiling = Math.min(...group.map((reading) => Math.min(reading.score, ceiling))) - RANK_GAP;
    }
  }
  const spaced = readings.map((reading) => cap(reading, ceilings.get(reading) ?? Infinity));
  const sure = spaced.map((reading) => (evidenceLed && !reading.evidence.length ? cap(reading, EVIDENCE_FLOOR - 1) : reading));
  const top = new Map<string, number[]>();
  for (const reading of sure) if (reading.score >= EXCELLENCE) top.set(reading.attribute, [...(top.get(reading.attribute) ?? []), reading.score]);
  return sure.map((reading) => {
    const scores = top.get(reading.attribute);
    if (!scores || reading.score < EXCELLENCE) return reading;
    const best = Math.max(...scores);
    return reading.score === best && scores.filter((score) => score === best).length === 1 ? reading : cap(reading, EXCELLENCE - 1);
  });
}

/**
 * The question as a person reads it: without the instruction that tells the model how to join the ROSTER messages, the attribute ids
 * ("value = Value for money" is "Value for money") and the JSON format the scrapers are asked to answer in.
 */
export function readableQuestion(text: string) {
  return text
    .replace(/^(?:Join the ROSTER messages|Junte as mensagens ROSTER)[^.]*\.\s*/i, '')
    // To the end of its line: in an interface's prompt the brands and attributes follow it.
    .replace(/\s*(?:Answer JSON only|Responda só JSON)[^\n]*/g, '')
    .replace(/(?<=(?:Attributes|Atributos): |; )[\w-]+ ?= ?/g, '')
    .trim();
}

/** Monday (UTC) of the week of a date. */
export function weekStart(date: string) {
  const at = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}
/** First day of the period (day, week or month) a query day falls in, for the frequency the project chose. */
export const periodStart = (date: string, frequency: PanelFrequency) => (frequency === 'daily' ? date.slice(0, 10) : frequency === 'monthly' ? `${date.slice(0, 7)}-01` : weekStart(date));
