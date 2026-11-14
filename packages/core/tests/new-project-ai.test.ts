import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWizard, promptsPerTopic, wizardAttributeRequest, wizardCount, wizardRequest, wizardSearches, type WizardInput } from '../lib/new-project-ai.ts';

// Fixtures only: every model answer here is written in this file; nothing paid is called.
const reply = (content: unknown, cost: unknown = 0.004) => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { cost } });
const pt: WizardInput = { brand: 'Acme Seguros', domain: 'acme.com.br', location: 2076, language: 'pt', home: 'Seguro de vida e previdência.' };
const en: WizardInput = { brand: 'Acme', domain: 'acme.com', location: 2840, language: 'en' };

test('each step asks in the project language and market, with the old wizard instructions and a strict schema', () => {
  const competitors = wizardRequest('m', 'competitors', pt);
  assert.deepEqual(competitors.plugins, [{ id: 'web' }], 'competitors search the web');
  assert.equal(competitors.temperature, 0.2);
  assert.match(competitors.messages[1].content, /analista de mercado que mapeia concorrentes diretos/);
  assert.match(competitors.messages[1].content, /aliasDomains deve conter outros domínios oficiais/);
  assert.match(competitors.messages[2].content, /Mercado\/país da marca: Brasil \(pt-BR\)/);
  assert.match(competitors.messages[0].content, /<home>\nSeguro de vida e previdência\.\n<\/home>/);
  assert.equal(competitors.response_format.json_schema.strict, true);
  assert.deepEqual(competitors.reasoning, { effort: 'low' });
  const topics = wizardRequest('m', 'topics', en);
  assert.equal(topics.plugins, undefined, 'topics answer from the site, no web search');
  assert.match(topics.messages[0].content, /Mercado e idioma: Estados Unidos \(en\)/);
  assert.match(topics.messages[0].content, /Home indisponível/);
  const prompts = wizardRequest('m', 'prompts', { ...en, topics: [{ name: 'CRM software', keyword: 'crm software', seed: 'What are the best CRM tools?' }] });
  assert.match(prompts.messages[1].content, /Gerar exatamente 20 prompts transacionais em inglês/);
  assert.match(prompts.messages[1].content, /cobrir melhor, maior e best value/);
  assert.match(prompts.messages[2].content, /- t1: tópico "CRM software"; palavra-chave principal: "crm software"; limite: gerar somente prompts dentro deste tópico; promptSeed preferencial: "What are the best CRM tools\?"/);
  // Portugal's market writes European Portuguese.
  assert.match(wizardRequest('m', 'prompts', { ...pt, location: 2620, topics: [{ name: 'Seguros' }] }).messages[1].content, /português de Portugal/);
  // No brand is written into the instructions but the one asked about (the old few-shot examples named real brands).
  for (const request of [competitors, topics, prompts]) for (const message of request.messages) assert.doesNotMatch(message.content, /Conversion|Icatu|Webmotors|Mestre/);
});

test('the steps share their opening word for word (the providers cache it); the quick pass of competitors searches nothing', () => {
  const input = { ...pt, topics: [{ name: 'Seguros' }] };
  const roots = (['competitors', 'topics', 'prompts'] as const).map((step) => wizardRequest('m', step, input).messages[0]);
  assert.equal(new Set(roots.map((message) => JSON.stringify(message))).size, 1);
  assert.equal(roots[0].role, 'system');
  assert.match(roots[0].content, /^Marca analisada: Acme Seguros\nDomínio: acme\.com\.br\nMercado e idioma: Brasil \(pt-BR\)/);
  const quick = wizardRequest('m', 'competitors', { ...pt, quick: true });
  assert.equal(quick.plugins, undefined);
  assert.deepEqual(quick.reasoning, { effort: 'minimal' });
  assert.match(quick.messages[2].content, /sem busca na web/);
  // The quick pass writes no description (never shown); the searched one keeps it.
  assert.doesNotMatch(quick.messages[2].content, /description/);
  assert.equal((quick.response_format.json_schema.schema as { properties: { competitors: { items: { properties: Record<string, unknown> } } } }).properties.competitors.items.properties.description, undefined);
  assert.match(wizardRequest('m', 'competitors', pt).messages[2].content, /- description:/);
  assert.deepEqual(quick.messages[0], roots[0]);
  assert.equal(promptsPerTopic(3), 20);
  assert.equal(wizardCount('prompts', { ...en, topics: Array(5).fill({ name: 'x' }) }), 50);
});

test('competitors: never the brand or its domain, each with its own domain, no repeats, by competition score', () => {
  const { suggestions, cost } = parseWizard('competitors', reply({
    competitors: [
      { name: 'Beta', domain: 'https://www.beta.com.br/sobre', description: null, competitionScore: 70, aliases: ['Beta Seguros', 'beta', 'Acme Seguros'], aliasDomains: ['beta.com', 'https://beta.com/', 'acme.com.br', 'gamma.com', 'beta.com.br', 'not a domain'] },
      { name: 'Gamma', domain: 'gamma.com', description: 'x', competitionScore: 95, aliases: [], aliasDomains: ['gamma.com.br'] },
      { name: 'Acme Seguros', domain: 'acme.com.br', description: null, competitionScore: 99, aliases: [] },
      { name: 'Delta', domain: null, description: null, competitionScore: 90, aliases: [] },
      { name: 'Gamma Brasil', domain: 'gamma.com', description: null, competitionScore: 60, aliases: [] },
      { name: 'Known', domain: 'known.com', description: null, competitionScore: 80, aliases: [] },
    ],
  }), { ...pt, competitors: ['known'] });
  assert.equal(cost, 0.004);
  assert.deepEqual(suggestions, {
    competitors: [
      // Other domains: never the brand's, another competitor's, its own main one, a repeat or not a domain.
      { name: 'Gamma', domain: 'gamma.com', aliases: [], domains: ['gamma.com.br'] },
      { name: 'Beta', domain: 'beta.com.br', aliases: ['Beta Seguros'], domains: ['beta.com'] },
    ],
  });
});

test('topics: at most 40 characters, never naming the brand, no repeats, by relevance; the seed kept for the prompts', () => {
  const { suggestions } = parseWizard('topics', reply('```json\n' + JSON.stringify({
    topics: [
      { name: 'Previdência Privada', primaryKeyword: 'previdência privada', promptSeed: 'Quais instituições oferecem os melhores planos?', intent: 'comparative', relevanceScore: 80, evidence: [] },
      { name: 'Seguro de Vida', primaryKeyword: 'seguro de vida', promptSeed: null, intent: null, relevanceScore: 98, evidence: [] },
      { name: 'Seguro de vida', primaryKeyword: 'seguro vida', promptSeed: null, intent: null, relevanceScore: 50, evidence: [] },
      { name: 'Acme Seguros Empresarial', primaryKeyword: 'x', promptSeed: null, intent: null, relevanceScore: 99, evidence: [] },
      { name: 'Um tópico com um nome longo demais para o campo', primaryKeyword: 'x', promptSeed: null, intent: null, relevanceScore: 97, evidence: [] },
    ],
  }) + '\n```'), pt);
  assert.deepEqual(suggestions, {
    topics: [
      { name: 'Seguro de Vida', keyword: 'seguro de vida', seed: null },
      { name: 'Previdência Privada', keyword: 'previdência privada', seed: 'Quais instituições oferecem os melhores planos?' },
    ],
  });
});

test('prompts: only within an asked topic, never naming the brand, no repeats, the best first', () => {
  const input = { ...en, topics: [{ name: 'CRM software' }, { name: 'Help desk' }] };
  const { suggestions } = parseWizard('prompts', reply({
    detectedContext: null,
    suggestions: [
      { prompt: '1. "Which CRM software is best for small teams?"', topicId: 't1', relevanceScore: 70, scoreReason: null },
      { prompt: 'What is the best CRM software?', topicId: 't1', relevanceScore: 99, scoreReason: 'broad' },
      { prompt: 'Is Acme a good CRM software?', topicId: 't1', relevanceScore: 98, scoreReason: null },
      { prompt: 'What is the best help desk tool?', topicId: 't2', relevanceScore: 90, scoreReason: null },
      { prompt: 'What is the best CRM software?', topicId: 't2', relevanceScore: 60, scoreReason: null },
      { prompt: 'Which payroll tools are best?', topicId: 't9', relevanceScore: 95, scoreReason: null },
      { prompt: 'Short?', topicId: 't1', relevanceScore: 94, scoreReason: null },
    ],
  }), input);
  assert.deepEqual(suggestions, {
    prompts: [
      { text: 'What is the best CRM software?', topic: 'CRM software', score: 99 },
      { text: 'What is the best help desk tool?', topic: 'Help desk', score: 90 },
      { text: 'Which CRM software is best for small teams?', topic: 'CRM software', score: 70 },
    ],
  });
});

test('an answer that is not the asked JSON, or with nothing usable, is an error: no template stands in', () => {
  assert.throws(() => parseWizard('topics', reply('Sorry, I cannot help with that.'), en), /not JSON/);
  assert.throws(() => parseWizard('competitors', reply({ competitors: [{ name: 'Acme', domain: 'acme.com', competitionScore: 90, aliases: [] }] }), en), /no usable competitors/);
  assert.throws(() => parseWizard('prompts', reply({ detectedContext: null, suggestions: [] }), { ...en, topics: [{ name: 'CRM' }] }), /no usable prompts/);
  assert.throws(() => parseWizard('topics', reply({ topics: [] }, -1), en), /Invalid wizard cost/);
  // A reply without a cost is used; the server keeps its reservation as the cost.
  assert.equal(parseWizard('topics', reply({ topics: [{ name: 'CRM', primaryKeyword: 'crm', promptSeed: null, intent: null, relevanceScore: null, evidence: [] }] }, null), en).cost, null);
});

test('attributes: Settings > Semantic Branding’s request for every brand compared, read by its own rule', () => {
  const sites = [{ name: 'Beta', domain: 'beta.com.br', home: 'Seguros de carro.' }, { name: 'Acme Seguros', domain: 'acme.com.br', home: null }];
  const request = wizardAttributeRequest('m', { ...pt, sites });
  assert.deepEqual(request.plugins, [{ id: 'web' }]);
  assert.equal(wizardSearches('attributes', pt), true);
  assert.match(request.messages[0].content, /- Beta \(beta\.com\.br\)\n- Acme Seguros \(acme\.com\.br\)/);
  assert.match(request.messages[0].content, /### Beta \(beta\.com\.br\)\nSeguros de carro\./);
  assert.match(request.messages[0].content, /País: Brasil/);
  const definition = (word: string) => `${word} mede como cada marca do segmento é percebida neste ponto, com palavras suficientes para a regra de cem a duzentos caracteres.`;
  const { suggestions, cost } = parseWizard('attributes', reply({
    atributos: [
      { nome: 'Preço', definicao: definition('Preço') },
      { nome: 'Beta', definicao: definition('Atendimento') },
      { nome: 'Cobertura', definicao: 'curta' },
      { nome: 'Atendimento', definicao: definition('Atendimento') },
    ],
  }), { ...pt, sites });
  assert.equal(cost, 0.004);
  assert.deepEqual(suggestions, { attributes: [{ name: 'Preço', description: definition('Preço') }, { name: 'Atendimento', description: definition('Atendimento') }] });
  assert.throws(() => parseWizard('attributes', reply({ atributos: [] }), pt), /no usable attributes/);
});
