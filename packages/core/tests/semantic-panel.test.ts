import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_READINGS, OVERVIEW_GROUP, PANEL_ENGINES, RANK_GAP, SCORE_BANDS, anchorReadings, brandMatcher, evidenceList, isFact, isQuote, panelGroups, panelModel, panelRequest, parsePanelReply, periodStart, readableQuestion, runOrder, shuffled, unlabeled, weekStart } from '../lib/semantic-panel.ts';
import { OVERVIEW_READER_MODEL, overviewNotes, overviewReading, panelCall, readOverview, readOverviewOnce, readPanelTask, readingKey, taskCost } from '../lib/semantic-panel-provider.ts';
import { plainAnswer } from '../lib/semantic-perception.ts';

const brands = [{ name: 'Netflix', domain: 'netflix.com' }, { name: 'Disney+', domain: 'disneyplus.com' }];
const attributes = [{ id: 'value', name: 'Value for money', description: 'Price compared with catalog.' }, { id: 'films', name: 'Film selection' }];

test('Semantic Branding asks every AI (8/11/2026); Claude and Perplexity the way their daily collection does: Claude on the Standard queue, Perplexity Live', () => {
  assert.deepEqual([...PANEL_ENGINES], ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode', 'google_ai_overviews']);
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  const claude = panelCall('claude', request, { day: 'd', language: 'en', location: 2840 })!;
  // The collection's request: the model with reasoning and the web search it decides to use, the collection's model (or the one given).
  // Claude's answer with reasoning and search can outlast a Live call's wait: the Standard queue keeps the task id and reads it later.
  assert.equal(claude.path, 'ai_optimization/claude/llm_responses/task_post');
  assert.equal(claude.live, false);
  assert.equal(claude.resultPath('t1'), 'ai_optimization/claude/llm_responses/task_get/t1');
  assert.deepEqual([claude.payload.model_name, claude.payload.web_search, claude.payload.use_reasoning, claude.payload.force_web_search], ['claude-sonnet-5', true, undefined, undefined]);
  assert.equal(claude.payload.system_message, 'Answer in English.');
  assert.equal(panelCall('claude', request, { day: 'd', language: 'en', location: 2840, model: 'claude-opus-5' })!.payload.model_name, 'claude-opus-5');
  const sonar = panelCall('perplexity', request, { day: 'd', language: 'pt', location: 2076 })!;
  assert.deepEqual([sonar.payload.model_name, sonar.payload.web_search_country_iso_code, sonar.payload.system_message], ['sonar', 'BR', 'Responda em português.']);
  // The whole question as a chain of messages of at most 500 characters that alternate user and ai (Perplexity requires it), at most 10.
  for (const call of [claude, sonar]) {
    const chain = call.payload.message_chain as { role: string; message: string }[];
    // Perplexity's alternate user and ai (it requires it); Claude's go one after another.
    const alternate = call === sonar;
    assert.ok(chain.length <= 10 && chain.every((message, at) => message.role === (alternate && at % 2 ? 'ai' : 'user') && message.message.length <= 500), JSON.stringify(chain.map((m) => m.role)));
    assert.ok(String(call.payload.user_prompt).length <= 500 && Number(call.payload.max_output_tokens) <= 4096);
  }
  assert.equal(claude.question, request.prompt);
  // The model's worst case and the readings: a few tenths of a dollar at most.
  assert.ok(claude.reserve > 0.1 && claude.reserve < 0.5 && sonar.reserve > 0.1 && sonar.reserve < 0.5, `${claude.reserve} ${sonar.reserve}`);
  assert.equal(panelModel('claude', 0, 'claude-sonnet-5'), 'claude-sonnet-5');
  // A big roster (11 brands by 6 attributes) asks for brief notes, with every rule of the task: its explained notes would pass the output cap.
  const big = panelRequest(Array.from({ length: 11 }, (_, at) => ({ name: `B${at}`, domain: `b${at}.com` })), Array.from({ length: 6 }, (_, at) => ({ id: `a${at}`, name: `A${at}` })), 'x', 'en');
  const bigText = big.chain()!.message_chain.map((message) => message.message).join('');
  assert.match(bigText, /^Rate how strongly/);
  assert.match(bigText, /FIRST rank the brands listed[^]*A brand you know little about, or without a concrete checkable fact[^]*scores 59 or less, never a middle score[^]*no reason; evidence with 1 fact of that attribute in at most 10 words \(never the score or band\), empty only below 60/);
});

test('a Portuguese roster of little-known brands asks Claude for every score with every rule, and its refusal is retried, not a zero (8/11/2026)', () => {
  // The shape of the round that failed: 7 Brazilian agencies by 6 attributes with long definitions, in Portuguese. Claude, told by the
  // collection to assess only what it is sure of, got the bare short form ("Dê de 0 a 100...", no rule to always score) and answered prose.
  const agencies = ['Alfa SEO', 'Beta Busca', 'Gama Conteúdo', 'Delta Digital', 'Épsilon Web', 'Zeta Links', 'Eta Agência'].map((name, at) => ({ name, domain: `agencia${at}.com.br` }));
  const traits = ['Expertise', 'GEO', 'Conteúdo', 'Autoridade', 'Conversão', 'Atendimento'].map((name, at) => ({ id: `t${at}`, name, description: `Definição neutra do atributo ${name}, com o que um comprador compara entre agências de SEO no Brasil, em auditorias, conteúdo e resultados de busca e de IA.` }));
  const request = panelRequest(agencies, traits, 'agência de SEO', 'pt');
  const claude = panelCall('claude', request, { day: 'd', language: 'pt', location: 2076 })!;
  const asked = (claude.payload.message_chain as { role: string; message: string }[]).map((message) => message.message).join('');
  assert.doesNotMatch(asked, /^Dê de 0 a 100/);
  assert.match(asked, /PRIMEIRO ordene as marcas listadas[^]*DEPOIS dê a cada uma a faixa e a nota de 0 a 100/);
  assert.match(asked, /Marca que você conhece pouco, ou sem fato concreto e verificável desse atributo[^]*fica em 59 ou menos, nunca numa nota média/);
  assert.match(asked, /sem reason; evidence com 1 fato desse atributo em até 10 palavras \(nunca a nota ou a faixa\), vazia só abaixo de 60/);
  // The definitions go too (Claude takes up to ten messages in a row), and every message is within the provider's limits.
  assert.match(asked, /Definição neutra do atributo Atendimento/);
  assert.ok((claude.payload.message_chain as unknown[]).length <= 10);
  // The collection's message (8/11/2026: only the language, Claude searching when it decides, as the daily collection asks it).
  assert.equal(claude.payload.system_message, 'Responda em português.');
  assert.equal(claude.payload.web_search, true);
  // Perplexity alternates, so it may take the names only; it still gets every rule.
  const sonar = (panelCall('perplexity', request, { day: 'd', language: 'pt', location: 2076 })!.payload.message_chain as { message: string }[]).map((message) => message.message).join('');
  assert.match(sonar, /nunca numa nota média/);
  // The brief notes parse; the refusal has none (the reading finds none either), so the query fails and is retried.
  const brief = JSON.stringify({ brands: agencies.map((brand) => ({ brand: brand.name, attributes: traits.map((trait) => ({ id: trait.id, score: 55, reason: 'pouco conhecida' })) })) });
  assert.equal(parsePanelReply(brief, agencies, traits).length, agencies.length * traits.length);
  const refusal = 'Não tenho dados verificáveis sobre essas agências nesses atributos; qualquer nota seria uma estimativa sem base. Posso sugerir critérios objetivos.';
  const task = { status_code: 20000, cost: 0.007, result: [{ items: [{ type: 'message', sections: [{ type: 'text', text: refusal }] }] }] };
  assert.equal(readPanelTask(task, { engine: 'claude' }, agencies, traits).status, 'unread');
});

test('AI Overviews is asked once per group of at most five brands, with every attribute, so every brand is in a search (8/11/2026)', () => {
  const many = Array.from({ length: 11 }, (_, at) => ({ name: `B${at}`, domain: `b${at}.com` }));
  const groups = panelGroups('google_ai_overviews', many);
  assert.deepEqual(groups.map((group) => group.length), [4, 3, 4]);
  assert.deepEqual(groups.flat(), many);
  assert.ok(groups.every((group) => group.length <= OVERVIEW_GROUP));
  assert.deepEqual(panelGroups('gemini', many), [many]);
  // AI Mode and ChatGPT too, asked the same natural search since 12/11/2026.
  assert.deepEqual(panelGroups('google_ai_mode', many), groups);
  assert.deepEqual(panelGroups('chat_gpt', many), groups);
  assert.deepEqual(panelGroups('google_ai_overviews', many.slice(0, 5)), [many.slice(0, 5)]);
  assert.deepEqual([0, 1, 2].map((at) => panelModel('google_ai_overviews', at)), ['google_ai_overviews', 'google_ai_overviews:2', 'google_ai_overviews:3']);
  const six = Array.from({ length: 6 }, (_, at) => ({ id: `a${at}`, name: `Attribute ${at}` }));
  assert.equal(panelRequest(groups[1]!, six, 'phones', 'en').overview, 'B4 vs B5 vs B6 phones: Attribute 0, Attribute 1, Attribute 2, Attribute 3, Attribute 4, Attribute 5');
});

test('an answer in prose is read whole, clean of links, in as many readings as it needs (until 8/11/2026 the reader saw a third to three quarters)', async () => {
  // The shape of a recorded AI Overview: sections per attribute, Markdown links and citation marks, about 7,000 characters.
  const section = (name: string) => `### ${name}\n\n- **Netflix** [Netflix](https://www.netflix.com/): ${'strong library of originals and films for every taste. '.repeat(12)}[[1]](https://www.example.com/review?utm=${name})\n- **Disney+** [Disney+](https://www.disneyplus.com/): ${'family catalog with Pixar and Marvel titles across plans. '.repeat(12)}[[2]](https://www.example.com/compare)\n\n`;
  const answer = section('Value for money') + section('Film selection') + section('Series');
  assert.ok(answer.length > 4500 && plainAnswer(answer).length < answer.length);
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  const calls = request.readings(plainAnswer(answer));
  assert.ok(calls.length > 1 && calls.length <= MAX_READINGS);
  // Every character of the clean text is read, once, in order; each call stays within the provider's limits.
  const read = calls.flatMap((call) => call.message_chain.filter((message) => message.message.startsWith('TEXT ')).map((message) => message.message.slice(5))).join('');
  assert.equal(read, plainAnswer(answer).trim());
  assert.ok(calls.every((call) => call.message_chain.length <= 10 && call.message_chain.every((message) => message.message.length <= 500)));
  // Each reading's notes join (the first of a pair stays); a lost reply counts its reserve and stops.
  const sent: unknown[] = [];
  const quoted = (score: number) => ({ score, evidence: 'the "largest catalog" of films' });
  const replies = [{ Netflix: { value: quoted(80) } }, { Netflix: { value: quoted(10), films: quoted(75) }, 'Disney+': { films: 70 } }, {}];
  const send = async (_path: string, payload?: unknown) => {
    sent.push(payload);
    return [{ status_code: 20000, cost: 0.01, result: [{ money_spent: 0.009, items: [{ type: 'message', sections: [{ type: 'text', text: JSON.stringify(replies[sent.length - 1]) }] }] }] }];
  };
  const overview = { status: 'unread' as const, answer, sources: [], model: 'google_ai_overviews' };
  const done = await readOverview(overview, request, brands, attributes, send);
  assert.equal(sent.length, calls.length);
  // A note of 60 or more without a quote of the text is capped at 59 (the reader asks one), keeping the reader's own score.
  assert.deepEqual(done.outcome.status === 'completed' && done.outcome.readings.map((note) => [note.brand, note.attribute, note.score, note.raw]), [['Netflix', 'value', 80, undefined], ['Netflix', 'films', 75, undefined], ['Disney+', 'films', 59, 70]]);
  // A Live task's cost already includes what the model spent: not added twice.
  assert.equal(Number(done.cost.toFixed(6)), Number((0.01 * calls.length).toFixed(6)));
  assert.equal(taskCost({ cost: 0.01, result: [{ money_spent: 0.009 }] }), 0.01);
  // Fewer readings when the query reserved fewer.
  sent.length = 0;
  await readOverview(overview, request, brands, attributes, send, 1);
  assert.equal(sent.length, 1);
});

test('a reader\'s 0 ("does not cover this attribute") is absent, and the run of the text that covers the pair gives its note (12/11/2026, AI Mode)', async () => {
  // The shape of production's AI Mode answer of 12/11/2026 (Netflix demo): numbered sections, the family one past the first run of text.
  const part = (n: number, name: string, text: string) => `${n}. ${name}\n- Netflix: ${text}\n- Disney+: ${text}\n`;
  const answer = [part(1, 'Pricing & Plans', 'tiers that scale up for 4K and no ads. '.repeat(15)), part(2, 'Films', 'a wide catalog of films. '.repeat(100)),
    part(6, 'Family & Sharing Rules', 'kids profiles and parental controls on every plan. '.repeat(6))].join('\n');
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  assert.ok(request.readings(plainAnswer(answer)).length >= 2);
  const fact = (score: number) => ({ score, reason: 'covered', evidence: 'the "largest catalog" of films' });
  const none = { score: 0, reason: 'Does not cover this attribute', evidence: '' };
  // The reader's reply, as recorded: run 1 marks the pair it did not see with 0, run 2 (the family section) scores it.
  const replies = [
    { brands: [{ brand: 'Netflix', attributes: [{ id: 'value', score: 70, evidence: 'tiers that scale up for 4K and no ads' }, { id: 'films', ...none }] }, { brand: 'Disney+', attributes: [{ id: 'films', ...none }] }] },
    { brands: [{ brand: 'Netflix', attributes: [{ id: 'films', ...fact(78) }] }, { brand: 'Disney+', attributes: [{ id: 'films', ...none }] }] },
    { brands: [] },
  ];
  let at = 0;
  const send = async () => [{ status_code: 20000, cost: 0.01, result: [{ items: [{ type: 'message', sections: [{ type: 'text', text: JSON.stringify(replies[at++] ?? {}) }] }] }] }];
  const done = await readOverview({ status: 'unread', answer, sources: [], model: 'google_ai_mode' }, request, brands, attributes, send);
  assert.equal(done.outcome.status, 'completed');
  const notes = done.outcome.status === 'completed' ? done.outcome.readings.map((note) => [note.brand, note.attribute, note.score]) : [];
  // Netflix's films note comes from the run that covers it; Disney+'s films stays absent (no 0), never a zero.
  assert.deepEqual(notes, [['Netflix', 'value', 70], ['Netflix', 'films', 78]]);
});

test('an answer in prose is read by a decision model: a closed question per brand and attribute, rules first and text last, absent never zero (8/11/2026)', async () => {
  const answer = `### Value for money\n\n- **Netflix** [Netflix](https://www.netflix.com/): ${'strong library of originals. '.repeat(20)}\n- **Disney+**: family catalog.`;
  const payload = overviewReading(answer, brands, attributes);
  assert.equal(payload.model, OVERVIEW_READER_MODEL);
  assert.ok(OVERVIEW_READER_MODEL.startsWith('liquid/') || OVERVIEW_READER_MODEL.startsWith('typesafe/'), 'a decision model');
  assert.deepEqual(Object.keys(payload.state), ['rules', 'attributes', 'brands', 'text'], 'the fixed rules first, the text last');
  assert.ok(!payload.state.text.includes('https://') && payload.state.text.includes('Disney+'));
  assert.deepEqual(Object.keys(payload.questions), ['b0_a0', 'b0_a1', 'b1_a0', 'b1_a1']);
  assert.deepEqual(Object.keys(payload.questions.b0_a0!.criteria), ['absent', 'weak', 'well', 'fully', 'excellence']);
  // The labels are the bands of the one scale, each defined by what the text says (9/11/2026).
  assert.match(payload.questions.b0_a0!.criteria.excellence!, /THE leader, the best or the reference of the category/);
  assert.match(payload.questions.b0_a0!.criteria.absent!, /^The text says nothing about how this brand does on this attribute/);
  const odds = (p: Record<string, number>) => ({ type: 'choice', choice: Object.entries(p).sort((x, y) => y[1] - x[1])[0]![0], probabilities: p });
  const raw = {
    answers: {
      b0_a0: odds({ absent: 0.05, weak: 0, well: 0.05, fully: 0.4, excellence: 0.5 }),
      b0_a1: odds({ absent: 0.7, weak: 0, well: 0.1, fully: 0.2, excellence: 0 }),
      b1_a0: { type: 'choice', choice: 'well' },
      b1_a1: { type: 'choice', choice: 'invented' },
    },
    usage: { cost: 0.0003 },
  };
  // Expected note of the labels other than absent; absent when it is the likeliest (at least half); an unknown label is absent.
  assert.deepEqual(overviewNotes(raw, brands, attributes).map((note) => [note.brand, note.attribute, note.score]), [['Netflix', 'value', 85], ['Disney+', 'value', 70]]);
  const overview = { status: 'unread' as const, answer, sources: [], model: 'google_ai_overviews' };
  const asked: unknown[] = [];
  const done = await readOverviewOnce(overview, brands, attributes, async (sent) => { asked.push(sent); return raw; }, 'liquid/d1-ultra');
  assert.equal(asked.length, 1);
  assert.equal(done.cost, 0.0003);
  // The decision model writes no quote and its label is the judgment of the text: its notes keep their band (13/11/2026; from 10/11 the
  // missing quote put every one of them at 59 or below, three bands into one value).
  assert.deepEqual(done.outcome.status === 'completed' && done.outcome.readings.map((note) => [note.score, note.raw]), [[85, undefined], [70, undefined]]);
  // No cost reported: the reserve counts. A lost reply that may have been billed: the reserve. A refusal: what it said it spent.
  assert.equal((await readOverviewOnce(overview, brands, attributes, async () => ({ answers: {} }), 'm', 0.02)).cost, 0.02);
  const lost = await readOverviewOnce(overview, brands, attributes, async () => { throw Object.assign(new Error('timeout'), { unknown: true }); }, 'm', 0.02);
  assert.deepEqual([lost.outcome.status, lost.cost], ['failed', 0.02]);
  const refused = await readOverviewOnce(overview, brands, attributes, async () => { throw Object.assign(new Error('HTTP 400'), { unknown: false, cost: 0 }); }, 'm', 0.02);
  assert.deepEqual([refused.outcome.status, refused.cost, refused.outcome.status === 'failed' && refused.outcome.answer], ['failed', 0, answer]);
});

test('one question covers all brands and attributes with their whole definitions, the Brand-Attribute-Score way', () => {
  const definition = 'How the monthly price compares with the size and quality of the catalog offered, across plans and the usual promotions.';
  const request = panelRequest(brands, [{ ...attributes[0]!, description: definition }, attributes[1]!], 'streaming', 'en');
  assert.ok(request.prompt!.includes('Disney+ (disneyplus.com)'));
  assert.ok(request.text.includes('films = Film selection'));
  // The definition goes whole (no 80-character cut).
  assert.ok(request.text.includes(`value = Value for money, ${definition}`));
  assert.match(request.prompt!, /from independent sources/);
  assert.match(request.prompt!, /never from what the brand says of itself/);
  assert.match(request.prompt!, /reason in at most 12 words/);
  // Every note is asked for; facts only when sure, never guessed. No familiarity any more (it was for the pure models).
  assert.match(request.prompt!, /scores 59 or less, never a middle score/);
  assert.match(request.prompt!, /up to 2 concrete facts of that attribute you are sure of \(never the score, the band or praise\), each with its source in parentheses when you know it, empty only below 60\. Never invent facts\./);
  assert.doesNotMatch(request.prompt!, /familiarity|score null|I don't know/);
  // An answer stored with a familiarity (6/11/2026) still reads its notes; a note stored as "I don't know" (score null) stays absent.
  const notes = parsePanelReply(JSON.stringify({ brands: [{ brand: 'Netflix', familiarity: 'low', attributes: [{ id: 'value', score: 35, reason: 'Little known.', evidence: [] }] }] }), brands, attributes);
  assert.deepEqual(notes, [{ brand: 'Netflix', attribute: 'value', score: 35, reason: 'Little known.', evidence: [] }]);
  assert.equal(parsePanelReply(JSON.stringify({ brands: [{ brand: 'Netflix', attributes: [{ id: 'value', score: null, justification: "I don't know" }, { id: 'films', score: 70 }] }] }), brands, attributes).map((note) => note.attribute).join(), 'films');
  assert.ok(request.keyword && request.keyword.length <= 700 && request.keyword.includes('Disney+') && request.keyword.includes('films=Film selection'));
  // Nothing tells the AI which brand is the client's or the main one.
  assert.doesNotMatch(JSON.stringify(request), /your brand|sua marca|client|main brand|marca principal/i);
});

test('every question and the reader carry the one scale (8/11/2026): 0-59 weakly, 60-79 well, 80-89 fully perceived, 90+ excellence', () => {
  assert.deepEqual(SCORE_BANDS.map((band) => [band.min, band.max]), [[0, 59], [60, 79], [80, 89], [90, 100]]);
  for (const [language, full, short] of [
    // the owner's words for each band (13/11/2026), verbatim.
    ['en', /0-59 the attribute is weakly perceived by the market; 60-79 well perceived; 80-89 fully perceived, with good quality; 90-100 fully recognised by the market as THE reference for excellence/, /0-59 weakly perceived, 60-79 well perceived, 80-89 fully perceived, 90-100 only the one reference for excellence/],
    ['pt', /0-59 atributo pouco percebido pelo mercado; 60-79 bem percebido; 80-89 totalmente percebido, com boa qualidade; 90-100 totalmente reconhecido pelo mercado como A referência em excelência/, /0-59 pouco percebido, 60-79 bem percebido, 80-89 totalmente percebido, 90-100 só a única referência em excelência/],
  ] as const) {
    const request = panelRequest(brands, attributes, 'streaming', language);
    assert.match(request.prompt!, full);
    assert.match(request.chain()!.message_chain.map((message) => message.message).join(''), full);
    assert.match(request.keyword!, short);
    const [reading] = request.readings('Netflix has the best films.');
    assert.match(reading!.system_message, short);
    assert.ok(reading!.system_message.length <= 500);
    // The old anchors (50 mixed, 100 very strong) are gone everywhere.
    assert.doesNotMatch(JSON.stringify([request.prompt, request.keyword, reading]), /50 mixed|50 mista|100 very strong|100 muito forte/);
  }
  // A keyword the scale would push past 700 characters is asked bare rather than not at all.
  const many = Array.from({ length: 48 }, (_, at) => ({ name: `Brand ${at}`, domain: `b${at}.com` }));
  const bare = panelRequest(many, attributes, 'streaming', 'en').keyword;
  assert.ok(bare && bare.length <= 700 && !bare.includes('excellence'), bare ?? 'null');
});

test('every way of asking anchors the scale (9/11/2026): band first, 60+ only with a fact of that attribute, little known below 60 but scored, 90+ one brand per attribute', () => {
  const agencies = ['Alfa SEO', 'Beta Busca', 'Gama Conteúdo', 'Delta Digital', 'Épsilon Web', 'Zeta Links', 'Eta Agência'].map((name, at) => ({ name, domain: `agencia${at}.com.br` }));
  const traits = ['Expertise', 'GEO', 'Conteúdo', 'Autoridade', 'Conversão', 'Atendimento'].map((name, at) => ({ id: `t${at}`, name, description: `Definição neutra do atributo ${name}, com o que um comprador compara entre agências.` }));
  // The comparative scale (13/11/2026): rank first, the owner's bands, generic anchors, little known or no fact below 60 (never a middle score),
  // 90+ one brand, consecutive ranks RANK_GAP apart, be critical.
  const rules = {
    en: [/Be critical: most brands are not references/, /For every attribute, FIRST rank the brands listed from the strongest association to the weakest \(rank 1 = strongest; the same rank only for brands you cannot tell apart\), THEN give each its band and score from 0 to 100/, /Anchors: 50 the market rarely links the brand to it, or you know little of it; 70 [^]*; 85 [^]*with a fact that sets it apart; 95 the brand the category measures itself against/, /without a concrete checkable fact of that attribute \(award, ranking, number, case, review, article; a fact of another attribute or a generic phrase does not count\), scores 59 or less, never a middle score/, /90 or more for one brand per attribute at most, only the reference/, new RegExp(`Consecutive ranks differ by at least ${RANK_GAP} points`)],
    pt: [/Seja crítico: a maioria das marcas não é referência/, /Para cada atributo, PRIMEIRO ordene as marcas listadas da associação mais forte à mais fraca \(rank 1 = mais forte; o mesmo rank só para marcas que você não distingue\), DEPOIS dê a cada uma a faixa e a nota de 0 a 100/, /Âncoras: 50 o mercado raramente liga a marca a ele, ou você sabe pouco dela; 70 [^]*; 85 [^]*com fato que a destaca; 95 a marca pela qual a categoria se mede/, /sem fato concreto e verificável desse atributo \(prêmio, ranking, número, case, avaliação, matéria; fato de outro atributo ou frase genérica não vale\), fica em 59 ou menos, nunca numa nota média/, /90 ou mais para uma marca por atributo no máximo, só a referência/, new RegExp(`Ranks consecutivos diferem em pelo menos ${RANK_GAP} pontos`)],
  };
  const keyword = { en: /60\+ only with a checkable fact of the attribute, else 59 or less, 80\+ only if it stands out in the category, 90\+ one brand per attribute, ranks 5\+ points apart/, pt: /60\+ só com fato verificável do atributo, senão até 59, 80\+ só se destaca da categoria, 90\+ só uma marca por atributo, ranks com 5\+ pontos de diferença/ };
  const reader = { en: /Per attribute rank the brands as TEXT favours them \(1 = first\), then band and score[^]*Ranks 5\+ points apart; 90\+ only the brand TEXT calls the leader/, pt: /Por atributo, ordene as marcas como TEXT as favorece \(1 = primeira\), depois faixa e nota[^]*Ranks 5\+ pontos de diferença; 90\+ só a marca que TEXT chama de líder/ };
  // What the text must say for each band: a description of what a brand offers is not "fully perceived" (10/11/2026); a drawback is below 60 (13/11/2026).
  const readerBands = { en: /does, offers or says of itself is 60-79 at most; 80\+ only if TEXT singles it out on that attribute against the others; 90\+ only if TEXT calls it the leader or reference; a drawback, or behind the others, below 60\. Brands TEXT treats alike share a rank/, pt: /faz, oferece ou diz de si vale 60-79 no máximo; 80\+ só se TEXT a destaca nesse atributo frente às outras; 90\+ só se TEXT a chama de líder ou referência; desvantagem, ou atrás das outras, abaixo de 60\. Marcas que TEXT trata igual dividem o rank/ };
  for (const language of ['en', 'pt'] as const) {
    for (const [roster, traitsOf] of [[brands, attributes], [agencies, traits]] as const) {
      const request = panelRequest(roster, traitsOf, 'x', language);
      const said = (chain: ReturnType<typeof request.chain>) => chain!.message_chain.filter((message) => message.role === 'user').map((message) => message.message).join('');
      // The full task (ChatGPT, Gemini, Claude) and the brief one (Perplexity's alternating chain of a big roster) carry every rule.
      for (const text of [request.prompt!, said(request.chain()), said(request.chain({ alternate: true }))]) for (const rule of rules[language]) assert.match(text, rule);
      assert.ok(request.prompt!.length <= 2000);
      for (const alternate of [false, true]) {
        const chain = request.chain({ alternate })!;
        assert.ok(chain.message_chain.length <= 10 && chain.message_chain.every((message) => message.message.length <= 500) && chain.user_prompt.length <= 500);
      }
      // The band comes before the score in the notes asked for.
      assert.match(request.prompt!, /"band":"[^"]+","score":0/);
      const [read] = request.readings('Alfa SEO has the best audits.');
      assert.match(read!.system_message, reader[language]);
      assert.ok(read!.system_message.length <= 500, String(read!.system_message.length));
      assert.match(read!.user_prompt, readerBands[language]);
      assert.ok(read!.user_prompt.length <= 500, String(read!.user_prompt.length));
      // Every way of asking asks a fact with each note (10/11/2026): the full task, the brief notes, the keyword and the reader.
      for (const text of [read!.system_message, request.prompt!, said(request.chain())]) assert.match(text, /"evidence":/);
    }
    const small = panelRequest(brands, attributes, 'streaming', language);
    assert.match(small.keyword!, keyword[language]);
    assert.ok(small.keyword!.length <= 700 && /\[(?:score|nota),"(?:fact, not the score|fato, não a nota)",rank\]/.test(small.keyword!), small.keyword!);
    // The never-without-a-score wording is gone: a little-known brand is still scored, below 60.
    assert.doesNotMatch(small.prompt!, /never leave a brand without a score|nunca deixe uma marca sem nota/);
  }
  // The brief notes ask one fact too, and the bare keyword of a roster too big for the scale still asks `[score, "fact"]`.
  const big = panelRequest(Array.from({ length: 11 }, (_, at) => ({ name: `B${at}`, domain: `b${at}.com` })), Array.from({ length: 6 }, (_, at) => ({ id: `a${at}`, name: `A${at}` })), 'x', 'en');
  assert.match(big.chain()!.message_chain.map((message) => message.message).join(''), /"evidence":\[\]/);
  const many = panelRequest(Array.from({ length: 48 }, (_, at) => ({ name: `Brand ${at}`, domain: `b${at}.com` })), attributes, 'x', 'en').keyword!;
  assert.ok(many.length <= 700 && many.includes('[score,"fact, not the score",rank]'), many);
});

test('the comparative scale (13/11/2026): the ranks of one answer space its notes, a clustered answer spreads, the same ranks another day give the same notes', () => {
  // The shape of a Gemini answer of 12/11/2026: six streaming brands within 78-85 on one attribute, every one with a fact.
  const roster = ['Netflix', 'Disney+', 'Max', 'Prime Video', 'Apple TV+', 'Paramount+'].map((name, at) => ({ name, domain: `s${at}.com` }));
  const traits = [{ id: 'originals', name: 'Originals' }, { id: 'value', name: 'Value for money' }];
  const answer = (scores: number[], ranks: number[]) => JSON.stringify({ brands: roster.map((brand, at) => ({ brand: `${brand.name} (${brand.domain})`, attributes: [
    { id: 'originals', rank: ranks[at], band: 'fully', score: scores[at], reason: 'Known originals.', evidence: [`Won ${at + 2} Emmys in 2025 (Variety)`] },
  ] })) });
  const day1 = anchorReadings(parsePanelReply(answer([85, 84, 82, 81, 80, 78], [1, 2, 3, 4, 5, 6]), roster, traits));
  // The AI's own spread was 7 points; ranked, each brand is at least RANK_GAP under the one above it: 25 points over six brands, the order kept.
  assert.deepEqual(day1.map((note) => [note.brand, note.score, note.rank]), [['Netflix', 85, 1], ['Disney+', 80, 2], ['Max', 75, 3], ['Prime Video', 70, 4], ['Apple TV+', 65, 5], ['Paramount+', 60, 6]]);
  assert.equal(day1[0]!.score - day1.at(-1)!.score, RANK_GAP * (roster.length - 1));
  // Another day, the same ranks and the raw scores moved by up to 3 points: the same notes (the gaps settle the numbers under the first).
  const day2 = anchorReadings(parsePanelReply(answer([85, 81, 84, 79, 83, 80], [1, 2, 3, 4, 5, 6]), roster, traits));
  assert.deepEqual(day2.map((note) => note.score), day1.map((note) => note.score));
  // Brands the AI cannot tell apart share a rank and keep their notes; the next rank sits RANK_GAP under the lowest of them.
  const tied = anchorReadings(parsePanelReply(answer([85, 84, 84, 70, 60, 50], [1, 2, 2, 3, 4, 5]), roster, traits));
  assert.deepEqual(tied.map((note) => note.score), [85, 80, 80, 70, 60, 50]);
  // A note ranked above another never rises: only the lower one is capped, and the AI's own score is kept in `raw`.
  assert.deepEqual(day1.map((note) => note.raw), [undefined, 84, 82, 81, 80, 78]);
  // The gaps go on the AI's own scores, then the evidence cap: a rank 1 without a fact goes to 59; rank 2, with its fact, keeps 80.
  const noFact = anchorReadings([
    { brand: 'Netflix', attribute: 'value', score: 86, rank: 1, reason: null, evidence: [] },
    { brand: 'Disney+', attribute: 'value', score: 80, rank: 2, reason: null, evidence: ['US$ 7.99 ads tier'] },
  ]);
  assert.deepEqual(noFact.map((note) => [note.score, note.raw]), [[59, 86], [80, undefined]]);
  // Idempotent; notes without a rank (an answer of before, the keyword without one) are spaced by nothing.
  assert.deepEqual(anchorReadings(day1), day1);
  assert.deepEqual(anchorReadings(parsePanelReply(answer([85, 84, 82, 81, 80, 78], []), roster, traits)).map((note) => note.score), [85, 84, 82, 81, 80, 78]);
  // The bare form carries the rank as the third item: `[score, "fact", rank]`.
  const bare = JSON.stringify({ Netflix: { value: [82, 'US$ 7.99 ads tier (press)', 2] }, 'Disney+': { value: [84, 'Bundle with Hulu at US$ 10.99', 1] } });
  assert.deepEqual(anchorReadings(parsePanelReply(bare, roster, traits)).map((note) => [note.brand, note.score, note.rank, note.evidence.length]), [['Netflix', 79, 2, 1], ['Disney+', 84, 1, 1]]);
});

test('the reader of an answer in prose keeps its quote as the evidence (13/11/2026): a note of 60 or more read from the text is not pulled to 59 for lacking a number', async () => {
  // The shape of the reader's reply on a ChatGPT search: quotes with no number or name, which isFact calls no fact.
  const reply = { brands: [
    { brand: 'Netflix', attributes: [{ id: 'value', rank: 2, band: 'well', score: 70, reason: 'Tiers for every budget.', evidence: 'offers an ad-supported tier that keeps the entry price low' }] },
    { brand: 'Disney+', attributes: [{ id: 'value', rank: 1, band: 'fully', score: 82, reason: 'Bundle praised.', evidence: 'the bundle is repeatedly called the best deal among the services' }] },
  ] };
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  const send = async () => [{ status_code: 20000, cost: 0.01, result: [{ items: [{ type: 'message', sections: [{ type: 'text', text: JSON.stringify(reply) }] }] }] }];
  const read = await readOverview({ status: 'unread', answer: 'Disney+ vs Netflix: value.', sources: [], model: 'chat_gpt' }, request, brands, attributes, send);
  assert.deepEqual(read.outcome.status === 'completed' && read.outcome.readings.map((note) => [note.brand, note.score, note.evidence.length]), [['Netflix', 70, 1], ['Disney+', 82, 1]]);
  // A quote that restates the note or the band is still none, and the note falls below 60.
  const restated = { brands: [{ brand: 'Netflix', attributes: [{ id: 'value', score: 75, evidence: 'Well perceived on value for money' }] }] };
  const again = await readOverview({ status: 'unread', answer: 'Netflix: value.', sources: [], model: 'chat_gpt' }, request, brands, attributes, async () => [{ status_code: 20000, cost: 0.01, result: [{ items: [{ type: 'message', sections: [{ type: 'text', text: JSON.stringify(restated) }] }] }] }]);
  assert.deepEqual(again.outcome.status === 'completed' && again.outcome.readings.map((note) => [note.score, note.evidence]), [[59, []]]);
  for (const text of ['offers an ad-supported tier', 'Score 92 em expertise', 'Zona de excelência em conteúdo', ' ']) assert.equal(isQuote(text), !text.startsWith('Score') && !text.startsWith('Zona') && !!text.trim(), text);
});

test('the anchors cap the notes of one answer as they are recorded: no evidence below 60, one brand at 90+ per attribute, the raw score kept', () => {
  const note = (brand: string, attribute: string, score: number, evidence: string[] = ['Won 3 Emmys']) => ({ brand, attribute, score, reason: null, evidence });
  const answer = [
    note('A', 'value', 95), note('B', 'value', 92), note('C', 'value', 85, []), note('D', 'value', 55, []),
    note('A', 'films', 91), note('B', 'films', 91), note('C', 'films', 90, []),
  ];
  const anchored = anchorReadings(answer);
  assert.deepEqual(anchored.map((reading) => [reading.brand, reading.attribute, reading.score, reading.raw]), [
    // The highest stays; the other 90+ is capped at 89; 60+ without a fact at 59; a note already below 60 is untouched.
    ['A', 'value', 95, undefined], ['B', 'value', 89, 92], ['C', 'value', 59, 85], ['D', 'value', 55, undefined],
    // A tie at the top is no single clear reference: every tied brand goes to 89 (a tie broken by name would favour a spelling).
    ['A', 'films', 89, 91], ['B', 'films', 89, 91], ['C', 'films', 59, 90],
  ]);
  // Idempotent, and the input is not changed (a stored note is never rewritten).
  assert.deepEqual(anchorReadings(anchored), anchored);
  assert.equal(answer[1]!.score, 92);
  // Through the task reader, whatever the question asked (10/11/2026: no evidence, no note above 59, the bare keyword too).
  const full = panelRequest(brands, attributes, 'streaming', 'en');
  const reply = JSON.stringify({ brands: [{ brand: 'Netflix', attributes: [{ id: 'value', band: 'fully', score: 84, reason: 'Known for it.', evidence: [] }, { id: 'films', score: 93, evidence: ['4,000 films'] }] }, { brand: 'Disney+', attributes: [{ id: 'films', score: 96, evidence: ['Pixar'] }] }] });
  const task = { status_code: 20000, result: [{ items: [{ type: 'message', sections: [{ type: 'text', text: reply }] }] }] };
  const read = readPanelTask(task, { engine: 'claude', question: full.prompt! }, brands, attributes);
  assert.deepEqual(read.status === 'completed' && read.readings.map((reading) => [reading.brand, reading.attribute, reading.score]), [['Netflix', 'value', 59], ['Netflix', 'films', 89], ['Disney+', 'films', 96]]);
  const bare = readPanelTask(task, { engine: 'claude', question: full.keyword! }, brands, attributes);
  assert.deepEqual(bare.status === 'completed' && bare.readings.map((reading) => reading.score), [59, 89, 96]);
  // The bare keyword's `[score, "fact"]`: the fact is the note's evidence; a score alone, or with an empty fact, has none and stays below 60.
  const pairs = JSON.stringify({ Netflix: { value: [82, 'US$ 7.99 ads tier (press)'], films: [75, ' '] }, 'Disney+': { films: 70 } });
  assert.deepEqual(anchorReadings(parsePanelReply(pairs, brands, attributes)).map((reading) => [reading.brand, reading.attribute, reading.score, reading.evidence]),
    [['Netflix', 'value', 82, ['US$ 7.99 ads tier (press)']], ['Netflix', 'films', 59, []], ['Disney+', 'films', 59, []]]);
});

test('reading the same prose again for a project has the same key: the roster in any order, links aside; another text, roster or reader is another key', async () => {
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  const text = 'Netflix has the **largest** catalog.[[1]](https://a.com/x?utm=1)';
  const key = await readingKey(text, brands, attributes, request, null);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await readingKey('Netflix has the largest catalog.[[1]](https://b.com/y)', [...brands].reverse(), [...attributes].reverse(), panelRequest([...brands].reverse(), attributes, 'streaming', 'en'), null), key);
  assert.notEqual(await readingKey('Netflix has a large catalog.', brands, attributes, request, null), key);
  assert.notEqual(await readingKey(text, brands.slice(0, 1), attributes, request, null), key);
  assert.notEqual(await readingKey(text, brands, [{ ...attributes[0]!, description: 'Another definition.' }, attributes[1]!], request, null), key);
  assert.notEqual(await readingKey(text, brands, attributes, request, 'liquid/d1-ultra'), key);
  assert.notEqual(await readingKey(text, brands, attributes, panelRequest(brands, attributes, 'streaming', 'pt'), null), key, 'the reader in another language');
});

test('the brands go in the order given, and the second run reverses it', () => {
  const order = shuffled(['a', 'b', 'c', 'd'], () => 0);
  assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(runOrder(order, 1), [...order].reverse());
  assert.deepEqual(runOrder(order, 0), order);
  const reversed = panelRequest([...brands].reverse(), attributes, 'streaming', 'en');
  assert.ok(reversed.text.indexOf('Disney+') < reversed.text.indexOf('Netflix'));
  assert.match(reversed.overview!, /^Disney\+ vs Netflix streaming: Value for money, Film selection$/);
});

test('the question is written in the language of the screen', () => {
  const request = panelRequest(brands, attributes, 'streaming', 'pt');
  assert.match(request.text, /Dê a nota de cada marca em cada atributo/);
  assert.match(request.prompt!, /nunca pelo que a marca diz de si/);
  assert.match(request.prompt!, /nunca numa nota média/);
  assert.match(request.prompt!, /Nunca invente fatos\./);
  assert.match(request.keyword!, /Dê de 0 a 100/);
});

test('a roster too big for an interface is not asked there instead of being cut; each interface goes to the provider queue', () => {
  const many = Array.from({ length: 120 }, (_, at) => ({ name: `Brand number ${at}`, domain: `brand${at}.example.com` }));
  const long = Array.from({ length: 12 }, (_, at) => ({ id: `a${at}`, name: `Attribute ${at}` }));
  const request = panelRequest(many, long, 'x', 'en');
  assert.equal(request.keyword, null);
  assert.equal(panelCall('google_ai_mode', request, { day: '2026-10-31', language: 'en', location: 2076 }), null);
  // The ChatGPT and Gemini interfaces take the whole question up to 2,000 characters, else the short keyword, else nothing.
  assert.equal(request.prompt, null);
  const small = panelRequest(brands, attributes, 'streaming', 'en');
  assert.ok(small.prompt!.length <= 2000 && small.prompt!.includes('Rate how strongly') && small.prompt!.includes('Disney+ (disneyplus.com)'));
  const gemini = panelCall('gemini', small, { day: 'd', language: 'en', location: 2840 })!;
  assert.equal(gemini.question, small.prompt);
  const chat = panelCall('chat_gpt', small, { day: 'd', language: 'en', location: 2840 })!;
  // ChatGPT gets the natural search since 12/11/2026: asked the scoring task in JSON it searched but cited no source.
  assert.equal(chat.question, small.overview);
  assert.match(chat.path, /chat_gpt\/llm_scraper\/task_post$/);
  assert.match(chat.resultPath('t1'), /chat_gpt\/llm_scraper\/task_get\/advanced\/t1$/);
  // Every interface reserves its scraper's fee and the readings of an answer in prose, about a fifth of a dollar at most.
  for (const engine of ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews'] as const) {
    const call = panelCall(engine, small, { day: 'd', language: 'en', location: 2840 })!;
    assert.ok(call.reserve > 0.02 && call.reserve < 0.2 && !call.live, `${engine} ${call.reserve}`);
  }
  // A roster too big for Perplexity's alternating chain is not asked there; Claude, ten messages in a row, gets it with the names only.
  assert.equal(request.chain({ alternate: true }), null);
  assert.equal(panelCall('perplexity', request, { day: 'd', language: 'en', location: 2840 }), null);
  assert.match(request.chain()!.message_chain.map((message) => message.message).join(''), /no reason; evidence with 1 fact[^]*Brands: Brand number 0, Brand number 1/);
  assert.equal(panelCall('google_ai_overviews', small, { day: 'd', language: 'en', location: 2840 })!.question, small.overview);
  // AI Mode is asked the natural search too (12/11/2026): asked the scoring task it answered without searching, so no source.
  assert.equal(panelCall('google_ai_mode', small, { day: 'd', language: 'en', location: 2840 })!.question, small.overview);
  assert.equal(panelCall('google_ai_mode', panelRequest(brands, attributes, 'streaming', 'pt'), { day: 'd', language: 'pt', location: 2076 })!.payload.language_code, 'pt-BR');
});

test('an interface answer without notes in the format asked is read afterwards (unread), never a failure or a zero', () => {
  const call = { engine: 'google_ai_mode' as const };
  const task = (text: string) => ({ status_code: 20000, cost: 0.0012, result: [{ items: [{ type: 'ai_overview', markdown: text }] }] });
  assert.equal(readPanelTask(task('Netflix leads on films.'), call, brands, attributes).status, 'unread');
  const read = readPanelTask(task('{"Netflix":{"value":80}}'), call, brands, attributes);
  assert.deepEqual(read.status === 'completed' && [read.model, read.readings.length], ['google_ai_mode', 1]);
  assert.equal(readPanelTask({ status_code: 40102 }, call, brands, attributes).status, 'absent');
});

test('both reply shapes parse; unknown names and scores outside 0-100 are absent, never a zero', () => {
  const fullShape = '```json\n' + JSON.stringify({ brands: [
    { brand: 'netflix', attributes: [{ id: 'value', score: 71.4, reason: 'Fair price [3].', evidence: 'US$ 7.99 ads tier' }, { id: 'Film selection', score: 120 }] },
    { brand: 'Unknown', attributes: [{ id: 'value', score: 50 }] },
    { brand: 'Disney+', attributes: [{ id: 'films', score: 'high' }, { id: 'films', score: 40 }, { id: 'films', score: 90 }] },
  ] }) + '\n```';
  // Before 31/10/2026 the evidence was one string: it reads as a list of one.
  assert.deepEqual(parsePanelReply(fullShape, brands, attributes), [
    { brand: 'Netflix', attribute: 'value', score: 71, reason: 'Fair price.', evidence: ['US$ 7.99 ads tier'] },
    { brand: 'Disney+', attribute: 'films', score: 40, reason: null, evidence: [] },
  ]);
  const listed = JSON.stringify({ brands: [{ brand: 'Netflix', attributes: [{ id: 'films', score: 80, justification: 'Large catalog [2].', evidence: ['4,000 titles', ' ', 'Oscar winners', 'a', 'b', 'c'] }] }] });
  assert.deepEqual(parsePanelReply(listed, brands, attributes), [{ brand: 'Netflix', attribute: 'films', score: 80, reason: 'Large catalog.', evidence: ['4,000 titles', 'Oscar winners'] }]);
  assert.deepEqual(evidenceList('["A","B"]'), ['A', 'B']);
  assert.deepEqual(evidenceList('One fact'), ['One fact']);
  assert.deepEqual([evidenceList(null), evidenceList('[not json')], [[], ['[not json']]);
  assert.deepEqual(parsePanelReply('Sure! {"Netflix":{"value":80,"films":"n/a"},"Disney+":{"films":0}}', brands, attributes).map((r) => [r.brand, r.attribute, r.score]),
    [['Netflix', 'value', 80], ['Disney+', 'films', 0]]);
  assert.deepEqual(parsePanelReply('no json here', brands, attributes), []);
  // The ChatGPT interface answers in Markdown, which escapes brackets and dollar signs.
  const markdown = '{\n  "brands": \\[{ "brand": "Netflix", "attributes": \\[{ "id": "value", "score": 64, "justification": "Costs \\$7.99.", "evidence": \\["A", "B"\\] }\\] }\\]\n}';
  assert.deepEqual(parsePanelReply(markdown, brands, attributes), [{ brand: 'Netflix', attribute: 'value', score: 64, reason: 'Costs $7.99.', evidence: ['A', 'B'] }]);
  // The roster's "Name (domain)" copied back, or the domain alone, is the brand (Gemini answered this way and lost every note).
  assert.deepEqual(parsePanelReply('{"brands":[{"brand":"Netflix (netflix.com)","attributes":[{"id":"value","score":80}]},{"brand":"disneyplus.com","attributes":[{"id":"films","score":60}]}]}', brands, attributes).map((r) => [r.brand, r.attribute, r.score]),
    [['Netflix', 'value', 80], ['Disney+', 'films', 60]]);
  // A note written as text, or under the key a model translated it to.
  assert.deepEqual(parsePanelReply('{"brands":[{"brand":"Netflix","attributes":[{"id":"value","nota":"85,5","justificativa":"Bom preço."},{"id":"films","score":"70"}]}]}', brands, attributes).map((r) => [r.attribute, r.score, r.reason]),
    [['value', 86, 'Bom preço.'], ['films', 70, null]]);
  assert.deepEqual(parsePanelReply('{"brands": [', brands, attributes), []);
});

test('a reply cut at its output limit or wrapped in prose with braces keeps every complete note', () => {
  // Gemini's failure shape (31/10): the JSON in a code fence, cut in the middle of a note, so it never closes.
  const cut = '```json\n{"brands":[{"brand":"Netflix","attributes":[{"id":"value","score":72,"justification":"Fair price.","evidence":["US$ 7.99 ads tier","4 plans"]},'
    + '{"id":"films","score":81,"justification":"Large catalog.","evidence":["4,000 films"]}]},{"brand":"Disney+","attributes":[{"id":"value","score":64,"justification":"Bundles help.","evidence":["Hulu bundle"]},{"id":"films","score":7';
  assert.deepEqual(parsePanelReply(cut, brands, attributes).map((r) => [r.brand, r.attribute, r.score, r.evidence.length]),
    [['Netflix', 'value', 72, 2], ['Netflix', 'films', 81, 1], ['Disney+', 'value', 64, 1]]);
  // Prose with braces before the JSON, and other key names for the list of notes.
  const prose = 'Scores {0-100} below. {"brands":[{"brand":"Disney+","scores":[{"attribute":"films","score":77,"reason":"Pixar and Marvel."}]}]}';
  assert.deepEqual(parsePanelReply(prose, brands, attributes), [{ brand: 'Disney+', attribute: 'films', score: 77, reason: 'Pixar and Marvel.', evidence: [] }]);
});

test('periods follow the frequency', () => {
  assert.equal(periodStart('2026-10-14T10:00:00Z', 'daily'), '2026-10-14');
  assert.equal(periodStart('2026-10-14', 'weekly'), '2026-10-12');
  assert.equal(periodStart('2026-10-14', 'monthly'), '2026-10-01');
  assert.equal(weekStart('2026-10-18'), '2026-10-12');
});

test('the question shown to a person has no assembly instruction, attribute ids or output format', () => {
  const request = panelRequest(brands, attributes, 'streaming', 'en');
  const shown = readableQuestion(request.text);
  assert.match(shown, /^Score every brand on every attribute \(streaming\)\./);
  assert.ok(shown.includes('Brands: Netflix (netflix.com); Disney+ (disneyplus.com)'));
  assert.ok(shown.includes('Attributes: Value for money, Price compared with catalog.; Film selection.'));
  assert.doesNotMatch(shown, /ROSTER|value =|films =/);
  const scrape = readableQuestion('Score 0 to 100 how strongly each brand is associated with each attribute (streaming). Brands: Netflix, Disney+. Attributes: value=Value for money; films=Film selection. Answer JSON only {"brand":{"attribute id":score}}.');
  assert.equal(scrape, 'Score 0 to 100 how strongly each brand is associated with each attribute (streaming). Brands: Netflix, Disney+. Attributes: Value for money; Film selection.');
  assert.match(readableQuestion(panelRequest(brands, attributes, 'streaming', 'pt').text), /^Dê a nota de cada marca em cada atributo \(streaming\)\./);
});

test('only facts count as evidence (10/11/2026): a restated score or band and generic praise are dropped, and a note left without a fact stays below 60', () => {
  const own = ['Conversion', 'conversion.com.br', 'Expertise'];
  // Seen in answers: the note or the band restated, and praise with nothing to check.
  for (const text of [
    'Score 92 em expertise técnica e estratégica', 'Nota 85 em autoridade', 'Rated 88/100 for value', '90 pontos em conteúdo',
    'Zona de excelência em expertise técnica e estratégica', 'Fully perceived on value for money', 'Bem percebido pelo mercado',
    'Realização de pesquisas de mercado e eventos de referência na área.', 'Feedback positivo de clientes sobre suporte técnico',
    'Known as a pioneer of binge-model releases with massive blockbuster original hits',
    'Conversion tem boa reputação em Expertise', 'Boa reputação no mercado.',
  ]) assert.equal(isFact(text, own), false, text);
  // Something checkable: a number, a name, an acronym, a quote, a source.
  for (const text of [
    '1,216 movies in US catalog (JustWatch, November 2026)', 'Terceira colocada no comparativo independente GUIA de agências de SEO',
    'Campanha da Onlinecurriculo conquistou mais de 100 backlinks', '71 avaliações na plataforma Semrush, com média 4,6/5',
    'Produced Stranger Things as one of the most-watched series', 'Pixar', 'Squid Game.', 'Cliente citado: "a melhor auditoria que já tivemos"',
    'Organiza o SEO Conference desde 2019',
  ]) assert.equal(isFact(text, own), true, text);
  // In a reading: the restated score goes, the fact stays; with no fact left the note is capped like any note without evidence.
  const agencies = [{ name: 'Conversion', domain: 'conversion.com.br' }];
  const traits = [{ id: 'expertise', name: 'Expertise' }, { id: 'geo', name: 'GEO' }];
  const reply = JSON.stringify({ Conversion: { expertise: [92, 'Score 92 em expertise técnica e estratégica'], geo: [84, 'Organiza o SEO Conference desde 2019'] } });
  assert.deepEqual(anchorReadings(parsePanelReply(reply, agencies, traits)).map((note) => [note.attribute, note.score, note.evidence, note.raw]),
    [['expertise', 59, [], 92], ['geo', 84, ['Organiza o SEO Conference desde 2019'], undefined]]);
  // Every way of asking says the evidence is a fact, never the score.
  const request = panelRequest(brands, attributes, 'streaming', 'pt');
  assert.match(request.prompt!, /nunca a nota, a faixa ou um elogio/);
  assert.match(request.keyword!, /\[nota,"fato, não a nota",rank\]/);
  assert.match(request.readings('Netflix tem o maior catálogo.')[0]!.user_prompt, /nunca a nota, a faixa ou um elogio/);
});

test('a reason that names the reader\'s message label ("TEXT identifies…") is stored without it; the reader is told not to name it', () => {
  const reply = JSON.stringify({ brands: [{ brand: 'Netflix', attributes: [
    { id: attributes[0]!.id, band: 'fully', score: 92, reason: 'TEXT identifies Netflix as industry leader', evidence: 'Netflix leads original series' },
    { id: attributes[1]!.id, band: 'well', score: 70, reason: 'ROSTER: catalog is broad', evidence: '' },
  ] }, { brand: 'Disney+', attributes: [{ id: attributes[0]!.id, band: 'well', score: 65, reason: 'Textual praise only', evidence: '' }] }] });
  const reasons = parsePanelReply(reply, brands, attributes).map((reading) => reading.reason);
  assert.deepEqual(reasons, ['Identifies Netflix as industry leader', 'Catalog is broad', 'Textual praise only']);
  assert.equal(unlabeled('the TEXT says'), 'the TEXT says');
  for (const language of ['en', 'pt'] as const) {
    const [read] = panelRequest(brands, attributes, 'streaming', language).readings('Netflix has the best films.');
    assert.match(read!.user_prompt, language === 'en' ? /The reason never names TEXT or ROSTER\./ : /O reason nunca cita TEXT nem ROSTER\./);
    assert.ok(read!.user_prompt.length <= 500);
  }
});

test('a brand named by one of its aliases, or inside a longer label, keeps its notes; a label that fits two brands gives none (13/11/2026)', () => {
  // Conversion's roster: competitors with aliases, as the project stores them.
  const roster = [
    { name: 'Conversion', domain: 'conversion.com.br' },
    { name: 'FSB Comunicação', domain: 'fsb.com.br', aliases: ['Grupo FSB', 'FSB'] },
    { name: 'LiveSEO', domain: 'liveseo.com.br', aliases: ['Agência liveSEO', 'Live SEO'] },
    { name: 'Hedgehog Digital', domain: 'hedgehogdigital.co.uk', aliases: ['Hedgehog Digital Brasil', 'Hedgehog'] },
    { name: 'NP Digital', domain: 'npdigital.com' },
    { name: 'Web Estratégica', domain: 'webestrategica.com.br' },
  ];
  const traits = [{ id: 'geo', name: 'GEO' }];
  const find = brandMatcher(roster);
  assert.equal(find('Grupo FSB'), 'FSB Comunicação');
  assert.equal(find('FSB'), 'FSB Comunicação');
  assert.equal(find('Agência liveSEO'), 'LiveSEO');
  assert.equal(find('Hedgehog'), 'Hedgehog Digital');
  assert.equal(find('NP Digital Brasil'), 'NP Digital');
  assert.equal(find('Agência Conversion'), 'Conversion');
  assert.equal(find('Web Estratégica (webestrategica.com.br)'), 'Web Estratégica');
  // "Digital" fits NP Digital and Hedgehog Digital: no brand rather than the wrong one.
  assert.equal(find('Digital'), undefined);
  assert.equal(find('Rock Content'), undefined);
  // The shape of an answer that names the brands its own way.
  const reply = JSON.stringify({ brands: [
    { brand: 'Grupo FSB', attributes: [{ id: 'geo', score: 72, reason: 'PR-led GEO', evidence: ['FSB Inteligência launched a GEO practice in 2025'] }] },
    { brand: 'Agência liveSEO', attributes: [{ id: 'geo', score: 81, reason: 'GEO for e-commerce', evidence: ['LiveSEO GEO Score for PDPs'] }] },
  ] });
  assert.deepEqual(parsePanelReply(reply, roster, traits).map((note) => [note.brand, note.score]), [['FSB Comunicação', 72], ['LiveSEO', 81]]);
  // The roster tells the AI and its reader the aliases (at most three), so an answer that uses them is read for the brand.
  const request = panelRequest(roster.slice(0, 3), traits, 'agência de SEO', 'pt-BR');
  assert.match(request.text, /FSB Comunicação \(fsb\.com\.br; também Grupo FSB, FSB\)/);
  assert.match(request.text, /Conversion \(conversion\.com\.br\)/);
});
