/**
 * Free brand discovery. Every name an answer presents
 * as an entity is a candidate: the head of list items, headings, bold titles and table cells, the names
 * of "como A, B e C" lists and capitalized spans of running text. Candidates are grouped across
 * answers with a few excerpts each; what a name is to the project (competitor, client, supplier, source,
 * partner or not a brand) is decided by the brand_roles decision model (brand-roles.ts), never here.
 * No persistence, network or paid inference.
 */
import placeNames from './place-names.json' with { type: 'json' };
import type { BrandRole } from './brand-roles.ts';
import { brandDomainFromHits, brandLabel, domainHitsOf, registrableDomain, textHosts } from './brand-domain.ts';
import { competitorIdentity } from './competitor-identity.ts';
import { decodeEntities } from './html-text.ts';
import { brandKey } from './brand-decisions.ts';
import type { AnswerBrand } from './types.ts';

/**
 * Stored with a finished analysis: the reanalysis redoes projects analysed by an older detector.
 * v5: section and label words, numeric specs, category phrases and sentence openers are not names;
 * comparison tables give their header, not their criteria; ordinary words are dropped over the whole window;
 * sub-brands and divisions ("Accenture Song") fold into the brand named alone ("Accenture").
 * v6: a name the answers write in italics ("*Severance*") is a title, not a brand; a dictionary word never heads a
 * family ("Star" does not take "Star Wars"); a season marker is not a model number; no family chains.
 * v7: the same answers give the same brands however they are paged or ordered. Pages only tally names; ordinary
 * words, titles, families and counts are decided once over the whole window, in one canonical order, and each family is
 * counted once per answer. A longer name the answers use more than its head is a brand of its own ("Amazon Prime" is not
 * Amazon's); "The Sopranos" is "Sopranos"; "JustWatch.JustWatch" in prose is no domain.
 * v8: the discovery is unchanged; the same pass recounts the project's own names with the matcher that folds
 * spacing, hyphens, apostrophes and "&" (lib/metrics.ts mentionText), so a reprocess gives the older answers those mentions.
 * v9: the discovery is unchanged; the same pass recounts the project's names that are also common words
 * ("Conversion" in "conversion rate") by their evidence in each answer (lib/brand-mention-check.ts), and asks the decision
 * model only about the mentions the text cannot settle (lib/server/brand-mention-checks.ts, within US$ 30 in all).
 * v10: a spelling used inside longer capitalized terms ("Conversion Rate Optimization" in Portuguese answers that
 * write "conversão") is a common word too; such a term counts as the word only when it is generic, else it is asked.
 * v11: another company's longer name is no mention ("AIM Conversion Experts", "Conversion Sciences é uma
 * agência", "Conversion.com"); the decision model had said "the company" for them (60 of 138 CRO answers).
 * v12: the discovery is unchanged; the same pass reads the project's common-word names again with rules that use
 * no word list or language grammar (lib/brand-mention-check.ts R1-R8) and asks the decision model about the rest by the
 * exact question, counting only on its probability (brand-mentions:v2). The bump only triggers the 90-day recount.
 * v13: a monitored spelling that is a common word in the window claims only itself in discovery: a longer name
 * holding it ("AIM Conversion Experts", "Apple Watch") is a discovered name of its own, judged by the roles model.
 * v14 (10/11/2026): a longer name holding a monitored competitor's whole name ("Amazon Prime Video" for Prime Video) is
 * one name question per pair (lib/brand-mention-check.ts \`pair\`): the competitor itself counts as its mention, anything
 * else is a brand of its own. The bump reads every answer again under it (one full pass per project).
 * v15 (11/11/2026): the brands the project already knows (its counted discoveries, with their aliases) are found in each
 * answer by their spellings first (knownBrandMentions), so a known name the extraction cannot read as one ("Orgânica
 * Digital", made of section words; "Web Estratégica / Orgânica Digital") is still named and counted; and a name spelled
 * like a site the answer links or writes ("Inside Digital", insidedigital.com.br) is a name whatever its words. The bump
 * reads every answer again under it.
 */
export const DETECTOR_VERSION = 'structure-v15';
/** Longer answers are read up to here. */
export const MAX_DISCOVERY_ANSWER_CHARACTERS = 180_000;

export type DiscoveryAnswer = {
  id: string;
  answer: string;
  sources: { url: string; domain: string; title: string }[];
  createdAt: string;
};

export type DiscoverySeed = {
  name: string;
  domain: string;
  aliases?: string[];
  domains?: string[];
};

/** Who the name is to the project (the detector only tells client or supplier; the decision model adds the rest). */
export type { BrandRole };

export type CompetitorCandidate = {
  name: string;
  domain: string | null;
  domainEvidence: 'none' | 'unique' | 'conflict';
  /** 1 when some answer presents the name as an item (list, heading, bold title, table), 0.5 when only in running text. */
  score: number;
  answerCount: number;
  evidence: { runId: string; excerpt: string; createdAt: string }[];
  key?: string;
  ambiguous?: boolean;
  reasons?: string[];
  role?: BrandRole;
  /** UTC day (YYYY-MM-DD) → answers of that day that mention the name. */
  days?: Record<string, number>;
  /** No role cue, domain or company role: it leaves the list if the window writes it in lowercase as often as it names it. */
  plain?: boolean;
  /** Answers of this page that write the name in lowercase ("via", "link building"); the store adds the pages up. */
  lowercaseAnswers?: number;
  /** Answers of this page that write the name in italics ("*Severance*"): a title of a work, not a brand; the store adds the pages up. */
  italicAnswers?: number;
  /** The first word of this (multi-word) name is written in lowercase somewhere on this page ("star" of "Star Wars"): it never heads a family. */
  headOrdinary?: boolean;
  /** Some answer presents the name as an item (list, heading, bold title, table), not only in running text. */
  structured?: boolean;
  /** Other spellings and sub-brands this candidate stands for ("Accenture Song" under "Accenture"). */
  aliases?: string[];
};

/** Keys of the words an answer writes all in lowercase ("via", "forte"; not "iPullRank"). */
export function lowercaseWordKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(/(?<![\p{L}\p{M}\p{N}./@_:-])\p{Ll}[\p{Ll}\p{M}]{2,}(?![\p{L}\p{M}\p{N}@_]|\.\p{L})/gu))
    keys.add(brandDetectionKey(match[0]));
  return keys;
}

// Full case-fold exceptions after NFKC (Unicode 16); Cherokee folds to uppercase.
const CASE_FOLD: Record<string, string> = {
  ß: 'ss',
  ǰ: 'ǰ',
  'ͅ': 'ι',
  ΐ: 'ΐ',
  ΰ: 'ΰ',
  ς: 'σ',
  ᲀ: 'в',
  ᲁ: 'д',
  ᲂ: 'о',
  ᲃ: 'с',
  ᲄ: 'т',
  ᲅ: 'т',
  ᲆ: 'ъ',
  ᲇ: 'ѣ',
  ᲈ: 'ꙋ',
  ẖ: 'ẖ',
  ẗ: 'ẗ',
  ẘ: 'ẘ',
  ẙ: 'ẙ',
  ẞ: 'ss',
  ὐ: 'ὐ',
  ὒ: 'ὒ',
  ὔ: 'ὔ',
  ὖ: 'ὖ',
  ᾀ: 'ἀι',
  ᾁ: 'ἁι',
  ᾂ: 'ἂι',
  ᾃ: 'ἃι',
  ᾄ: 'ἄι',
  ᾅ: 'ἅι',
  ᾆ: 'ἆι',
  ᾇ: 'ἇι',
  ᾈ: 'ἀι',
  ᾉ: 'ἁι',
  ᾊ: 'ἂι',
  ᾋ: 'ἃι',
  ᾌ: 'ἄι',
  ᾍ: 'ἅι',
  ᾎ: 'ἆι',
  ᾏ: 'ἇι',
  ᾐ: 'ἠι',
  ᾑ: 'ἡι',
  ᾒ: 'ἢι',
  ᾓ: 'ἣι',
  ᾔ: 'ἤι',
  ᾕ: 'ἥι',
  ᾖ: 'ἦι',
  ᾗ: 'ἧι',
  ᾘ: 'ἠι',
  ᾙ: 'ἡι',
  ᾚ: 'ἢι',
  ᾛ: 'ἣι',
  ᾜ: 'ἤι',
  ᾝ: 'ἥι',
  ᾞ: 'ἦι',
  ᾟ: 'ἧι',
  ᾠ: 'ὠι',
  ᾡ: 'ὡι',
  ᾢ: 'ὢι',
  ᾣ: 'ὣι',
  ᾤ: 'ὤι',
  ᾥ: 'ὥι',
  ᾦ: 'ὦι',
  ᾧ: 'ὧι',
  ᾨ: 'ὠι',
  ᾩ: 'ὡι',
  ᾪ: 'ὢι',
  ᾫ: 'ὣι',
  ᾬ: 'ὤι',
  ᾭ: 'ὥι',
  ᾮ: 'ὦι',
  ᾯ: 'ὧι',
  ᾲ: 'ὰι',
  ᾳ: 'αι',
  ᾴ: 'άι',
  ᾶ: 'ᾶ',
  ᾷ: 'ᾶι',
  ᾼ: 'αι',
  ῂ: 'ὴι',
  ῃ: 'ηι',
  ῄ: 'ήι',
  ῆ: 'ῆ',
  ῇ: 'ῆι',
  ῌ: 'ηι',
  ῒ: 'ῒ',
  ῖ: 'ῖ',
  ῗ: 'ῗ',
  ῢ: 'ῢ',
  ῤ: 'ῤ',
  ῦ: 'ῦ',
  ῧ: 'ῧ',
  ῲ: 'ὼι',
  ῳ: 'ωι',
  ῴ: 'ώι',
  ῶ: 'ῶ',
  ῷ: 'ῶι',
  ῼ: 'ωι',
};

export function brandDetectionKey(value: string): string {
  const folded = Array.from(value.normalize('NFKC'), (character) =>
    /[\u13a0-\u13ff\uab70-\uabbf]/u.test(character)
      ? character.toUpperCase()
      : (CASE_FOLD[character] ?? character.toLowerCase()),
  ).join('');
  const key = folded.replace(/[^\p{L}\p{M}\p{N}+]+/gu, ' ').trim();
  // "Paramount Plus", "Disney Plus", "ESPN Plus" are written "Paramount+", "Disney+", "ESPN+" as often.
  return key.replace(/^(\S.*?)\s*(?:\+|\splus)$/u, '$1+');
}

// Places in any language: countries from the runtime's own CLDR data, cities and
// first-level divisions from lib/place-names.json (scripts/build-place-names.mjs).
const REGION_LOCALES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'id', 'ja', 'ko', 'zh', 'vi', 'th', 'el', 'ro', 'hu'];
const stripMarks = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '');
const PLACES = (() => {
  const keys = new Set<string>();
  const add = (name: string | undefined) => {
    if (!name) return;
    const key = brandDetectionKey(name);
    if (key.length >= 3 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(key))
      keys.add(key).add(stripMarks(key));
  };
  for (const key of placeNames as string[]) add(key);
  const codes: string[] = [];
  for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') codes.push(first + second);
  for (const locale of REGION_LOCALES) {
    try {
      const names = new Intl.DisplayNames([locale], { type: 'region' });
      for (const code of codes) {
        const name = names.of(code);
        if (name && name !== code) add(name);
      }
    } catch {
      /* A runtime without this locale simply knows fewer names. */
    }
  }
  return keys;
})();
/** A city, state, province or country name in any of the supported languages. */
export function isPlaceName(key: string): boolean {
  return PLACES.has(key) || PLACES.has(stripMarks(key));
}

// Connection, display and audio standards that answers name as features, never as companies
// ("Wi-Fi" once appeared as a monitored brand). Matched on the whole name only.
const GENERIC_TECHNOLOGY = new Set([
  'wi fi', 'wifi', 'bluetooth', '4k', '8k', 'uhd', 'hd', 'full hd', 'hdr', 'hdr10', 'hdr10+', 'hdmi', 'usb', 'usb c',
  'nfc', 'gps', 'lte', '3g', '4g', '5g', 'ethernet', 'lan', 'vpn', 'qr code',
]);
/** A technology standard or feature ("Wi-Fi", "4K", "HDR", "Bluetooth"): not a company in any answer. */
export function isGenericTechnology(key: string): boolean {
  return GENERIC_TECHNOLOGY.has(key);
}

// Names joined by a separator or a conjunction are separate brands ("A × B", "A + B", "A e B",
// "A / B", "A, B"); a conjunction left at an edge ("e B") is not part of the name.
const CONJUNCTIONS = 'e|and|y|et|und|och|en|og|ou|or|и|і';
const SEPARATORS = new RegExp(
  `\\s*[×✕✖]\\s*|\\s+x\\s+|\\s+/\\s+|\\s+\\+\\s+|(?<=\\p{L})/(?=\\p{Lu}\\p{Ll})|\\s*,\\s+|\\s+(?:${CONJUNCTIONS})\\s+`,
  'gu',
);
const LEGAL_SUFFIX = /^(?:inc|ltd|llc|ltda|sa|s\/a|co|corp|gmbh|plc|me|eireli)\.?$/iu;
const EDGE_CONJUNCTION = new RegExp(`^(?:${CONJUNCTIONS})\\s+|\\s+(?:${CONJUNCTIONS})$`, 'u');
const AMPERSAND = /\s*&\s*/gu;
/**
 * Offsets, inside `surface`, of the brand names it holds. "&" joins a name
 * ("Procter & Gamble", "AT&T") unless every part is already a brand known on its
 * own (`known`, as brandDetectionKey values).
 */
export function splitBrandSurface(
  surface: string,
  known: ReadonlySet<string> = new Set(),
): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = [];
  let from = 0;
  const cut = (start: number, end: number) => {
    let text = surface.slice(start, end);
    for (;;) {
      const lead = text.length - text.trimStart().length;
      start += lead;
      text = text.slice(lead).trimEnd();
      const edge = EDGE_CONJUNCTION.exec(text);
      if (!edge) break;
      if (edge.index === 0) {
        start += edge[0].length;
        text = text.slice(edge[0].length);
      } else text = text.slice(0, edge.index);
    }
    const end2 = start + text.length;
    if (/[\p{L}\p{N}]/u.test(text) && Array.from(text).length >= 2 && !LEGAL_SUFFIX.test(text))
      pieces.push({ start, end: end2 });
  };
  for (const match of surface.matchAll(SEPARATORS)) {
    cut(from, match.index);
    from = match.index + match[0].length;
  }
  cut(from, surface.length);
  return pieces.flatMap((piece) => {
    const text = surface.slice(piece.start, piece.end);
    if (!text.includes('&')) return [piece];
    const parts = text.split(AMPERSAND);
    if (!parts.every((part) => known.has(brandDetectionKey(part)))) return [piece];
    let at = piece.start;
    return parts.map((part) => {
      const start = surface.indexOf(part, at);
      at = start + part.length;
      return { start, end: at };
    });
  });
}


// A name listed right after "clientes como ..." / "fornecedores: ..." is a client or supplier of the
// brand being described, not its competitor. Only the explicit cue counts; anything subtler is left
// for the decision model.
const CLIENT_CUE =
  /(?:clientes?|customers?|clients?|marcas|brands|nomes)\s*(?:como|tais como|incluem|inclui|incluindo|such as|like|including|includes?|are|são|:)\s*([^.;:!?\n]*)$/iu;
const SUPPLIER_CUE =
  /(?:fornecedor(?:es)?|suppliers?|vendors?)\s*(?:como|incluem|inclui|incluindo|such as|like|including|includes?|are|são|:)\s*([^.;:!?\n]*)$/iu;
const LIST_TAIL =
  /^(?:[\p{Lu}\p{N}][^,\s]*(?:\s+[\p{Lu}\p{N}][^,\s]*)*\s*(?:,\s*|\s+(?:e|and|y)\s+))*$/u;
function listedAfter(cue: RegExp, before: string) {
  const match = cue.exec(before);
  return !!match && LIST_TAIL.test(match[1]!.replace(/[*_[\]()]/gu, ''));
}

/** Where an answer presents a name: as an item (list lead, heading, bold title, table cell) or in running text. */
export type MentionStructure = 'list' | 'heading' | 'bold' | 'table' | 'prose';
export type BrandMention = {
  name: string;
  /** brandDetectionKey of the name. */
  key: string;
  structure: MentionStructure;
  /** The text around the name, for the decision model and the evidence shown to people. */
  excerpt: string;
  /** Named right after an explicit client or supplier cue. */
  cue?: 'client' | 'supplier';
  /** The text right after it gives it a company role ("Via oferece CRO", "X é uma agência"). */
  company?: boolean;
  /** A span opening a sentence, whose first word may be grammar ("Auch Orbit"). */
  opening?: boolean;
  /** Written in italics ("*Severance*", "_The Bear_"): how answers write the title of a work, never a brand. */
  italic?: boolean;
};

/** The name opens or closes an italic span of the line ("*Severance*", "*Only Murders in the Building*"); bold ("**") is not italics. */
function italicized(line: string, name: string) {
  const word = (character: string | undefined) => !!character && /[\p{L}\p{N}]/u.test(character);
  for (let at = line.indexOf(name); at >= 0; at = line.indexOf(name, at + 1)) {
    const [before, open] = [line[at - 2], line[at - 1]];
    const [close, after] = [line[at + name.length], line[at + name.length + 1]];
    if (word(open) || word(close)) continue;
    if ((open === '*' || open === '_') && before !== '*' && !word(before)) return true;
    if ((close === '*' || close === '_') && after !== '*' && !word(after)) return true;
  }
  return false;
}

// "Name oferece…", "Name é uma agência…": the sentence treats the name as a company, so it is not an ordinary word.
const COMPANY_AFTER =
  /^[\s*_:,;—–-]*(?:(?:é|is|era|was)\s+(?:um|uma|an?|the)?\s*(?:[\p{L}-]+\s+){0,3}(?:agência|empresa|consultoria|plataforma|ferramenta|marca|agency|company|consultancy|platform|tool|firm|brand|banco|bank|fintech|loja|varejista|retailer|startup|grupo|group|rede|serviço|service|streamer|app|aplicativo|software|provedor|provider|operadora|fabricante|manufacturer|seguradora|insurer|editora|publisher|canal|channel|estúdio|studio|marketplace|network|label|divisão|division|subsidiária|subsidiary|alternativa|alternative|opção|option|concorrente|competitor|rival)\b|(?:oferece|fornece|atende|ajuda|desenvolve|vende|lançou|produz|opera|publica|lança|offers?|provides?|helps?|builds?|sells?|launched|launches|produces?|operates?|serves?|publishes|releases?)\b)/iu;
// The first header cell of a comparison table: the column that holds criteria, not brands.
const CRITERIA_HEAD =
  /^(?:|#|—|–|-|vs\.?|feature|features|criteria|criterion|critério|critérios|aspect|aspects|aspecto|aspectos|spec|specs|specification|specifications|especificação|especificações|category|categoria|attribute|attributes|atributo|atributos|característica|características|recurso|recursos|comparison|comparação|comparativo|metric|metrics|métrica|métricas|factor|factors|fator|fatores|dimension|dimensions|dimensão|área|area|quesito|quesitos|parameter|parameters|parâmetro|parâmetros|item|itens|items|element|elements|elemento|elementos|field|campo|what|o que)$/iu;
const CONNECTORS = new Set('de da do das dos e para em com por of the and for & + y del la le von van'.split(' '));
// Words of section headings, field labels, table criteria, feature names and category phrases in English and
// Portuguese ("Key Takeaways", "Prós e Contras", "Live TV", "Marketing Digital", "Kids Profiles"). A name made only of
// these (and digits) is not a brand; a brand word next to them stays ("Food Network", "Rock Content", "PBS Kids").
// Words that are also Brazilian brands on their own (Claro, Extra, Light, Ponto, Pago) are deliberately not here.
const SECTION_WORDS = `
  overview summary panorama context introduction conclusions considerations highlights highlight takeaway takeaways
  verdicts notes tips step steps stage stages phase phases part parts section sections chapter example examples case cases
  scenario scenarios option options alternative alternatives offer offering offerings suggestion suggestions pros cons
  advantage advantages disadvantage disadvantages benefit benefits drawback drawbacks limitation limitations risk risks
  strength strengths weakness weaknesses opportunity opportunities trend trends challenge challenges problem problems
  solution solutions service services product products tool tools platform platforms feature features functionality
  functionalities characteristic characteristics spec specs specification specifications criteria criterion factor factors
  aspect aspects requirement requirements metric metrics indicator indicators goal goals strategy strategies approach
  method methods methodology process processes model models type types category categories level levels tier tiers
  profile profiles description specialty specialties focus differentiator differentiators price prices pricing value values
  cost costs investment budget budgets range deadline deadlines scope deliverable deliverables contract contracts proposal
  proposals quality quantity size scale speed performance experience support team teams staff professional professionals
  specialist specialists expert experts consultant consultants consultancy consultancies agency agencies company companies
  corporation group groups holding division divisions unit units department departments headquarters founded founder founders
  ceo cto cmo coo cfo director directors manager managers analyst analysts coordinator coordinators location locations city
  cities country countries region regions state states area areas market markets sector sectors segment segments industry
  niche mainstream audience customer customers client clients user users consumer consumers buyer buyers vendor vendors
  supplier suppliers partner partners partnership competitor competitors competition leader leaders leadership reference
  references source sources link links site sites website websites page pages blog blogs content contents text texts
  article articles post posts video videos image images media ads ad advertising campaign campaigns automation inbound
  outbound branding brand brands design development programming technology technologies digital online offline mobile web
  internet software hardware app apps application applications system systems integration integrations hosting domain
  domains store stores shop shops retail wholesale commerce business businesses project projects work course courses
  training event events lecture lectures book books guide guides manual checklist template templates question questions
  answer answers doubt doubts list lists table tables comparison comparisons analysis analyses audit audits diagnosis
  report reports data numbers statistics rate rates conversion conversions sale sales revenue profit return traffic search
  keyword keywords term terms ranking rankings position positions rating ratings review reviews winner winners choice
  choices pick picks top best worst better cheaper cheapest expensive affordable premium standard basic essential essentials
  ultimate deluxe lite mini plus pro regular limited unlimited exclusive originals classic classics newer newest latest
  older recent upcoming popular trending hidden gem gems bonus more less fewer most least many much lots several various
  another same different similar specific general generic common typical unique special honorable mention mentions
  runner runner-up membership subscription subscriptions ad-free ad-supported free paid trial fee fees month monthly year
  yearly annual annually total overall average library catalog catalogue interface control controls parental bundle
  bundles cheap display battery camera cameras storage build weight screen audio sound connectivity ecosystem keyboard
  ports durability comfort memory processor chip resolution refresh series season seasons episode episodes movie movies
  film films show shows title titles documentary documentaries drama dramas comedy comedies thriller thrillers horror
  anime animation animated cartoons reality sports sport news live tv television channel channels network
  networks studio studios music podcast podcasts audiobook audiobooks ebook ebooks game games gaming kids kid children
  child family families adult adults teen teens parents parent baby toddler toddlers preschool student students school
  college university personal home office travel fitness health medical sleep workout outdoor indoor car cars phone phones
  smartphone smartphones tablet tablets laptop laptops desktop desktops computer computers pc pcs watch watches smartwatch
  smartwatches earbuds headphones speaker speakers headset headsets monitor monitors printer printers console consoles
  accessory accessories device devices gadget gadgets lineup line lines maker makers manufacturer manufacturers retailer
  retailers cloud analytics ai ia ml llm llms chatbot chatbots assistant assistants seo geo aeo cro sem ppc ux ui cx crm
  erp roi roas cpa cpc cpm ctr kpi kpis b2b b2c d2c saas api apis html css url urls marketing copy copywriting designer
  designers developer developers engineering engineer engineers freelancer freelancers freelance player players giant
  giants startup startups global local national regional international worldwide latin latino latina nordic scandinavian
  taiwanese western eastern northern southern mexican argentine portuguese brazilian paulista carioca mineiro
  additionally furthermore moreover ultimately mostly often sometimes usually generally typically especially particularly
  unlike either neither widely highly very quite rather really thanks thank please okay ok sure strong solid decent poor
  weak slow quick easy hard complex flexible robust reliable secure safe safety deep high low higher lower big small large
  larger largest long short wide light heavy versatile massive huge tiny ideal perfect right wrong true false current
  future past early late last final initial primary secondary who what when where why how which whose including includes
  include included excluding except versus vs per without within between among across around above below under
  over through during before after until toward towards against along behind beside beyond despite regarding inside outside
  down out off away back forward ahead today tomorrow yesterday soon later again already still ever never always once
  twice somewhere anywhere everywhere something anything everything nobody somebody anybody everybody none plenty variety
  selection mix blend combination combo duo trio pack package kit set go find view check start stop keep choose choosing
  picking consider considering explore exploring browse subscribe cancel compare comparing watching stream streaming try
  using get getting buying look looking see remember skip grab key up engine engines monitoring smaller bigger faster
  slower let tie draw varies depends mixed optional available unavailable partial full advanced fair life lifespan
  longevity repairability upgradability expandability compatibility versatility efficiency endurance accuracy simplicity
  flexibility reliability stability usability accessibility affordability availability capability capabilities synergy
  migration retention attenuation cancellation isolation immersion breakdown matrix glance contenders contender
  dealbreaker dealbreakers wildcard wildcards route replacement hybrid environment workflow interaction system systems
  tracking detection mode modes sensor sensors charging charger cable cover strap stand dock adapter finish clarity
  security cellular portability consistency customization customizability soundstage notice seniors senior gym teenager
  teenagers white silver gold gray grey navy graphite blue red green pink purple titanium head-to-head all-in-one all-day
  built-in high-end low-end mid-range midrange entry-level long-term short-term must-have go-to one-stop step-by-step
  easy-to-use well-rounded user-friendly cost-effective budget-friendly kid-friendly family-friendly eco-friendly
  up-to-date at-a-glance trade-off trade-offs tradeoff tradeoffs e-commerce e-mail on-premise in-house full-service
  end-to-end best-in-class top-tier high-quality low-cost low-budget pay-as-you-go ai-powered arm-based hands-on hands-free
  wire-free on-demand monday tuesday wednesday thursday friday saturday sunday weekday weekend weekends america américa
  americas europe europa asia ásia africa áfrica oceania antarctica latam east west north south middle central k-drama
  k-dramas c-drama c-dramas j-drama j-dramas b-movie b-movies k-pop j-pop sci-fi rom-com rom-coms docuseries pin dept age
  ages alternatively notable preschoolers tweens dive genre genres hits rotating rotation heavyweight heavyweights
  theatrical pipeline topic topics moderate world-building perk perks downloads volume cool silent world worldwide
  binge binge-worthy bingeable watchlist lineup catalogs award awards academy prêmio prêmios pg pg-13 nc-17 r-rated tv-y
  tv-y7 tv-g tv-pg tv-14 tv-ma tv-7 rated unrated junior jr sr depth usage concurrent streams constant turnover breadth
  curated extensive further exploration consideration viewers viewer sharing arthouse art-house prestige noir
  visão geral contexto introdução considerações finais síntese sumário destaque destaques observação observações
  importante atenção cuidado aviso lembrete dicas notas passo passos etapa etapas fase fases parte partes seção seções
  capítulo exemplo exemplos caso casos cenário cenários opção opções alternativa alternativas recomendações sugestão
  sugestões resultado resultados prós contras vantagem vantagens desvantagem desvantagens benefício benefícios limitação
  limitações risco riscos oportunidade oportunidades tendência tendências desafio desafios problema problemas solução
  soluções serviço serviços produto produtos ferramenta ferramentas plataforma plataformas recurso recursos funcionalidade
  funcionalidades característica características especificação especificações critério critérios fator fatores aspecto
  aspectos quesito quesitos requisito requisitos métrica métricas indicador indicadores meta metas estratégia estratégias
  abordagem método métodos metodologia processo processos modelo modelos tipo tipos categoria categorias nível níveis porte
  perfil perfis descrição especialidade especialidades foco diferencial diferenciais pontos fortes fracos ponto forte fraco
  preço preços valor valores custo custos investimento orçamento orçamentos faixa prazo prazos tempo escopo entrega entregas
  contrato contratos proposta propostas qualidade quantidade tamanho escala velocidade desempenho experiência suporte
  atendimento equipe time times profissional profissionais especialista especialistas consultor consultores consultoria
  consultorias agência agências empresa empresas companhia grupo grupos divisão unidade fundação fundador fundadora
  fundadores sede cidade cidades estado estados país países região regiões local locais mercado mercados setor setores
  segmento segmentos indústria nicho público audiência cliente clientes usuário usuários consumidor consumidores comprador
  compradores fornecedor fornecedores parceiro parceiros parceria concorrente concorrentes concorrência líder líderes
  liderança referência referências fonte fontes página páginas conteúdo conteúdos texto textos artigo artigos vídeo
  vídeos imagem imagens mídia mídias orgânico orgânica tráfego busca buscas pesquisa pesquisas palavra palavras chave
  termo termos posição posições lista listas tabela tabelas comparação comparativo comparativos análise análises auditoria
  auditorias diagnóstico relatório relatórios dados dado números número estatística estatísticas taxa taxas conversão
  conversões venda vendas receita lucro retorno publicidade propaganda anúncio anúncios campanha campanhas automação marca
  marcas criação criativo criativa desenvolvimento programação tecnologia tecnologias aplicativo aplicativos sistema
  sistemas integração integrações hospedagem domínio domínios loja lojas varejo atacado comércio negócio negócios projeto
  projetos trabalho trabalhos curso cursos treinamento treinamentos aula aulas certificação certificações evento eventos
  palestra palestras livro livros guia guias manual manuais pergunta perguntas resposta respostas dúvida dúvidas questão
  questões quando onde quem qual quais quanto quanta quantos quantas pior piores maior maiores menor menores principal
  principais primeiro primeira segundo segunda terceiro terceira último última próximo próxima anterior novos novas antigo
  antiga atual atuais recente recentes grande grandes pequeno pequena pequenos pequenas médio média médios médias alto alta
  altos altas baixo baixa baixos baixas rápido rápida lento lenta fácil difícil complexo complexa barato barata caro cara
  gratuito gratuita básico básica padrão completo completa perfeito perfeita ótimo ótima excelente excelentes fortes
  fraca sólido sólida confiável seguro segura flexível robusto robusta inteligente profundo profunda amplo ampla importantes
  essencial essenciais fundamental fundamentais necessário necessária possível possíveis disponível disponíveis único única
  especial específico específica gerais comum comuns típico típica diferente diferentes similar similares parecido parecida
  mesmo mesma mesmos mesmas outro outra diversos diversas poucos poucas ambos ambas qualquer quaisquer além ainda já sempre
  nunca apenas só somente inclusive principalmente especialmente geralmente normalmente basicamente praticamente realmente
  provavelmente possivelmente certamente claramente obviamente infelizmente felizmente atualmente recentemente finalmente
  primeiramente logo pois porque contudo todavia embora apesar caso senão antes depois durante enquanto agora hoje amanhã
  ontem cedo tarde aqui ali lá aí acima abaixo dentro fora perto longe sobre sob entre contra desde até após segundo
  conforme mediante salvo exceto menos muito muita pouco pouca bastante demais tão tanto tanta quase cerca aproximadamente
  exatamente totalmente completamente parcialmente sim talvez certo errado veja confira conheça descubra saiba aprenda
  entenda lembre observe considere avalie compare escolha escolher opte prefira contrate contratar peça pergunte verifique
  teste experimente utilize acesse visite leia assista ouça baixe instale cadastre assine participe comece inicie defina
  planeje crie desenvolva implemente otimize melhore aumente reduza evite garanta mantenha invista foque analise meça
  monitore acompanhe revise atualize vale destacar lembrar ressaltar notar mencionar citar dessa desse deste desta nesse
  nessa neste nesta naquele naquela daquele daquela pelo pela pelos pelas ao aos à às num numa dele dela deles delas
  transparência consolidação pessoas publicações monitoramento integrado integrada pioneiro pioneira educação profundidade
  promessa próprio própria próprios próprias queda ticket empate parcial limitado ilimitado incluso incluído opcional
  indisponível depende varia ruim custo-benefício passo-a-passo ponta-a-ponta`;
// Grammar words, pronouns, quantifiers, demonyms and adjectives of English and Portuguese: never a name alone.
const STOPWORDS = new Set(
  `a o as os e ou de da do das dos em no na nos nas um uma para com por que se como mais é são você sua meu nós nosso
  eu me mim minha meus minhas tu te ti teu tua vocês seu seus suas ele ela eles elas nossa nossos nossas isso isto aquilo
  este esta esse essa estes estas esses essas quem qual quais todos todas muitos muitas alguns algumas outros outras vários
  várias cada todo toda algum alguma nenhum nenhuma melhor melhores grátis novo nova bom boa direto direta moderno moderna
  internacional popular exclusivo exclusiva original brasileiro brasileira brasileiros brasileiras americano americana europeu
  europeia inglês inglesa francês francesa alemão alemã espanhol espanhola italiano italiana japonês japonesa chinês chinesa
  the an is are and or of in on to with by for it its if you your my we our they their this that these those from has have
  best offers some many other others few several each every much most another free new great good better direct modern
  i me mine he him his she her it we us who what which all any both one popular exclusive original current classic excellent
  european japanese korean chinese english french german spanish italian american british canadian australian indian asian african
  why how when where however also overall additionally ultimately finally first second third next then so but yet still instead
  note tip pro-tip summary recommendation recommendations verdict conclusion bottom line yes no here there based according while
  although though because since unless whether i'd i'm i've i'll it's that's there's here's what's let's you'll you're you've
  we're don't can't won't isn't porém também então assim resumo dica nota conclusão recomendação veredito
  january february march april may june july august september october november december
  janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro u.s us uk eua
  ${SECTION_WORDS}`.split(/\s+/u),
);
// Imperative openers of headings and list items ("Choose Netflix if…", "Explore Hulu", "Assine a Globoplay"): the name is what follows.
const LEADING_VERBS =
  /^(?:choose|pick|explore|watch|try|get|use|consider|buy|stream|skip|keep|prefer|aim\s+for|best(?!\s+buy\b)|melhor|browse|add|rotate|cancel|drop|pair|combine|join|sample|subscribe\s+to|check\s+out|go\s+with|opt\s+for|switch\s+to|start\s+with|stick\s+with|runs?|supports?|includes?|features?|offers?|wants?|needs?|requires?|lacks?|gets?|adds?|brings?|delivers?|pairs?|syncs?|uses?|skips?|prefers?|avoids?|loves?|likes?|recommends?|recommended|built-in|escolha|assine|experimente|confira|veja|considere|opte\s+pela?|assista|prefira|acesse|use|prefira|evite|conheça|teste)\s+(?=[\p{Lu}\p{N}])/iu;
/** A token from a link or an id ("2ahUKEwiU7YCG1M2", "085sjwhLLxxMRyis"): letters, digits and both cases run together. */
const ID_TOKEN = /^(?=[^\s]*\d)(?=[^\s]*\p{Lu})(?=[^\s]*\p{Ll})[\p{L}\p{N}_-]{12,}$/u;
// Words that open a name only by grammar: "com a Cadastra", "pela Hedgehog", "The Aubers" keeps its own "The".
const LEADING_WORDS = /^(?:(?:com|pela|pelo|para|na|no|da|do|de|a|o|as|os|e|ou|à|ao|como|tais como|incluindo|A|O|As|Os|Na|No|Nas|Nos|Em|Para|Pela|Pelo|Pelas|Pelos|Ao|Aos|\u00c0|\u00c0s|Com|For|for|on|via|with|while|While|[Ss]ome|[Mm]any|[Mm]ost|[Oo]ther|[Bb]oth|[Ee]ach|[Ee]very|[Aa]ll|[Aa]ny)\s+)+(?=[\p{Lu}\p{N}])/u;
// What ends the name at the head of a list item or heading: "**Name** — description", "Name: description", "Name (Brasil)".
const LEAD_END = /\s+[—–-]\s+|\s*:\s|\s\(|\s\|\s|\.\s|,\s(?=\p{Ll})/u;
const ITEM = /^(?:[-*+•]|\d+[.)])\s+/u;
// Reference lists at the end of an answer cite publishers; their link labels are not mentions.
const SOURCES_HEADING = /^(?:#{1,6}\s*)?\**(?:sources?|fontes?|refer[êe]ncias?|references?|citations?|cita[çc][õo]es)\**\s*:?\s*$/iu;

/** Markdown reduced to its visible text: link labels kept once, images, citation markers and escapes removed. */
function visibleText(answer: string) {
  // Some answers arrive HTML-escaped: "CI&amp;T", "MS&#124;UX".
  return decodeEntities(answer)
    .replace(/\\([:.\-_*()[\]#!+|$])/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[\[\d+\]\]\([^)]*\)|\[\d+(?:,\s*\d+)*\]/gu, ' ')
    // "**\nName**" and a bullet alone on its line ("-\nName") belong to the next line.
    .replace(/(^|\s)\*\*[ \t]*\n\s*(?=\S)/gmu, '$1**')
    .replace(/^([ \t]*(?:[-*+•]|\d+[.)]))[ \t]*\n\s*(?=\S)/gmu, '$1 ')
    // "Name[Name](url)" (an answer that repeats the name as its link) keeps the name once.
    .replace(/\[([^\]]+)\]\((?:https?:)?[^)\s]*\)/gu, (_match, label: string, offset: number, all: string) =>
      all.slice(Math.max(0, offset - label.length), offset) === label ? '' : label,
    )
    // Bare links and URL-encoded fragments carry ids, not names ("imageDocid", "%7CPROD").
    // Anchored at a token's start: an unanchored \S* rescans a long run of non-spaces from every offset.
    .replace(/https?:\/\/\S+|\bwww\.\S+|(?<!\S)[^\s%]*%[0-9A-Fa-f]{2}\S*/gu, ' ');
}

// A specification, not a name: every token starts with a digit or is a unit or a technology standard ("1080p", "16GB RAM",
// "4K HDR", "1TB SSD", "100%", "1950s", "2-in-1", "QHD+ 120Hz").
const UNIT_TOKEN = /^(?:\d[\p{N}%+./-]*\p{L}{0,4}|[gmtk]b|ssd|hdd|ram|rom|hz|khz|mhz|ghz|mp|mah|w|kw|kg|g|mg|cm|mm|km|m|in|inch|inches|fps|nits|ppi|dpi|px|qhd|fhd|uhd|oled|lcd|led|amoled|k|gen)$/iu;
const specification = (words: string[]) =>
  words.some((word) => UNIT_TOKEN.test(word)) && words.every((word) => UNIT_TOKEN.test(word) || CONNECTORS.has(word) || isGenericTechnology(brandDetectionKey(word)));
// "Agência de SEO", "Especialista em CRO", "Head de SEO", "Ferramentas de SEO": a category or a job, not a company.
const CATEGORY_HEAD = new Set(
  `agência agências agencia agency agencies empresa empresas company companies consultoria consultorias consultancy
  ferramenta ferramentas tool tools plataforma plataformas platform platforms especialista especialistas specialist
  specialists solução soluções solution solutions serviço serviços service services estratégia estratégias strategy
  strategies gestão management marketing otimização optimization auditoria audit análise analysis criação creation
  desenvolvimento development produção production head gerente manager diretor diretora director analista analyst
  coordenador coordenadora coordinator consultor consultora consultant curso cursos course courses preço preços price
  prices pricing custo custos cost costs tipo tipos type types lista list ranking guia guide exemplo exemplos example
  examples melhores best top principais main maiores largest biggest leading agente agentes agent agents profissional
  profissionais professional professionals equipe team fornecedor fornecedores supplier suppliers parceiro parceiros
  partner partners cliente clientes client clients`.split(/\s+/u),
);
const CATEGORY_LINK = new Set('de da do das dos em para of for in on to with com por by'.split(' '));

/**
 * The shape of a name: short, capitalized (or with an inner capital), not a grammar word nor a sentence-case phrase.
 * `vouched`: the text already treats it as a company ("Via Agência Digital oferece CRO") or someone accepted it before,
 * so a name made of ordinary words is not ruled out by its words alone. `site` (structure-v15): the answer links or writes a
 * site whose name is spelled like it ("Inside Digital" and insidedigital.com.br), which vouches for a name of any length.
 */
export function looksLikeName(name: string, vouched = false, site = false) {
  const words = name.split(/\s+/u);
  if (words.length > 6 || name.length > 60 || Array.from(name).length < 2) return false;
  if (!/\p{L}/u.test(name) || /[?!…]$/u.test(name) || /\p{Sc}|\d[.,]\d/u.test(name)) return false;
  // Capitalized ("Cadastra"), or lowercase with an inner capital or digit ("iPullRank", "liveSEO").
  if (!/^[\p{Lu}\p{N}]/u.test(name) && !/^\p{Ll}+[\p{Lu}\p{N}]/u.test(name)) return false;
  if (/["“”]/u.test(name)) return false;
  const grammar = (word: string) => STOPWORDS.has(word.toLocaleLowerCase().replace(/’/gu, "'")) || /^\d/u.test(word) || CONNECTORS.has(word);
  // A name made only of section words is a heading ("Major Streaming Services"); a company role vouches for a short one
  // ("Método Rápido oferece CRO"), never for a long one.
  if (words.every(grammar) && !site && (!vouched || words.length === 1 || words.length >= 3)) return false;
  if (!vouched && !site) {
    // "No Brasil", "CRO do Brasil", "Agências de São Paulo": grammar around a place is not a name; the place alone may be.
    if (words.length > 1 && words.some(grammar) && !isPlaceName(brandDetectionKey(name)) && words.every((word) => grammar(word) || isPlaceName(brandDetectionKey(word)))) return false;
    if (specification(words)) return false;
    if (words.length > 2 && CATEGORY_HEAD.has(words[0]!.toLocaleLowerCase()) && CATEGORY_LINK.has(words[1]!.toLocaleLowerCase())) return false;
    // "Why Netflix Leads", "Como escolher uma agência": a question or an explanation, not a name.
    if (words.length >= 3 && /^(?:why|how|what|when|where|which|who|whether|por que|porque|como|o que|quando|onde|qual|quais|quem)$/iu.test(words[0]!)) return false;
  }
  // A phrase mostly made of section words is a title or a description ("Advanced Camera System", "Top Options for
  // Clumsy Teenagers"), not a name ("Amazon Prime Video", "Bay Alarm Medical SOS Smartwatch" keep their own words).
  const content = words.filter((word) => !CONNECTORS.has(word.toLocaleLowerCase()) && !/^\d+$/u.test(word));
  const section = content.filter((word) => STOPWORDS.has(word.toLocaleLowerCase())).length;
  if ((content.length >= 4 && section * 2 > content.length) || (content.length === 3 && section === 3)) return false;
  if (ID_TOKEN.test(name) || (words.length === 1 && HYPHEN_ADJECTIVE.test(name))) return false;
  if (/^https?:|^www\.|\.(?:com|br|io|net|org)\b/iu.test(name)) return false;
  // Sentence case ("Casos de migração", "Minha recomendação"): a lowercase word after the first is prose, not a name.
  return !words
    .slice(1)
    .some((word) => /^\p{Ll}/u.test(word) && !CONNECTORS.has(word.toLocaleLowerCase()) && !/[\p{Lu}\p{N}]/u.test(word));
}

function trimName(raw: string) {
  // An emoji or a symbol that decorates a heading ("🏆 Cadastra", "✅ Tubi") is not part of the name.
  let text = raw.replace(/\*+|`/gu, '').replace(/^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\s]|\u200d|\ufe0f)+/u, '').trim();
  for (let pass = 0; pass < 3; pass++)
    text = text
      .replace(/^\s*(?:\d+[.)]|[-*+•])\s*/u, '')
      .replace(LEADING_WORDS, '')
      .replace(LEADING_VERBS, '')
      .replace(/^(\S+)\s+(?=\S)/u, (match, word: string) => (HYPHEN_ADJECTIVE.test(word) ? '' : match))
      .replace(/\s+(\S+)$/u, (match, word: string) => (HYPHEN_ADJECTIVE.test(word) ? '' : match))
      // "Taylor Sheridan's Yellowstone", "Guillermo del Toro's Pinocchio": a person's possessive introduces the name
      // ("Bob's Burgers", "The Handmaid's Tale" keep theirs).
      .replace(/^(\p{Lu}[\p{L}\p{N}.-]*)\s+(?:[\p{L}][\p{L}\p{N}.-]*\s+){0,2}\p{Lu}[\p{L}\p{N}.-]*['’]s\s+(?=[\p{Lu}\p{N}])/u, (match, first: string) =>
        STOPWORDS.has(first.toLocaleLowerCase()) ? match : '',
      )
      // "Key Strengths of Bose", "Alternatives to Netflix", "Vantagens da Cadastra": section words before a link word.
      .replace(/^((?:[\p{L}-]+\s+){1,3})(?:of|to|for|da|do|de|à|ao|para)\s+(?=[\p{Lu}\p{N}])/u, (match, lead: string) =>
        lead.trim().split(/\s+/u).every((word) => STOPWORDS.has(word.toLocaleLowerCase())) ? '' : match,
      )
      .replace(/['’]s$/u, '')
      // "Releases & Add-ons" without its hyphenated last word leaves a dangling "&".
      .replace(/^&\s+|\s+&$/gu, '')
      .replace(/[\s:;,.!_–—-]+$/u, '')
      .replace(/^[\s_"“'(]+|[\s_"”')]+$/gu, '')
      .trim();
  return text;
}

const ACRONYM = /^[\p{Lu}\p{N}]{2,4}s?$/u;
// "Oscar-winning", "PBS-style", "Hollywood-adjacent", "PIN-protected": an adjective made of a name, not the name.
const HYPHEN_ADJECTIVE =
  /^[\p{L}\p{N}]+-(?:winning|nominated|contending|caliber|season|style|level|adjacent|owned|backed|related|powered|based|centric|friendly|only|exclusive|produced|type|like|specific|heavy|ready|first|free|rated|grade|class|quality|focused|driven|led|oriented|sized|shaped|wide|long|era|inspired|themed|approved|certified|cleared|licensed|branded|protected|locking|locked|supported|enabled|compatible|optimized|curated|funded|made|built|designed|tested|proof|safe|lite|plus|light|digit|minute|hour|day|week|month|year|language|budget|conscious|heavy|end|tier|end|hop|size|screen|hand|facing|looking|leaning|sounding|selling|rated|rating|stop|time|term|sided|up|down|in|out|off|on)s?$/iu;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** Code-unit order: the same in every runtime and locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every name the answer presents as an entity, once per name: the head of list items, headings, bold
 * titles and table cells, link labels, "como A, B e C" lists and capitalized spans of running text.
 * High recall by design (a "Perfil:" label or "SEO" also comes out): the decision model says what each
 * name is. `known` are brand keys that keep "&" from splitting a name (splitBrandSurface).
 */
export function extractBrandMentions(answer: string, known: ReadonlySet<string> = new Set()): BrandMention[] {
  const text = visibleText(answer);
  // The names of the sites the answer links or writes ("insidedigital" of insidedigital.com.br): a name spelled like one is vouched for.
  const sites = new Set(textHosts(answer).map((host) => registrableDomain(host).split('.')[0]!));
  const found: BrandMention[] = [];
  let next = '';
  // The line as written, with its markup: where italics are read.
  let marked = '';
  const push = (surface: string, structure: MentionStructure, line: string, at: number, opening = false) => {
    const stripped = trimName(surface.replace(ITEM, ''));
    for (const piece of splitBrandSurface(stripped, known)) {
      const name = trimName(stripped.slice(piece.start, piece.end)).normalize('NFC');
      if (!name) continue;
      const position = Math.max(0, line.indexOf(name, Math.max(0, at - name.length)));
      const company = COMPANY_AFTER.test(line.slice(position + name.length));
      const label = brandLabel(name);
      if (!looksLikeName(name, company, label.length >= 3 && sites.has(label))) continue;
      const key = brandDetectionKey(name);
      if (!key || isGenericTechnology(key) || (labels.get(key) ?? 0) > 1) continue;
      // In running text a place or an acronym ("Brasil", "SEO", "B2B") is grammar or jargon; as an item it is a candidate.
      if (structure === 'prose' && (isPlaceName(key) || ACRONYM.test(name))) continue;
      const before = line.slice(0, position);
      found.push({
        name,
        key,
        structure,
        // The line from a little before the name, then what follows it (an item's description is often on the next lines).
        excerpt: `${line.slice(Math.max(0, position - 120))} ${next}`.replace(/\s+/gu, ' ').trim().slice(0, 360),
        ...(listedAfter(CLIENT_CUE, before) ? { cue: 'client' as const } : listedAfter(SUPPLIER_CUE, before) ? { cue: 'supplier' as const } : {}),
        ...(company ? { company: true } : {}),
        ...(opening ? { opening } : {}),
        ...(italicized(marked, name) ? { italic: true } : {}),
      });
    }
  };
  const lead = (value: string) => trimName(value.replace(/^\s*\d+[.)]\s*/u, '')).split(LEAD_END)[0]!;
  // A bold label with a colon repeated in several items ("Perfil:", "Ideal para:") is a field, not a name.
  const labels = new Map<string, number>();
  for (const match of text.matchAll(/^\s*(?:[-*+•]|\d+[.)])?\s*\*\*([^*\n]{1,80}?)(?::\*\*|\*\*\s*:)/gmu)) {
    const key = brandDetectionKey(match[1]!.replace(/[:：]\s*$/u, ''));
    labels.set(key, (labels.get(key) ?? 0) + 1);
  }
  let inSources = false;
  let offset = 0;
  let inTable = false;
  // A comparison table ("| Feature | iPhone 17 | Galaxy S26 |"): the brands head its columns and the first column
  // holds the criteria ("Display", "Battery life"), which are not names.
  let criteriaTable = false;
  const opening = new Set<string>();
  const lines = text.split('\n');
  const separator = (value: string | undefined) => !!value && /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/u.test(value.trim());
  const cells = (row: string) => row.replace(/^\||\|$/gu, '').split('|');
  for (const [index, raw] of lines.entries()) {
    offset += raw.length + 1;
    next = text.slice(offset, offset + 240);
    const line = raw.trim();
    marked = line;
    {
      if (!line || separator(line)) continue;
      // A table row (leading pipe optional); a ranking table's header row only names the columns.
      inTable = line.includes('|') && (inTable || line.startsWith('|') || separator(lines[index + 1]));
      if (inTable && separator(lines[index + 1])) {
        const [first, ...rest] = cells(line);
        criteriaTable = CRITERIA_HEAD.test(trimName(first ?? ''));
        if (criteriaTable) for (const cell of rest) push(lead(cell), 'table', line, line.indexOf(cell));
        continue;
      }
      if (!inTable) criteriaTable = false;
      if (SOURCES_HEADING.test(line)) {
        inSources = true;
        continue;
      }
      const heading = /^#{1,6}\s+(.*)$/u.exec(line);
      if (heading) inSources = false;
      if (inSources) continue;
      if (heading) push(lead(heading[1]!), 'heading', line, 0);
      const item = ITEM.exec(line);
      if (item) push(lead(line.slice(item[0].length)), 'list', line, 0);
      if (inTable) for (const cell of cells(line).slice(criteriaTable ? 1 : 0)) push(lead(cell), 'table', line, line.indexOf(cell));
      for (const bold of line.matchAll(/\*\*([^*\n]{1,200}?)\*\*/gu)) {
        const inner = bold[1]!;
        push(inner.split(/\s+[—–-]\s+|\s*:\s*$|\s*:\s|\s\(/u)[0]!, 'bold', line, bold.index!);
      }
      // "como A, B e C": a list inside running text.
      for (const list of line.matchAll(/\b(?:como|tais como|incluindo|incluem|inclui|such as|including|includes?|e\.g\.|ex\.?:?)\s+((?:[\p{Lu}\p{N}][^\s,;.()]*(?:\s+(?:de|da|do|&)?\s*[\p{Lu}\p{N}][^\s,;.()]*)*(?:\s*,\s*|\s+(?:e|ou|and|or)\s+)?)+)/gu))
        push(list[1]!, 'list', line, list.index!);
      const plain = line.replace(/\*+|`/gu, '');
      // "Game of Thrones", "The Lord of the Rings", "Mare of Easttown": "of" and "the" join a name like "de" does.
      for (const span of plain.matchAll(/(?<![\p{L}\p{N}.@/-])(?:\p{Lu}(?:[\p{L}\p{N}&+'’-]|\.(?=[\p{L}\p{N}]))*|\p{Ll}+\p{Lu}[\p{L}\p{N}]*|\d+\p{L}[\p{L}\p{N}]*)(?:\s+(?:(?:de|da|do|dos|das|del|di|von|van|le|la|du|des|of|the|&|\+)\s+){0,2}(?:\p{Lu}(?:[\p{L}\p{N}&+'’-]|\.(?=[\p{L}\p{N}]))*|\d+[\p{L}\p{N}]*))*/gu)) {
        const before = plain.slice(0, span.index).trimEnd();
        const surface = span[0];
        const opens = !before || /[.!?:]$/u.test(before);
        // The first word of a sentence is capitalized by grammar: "Auch Orbit" also yields "Orbit", "A Supersonic" only
        // "Supersonic". A lone word there ("Confira", "Find", "Oferece") is grammar unless the sentence treats it as a
        // company ("Cadastra oferece CRO"): a real name is met again as an item or inside a sentence.
        if (opens && /\s/u.test(surface)) {
          const first = surface.split(/\s+/u)[0]!;
          // A grammar word opens the span ("Evite PBNs", "Além disso"): only the rest may be a name. Otherwise both are
          // candidates ("Auch Orbit" and "Orbit"); a tail that is a fragment ("Horizonte") folds into the longer name.
          const grammar = STOPWORDS.has(first.toLocaleLowerCase()) || new RegExp(`(?<![\\p{L}\\p{N}])${escape(first.toLocaleLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(text);
          if (!grammar) {
            push(surface, 'prose', plain, span.index!, true);
            opening.add(brandDetectionKey(trimName(surface)));
          }
          const rest = surface.replace(/^\S+\s+/u, '');
          // "Love Is Blind" opens a sentence: "Is Blind" is no name, unless the sentence treats it as a company.
          if (!STOPWORDS.has(rest.split(/\s+/u)[0]!.toLocaleLowerCase()) || COMPANY_AFTER.test(plain.slice(span.index! + surface.length)))
            push(rest, 'prose', plain, span.index! + surface.length - rest.length);
        } else if (
          !opens ||
          // "Shudder’s catalog", "Cadastra oferece CRO", "Semrush, Ahrefs e Moz": a possessive, a company role or a list vouch for it.
          /['’]s$/u.test(surface) ||
          COMPANY_AFTER.test(plain.slice(span.index! + surface.length)) ||
          /^,\s+[\p{Lu}\p{N}]|^\s+(?:e|and|ou|or)\s+[\p{Lu}\p{N}]/u.test(plain.slice(span.index! + surface.length))
        )
          push(surface, 'prose', plain, span.index!);
      }
    }
  }
  // One entry per name, the strongest structure first. A capitalized phrase the same answer also writes in
  // lowercase (outside a link or domain) is an ordinary phrase ("Link Building" next to "link building").
  const byKey = new Map<string, BrandMention>();
  const companies = new Set(found.filter((mention) => mention.company).map((mention) => mention.key));
  for (const mention of found) {
    const seen = byKey.get(mention.key);
    if (seen) {
      const company = seen.company || mention.company;
      const italic = seen.italic || mention.italic;
      if (seen.structure === 'prose' && mention.structure !== 'prose') byKey.set(mention.key, { ...mention, cue: mention.cue ?? seen.cue, ...(company ? { company } : {}), ...(italic ? { italic } : {}) });
      else {
        if (company) seen.company = true;
        if (italic) seen.italic = true;
      }
      continue;
    }
    const lower = mention.name.toLocaleLowerCase();
    if (lower !== mention.name && !companies.has(mention.key) && new RegExp(`(?<![\\p{L}\\p{N}./@_-])${escape(lower)}(?![\\p{L}\\p{N}@_]|\\.\\p{L})`, 'u').test(text)) continue;
    byKey.set(mention.key, mention);
  }
  const kept = [...byKey.values()];
  // A prose fragment of a longer name in the same answer ("Certo" of "Rank Certo") is not a name of its own.
  // A span that opens a sentence does not count as the longer name: its first word may be grammar ("Auch Orbit").
  return kept.filter(
    (mention) =>
      mention.structure !== 'prose' ||
      !kept.some((other) => other !== mention && !opening.has(other.key) && ` ${other.key} `.includes(` ${mention.key} `)),
  );
}

/**
 * A brand the project already knows (structure-v15): a discovery its decisions count (a settled competitor, not rejected,
 * or a name merged into one), with every spelling it is known by (its name, the aliases the analysis folded into it, its
 * domain).
 */
export type KnownBrand = {
  name: string;
  spellings: string[];
  /** The window also writes the name in lowercase (its `lowercaseAnswers`): a one-word spelling of it may be the word. */
  ordinary?: boolean;
};
type KnownSpelling = { brand: KnownBrand; words: string[]; caps: boolean[]; joins: string[]; tail: string; plainWord: boolean };
const WORD = /[\p{L}\p{N}]+/gu;
const foldWord = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
/** What joins two words of a name: any run of spaces and dashes is one gap ("Coca-Cola", "Coca Cola"); other marks count as written ("CI&T", "Meu.Redator"). */
const joinOf = (value: string) => {
  const folded = value.replace(/[‘’ʼ]/gu, "'").replace(/[\s\-‐-―−]+/gu, ' ');
  return folded.trim() ? folded.replace(/\s+/gu, '') : ' ';
};
const UPPER = /\p{Lu}/u;

/**
 * The known brands an answer names, found by their spellings before anything else reads it (11/11/2026: start from what
 * is already known). The words are compared with case, accents and the gaps between them folded ("Organica digital",
 * "EVTE-Marketing"), whole words only (so "Rankuvi's" and "rankuvi.com.br" name Rankuvi). An occurrence is left to the
 * discovery and the decision model, as before, when the text alone cannot say it is the brand:
 * - the answer writes a capitalized word of the spelling in lowercase ("busca orgânica"), except as a domain; a domain only
 *   counts written on its own; nothing glued to a host, handle or compound before it ("comwww.oxigenweb.com.br", "No-Code");
 * - a spelling of fewer than three letters, or one plain word the window also writes in lowercase (`ordinary`);
 * - it is part of a longer capitalized name (a capitalized word right beside it, "Orgânica Digital Brasil"; a grammar or
 *   section word before it, "A Rankuvi", is no part of a name: the English and Portuguese lists of this module, a known limit);
 * - it is one plain word ("Oficina") opening a sentence or an item, where a capital is grammar.
 * The longest spelling wins where two overlap. Sources sections are not read. Returns one hit per brand, in answer order,
 * with the text around its first occurrence. No word list, no language grammar.
 */
export function knownBrandMentions(answer: string, known: readonly KnownBrand[]): { brand: KnownBrand; excerpt: string }[] {
  if (!known.length) return [];
  const index = new Map<string, KnownSpelling[]>();
  for (const brand of known)
    for (const raw of new Set(brand.spellings.map((spelling) => spelling.trim()).filter(Boolean))) {
      const parts = [...raw.matchAll(WORD)];
      // Two letters ("RS", "TV") name too many things; left to the discovery.
      if (!parts.length || parts.reduce((length, part) => length + part[0].length, 0) < 3) continue;
      const words = parts.map((part) => foldWord(part[0]));
      const joins = parts.slice(1).map((part, at) => joinOf(raw.slice(parts[at]!.index! + parts[at]![0].length, part.index)));
      const tail = joinOf(raw.slice(parts.at(-1)!.index! + parts.at(-1)![0].length)).trim();
      const plainWord = words.length === 1 && !tail && /^\p{Lu}\p{Ll}+$/u.test(raw);
      // A one plain word spelling the window also writes in lowercase ("Code", "Máquina") is the discovery's to judge.
      if (plainWord && brand.ordinary) continue;
      const spelling = { brand, words, caps: parts.map((part) => UPPER.test(part[0][0]!)), joins, tail, plainWord };
      index.set(words[0]!, [...(index.get(words[0]!) ?? []), spelling]);
    }
  for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length || b.tail.length - a.tail.length);
  const text = visibleText(answer);
  // Sources sections cite publishers, as in extractBrandMentions.
  let inSources = false;
  const readable = text
    .split('\n')
    .map((line) => {
      if (SOURCES_HEADING.test(line.trim())) inSources = true;
      else if (/^#{1,6}\s/u.test(line.trim())) inSources = false;
      return inSources ? ' '.repeat(line.length) : line;
    })
    .join('\n');
  const tokens = [...readable.matchAll(WORD)].map((match) => ({ start: match.index!, end: match.index! + match[0].length, word: foldWord(match[0]) }));
  const between = (left: number, right: number) => readable.slice(tokens[left]!.end, tokens[right]!.start);
  const capitalNeighbour = (gap: string, word: string | undefined) => !!word && /^[ \t]+$/u.test(gap) && /^\p{Lu}/u.test(word);
  const hits = new Map<KnownBrand, number>();
  const lowercase = new Set<KnownBrand>();
  for (let at = 0; at < tokens.length; at++) {
    for (const spelling of index.get(tokens[at]!.word) ?? []) {
      const last = at + spelling.words.length - 1;
      if (last >= tokens.length || spelling.words.some((word, step) => tokens[at + step]!.word !== word || (step > 0 && joinOf(between(at + step - 1, at + step)) !== spelling.joins[step - 1]))) continue;
      let end = tokens[last]!.end;
      if (spelling.tail) {
        if (!joinOf(readable.slice(end, end + spelling.tail.length + 2)).startsWith(spelling.tail)) continue;
        end = readable.indexOf(spelling.tail.at(-1)!, end) + 1;
      }
      const start = tokens[at]!.start;
      // A domain written in the text ("rankuvi.com.br"), not one glued to another word or host ("semrush.comwww.rankuvi.com").
      const domain = /^\.\p{L}/u.test(readable.slice(end, end + 2));
      // Any spelling glued to a host, handle or compound before it ("comwww.oxigenweb.com.br", "@agencia", "No-Code"); a
      // slash still separates names ("Crunchyroll/Shudder").
      if (start > 0 && /[.@_\-‐]/u.test(readable[start - 1]!)) continue;
      // Each capitalized word of the spelling is capitalized here too ("Prime Video Instead" is not "Prime Video instead").
      if (!domain && spelling.caps.some((cap, step) => cap && !UPPER.test(readable[tokens[at + step]!.start]!))) {
        lowercase.add(spelling.brand);
        continue;
      }
      const word = (position: number) => (position >= 0 && position < tokens.length ? readable.slice(tokens[position]!.start, tokens[position]!.end) : undefined);
      // A grammar word before it ("A Rankuvi oferece", "Agência Rankuvi") is no longer name.
      const previous = word(at - 1);
      if (!domain && ((capitalNeighbour(at > 0 ? between(at - 1, at) : '', previous) && !STOPWORDS.has(previous!.toLocaleLowerCase())) || capitalNeighbour(last + 1 < tokens.length ? between(last, last + 1) : '', word(last + 1)))) continue;
      // An opening: nothing but markup before it on its line, or the end of a sentence.
      const before = readable.slice(readable.lastIndexOf('\n', start - 1) + 1, start).replace(/[*_#>|`\s-]|^\s*\d+[.)]/gu, '');
      if (spelling.plainWord && (!before || /[.!?:]$/u.test(before))) continue;
      if (!hits.has(spelling.brand)) hits.set(spelling.brand, start);
      at = last;
      break;
    }
  }
  return [...hits]
    .filter(([brand]) => !lowercase.has(brand))
    .sort((a, b) => a[1] - b[1])
    .map(([brand, start]) => ({ brand, excerpt: readable.slice(Math.max(0, start - 120), start + 240).replace(/\s+/gu, ' ').trim() }));
}

/** One spelling for the same name written another way: "The X" and "X", "CuriosityStream" and "Curiosity Stream", "ThinkPads" and "ThinkPad". */
export function brandVariantKey(key: string) {
  return key.replace(/^the /u, '').replace(/(?<=\p{L}{3})s$/u, '').replace(/\s+/gu, '');
}

// What follows a brand's own name without making another brand: its app or site, its country or its kind of company
// ("PBS Kids Video App", "Edelman Brasil", "Flowup Agency", "Chili Digital").
const BRAND_TAIL =
  /^(?: (?:app|apps|video|website|site|service|brasil|brazil|br|group|agency|agência|agencia|digital|comunicação|comunicacao|communications|media|marketing|consulting|consultoria|labs|inc|ltda))+$/u;
// Words that open many company names ("Grupo FSB", "Agência Kaizen"): never the brand that joins them.
const COMPANY_WORDS = new Set('grupo group agência agencia agency studio studios best top the editora instituto banco'.split(' '));
// Words that end many names ("PBS Kids", "Apple TV"): never a brand of their own to merge into a longer one.
const GENERIC_TAILS = new Set(
  'tv video kids junior music channel channels plus premium pro one go live now news sports play store app apps games studio studios network networks original originals mode profile profiles collection bundle animation universe mini air'.split(' '),
);

/**
 * "OnePlus 13R", "Amazfit Active 2": a model number in the second or third word, with no section word after the
 * brand's. A season, part or year marker ("Black Doves S2", "Lupin Part 4", "Brown 2013") is a title, not a model.
 */
const modelName = (key: string) =>
  /^\S+ (?:\S+ )?\S*\d/u.test(key) && !key.split(' ').slice(1).some((word) => STOPWORDS.has(word) || /^(?:s\d+|season|seasons|part|vol|volume|episode|chapter|\d{4})$/u.test(word));
/** A word that never heads a brand family of its own: grammar, a generic tail, a company word or a place. */
const familyWord = (word: string) => word.length >= 3 && !STOPWORDS.has(word) && !GENERIC_TAILS.has(word) && !COMPANY_WORDS.has(word) && !isPlaceName(word);

/**
 * Which names of a discovery are the same brand, as groups of keys: another spelling of
 * the same name (brandVariantKey), the brand's own name inside the one longer name that ends with it ("Prime Video" in
 * "Amazon Prime Video", "Viki" in "Rakuten Viki"; a tail several names end with, a generic one like "Kids" or an
 * ordinary word stays apart), a name with its "+" ("Apple TV" and "Apple TV+", "Disney" and "Disney+"), a company
 * form ("Grupo FSB" with "FSB Comunicação") and, when the brand is named alone as an item, its sub-brands and divisions
 * ("Accenture Song", "Accenture Interactive" under "Accenture"; "YouTube Kids" under "YouTube"). Only the obvious:
 * anything subtler is left to the person.
 */
export function brandMergeGroups(
  input: string[],
  /** A word these answers also write in lowercase ("black", "shop"): never a brand that joins others. Absent, models stay apart. */
  ordinary?: (word: string) => boolean,
  /** A key that stands on its own (an item in some answer, or named in several): the head a family may fold into. Absent, only a head with two or more sub-brands folds them. */
  anchored?: (key: string) => boolean,
  /** Answers that name the key: a longer name the answers use more than its head is a brand of its own ("Amazon Prime" is not Amazon's; structure-v7). */
  answers?: (key: string) => number,
): string[][] {
  // One canonical order: the groups never depend on the order the names were met in (structure-v7).
  const keys = [...new Set(input)].sort(byText);
  const parent = new Map(keys.map((key) => [key, key]));
  const size = new Map(keys.map((key) => [key, 1]));
  const find = (key: string): string => (parent.get(key) === key ? key : find(parent.get(key)!));
  const union = (a: string, b: string) => {
    const [from, to] = [find(a), find(b)];
    if (from === to) return;
    parent.set(from, to);
    size.set(to, (size.get(to) ?? 1) + (size.get(from) ?? 1));
  };
  /** Still a group of its own: nothing was folded into it and it was folded into nothing (no chains across rules). */
  const alone = (key: string) => find(key) === key && size.get(key) === 1;
  const plain = (word: string) => !ordinary?.(word);
  // A sub-brand, division or product line opens with the brand's own name ("Accenture Song", "HubSpot CRM", "Samsung
  // Galaxy"): it belongs to the brand when the brand stands on its own (an item, or often named) and the word is not
  // ordinary. First, while no other rule has merged anything, so rules never chain ("Orange" of "Sling Orange" never pulls
  // "Orange Is the New Black" into Sling).
  // The head is the longest other name the key opens with ("Amazon Prime" of "Amazon Prime Membership", structure-v7); a
  // one-word head must be a family word the answers never write in lowercase ("Star" heads nothing). In code order a head
  // comes before its sub-brands, so a sub-brand of a sub-brand joins the same family ("Amazon Music Unlimited").
  const headOf = (key: string) => {
    const words = key.split(' ');
    for (let length = words.length - 1; length >= 1; length--) {
      const head = words.slice(0, length).join(' ');
      if (parent.has(head)) return length > 1 || (familyWord(head) && plain(head)) ? head : undefined;
    }
    return undefined;
  };
  const children = new Map<string, number>();
  for (const key of keys) {
    const head = headOf(key);
    if (head) children.set(head, (children.get(head) ?? 0) + 1);
  }
  for (const key of keys) {
    const head = headOf(key);
    if (!head || !alone(key)) continue;
    if (answers && answers(key) > answers(head)) continue;
    if (anchored?.(head) || children.get(head)! >= 2) union(key, head);
  }
  const byVariant = new Map<string, string>();
  for (const key of keys) {
    // "Pokémon" and "Pokemon", "The Sopranos" and "Sopranos": one identity is one name.
    const variant = brandVariantKey(competitorIdentity(key));
    const seen = byVariant.get(variant);
    if (seen) union(key, seen);
    else byVariant.set(variant, key);
  }
  // The names that end with each name, and the names each one opens with, found by their word boundaries (comparing every
  // pair of names took seconds on a large window).
  const endingWith = new Map<string, string[]>();
  for (const key of keys)
    for (let at = key.indexOf(' '); at >= 0; at = key.indexOf(' ', at + 1)) endingWith.set(key.slice(at + 1), [...(endingWith.get(key.slice(at + 1)) ?? []), key]);
  const known = new Set(keys);
  for (const short of keys) {
    if (!familyWord(short) || !plain(short) || find(short) !== short) continue;
    const longer = new Set((endingWith.get(short) ?? []).map(find));
    // The longer name must still be its own family: "Hoopla" never follows "Kanopy & Hoopla" into "Kanopy" (no chains).
    if (longer.size === 1 && [...longer][0]!.endsWith(` ${short}`)) union(short, [...longer][0]!);
  }
  // A model of a brand ("Fitbit Sense 2", "Windows 11"), its app or its company form ("PBS Kids Video App", "Edelman
  // Brasil") belongs to the brand: the longest name it starts with, when a number or only BRAND_TAIL words follow.
  for (const key of keys) {
    let brand: string | undefined;
    // The longest name the key opens with, followed by a word boundary.
    for (let at = key.lastIndexOf(' '); at > 0 && !brand; at = key.lastIndexOf(' ', at - 1)) {
      const other = key.slice(0, at);
      if (known.has(other) && !GENERIC_TAILS.has(other) && (/\d/u.test(key.slice(other.length)) || BRAND_TAIL.test(key.slice(other.length)))) brand = other;
    }
    if (brand) union(key, brand);
  }
  for (const key of keys) {
    const base = key.replace(/(?:\+| plus)$/u, '');
    if (base !== key && parent.has(base)) union(key, base);
  }
  // "Grupo FSB", "Agência Mestre", "Banco Inter": the company word is not the brand. The rest is, alone or as the head
  // of its company form ("FSB Comunicação").
  for (const key of keys) {
    const core = /^(\S+) (.+)$/u.exec(key);
    if (!core || !COMPANY_WORDS.has(core[1]!) || !familyWord(core[2]!) || !plain(core[2]!)) continue;
    const named = parent.has(core[2]!) ? core[2]! : keys.find((other) => other !== key && other.startsWith(`${core[2]!} `) && BRAND_TAIL.test(other.slice(core[2]!.length)));
    if (named) union(key, named);
  }
  // Models of one brand no answer names alone ("OnePlus 15", "OnePlus Watch", "OnePlus 13R"): one brand, when two or
  // more names open with the same word and one of them carries a model number (brandMergeLead names it by that word).
  const byFirst = new Map<string, string[]>();
  for (const key of keys) {
    const first = /^(\S{3,}) \S/u.exec(key)?.[1];
    if (ordinary && first && !ordinary(first) && familyWord(first)) byFirst.set(first, [...(byFirst.get(first) ?? []), key]);
  }
  for (const [first, members] of byFirst)
    if (members.length >= 2 && members.some(modelName)) for (const key of [...members, ...(parent.has(first) ? [first] : [])]) union(key, members[0]!);
  const groups = new Map<string, string[]>();
  for (const key of keys) groups.set(find(key), [...(groups.get(find(key)) ?? []), key]);
  return [...groups.values()];
}

/**
 * The name a merged group shows: the one most answers use, never a model ("Fitbit", not "Fitbit Charge 6") nor a span
 * that only ever opened a sentence ("Orbit", not "Auch Orbit"); on a tie, the longer name.
 */
export function brandMergeLead(keys: string[], answers: (key: string) => number, opener: (key: string) => boolean = () => false) {
  // Models of a brand no answer names alone ("oneplus 15", "oneplus open"): the brand's word, which is not one of the keys.
  const byFirst = new Map<string, string[]>();
  for (const key of keys) {
    const first = /^(\S+) \S/u.exec(key)?.[1];
    if (first) byFirst.set(first, [...(byFirst.get(first) ?? []), key]);
  }
  // Only when no name of the group is already the brand of all the others ("fitbit" of "fitbit charge 6"), and never a
  // grammar or company word ("The Boys S5" does not make "The" a brand).
  const branded = keys.some((key) => keys.every((other) => other === key || other.startsWith(`${key} `)));
  const shared = [...byFirst].find(([first, members]) => familyWord(first) && members.length >= 2 && members.length * 2 > keys.length && members.some(modelName));
  if (shared && !branded) return shared[0];
  const pool = keys.some((key) => !opener(key)) ? keys.filter((key) => !opener(key)) : keys;
  const named = pool.some((key) => !/\d/u.test(key)) ? pool.filter((key) => !/\d/u.test(key)) : pool;
  let lead = named.reduce((best, key) => (answers(key) > answers(best) || (answers(key) === answers(best) && key.length > best.length) ? key : best));
  // A model or product line gives way to its brand ("ASUS", not "ASUS Zenbook OLED"); a company form ("Chili Digital")
  // keeps its name when more answers use it, and so does a service named by a generic tail ("Pluto TV", not "Pluto")
  // unless the bare name is the one the answers use ("YouTube", not "YouTube Kids").
  const brandOf = (name: string) =>
    keys.find(
      (key) =>
        name.startsWith(`${key} `) &&
        !BRAND_TAIL.test(name.slice(key.length)) &&
        (!name.slice(key.length + 1).split(' ').every((word) => GENERIC_TAILS.has(word)) || answers(key) >= answers(name)),
    );
  for (let shorter = brandOf(lead); shorter; shorter = brandOf(lead)) lead = shorter;
  // "Professional Wacom", "The Criterion Channel": section words before a member name are not the name, unless the
  // answers use the longer name more ("National Geographic", "Adult Swim", "Studio Ghibli" keep their first word).
  const bare = keys.find(
    (key) => key !== lead && lead.endsWith(` ${key}`) && answers(key) >= answers(lead) && lead.slice(0, -key.length - 1).split(' ').every((word) => STOPWORDS.has(word)),
  );
  return bare ?? lead;
}

/** Keys a tracked brand already covers: its names and aliases, a part of them ("Mestre") or a longer form ("NP Digital Brasil"). */
export function trackedBrandKeys(seeds: DiscoverySeed[], common: ReadonlySet<string> = new Set()) {
  const all = seeds.flatMap((seed) => [seed.name, ...(seed.aliases ?? [])]).map(brandDetectionKey).filter(Boolean);
  const variants = new Set(all.map(brandVariantKey));
  // A monitored spelling that is a common word in the project's answers (lib/brand-mention-check.ts commonSpellings) claims
  // only itself (structure-v13): "AIM Conversion Experts" and "Apple Watch" are names of their own for discovery, and the
  // roles model says what each is (a competitor, or a tracked brand's product, which is a mention).
  const keys = all.filter((key) => !common.has(key));
  return (key: string) =>
    variants.has(brandVariantKey(key)) ||
    // "Apple TV" is the monitored "Apple TV+", "Disney" the monitored "Disney+" (as in brandMergeGroups).
    variants.has(brandVariantKey(`${key}+`)) ||
    keys.some(
      (tracked) =>
        ` ${tracked} `.includes(` ${key} `) ||
        // "Disney Bundle" is a plan of the monitored Disney+.
        key.startsWith(`${tracked.replace(/\+$/u, '')} `) ||
        // A longer form of a monitored name or alias, wherever the name sits in it, is that monitored brand, never a
        // discovered sibling: "Disney+ Premium", "Amazon Prime Video", "Amazon Prime Video for Families" (the
        // monitored Prime Video). A generic tail ("TV") claims only the names it opens.
        (` ${key} `.includes(` ${tracked} `) && (key.startsWith(`${tracked} `) || !GENERIC_TAILS.has(tracked))),
    );
}

/**
 * What a batch of answers (one analysis page) says about one name, before any decision across names. Tallies of different
 * answers add up in any order (mergeNameTally), so the window's tally never depends on how its answers were paged.
 */
export type NameTally = {
  key: string;
  /** Each way the answers write the name and how many answers write it so. */
  spellings: Record<string, number>;
  answers: number;
  /** Some answer presents it as an item (list, heading, bold title, table). */
  structured?: boolean;
  /** Some answer presents it as the head of a list item, a heading or a bold title. */
  listed?: boolean;
  /** Some sentence gives it a company role ("X é uma agência"). */
  company?: boolean;
  /** `client` or `supplier` when every mention follows that cue. */
  role: BrandRole;
  /** Every mention opens a sentence ("Auch Orbit"): its first word may be grammar. */
  opener?: boolean;
  /** Answers that write it in italics ("*Severance*"). */
  italicAnswers?: number;
  /** Domains spelled like it in the answers and their links, with their hits (brandDomainHits). */
  domains?: Record<string, number>;
  evidence: { runId: string; excerpt: string; createdAt: string }[];
};
/** The names (keys) one answer writes: the window counts every family once per answer from these. */
export type AnswerNames = { id: string; createdAt: string; keys: string[] };
/** An answer's names with its own tallies: the window's tally of a name is the sum of its answers' (mergeNameTally). */
export type AnswerTallies = AnswerNames & { tallies: NameTally[] };

/** The spelling most answers use, the first in code order on a tie. */
export function tallyName(tally: Pick<NameTally, 'spellings'>) {
  return Object.entries(tally.spellings).sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0]![0];
}
/** The newest excerpts, one per answer. */
function newestEvidence(items: NameTally['evidence'], limit: number) {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => byText(b.createdAt, a.createdAt) || byText(a.runId, b.runId))
    .filter((item) => !seen.has(item.runId) && !!seen.add(item.runId))
    .slice(0, limit);
}
const addCounts = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
  const sum = { ...a };
  for (const [key, count] of Object.entries(b)) sum[key] = (sum[key] ?? 0) + count;
  return sum;
};
/** Two tallies of different answers as one: commutative and associative, so pages can be added in any order. */
export function mergeNameTally(a: NameTally, b: NameTally, evidenceLimit = 3): NameTally {
  const italicAnswers = (a.italicAnswers ?? 0) + (b.italicAnswers ?? 0);
  const domains = addCounts(a.domains, b.domains);
  return {
    key: a.key,
    spellings: addCounts(a.spellings, b.spellings),
    answers: a.answers + b.answers,
    ...(a.structured || b.structured ? { structured: true } : {}),
    ...(a.listed || b.listed ? { listed: true } : {}),
    ...(a.company || b.company ? { company: true } : {}),
    role: a.role === b.role ? a.role : 'competitor',
    ...(a.opener && b.opener ? { opener: true } : {}),
    ...(italicAnswers ? { italicAnswers } : {}),
    ...(Object.keys(domains).length ? { domains } : {}),
    evidence: newestEvidence([...a.evidence, ...b.evidence], evidenceLimit),
  };
}

/**
 * Every name these answers write, tallied by key with nothing decided across names (no family, no ordinary word): the
 * analysis adds the pages' tallies up and decides once over the whole window (resolveNames). `answers` lists the keys of
 * each answer, so a family is counted once per answer however many of its names the answer writes, with the answer's own
 * tallies: each answer is tallied alone (its domains read under the way it writes the name), so the window's tally is the
 * same however its answers are paged, and a store can keep each answer's part and add it up again without reading it.
 */
export function tallyNames(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  evidenceLimit = 3,
  common: ReadonlySet<string> = new Set(),
  /** The brands the project already knows (structure-v15): each answer that spells one names it (knownBrandMentions). */
  knownBrands: readonly KnownBrand[] = [],
) {
  const tracked = trackedBrandKeys(seeds, common);
  const known = new Set(seeds.map((seed) => brandDetectionKey(seed.name)));
  const recognisable = knownBrands.filter((brand) => !tracked(brandDetectionKey(brand.name)));
  const sum = new Map<string, NameTally>();
  const named: AnswerTallies[] = [];
  for (const answer of answers) {
    const keys: string[] = [];
    const tallies = new Map<string, NameTally & { texts: number }>();
    const text = answer.answer.slice(0, MAX_DISCOVERY_ANSWER_CHARACTERS);
    const extracted = extractBrandMentions(text, known);
    const found = new Set(extracted.map((mention) => mention.key));
    // A known brand the extraction did not read as a name here ("Web Estratégica / Orgânica Digital", a name of section
    // words) is still named: the window already settled it is a brand.
    const recognised = knownBrandMentions(text, recognisable).flatMap(({ brand, excerpt }): BrandMention[] => {
      const key = brandDetectionKey(brand.name);
      return found.has(key) ? [] : [{ name: brand.name, key, structure: 'prose', excerpt, company: true }];
    });
    for (const mention of [...extracted, ...recognised]) {
      if (tracked(mention.key)) continue;
      keys.push(mention.key);
      const role: BrandRole = mention.cue ?? 'competitor';
      const tally = tallies.get(mention.key) ?? { key: mention.key, spellings: {}, answers: 0, role, opener: true, evidence: [], texts: 0 };
      tally.spellings[mention.name] = (tally.spellings[mention.name] ?? 0) + 1;
      tally.answers++;
      if (mention.structure !== 'prose') tally.structured = true;
      if (mention.structure === 'list' || mention.structure === 'bold' || mention.structure === 'heading') tally.listed = true;
      if (mention.company) tally.company = true;
      if (tally.role !== role) tally.role = 'competitor';
      if (!mention.opening) delete tally.opener;
      if (mention.italic) tally.italicAnswers = (tally.italicAnswers ?? 0) + 1;
      if (tally.evidence.length < evidenceLimit) tally.evidence.push({ runId: answer.id, createdAt: answer.createdAt, excerpt: mention.excerpt });
      tally.texts++;
      tallies.set(mention.key, tally);
    }
    // The answer's hosts, read once: each mention counts them (and its links) once, as the window's tally always did.
    const hosts = tallies.size ? [...textHosts(answer.answer), ...answer.sources.flatMap((source) => { try { return [new URL(source.url).hostname]; } catch { return []; } })] : [];
    const own = [...tallies.values()].map(({ texts, ...tally }) => {
      const once = domainHitsOf(tallyName(tally), hosts);
      const domains = Object.fromEntries(Object.entries(once).map(([domain, hits]) => [domain, hits * texts]));
      return { ...tally, evidence: newestEvidence(tally.evidence, evidenceLimit), ...(Object.keys(domains).length ? { domains } : {}) };
    });
    for (const tally of own) sum.set(tally.key, sum.has(tally.key) ? mergeNameTally(sum.get(tally.key)!, tally, evidenceLimit) : tally);
    named.push({ id: answer.id, createdAt: answer.createdAt, keys, tallies: own });
  }
  return { names: [...sum.values()], answers: named };
}

/** How often the window writes a word or a name in lowercase: an ordinary word, not a brand ("forte", "link building"). */
export type LowercaseUse = {
  /** Answers that write this word (a brandDetectionKey of one word) in lowercase. */
  word: (word: string) => number;
  /** Answers that write the name in lowercase (0 for a name written in lowercase anyway). */
  name: (key: string, name: string) => number;
};
/**
 * Whether `text` writes `lower` as itself: not inside a word, a host, a handle or a path (no letter, digit, `./@_-` before;
 * no letter, digit, `@_` or `.letter` after). The same test as one regular expression per name, which compiled thousands of
 * them for a large window (hundreds of megabytes).
 */
const BEFORE_NAME = /[\p{L}\p{N}./@_-]/u;
const AFTER_NAME = /[\p{L}\p{N}@_]/u;
const LETTER = /\p{L}/u;
const codePointAt = (text: string, at: number) => (at >= 0 && at < text.length ? String.fromCodePoint(text.codePointAt(at)!) : '');
const codePointBefore = (text: string, at: number) => {
  if (at <= 0) return '';
  const low = text.charCodeAt(at - 1);
  return low >= 0xdc00 && low <= 0xdfff && at >= 2 ? text.slice(at - 2, at) : text[at - 1]!;
};
function standsAlone(text: string, lower: string) {
  for (let at = text.indexOf(lower); at >= 0; at = text.indexOf(lower, at + 1)) {
    const before = codePointBefore(text, at);
    if (before && BEFORE_NAME.test(before)) continue;
    const end = at + lower.length;
    const after = codePointAt(text, end);
    if (after && AFTER_NAME.test(after)) continue;
    if (after === '.' && LETTER.test(codePointAt(text, end + 1))) continue;
    return true;
  }
  return false;
}
/** A count kept by word or name ("constructor" is a word too, not the object's). */
const own = (counts: Record<string, number> | undefined, key: string) => (counts && Object.hasOwn(counts, key) ? counts[key]! : 0);
/** What lowercaseCounter has counted so far: per word, and per name of several words, the answers that write it in lowercase. */
export type LowercaseCounts = { words: Record<string, number>; phrases: Record<string, number> };
/**
 * One read of the window's answers for every name at once: each answer is split into its lowercase words once, and a
 * name of several words is only looked for in the answers that hold all of its words (structure-v7: before, each page
 * counted only the names it held itself, so the same answers paged another way told another story). Counts of different
 * answers add up, so a long window is read in parts (`start`: the counts of the parts read before).
 */
export function lowercaseCounter(names: { key: string; name: string }[], start?: LowercaseCounts) {
  const words = new Map<string, number>();
  for (const { key } of names) for (const word of key.split(' ')) words.set(word, own(start?.words, word));
  type Phrase = { lower: string; words: string[]; count: number };
  const phrases = new Map<string, Phrase>();
  const byWord = new Map<string, Phrase[]>();
  const loose: Phrase[] = [];
  for (const { key, name } of names) {
    const lower = name.toLocaleLowerCase();
    if (!/\s/u.test(name) || lower === name || phrases.has(key)) continue;
    const parts = [...lowercaseWordKeys(lower)].sort((a, b) => b.length - a.length || byText(a, b));
    const phrase: Phrase = { lower, words: parts, count: own(start?.phrases, key) };
    phrases.set(key, phrase);
    if (parts[0]) byWord.set(parts[0], [...(byWord.get(parts[0]) ?? []), phrase]);
    else loose.push(phrase);
  }
  return {
    add(text: string) {
      // Link targets and bare URLs carry names in lowercase ("ipullrank.com/?utm=ipullrank") that are not words.
      const readable = text.replace(/\]\([^)]*\)|https?:\/\/\S+/gu, ' ');
      const seen = lowercaseWordKeys(readable);
      for (const word of seen) {
        const count = words.get(word);
        if (count !== undefined) words.set(word, count + 1);
        for (const phrase of byWord.get(word) ?? []) if (phrase.words.every((part) => seen.has(part)) && standsAlone(readable, phrase.lower)) phrase.count++;
      }
      for (const phrase of loose) if (standsAlone(readable, phrase.lower)) phrase.count++;
    },
    counts(): LowercaseCounts {
      return { words: Object.fromEntries(words), phrases: Object.fromEntries([...phrases].map(([key, phrase]) => [key, phrase.count])) };
    },
    use(): LowercaseUse {
      return {
        word: (word) => words.get(word) ?? 0,
        name: (key, name) => (name.toLocaleLowerCase() === name ? 0 : /\s/u.test(name) ? (phrases.get(key)?.count ?? 0) : (words.get(key) ?? 0)),
      };
    },
  };
}
/** The lowercase use those counts say (the same answers as lowercaseCounter(names, counts).use() for the names counted). */
export function lowercaseFrom(counts: LowercaseCounts): LowercaseUse {
  return {
    word: (word) => own(counts.words, word),
    name: (key, name) => (name.toLocaleLowerCase() === name ? 0 : /\s/u.test(name) ? own(counts.phrases, key) : own(counts.words, key)),
  };
}
export function lowercaseUse(texts: Iterable<string>, names: { key: string; name: string }[]): LowercaseUse {
  const counter = lowercaseCounter(names);
  for (const text of texts) counter.add(text);
  return counter.use();
}

const MAX_ALIASES = 12;
/**
 * The window's decisions across names, made once over the whole window from its tallies, in one canonical order, so the
 * result is the same however the answers were paged or ordered (structure-v7): ordinary words and titles leave, "A & B"
 * and "X's Y" go to their brands, families fold (brandMergeGroups) and each candidate is counted from the answers' own
 * names, once per answer.
 */
export function resolveNames(
  input: NameTally[],
  answers: Iterable<AnswerNames>,
  seeds: DiscoverySeed[],
  lowercase: LowercaseUse,
  /** `onAnswer`: the candidates each answer names, once per family (the brands share of voice counts). */
  /** `common`: the monitored spellings that are common words in the window (they claim only themselves, trackedBrandKeys). */
  options: { keepOrdinary?: boolean; evidenceLimit?: number; onAnswer?: (id: string, names: string[]) => void; common?: ReadonlySet<string> } = {},
): CompetitorCandidate[] {
  const evidenceLimit = options.evidenceLimit ?? 3;
  const tracked = trackedBrandKeys(seeds, options.common);
  const tallies = new Map([...input].sort((a, b) => byText(a.key, b.key)).map((tally) => [tally.key, tally]));
  const names = new Map([...tallies].map(([key, tally]) => [key, tallyName(tally)]));
  const nameOf = (key: string) => names.get(key)!;
  const domainOf = (key: string) => brandDomainFromHits(tallies.get(key)?.domains ?? {});
  const plain = (tally: NameTally, domain: string | null) => !domain && !tally.company && tally.role === 'competitor';
  // A name the window writes in lowercase as often as it names it is an ordinary word ("Forte", "Live TV"); one written in
  // italics in a third of its answers is the title of a work ("*Severance*"). Only a domain, a company role or a
  // client/supplier cue vouches for it.
  if (!options.keepOrdinary)
    for (const [key, tally] of tallies) {
      const { domain } = domainOf(key);
      if ((plain(tally, domain) && lowercase.name(key, nameOf(key)) >= tally.answers) || (!domain && (tally.italicAnswers ?? 0) * 3 >= tally.answers))
        tallies.delete(key);
    }
  // Raw key → the keys its answers count for, when it is not a name of its own.
  const into = new Map<string, string[]>();
  // "Tubi & YouTube", "Kanopy & Hoopla", "Battery Life & Wear OS": a brand the window also names apart, joined to another
  // brand or to a phrase that is no name, is not a third brand.
  for (const key of tallies.keys()) {
    const parts = nameOf(key).split(/\s*&\s*/u);
    const keys = parts.map(brandDetectionKey);
    // A part that is the name itself would count its answers for itself.
    if (keys.length !== 2 || keys.includes(key) || !keys.some((part) => tallies.has(part)) || !keys.every((part, index) => tallies.has(part) || tracked(part) || !looksLikeName(parts[index]!))) continue;
    into.set(key, keys.filter((part) => tallies.has(part)));
    tallies.delete(key);
  }
  // "Google's Gemini", "Verizon's perks": what a brand the window knows possesses is the name, or no name at all.
  for (const key of tallies.keys()) {
    const owned = /^(\S+)['’]s\s+(\S.*)$/u.exec(nameOf(key));
    if (!owned || !tallies.has(key)) continue;
    const owner = brandDetectionKey(owned[1]!);
    if (!tallies.has(owner) && !tracked(owner)) continue;
    const tally = tallies.get(key)!;
    tallies.delete(key);
    const rest = brandDetectionKey(owned[2]!);
    if (!looksLikeName(owned[2]!) || tracked(rest)) {
      into.set(key, []);
      continue;
    }
    const moved = { ...tally, key: rest, spellings: { [owned[2]!]: tally.answers } };
    tallies.set(rest, tallies.has(rest) ? mergeNameTally(tallies.get(rest)!, moved, evidenceLimit) : moved);
    if (!names.has(rest)) names.set(rest, owned[2]!);
    into.set(key, [rest]);
  }
  // Families, decided on the window's own counts.
  const count = (key: string) => tallies.get(key)?.answers ?? 0;
  // A word the window writes in lowercase in a tenth as many answers as name it ("star", "black") is ordinary and heads no
  // family; one stray "peacock" in thousands of answers is not. A word no answer names alone: any lowercase use.
  const ordinary = (word: string) => (tallies.has(word) ? lowercase.word(word) * 10 >= count(word) : lowercase.word(word) > 0);
  const finals: { key: string; name: string; members: string[] }[] = [];
  for (const members of brandMergeGroups(
    [...tallies.keys()],
    ordinary,
    (key) => !!tallies.get(key)!.structured || count(key) >= 3,
    count,
  )) {
    const lead = members.length > 1 ? brandMergeLead(members, count, (key) => !!tallies.get(key)!.opener) : members[0]!;
    // A word a tracked brand owns ("Microsoft" of Microsoft Surface) names no discovery: the models stay apart.
    if (!tallies.has(lead) && tracked(lead)) {
      for (const key of members) finals.push({ key, name: nameOf(key), members: [key] });
      continue;
    }
    // Only models were named ("OnePlus 15", "OnePlus Watch"): the brand's word, written as the most cited model writes it.
    const top = members.reduce((best, key) => (count(key) > count(best) ? key : best));
    finals.push({ key: lead, name: tallies.has(lead) ? nameOf(lead) : nameOf(top).split(/\s+/u)[0]!, members });
  }
  // Two families written the same way ("OnePlus" of the models and "OnePlus+") are one name: identities are unique.
  const byIdentity = new Map<string, (typeof finals)[number]>();
  for (const final of finals) {
    const identity = competitorIdentity(final.name);
    const seen = byIdentity.get(identity);
    if (seen) seen.members.push(...final.members);
    else byIdentity.set(identity, final);
  }
  const kept = [...byIdentity.values()];
  const finalOf = new Map<string, number[]>();
  kept.forEach((final, index) => final.members.forEach((key) => finalOf.set(key, [index])));
  for (const [key, parts] of into) finalOf.set(key, [...new Set(parts.flatMap((part) => finalOf.get(part) ?? []))]);
  // Every candidate counted from the answers themselves: an answer that writes "Fitbit" and "Fitbit Charge 6" counts once.
  const counts = kept.map(() => ({ answers: 0, days: {} as Record<string, number> }));
  for (const answer of answers) {
    const hit = new Set<number>();
    for (const key of answer.keys) for (const index of finalOf.get(key) ?? []) hit.add(index);
    options.onAnswer?.(answer.id, [...hit].map((index) => kept[index]!.name));
    const day = answer.createdAt.slice(0, 10);
    for (const index of hit) {
      counts[index]!.answers++;
      if (/^\d{4}-\d{2}-\d{2}$/u.test(day)) counts[index]!.days[day] = (counts[index]!.days[day] ?? 0) + 1;
    }
  }
  const candidates: CompetitorCandidate[] = [];
  kept.forEach((final, index) => {
    const { answers: answerCount, days } = counts[index]!;
    if (!answerCount) return;
    const tally = final.members.map((key) => tallies.get(key)!).reduce((a, b) => mergeNameTally(a, b, evidenceLimit));
    // A family's domain is the one spelled like the name it shows ("amazon.com" for Amazon, not "amazonmusic.com").
    const label = brandLabel(final.name);
    const { domain, state } = brandDomainFromHits(Object.fromEntries(Object.entries(tally.domains ?? {}).filter(([found]) => registrableDomain(found).split('.')[0] === label)));
    const role = tally.role;
    const reasons: string[] = [];
    if (role !== 'competitor')
      reasons.push(role === 'client' ? 'Listed as a client of the described brand, not as a competitor.' : 'Listed as a supplier of the described brand, not as a competitor.');
    if (domain) reasons.push('A domain in the answers is spelled like the brand.');
    if (isPlaceName(final.key)) reasons.push('Place name (city, state or country); human review required.');
    // Without the decision model this is all there is: a name stands only as the head of a list item or a bold title.
    if (!tally.listed) reasons.push('Never the head of a list item or a bold title in these answers; human review required.');
    if (ACRONYM.test(final.name) && !domain) reasons.push('Short acronym without a domain; human review required.');
    const aliases = final.members
      .filter((key) => key !== final.key)
      .sort((a, b) => count(b) - count(a) || byText(a, b))
      .map(nameOf)
      .filter((alias) => alias !== final.name)
      .slice(0, MAX_ALIASES);
    const head = /^(\S+) /u.exec(final.key)?.[1];
    const lowercaseAnswers = lowercase.name(final.key, final.name);
    candidates.push({
      name: final.name,
      key: final.key,
      ambiguous: reasons.some((reason) => reason.endsWith('human review required.')),
      // Nothing vouches for the name but its spelling.
      plain: plain(tally, domain),
      lowercaseAnswers,
      ...(tally.italicAnswers ? { italicAnswers: tally.italicAnswers } : {}),
      ...(head && ordinary(head) ? { headOrdinary: true } : {}),
      structured: !!tally.structured,
      ...(aliases.length ? { aliases } : {}),
      reasons,
      role,
      days: Object.fromEntries(Object.entries(days).sort()),
      domain,
      domainEvidence: state,
      score: tally.structured ? 1 : 0.5,
      answerCount,
      evidence: tally.evidence,
    });
  });
  return candidates;
}

/**
 * The names these answers present, grouped by key, most answers first. Each candidate keeps a few
 * excerpts, its answers per day, a domain the answers spell like it and the textual
 * client/supplier cue. `ambiguous` (review) when the text alone cannot vouch for a company: a name never
 * the head of a list item or a bold title, a short acronym or a place. `plain` marks a name with no
 * domain, cue or company role, which is dropped when the answers write it in lowercase as often as they
 * name it (kept, with its counts, under `keepOrdinary`). The same as tallying the answers page by page and
 * resolving the sum (what the project store does), in any order.
 */
export function discoverCompetitors(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  options: {
    maxCandidates?: number;
    maxEvidencePerCandidate?: number;
    /** Keep the names these answers write in lowercase (or in italics) as often as they name them, with their counts. */
    keepOrdinary?: boolean;
    /** Monitored spellings that are common words (commonSpellings): they claim only themselves (structure-v13). */
    common?: ReadonlySet<string>;
  } = {},
): CompetitorCandidate[] {
  const evidenceLimit = Math.max(1, Math.trunc(options.maxEvidencePerCandidate ?? 3));
  const { names, answers: named } = tallyNames(answers, seeds, evidenceLimit, options.common);
  const lowercase = lowercaseUse(
    answers.map((answer) => answer.answer),
    names.map((tally) => ({ key: tally.key, name: tallyName(tally) })),
  );
  const maxCandidates = Math.min(500, Math.max(1, Math.trunc(options.maxCandidates ?? 10)));
  return resolveNames(names, named, seeds, lowercase, { keepOrdinary: options.keepOrdinary, evidenceLimit, common: options.common })
    .sort(
      (left, right) =>
        Number(left.ambiguous) - Number(right.ambiguous) ||
        right.answerCount - left.answerCount ||
        right.score - left.score ||
        byText(left.name, right.name),
    )
    .slice(0, maxCandidates);
}

export const ANSWER_ROLE_ORDER: AnswerBrand['role'][] = ['tracked', 'competitor', 'client', 'supplier', 'partner', 'ambiguous', 'pending'];

/**
 * The brands one answer names, for its response detail: the monitored ones it mentions, then each other name with
 * what the decision model said it is (`roles`, by brandKey). A name the model called a mention (a source cited in
 * passing) or no brand at all (a title, a person, a term) is not a brand here, nor is a title written in italics; a
 * name without an answer yet is listed as pending only when the answer presents it as an item, so a stray
 * capitalized word never shows up.
 */
export function answerBrands(answer: string, tracked: string[], seeds: DiscoverySeed[], roles: ReadonlyMap<string, string>, common: ReadonlySet<string> = new Set()): AnswerBrand[] {
  const isTracked = trackedBrandKeys(seeds, common);
  const known = new Set(seeds.map((seed) => brandDetectionKey(seed.name)));
  const brands: AnswerBrand[] = tracked.map((name) => ({ name, role: 'tracked' }));
  for (const mention of extractBrandMentions(answer.slice(0, MAX_DISCOVERY_ANSWER_CHARACTERS), known)) {
    if (isTracked(mention.key)) continue;
    const role = roles.get(brandKey(mention.name));
    if (role === 'mention' || role === 'not_brand' || (!role && (mention.structure === 'prose' || mention.italic))) continue;
    brands.push({ name: mention.name, role: (role ?? 'pending') as AnswerBrand['role'] });
  }
  return brands.sort((left, right) => ANSWER_ROLE_ORDER.indexOf(left.role) - ANSWER_ROLE_ORDER.indexOf(right.role));
}
