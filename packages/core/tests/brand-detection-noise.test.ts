import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerBrands,
  brandDetectionKey,
  brandMergeGroups,
  brandMergeLead,
  discoverCompetitors,
  extractBrandMentions,
  isGenericTechnology,
  isPlaceName,
  splitBrandSurface,
  trackedBrandKeys,
  type CompetitorCandidate,
  type DiscoveryAnswer,
} from '../lib/competitor-discovery.ts';
import { discoverPaged } from '../lib/classifier-consistency.ts';

// Shapes the Conversion project's answers take (Oct 2026), on invented names.
// No provider is involved: the free detector only finds names; the decision model says what each one is.
const seeds = [
  { name: 'Conversion', domain: 'conversion.com.br' },
  { name: 'Agência Mestre', domain: 'agenciamestre.com' },
  { name: 'NP Digital', domain: 'npdigital.com' },
];
const answer = (text: string, id = 'fixture'): DiscoveryAnswer => ({ id, answer: text, sources: [], createdAt: '2026-10-10T12:00:00.000Z' });
const found = (text: string) => discoverCompetitors([answer(text)], seeds, { maxCandidates: 500 });
const names = (text: string) => found(text).map((candidate) => candidate.name).sort();
const mentioned = (text: string) => extractBrandMentions(text).map((mention) => mention.name);

void test('names standing alone in bold, as headings or as list leads are all found in one answer', () => {
  // A reported answer: six agencies, each a bold line followed by its description.
  const bold = 'Existem agências com experiência.\n\n## Agências Especializadas em Acessibilidade\n\n' +
    ['Alfa Digital', 'EqualFix', 'InterTeste', 'Acesso para Todos', 'Bela Agência', 'Unclex']
      .map((name) => `**${name}**\n\n\nA empresa oferece criação de sites acessíveis e consultoria\n\n.`)
      .join('\n\n');
  for (const name of ['Alfa Digital', 'EqualFix', 'InterTeste', 'Acesso para Todos', 'Bela Agência', 'Unclex'])
    assert.ok(names(bold).includes(name), name);
  const headings = '## 1\\. Visivel Labs\nReino Unido\n\n## 2\\. Zeta\nSEO corporativo\n\n### 3. [Gamma SEO](https://gamma.example) \n- **Perfil:** agência';
  assert.deepEqual(['Gamma SEO', 'Visivel Labs', 'Zeta'].filter((name) => names(headings).includes(name)), ['Gamma SEO', 'Visivel Labs', 'Zeta']);
  const leads = '- **Rank Alto** — destaque para auditoria\n- **Delta Comms:** relações públicas\n- Omega Links: agência de links\n- **[Sigma One]** : PR digital';
  for (const name of ['Rank Alto', 'Delta Comms', 'Omega Links', 'Sigma One']) assert.ok(names(leads).includes(name), name);
});

void test('a bold label repeated in every item, a sentence-case heading and table headers are not names', () => {
  const text = [
    '- **Kappa Web**',
    '  - **Perfil:** agência de tecnologia.',
    '  - **Saiba mais:** site.',
    '- **Lambda SEO**',
    '  - **Perfil:** consultoria.',
    '  - **Saiba mais:** site.',
    '## Como eu escolheria a agência',
    '| Critério | O que exigir |',
    '|---|---|',
    '| Escala comprovada | Kappa Web |',
  ].join('\n');
  const list = mentioned(text);
  assert.ok(list.includes('Kappa Web') && list.includes('Lambda SEO'));
  for (const label of ['Perfil', 'Saiba mais', 'Como eu escolheria a agência', 'O que exigir', 'Escala comprovada'])
    assert.ok(!list.includes(label), label);
});

void test('running text yields names after an article, in "como A, B e C" lists and in broken bold', () => {
  const text = 'A Método Rápido oferece pesquisa com usuários. A Supersonix é a primeira consultoria de CRO. Atende marcas como Natura Teste, Loja Ômega e Banco Pi.\n\n**\nElonex** estrutura a contratação.';
  const list = mentioned(text);
  for (const name of ['Método Rápido', 'Supersonix', 'Natura Teste', 'Loja Ômega', 'Banco Pi', 'Elonex']) assert.ok(list.includes(name), name);
  // A list of clients carries that cue, which keeps the names out of the competitor ranking without a model.
  assert.equal(found(text).find((candidate) => candidate.name === 'Banco Pi')?.role, 'client');
});

void test('tracked brands, their parts and longer forms are not discoveries, and sources sections are skipped', () => {
  const text = '- **Agência Mestre** — pioneira\n- **NP Digital Brasil** — braço local\n- A Mestre foi pioneira.\n- **Conversion** — SEO\n- **Theta Lab** — SEO\n\n## Fontes\n- [Publicador X](https://publisher.example)\n- [Revista Y](https://revista.example)';
  assert.deepEqual(names(text), ['Theta Lab']);
});

void test('a name written in lowercase as often as capitalized is an ordinary word; camelCase and domains are not lowercase', () => {
  const text = 'Os resultados são promissores. Uma estratégia forte e uma via clara de testes ajudam. Forte é o ponto principal. A Via aparece em listas.\n\n- **Cadastra** — oferece CRO\n- **iPullRank** — SEO técnico. Site: [ipullrank.com](https://ipullrank.com/?ref=ipullrank)\n- **Via Agência Digital** — oferece CRO';
  const list = names(text);
  for (const name of ['Cadastra', 'iPullRank', 'Via Agência Digital']) assert.ok(list.includes(name), name);
  for (const word of ['Forte', 'Via']) assert.ok(!list.includes(word), word);
  const pages = ['- **Foco:** técnico', 'O foco é técnico.', 'Com foco em dados.'].map((text, index) => answer(text, String(index)));
  assert.ok(!discoverCompetitors(pages, seeds).some((candidate) => candidate.name === 'Foco'));
});

void test('names joined by × or a conjunction are separate brands and a leading conjunction is dropped', () => {
  assert.deepEqual(names('### 1. Hedgehog × Netlinks\n\n### 2. e Cadastra\n'), ['Cadastra', 'Hedgehog', 'Netlinks']);
  assert.deepEqual(names('- **Hedgehog e Netlinks** — duas agências que oferecem CRO\n'), ['Hedgehog', 'Netlinks']);
});

void test('splitBrandSurface handles separators in several languages and keeps real names whole', () => {
  const pieces = (surface: string) => splitBrandSurface(surface).map((piece) => surface.slice(piece.start, piece.end));
  assert.deepEqual(pieces('Hedgehog × Netlinks'), ['Hedgehog', 'Netlinks']);
  assert.deepEqual(pieces('Hedgehog + Netlinks'), ['Hedgehog', 'Netlinks']);
  assert.deepEqual(pieces('Hedgehog/Netlinks'), ['Hedgehog', 'Netlinks']);
  assert.deepEqual(pieces('Hedgehog / Netlinks'), ['Hedgehog', 'Netlinks']);
  assert.deepEqual(pieces('Nike x Off-White'), ['Nike', 'Off-White']);
  assert.deepEqual(pieces('Cadastra and Netlinks'), ['Cadastra', 'Netlinks']);
  assert.deepEqual(pieces('Cadastra y Netlinks'), ['Cadastra', 'Netlinks']);
  assert.deepEqual(pieces('Cadastra, Netlinks'), ['Cadastra', 'Netlinks']);
  assert.deepEqual(pieces('e Cadastra'), ['Cadastra']);
  assert.deepEqual(pieces('and Cadastra'), ['Cadastra']);
  assert.deepEqual(pieces('Cadastra, Inc.'), ['Cadastra']);
  for (const whole of ['Procter & Gamble', 'AT&T', 'Rakuten Viki', 'Paramount+', 'Disney+', 'Apple TV+', 'O Boticário', 'Mercado Livre'])
    assert.deepEqual(pieces(whole), [whole]);
});

void test('cities, states and countries go to review as items and are dropped from running text', () => {
  for (const place of ['São Paulo', 'Sao Paulo', 'Rio de Janeiro', 'Minas Gerais', 'New York', 'München', 'Tokyo', 'Brasil', 'Brazil', 'Portugal', 'Deutschland', 'Argentina', 'Москва', '東京'])
    assert.ok(isPlaceName(brandDetectionKey(place)), place);
  for (const brand of ['Cadastra', 'Netlinks', 'Hedgehog', 'Adobe', 'Conversion', 'Netflix'])
    assert.ok(!isPlaceName(brandDetectionKey(brand)), brand);
  const rows = found('Agências de CRO em São Paulo atendem o Brasil.\n\n- **São Paulo** — onde ficam muitas agências\n- **Cadastra** — oferece CRO\n');
  const place = rows.find((row) => row.key === 'são paulo');
  assert.equal(place?.ambiguous, true);
  assert.ok(place?.reasons?.some((reason) => /place name/i.test(reason)));
  assert.equal(rows.find((row) => row.key === 'cadastra')?.ambiguous, false);
  assert.ok(!rows.some((row) => row.key === 'brasil'));
});

void test('a name met only in running text or a short acronym item waits for review; a name standing as an item does not', () => {
  const rows = found('A Orbit Works oferece SEO. Também há a FSB.\n\n- **Pixel Norte** — oferece SEO\n- **FSB** — relações públicas\n');
  assert.equal(rows.find((row) => row.name === 'Orbit Works')?.ambiguous, true);
  assert.equal(rows.find((row) => row.name === 'Orbit Works')?.plain, false);
  assert.equal(rows.find((row) => row.name === 'FSB')?.ambiguous, true);
  assert.equal(rows.find((row) => row.name === 'Pixel Norte')?.ambiguous, false);
  assert.equal(rows.find((row) => row.name === 'Pixel Norte')?.score, 1);
  // One capitalized word met only in prose is "plain": the analysis drops it once the window writes it in lowercase.
  assert.equal(found('Vale citar a Sonora, que atende o mercado.').find((row) => row.name === 'Sonora')?.plain, true);
});

void test('names listed as clients or suppliers get that role and are not competitors', () => {
  assert.equal(found('A Cadastra oferece CRO e atende clientes como Adobe, Via e Netflix.').find((row) => row.key === 'adobe')?.role, 'client');
  assert.equal(found('Cadastra offers CRO. Its customers include Adobe and Netflix.').find((row) => row.key === 'adobe')?.role, 'client');
  assert.equal(found('A Cadastra usa fornecedores como Hotjar e Optimizely para testes.').find((row) => row.key === 'hotjar')?.role, 'supplier');
  // "clientes" elsewhere in the sentence does not turn the following brand into a client.
  assert.equal(found('Nossos clientes confiam na Hedgehog, que oferece CRO.').find((row) => row.key === 'hedgehog')?.role, 'competitor');
  // A client in one answer and an item in another is not only a client.
  const both = discoverCompetitors([answer('Atende marcas como Rock Conteúdo e Banco Pi.', 'a'), answer('- **Rock Conteúdo** — marketing de conteúdo', 'b')], seeds);
  assert.equal(both.find((row) => row.name === 'Rock Conteúdo')?.role, 'competitor');
});

void test('"&" joins a name unless both sides are already brands known on their own', () => {
  const pieces = (surface: string, known: string[]) =>
    splitBrandSurface(surface, new Set(known.map(brandDetectionKey))).map((piece) => surface.slice(piece.start, piece.end));
  assert.deepEqual(pieces('Procter & Gamble', []), ['Procter & Gamble']);
  assert.deepEqual(pieces('Procter & Gamble', ['Procter']), ['Procter & Gamble']);
  assert.deepEqual(pieces('AT&T', ['AT', 'T']), ['AT', 'T']);
  assert.deepEqual(pieces('Hedgehog & Netlinks', ['Hedgehog', 'Netlinks']), ['Hedgehog', 'Netlinks']);
  assert.deepEqual(pieces('Hedgehog & Netlinks', ['Hedgehog']), ['Hedgehog & Netlinks']);
  assert.deepEqual(pieces('Cadastra, Hedgehog & Netlinks', ['Hedgehog', 'Netlinks']), ['Cadastra', 'Hedgehog', 'Netlinks']);
  assert.ok(names('- **Procter & Gamble** — oferece produtos de consumo\n').includes('Procter & Gamble'));
});

void test('technology standards named as features ("Wi-Fi", "4K", "HDR") are never discovered as brands', () => {
  for (const name of ['Wi-Fi', 'WiFi', 'Bluetooth', '4K', 'HDR', 'HDMI'])
    assert.ok(isGenericTechnology(brandDetectionKey(name)), name);
  for (const brand of ['Netflix', 'Dolby', 'Wi-Fi Alliance'])
    assert.ok(!isGenericTechnology(brandDetectionKey(brand)), brand);
  assert.deepEqual(names('- **Wi-Fi** — conexão sem fio usada em casa\n- **4K** — resolução das imagens\n- **Cadastra** — oferece CRO\n'), ['Cadastra']);
});

void test('candidates carry answers per day, excerpts around the name and the most mentioned come first', () => {
  const rows = discoverCompetitors(
    [answer('- **Pixel Norte** — SEO técnico', 'a'), { ...answer('- **Pixel Norte** — SEO\n- **Beta Web** — sites', 'b'), createdAt: '2026-10-11T08:00:00.000Z' }],
    seeds,
  );
  assert.deepEqual(rows.map((row) => row.name), ['Pixel Norte', 'Beta Web']);
  assert.deepEqual(rows[0]!.days, { '2026-10-10': 1, '2026-10-11': 1 });
  assert.equal(rows[0]!.answerCount, 2);
  assert.ok(rows[0]!.evidence.every((item) => item.excerpt.includes('Pixel Norte')));
});

void test('a response lists every brand it names with its role: monitored, settled, waiting; mentions and stray words are left out', () => {
  const text = [
    '- **Conversion** — SEO',
    '- **Pixel Norte** — SEO técnico; atende marcas como Loja Ômega e Banco Pi',
    '- **Ferramenta Z** — software de SEO',
    '- **Revista Q** — publicou o ranking',
    '- **Beta Web** — sites',
    'A Gama Prosa também atua.',
  ].join('\n');
  const roles = new Map([
    ['pixel norte', 'competitor'],
    ['loja omega', 'client'],
    ['ferramenta z', 'supplier'],
    ['revista q', 'mention'],
  ]);
  assert.deepEqual(answerBrands(text, ['Conversion'], seeds, roles), [
    { name: 'Conversion', role: 'tracked' },
    { name: 'Pixel Norte', role: 'competitor' },
    { name: 'Loja Ômega', role: 'client' },
    { name: 'Ferramenta Z', role: 'supplier' },
    { name: 'Banco Pi', role: 'pending' },
    { name: 'Beta Web', role: 'pending' },
  ]);
});

void test('headings that open with a verb, possessives, link ids and sentence openers are not names', () => {
  const text = '## Choose Hulu if you want live TV\n### Explore Kanopy\n- **Pick Tubi** for free movies\n\nShudder’s catalog is deep. However, Why not both? I’d say Peacock.\n\nSee https://example.com/search?imgrc=x2ahUKEwiU7YCG1M2X&imageDocid=1 and %7CPROD here. October 2026 brings more.';
  const list = mentioned(text);
  for (const name of ['Hulu', 'Kanopy', 'Tubi', 'Shudder', 'Peacock']) assert.ok(list.includes(name), name);
  for (const noise of ['Choose Hulu', 'Explore Kanopy', 'Pick Tubi', 'Shudder’s', 'However', 'Why', 'I’d', '7CPROD', 'imageDocid', 'October 2026'])
    assert.ok(!list.includes(noise), noise);
  assert.ok(mentioned('- **Best Buy** sells it').includes('Best Buy'));
});

void test('obvious spellings of one brand are merged, the rest stays apart', () => {
  const groups = (keys: string[]) => brandMergeGroups(keys).map((group) => group.sort().join(' | ')).sort();
  assert.deepEqual(groups(['the criterion channel', 'criterion channel', 'criterion collection']), ['criterion channel | the criterion channel', 'criterion collection']);
  assert.deepEqual(groups(['curiositystream', 'curiosity stream', 'thinkpads', 'thinkpad']), ['curiosity stream | curiositystream', 'thinkpad | thinkpads']);
  assert.deepEqual(groups(['rakuten viki', 'viki']), ['rakuten viki | viki']);
  // A name several longer ones end with, or a generic tail, stays apart.
  assert.deepEqual(groups(['pbs kids', 'youtube kids', 'kids']), ['kids', 'pbs kids', 'youtube kids']);
  assert.deepEqual(groups(['fitbit', 'fitbit charge 6', 'pbs kids', 'pbs kids video app', 'apple tv', 'apple tv+', 'disney', 'disney+']), [
    'apple tv | apple tv+', 'disney | disney+', 'fitbit | fitbit charge 6', 'pbs kids | pbs kids video app',
  ]);
  // A company form of the brand joins it (Conversion's answers, Oct 2026).
  assert.deepEqual(groups(['edelman', 'edelman brasil', 'flowup', 'flowup agency', 'mga press', 'mgapress', 'chili', 'chili digital']), [
    'chili | chili digital', 'edelman | edelman brasil', 'flowup | flowup agency', 'mga press | mgapress',
  ]);
  assert.equal(brandMergeLead(['chili', 'chili digital'], (key) => (key === 'chili digital' ? 71 : 44)), 'chili digital');
  assert.equal(brandMergeLead(['fitbit', 'fitbit charge 6'], (key) => (key === 'fitbit' ? 1 : 9)), 'fitbit');
  // The merged candidate counts each answer once and carries the brand's own name, not a model's.
  const merged = discoverCompetitors(
    [answer('- **Fitbit Charge 6** is great\n- **Rakuten Viki** for dramas', '1'), answer('- **Fitbit** watches\n- **Viki** for dramas', '2'), answer('- **Viki** again', '3')],
    [{ name: 'Netflix', domain: 'netflix.com' }, { name: 'Prime Video', domain: 'primevideo.com' }],
    { maxCandidates: 50 },
  );
  assert.deepEqual(merged.map((candidate) => [candidate.name, candidate.answerCount]).sort(), [['Fitbit', 2], ['Viki', 3]]);
  // The monitored Prime Video already covers "Amazon Prime Video" and "The Prime Video".
  assert.deepEqual(discoverCompetitors([answer('- **Amazon Prime Video**\n- **The Prime Video**\n- **Tubi**')], [{ name: 'Prime Video', domain: 'primevideo.com' }]).map((c) => c.name), ['Tubi']);
});

void test('models of a brand no answer names alone become that brand', () => {
  const groups = (keys: string[]) => brandMergeGroups(keys).map((group) => group.sort().join(' | ')).sort();
  const brandWords = (keys: string[]) => brandMergeGroups(keys, (word) => word === 'black').map((group) => group.sort().join(' | ')).sort();
  assert.deepEqual(brandWords(['black mirror 7', 'black bird']), ['black bird', 'black mirror 7']);
  assert.deepEqual(groups(['oneplus 15', 'oneplus watch']), ['oneplus 15', 'oneplus watch']);
  assert.deepEqual(brandWords(['oneplus 15', 'oneplus watch', 'oneplus 13r', 'grupo fsb', 'grupo 3', 'apple tv', 'apple music']), [
    'apple music', 'apple tv', 'grupo 3', 'grupo fsb', 'oneplus 13r | oneplus 15 | oneplus watch',
  ]);
  assert.equal(brandMergeLead(['oneplus 15', 'oneplus watch'], () => 1), 'oneplus');
  const found = discoverCompetitors(
    [answer('- **OnePlus 15** fast\n- **OnePlus Watch** light', '1'), answer('- **OnePlus 13R** cheap', '2')],
    [{ name: 'Apple', domain: 'apple.com' }],
    { maxCandidates: 50 },
  );
  assert.deepEqual(found.map((candidate) => [candidate.name, candidate.answerCount]), [['OnePlus', 2]]);
});

void test('a name joined by "&" to a hyphenated word is read once and ends', () => {
  // Netflix answer (Oct 2026): this line kept the detection of the whole project from ever finishing.
  const text = '- **Amazon Prime Video** (Best Hub for Regional Releases & Add-ons)\n- **ViX** (Best for X & Add-on fans)';
  const list = names(text);
  assert.ok(list.includes('Amazon Prime Video'));
  assert.ok(!list.some((name) => name.endsWith('&')), list.join(', '));
});

void test('an HTML-escaped answer gives the name as written', () => {
  const list = names('- **CI&amp;T**: consultoria.\n- **MS&#124;UX**: agência.\n- **Hill &amp; Knowlton** &#99999999; fim.');
  for (const name of ['CI&T', 'MS|UX', 'Hill & Knowlton']) assert.ok(list.includes(name), list.join(', '));
  assert.ok(!list.some((name) => name.includes('&amp;')), list.join(', '));
});

void test('structure-v6: a name the answers write in italics is the title of a work, not a brand', () => {
  // Netflix answers (Oct 2026): 106 of 117 non-brands were italicized at least a third of the time, 2 of 51 brands.
  const text = '- *Severance* — Apple TV+ drama\n- **Tubi** — free, ad-supported\n\nStart with *The Bear* or _Slow Horses_. Severance is a great option for thrillers; **Kanopy** has *Only Murders in the Building*.';
  const list = mentioned(text);
  const mention = (name: string) => extractBrandMentions(text).find((item) => item.name === name);
  for (const title of ['Severance', 'The Bear', 'Slow Horses', 'Only Murders']) assert.equal(mention(title)?.italic, true, title);
  for (const brand of ['Tubi', 'Kanopy']) assert.equal(mention(brand)?.italic, undefined, brand);
  assert.ok(list.includes('Severance') && list.includes('Tubi'));
  const rows = names(text);
  for (const brand of ['Tubi', 'Kanopy']) assert.ok(rows.includes(brand), brand);
  for (const title of ['Severance', 'The Bear', 'Slow Horses', 'Only Murders']) assert.ok(!rows.includes(title), title);
  // The store judges the whole window: a page reports the answers that italicize the name.
  const kept = discoverCompetitors([answer(text)], seeds, { keepOrdinary: true, maxCandidates: 50 });
  assert.equal(kept.find((row) => row.name === 'Severance')?.italicAnswers, 1);
  assert.equal(kept.find((row) => row.name === 'Tubi')?.italicAnswers, undefined);
  // Bold is not italics, and a domain spelled like the name vouches for a brand.
  assert.ok(names('- **Tubi** — free\n\nSee *Tubi* at tubi.tv for more.').includes('Tubi'));
  // The response detail does not list a title written in italics as a pending brand.
  assert.deepEqual(answerBrands('- *Severance* — drama\n- **Tubi** — free', ['Netflix'], seeds, new Map()).map((brand) => brand.name), ['Netflix', 'Tubi']);
});

void test('structure-v6: a dictionary word heads no family, a family never chains, a season marker is no model number', () => {
  const groups = (keys: string[], ordinary?: (word: string) => boolean) => brandMergeGroups(keys, ordinary, () => true).map((group) => group.sort().join(' | ')).sort();
  // "star" is written in lowercase somewhere ("star-studded"): "Star Wars" and "Star Trek" are not Star's sub-brands.
  assert.deepEqual(groups(['star', 'star wars', 'star trek'], (word) => word === 'star'), ['star', 'star trek', 'star wars']);
  assert.deepEqual(groups(['accenture', 'accenture song', 'accenture interactive'], () => false), ['accenture | accenture interactive | accenture song']);
  // "Hoopla" never follows "Kanopy & Hoopla" into Kanopy; "Viki" still joins "Rakuten Viki".
  assert.deepEqual(groups(['kanopy', 'kanopy kids', 'kanopy & hoopla', 'hoopla'], () => false), ['hoopla', 'kanopy | kanopy & hoopla | kanopy kids']);
  assert.deepEqual(groups(['rakuten viki', 'viki'], () => false), ['rakuten viki | viki']);
  // A season, part or year is a title's marker: "Black Doves S2" does not make "Black" the brand of "Black Mirror".
  assert.deepEqual(groups(['black doves s2', 'black mirror', 'black bird'], () => false), ['black bird', 'black doves s2', 'black mirror']);
  assert.deepEqual(groups(['lupin part 4', 'lupin season 4', 'lupin'], () => false), ['lupin | lupin part 4 | lupin season 4']);
  assert.deepEqual(groups(['oneplus 15', 'oneplus watch'], () => false), ['oneplus 15 | oneplus watch']);
  // The page knows which head words are ordinary: "Star Wars" and "Star Trek" stay apart when some answer writes "star"
  // (and "Star" alone is an ordinary word of that answer, as before).
  const rows = discoverCompetitors(
    [answer('A star-studded cast.\n\n- **Star Wars** — the saga\n- **Star Trek** — the other saga\n- **Star** — the hub', '1')],
    [{ name: 'Netflix', domain: 'netflix.com' }],
    { maxCandidates: 50, keepOrdinary: true },
  );
  assert.deepEqual(rows.map((row) => row.name).sort(), ['Star Trek', 'Star Wars']);
  assert.equal(rows.find((row) => row.name === 'Star Wars')?.headOrdinary, true);
  assert.equal(
    discoverCompetitors([answer('- **Accenture Song** — agência\n- **Accenture Interactive** — agência\n- **Accenture** — consultoria', '1')], seeds, { maxCandidates: 50 })
      .map((row) => `${row.name}: ${(row.aliases ?? []).sort().join(', ')}`)
      .join('; '),
    'Accenture: Accenture Interactive, Accenture Song',
  );
});

void test('structure-v6: the longer name stays the lead when the answers use it more, and a plan of a monitored brand is that brand', () => {
  const answers = (counts: Record<string, number>) => (key: string) => counts[key] ?? 0;
  assert.equal(brandMergeLead(['national geographic', 'geographic'], answers({ 'national geographic': 200, geographic: 10 })), 'national geographic');
  assert.equal(brandMergeLead(['adult swim', 'swim'], answers({ 'adult swim': 58, swim: 8 })), 'adult swim');
  assert.equal(brandMergeLead(['professional wacom', 'wacom'], answers({ 'professional wacom': 1, wacom: 5 })), 'wacom');
  const tracked = trackedBrandKeys([{ name: 'Disney+', domain: 'disneyplus.com' }, { name: 'Prime Video', domain: 'primevideo.com' }]);
  for (const plan of ['disney+ premium', 'disney+ bundle', 'disney bundle', 'disney+', 'prime video channels']) assert.ok(tracked(plan), plan);
  for (const other of ['peacock premium', 'disneyland']) assert.ok(!tracked(other), other);
  // A monitored brand always wins over a discovered sibling, wherever its name sits in the longer one; "Amazon
  // Prime" itself is another brand, and a generic tail never claims a longer name it does not open.
  for (const plan of ['amazon prime video', 'amazon prime video for families', 'amazon prime video channels', 'the disney+ hulu bundle']) assert.ok(tracked(plan), plan);
  for (const other of ['amazon prime', 'amazon prime membership', 'amazon video']) assert.ok(!tracked(other), other);
  assert.ok(!trackedBrandKeys([{ name: 'TV', domain: 'tv.example' }])('pluto tv live'));
  assert.ok(trackedBrandKeys([{ name: 'TV', domain: 'tv.example' }])('tv guide'));
  const netflix = [{ name: 'Netflix', domain: 'netflix.com', aliases: ['Netflix Originals'] }, { name: 'Prime Video', domain: 'primevideo.com' }];
  assert.deepEqual(
    discoverCompetitors([answer('- **Amazon Prime** — shipping and video\n- **Amazon Prime Video for Families** — kids\n- **The Netflix Originals Collection** — series\n- **Tubi** — free')], netflix, { maxCandidates: 50 })
      .map((c) => c.name)
      .sort(),
    ['Amazon Prime', 'Tubi'],
  );
});

void test('structure-v7: the same answers give the same brands however they are paged or ordered', () => {
  // Netflix answers (Oct 2026) on shapes that used to depend on the page: a family met on one page and its head on another,
  // "A & B", "X's Y", a sub-brand the answers use more than its head, an article, a run-together "Name.Name".
  const texts = [
    '- **Amazon Prime** — huge library\n- **Peacock** — NBC shows\n\nThe Sopranos is on Max.',
    '- **Amazon** — the store\n- **Amazon Music Unlimited** — songs\n- **Amazon Music** — songs',
    '- **Amazon Prime** — included with shipping\n- **Amazon Prime Membership** — the plan',
    '- **Amazon Prime** — rent new films\n- **Tubi & Peacock** — free tiers',
    '- **Peacock Premium** — no ads\n- **Fitbit** — trackers at fitbit.com\n- **Fitbit Charge 6** — the band',
    "- **Sopranos** — HBO classic\n- **Google's Gemini** — the assistant\n- **Google** — search",
    '- **JustWatch** — find where to stream (JustWatch.JustWatch lists it)\n- **Peacock** — a star-studded catalog',
    '- **Tubi** — free\n- **Peacock** — sports\n- **Amazon** — rentals at amazon.com and amazon.in',
  ];
  const answers = texts.map((text, index): DiscoveryAnswer => ({ id: `a${index}`, answer: text, sources: [], createdAt: `2026-10-${10 + index}T12:00:00.000Z` }));
  const netflix = [{ name: 'Netflix', domain: 'netflix.com' }, { name: 'Max', domain: 'max.com' }];
  const shown = (list: CompetitorCandidate[]) => list.map((c) => `${c.name} ${c.answerCount} ${c.domain ?? '-'} [${(c.aliases ?? []).join(', ')}]`).sort();
  // What the project store does (discoverPaged): tally each page, add the tallies up, resolve once over the window.
  const paged = (order: DiscoveryAnswer[], size: number) => shown(discoverPaged(order, netflix, size));
  const whole = shown(discoverCompetitors(answers, netflix, { maxCandidates: 500 }));
  for (const [order, size] of [[answers, 1], [answers, 3], [[...answers].reverse(), 2], [[3, 6, 0, 7, 1, 5, 2, 4].map((index) => answers[index]!), 3]] as const)
    assert.deepEqual(paged(order, size), whole);
  const row = (name: string) => whole.find((line) => line.startsWith(`${name} `));
  // A sub-brand the answers use more than its head is a brand of its own; its own sub-brands follow it.
  assert.equal(row('Amazon Prime'), 'Amazon Prime 3 - [Amazon Prime Membership]');
  assert.equal(row('Amazon'), 'Amazon 2 amazon.com [Amazon Music, Amazon Music Unlimited]', 'amazon.in is amazon.com in another country');
  // Counted once per answer: "Fitbit" and "Fitbit Charge 6" in one answer is one answer.
  assert.equal(row('Fitbit'), 'Fitbit 1 fitbit.com [Fitbit Charge 6]');
  assert.equal(row('Peacock'), 'Peacock 5 - [Peacock Premium]');
  assert.equal(row('Tubi'), 'Tubi 2 - []', '"Tubi & Peacock" counts for both');
  assert.equal(row('Gemini'), 'Gemini 1 - []');
  assert.match(row('JustWatch')!, /^JustWatch 1 - /, '"JustWatch.JustWatch" is no domain');
  assert.ok(row('Sopranos')?.startsWith('Sopranos 2 '), 'The Sopranos is Sopranos');
});

void test('structure-v13: a monitored spelling that is a common word claims only itself, so longer names holding it are discovered', () => {
  const conversion = [{ name: 'Conversion', domain: 'conversion.com.br' }, { name: 'Rock Content', domain: 'rockcontent.com' }];
  const common = new Set(['conversion']);
  // Before: any name holding "conversion" was the monitored agency and never a discovery.
  assert.ok(trackedBrandKeys(conversion)('aim conversion experts'));
  const tracked = trackedBrandKeys(conversion, common);
  for (const other of ['aim conversion experts', 'conversion sciences', 'conversion rate store']) assert.ok(!tracked(other), other);
  assert.ok(tracked('conversion'), 'the spelling itself stays the monitored brand');
  assert.ok(tracked('rock content') && tracked('rock content brasil'), 'other monitored names keep their longer forms');
  const found = discoverCompetitors(
    [
      answer('Agências de CRO:\n- **AIM Conversion Experts**: pioneira em CRO.\n- **Conversion Sciences**: agência global.\n- **Rock Content**: conteúdo.', 'a1'),
      answer('Outras opções:\n- **AIM Conversion Experts**: testes A/B.\n- **Conversion Sciences**: CRO nos EUA.', 'a2'),
    ],
    conversion,
    { maxCandidates: 50, common },
  ).map((candidate) => candidate.name);
  assert.ok(found.includes('AIM Conversion Experts') && found.includes('Conversion Sciences'), found.join(', '));
  assert.ok(!discoverCompetitors([answer('- **AIM Conversion Experts**: CRO.\n- **Conversion Sciences**: CRO.', 'a3')], conversion, { maxCandidates: 50 }).some((candidate) => candidate.name === 'AIM Conversion Experts'), 'without the window it stays as before');
  // The brand's own products become names too; the roles model calls a tracked brand's product a mention, never a competitor.
  assert.ok(!trackedBrandKeys([{ name: 'Apple', domain: 'apple.com' }], new Set(['apple']))('apple watch'));
});
