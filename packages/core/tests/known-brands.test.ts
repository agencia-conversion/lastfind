import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  brandDetectionKey,
  extractBrandMentions,
  knownBrandMentions,
  lowercaseUse,
  resolveNames,
  tallyName,
  tallyNames,
  type DiscoveryAnswer,
  type KnownBrand,
} from '../lib/competitor-discovery.ts';

// Real answers the project owner reviewed on 11/11/2026 (Conversion project): brands the project already knew were not named.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/easy-start-answers.json', import.meta.url), 'utf8')) as {
  answers: Record<'aiMode' | 'aiOverviews' | 'chatGpt', { answer: string; sources: DiscoveryAnswer['sources'] }>;
};
const answer = (key: keyof typeof fixture.answers, id = key): DiscoveryAnswer => ({ id, answer: fixture.answers[key].answer, sources: fixture.answers[key].sources, createdAt: '2026-11-11T07:01:01.836Z' });
const seeds = [
  { name: 'Conversion', domain: 'conversion.com.br' },
  { name: 'Agência Mestre', domain: 'agenciamestre.com' },
  { name: 'Web Estratégica', domain: 'webestrategica.com.br' },
  { name: 'LiveSEO', domain: 'liveseo.com.br', aliases: ['Agência liveSEO', 'Live SEO'] },
];
const brand = (name: string, ...spellings: string[]): KnownBrand => ({ name, spellings: [name, ...spellings] });
const known = [
  brand('Orgânica Digital'),
  brand('Agência SEO Brasil'),
  brand('Rankuvi', 'Acessar Rankuvi'),
  brand('EVTE Marketing', 'EVTE', 'Conhecer EVTE Marketing'),
  brand('QMIX Digital', 'QMIX'),
  brand('Meu Redator'),
  brand('Busca Orgânica'),
  brand('Oficina Consultoria', 'Oficina'),
];
const names = (text: string, list = known) => knownBrandMentions(text, list).map((hit) => hit.brand.name);

test('a known brand the extraction cannot read as a name is named in the real answers', () => {
  // "Web Estratégica / Orgânica Digital": two section words after a slash, never a name for the extraction alone.
  const aiMode = fixture.answers.aiMode.answer;
  assert.ok(!extractBrandMentions(aiMode).some((mention) => mention.name === 'Orgânica Digital'));
  assert.deepEqual(names(aiMode), ['QMIX Digital', 'EVTE Marketing', 'Orgânica Digital']);
  const page = tallyNames([answer('aiMode')], seeds, 3, new Set(), known);
  assert.ok(page.answers[0]!.keys.includes(brandDetectionKey('Orgânica Digital')));
  // Without the known brands the answer does not name it (structure-v14).
  assert.ok(!tallyNames([answer('aiMode')], seeds).answers[0]!.keys.includes(brandDetectionKey('Orgânica Digital')));
  // The window counts it as a brand of this answer (the known hit vouches for it as a company).
  const resolved = new Map<string, string[]>();
  resolveNames(page.names, page.answers, seeds, lowercaseUse([aiMode], page.names.map((tally) => ({ key: tally.key, name: tallyName(tally) }))), { onAnswer: (id, found) => resolved.set(id, found) });
  assert.ok(resolved.get('aiMode')!.includes('Orgânica Digital'));
  assert.ok(names(fixture.answers.aiOverviews.answer).includes('Agência SEO Brasil'));
  assert.deepEqual(names(fixture.answers.chatGpt.answer), ['Orgânica Digital']);
});

test('a name spelled like a site the answer links is a name whatever its words', () => {
  // "**3\. Inside Digital**" and [Conhecer a Inside Digital](https://www.insidedigital.com.br/): only section words, vouched by its site.
  const chatGpt = extractBrandMentions(fixture.answers.chatGpt.answer).map((mention) => mention.name);
  assert.ok(chatGpt.includes('Inside Digital'));
  assert.ok(chatGpt.includes('Orgânica Digital'));
  assert.ok(extractBrandMentions(fixture.answers.aiOverviews.answer).some((mention) => mention.name === 'Agência SEO Brasil'));
  // Without the site, the same words stay a heading.
  assert.ok(!extractBrandMentions('**3. Inside Digital**\n\n- Combina SEO e marketing digital.').some((mention) => mention.name === 'Inside Digital'));
});

test('folding: accents, case of a capitalized spelling, dashes, possessives and domains', () => {
  assert.deepEqual(names('Recomendo a Organica Digital para começar.'), ['Orgânica Digital']);
  assert.deepEqual(names('A EVTE-Marketing atende rápido.'), ['EVTE Marketing']);
  assert.deepEqual(names("Rankuvi's packages are flexible."), []);
  assert.deepEqual(names("Many teams like Rankuvi's packages."), ['Rankuvi']);
  assert.deepEqual(names('Veja os pacotes em rankuvi.com.br antes de contratar.'), ['Rankuvi']);
  assert.deepEqual(names('Uma opção é a QMIX: pacotes avulsos.'), ['QMIX Digital']);
});

test('what the text alone cannot settle is left to the discovery and the decision model', () => {
  // Written in lowercase while the spelling has a capital: an ordinary phrase here, even where it is capitalized too.
  assert.deepEqual(names('### Busca Orgânica\nA busca orgânica traz tráfego.'), []);
  assert.deepEqual(names('Invista em busca orgânica.'), []);
  // Part of a longer capitalized name.
  assert.deepEqual(names('Fale com a Orgânica Digital Labs hoje.'), []);
  assert.deepEqual(names('Contrate a Rankuvi Pro agora.'), []);
  // One plain word opening a sentence or an item: its capital may be grammar. Inside a sentence it names the brand.
  assert.deepEqual(names('Oficina de SEO para iniciantes.'), []);
  assert.deepEqual(names('- Oficina: cursos práticos.'), []);
  assert.deepEqual(names('Empresas como a Oficina ajudam.'), ['Oficina Consultoria']);
  // Sources sections cite publishers.
  assert.deepEqual(names('Texto.\n\n## Fontes\n- Meu Redator: blog'), []);
  // The longest spelling wins: "EVTE Marketing" is one hit, never also "EVTE".
  assert.deepEqual(names('A EVTE Marketing e a EVTE.'), ['EVTE Marketing']);
  // Every capitalized word of the spelling is capitalized in the text (real Netflix answer: "I'd choose Prime Video instead if").
  assert.deepEqual(names("I'd choose Prime Video instead if you pay for Prime.", [brand('Prime Video Instead')]), []);
  // A domain glued to another host is a citation chip, not a mention (real answers: "agencies.semrush.comwww.oxigenweb.com.br").
  assert.deepEqual(names('Site: Agência Mestre agencies.semrush.comwww.oxigenweb.com.br', [brand('Oxigenweb')]), []);
  // Two letters name too many things (real answer: "escritórios em (SP, RS, PR, SC)").
  assert.deepEqual(names('Escritórios em vários estados (SP, RS, PR, SC).', [brand('RS Comunicação', 'RS')]), []);
  // One plain word the window also writes in lowercase is the discovery's to judge ("Agências Web de Code/No-Code").
  assert.deepEqual(names('Agências Web de Code/No-Code avançado.', [{ ...brand('Code'), ordinary: true }]), []);
  assert.deepEqual(names('Agências Web de Code/No-Code avançado.', [brand('Code')]), ['Code']);
  assert.deepEqual(names('Agências Web No-Code avançado.', [brand('Code')]), []);
  assert.deepEqual(names('Planos como Crunchyroll/Shudder valem.', [brand('Shudder')]), ['Shudder']);
});

test('a monitored brand is never a known discovery', () => {
  const page = tallyNames([{ id: 'a', answer: 'Empresas como a LiveSEO e a Live SEO.', sources: [], createdAt: '2026-11-11' }], seeds, 3, new Set(), [brand('Live SEO')]);
  assert.deepEqual(page.answers[0]!.keys, []);
});
