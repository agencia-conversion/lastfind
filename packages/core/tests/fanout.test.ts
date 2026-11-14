import test from 'node:test';
import assert from 'node:assert/strict';
import { addedWords, buildFanout, buildQueryGaps, normalizeQuery, phrasesOf, siteOf, stem, termKey } from '../lib/fanout.ts';

const run = (
  id: string,
  engine: 'chat_gpt' | 'claude',
  queries: string[],
  mentioned = false,
  created_at = '2026-10-16T10:00:00Z',
  prompt_text = 'best streaming service',
  topic = 'General',
) => ({
  id,
  engine,
  prompt_id: `p-${id}`,
  prompt_text,
  topic,
  created_at,
  queries,
  mentioned,
  cited: false,
});

void test('normalization folds case, accents, punctuation and spacing', () => {
  assert.equal(
    normalizeQuery('  Melhor  Plataforma, de Vídeo?! '),
    'melhor plataforma de video',
  );
  assert.equal(
    siteOf('reddit streaming site:https://www.Reddit.com/r/x'),
    'reddit.com',
  );
  assert.equal(siteOf('no operator'), '');
});

void test('an occurrence is one query in one response, and totals follow the normalized key', () => {
  const report = buildFanout(
    [
      run(
        '1',
        'chat_gpt',
        ['Best streaming 2026', 'best  streaming 2026', 'netflix vs max'],
        true,
      ),
      run('2', 'chat_gpt', ['best streaming 2026']),
      run('3', 'claude', ['site:reddit.com best streaming']),
    ],
    [
      { engine: 'chat_gpt', responses: 3 },
      { engine: 'claude', responses: 1 },
    ],
    [
      { name: 'Netflix', own: true },
      { name: 'Max', own: false },
    ],
  );
  assert.equal(report.occurrences, 4);
  assert.equal(report.distinct, 3);
  assert.equal(report.queries[0].key, 'best streaming 2026');
  assert.equal(report.queries[0].occurrences, 2);
  assert.equal(report.queries[0].mentionedRate, 50);
  assert.equal(report.queries.find((q) => q.kind === 'site')?.occurrences, 1);
  assert.deepEqual(report.sites, [{ site: 'reddit.com', count: 1 }]);
  // largest first, everywhere
  assert.deepEqual(
    report.engines.map((e) => e.engine),
    ['chat_gpt', 'claude'],
  );
  assert.equal(report.engines[0].withFanout, 2);
  assert.deepEqual(
    report.brands.map((b) => b.name),
    ['Netflix', 'Max'],
  );
});

void test('distinct queries are a union across AIs, with honest coverage and bounded output', () => {
  const report = buildFanout(
    [
      run('a', 'chat_gpt', ['Shared query']),
      run('b', 'claude', ['shared query']),
    ],
    [
      { engine: 'chat_gpt', responses: 2 },
      { engine: 'claude', responses: 1 },
    ],
    [],
  );
  assert.equal(report.distinct, 1);
  assert.equal(report.occurrences, 2);
  assert.equal(report.withFanout, 2);
  assert.equal(report.responses, 3);
  assert.equal(report.queries[0].prompts, 2);
  assert.deepEqual(buildFanout([], [], []).queries, []);
  const missing = buildFanout([], [{ engine: 'gemini', responses: 4 }], []);
  assert.equal(missing.responses, 4);
  assert.equal(missing.withFanout, 0);
  const capped = buildFanout(
    [
      run(
        'c',
        'chat_gpt',
        Array.from({ length: 205 }, (_, i) => `query ${i}`),
      ),
    ],
    [{ engine: 'chat_gpt', responses: 1 }],
    [],
  );
  assert.equal(capped.distinct, 205);
  assert.equal(capped.queries.length, 200);
  assert.equal(capped.hasMoreQueries, true);
});

void test('added words are what the search has and the prompt does not; the year is kept', () => {
  assert.deepEqual(
    addedWords('Best streaming service for movies', 'best streaming service movies 2026 vs hulu'),
    ['2026', 'hulu'],
  );
  assert.deepEqual(addedWords('melhor plataforma de vídeo', 'melhor plataforma video'), []);
  assert.deepEqual(addedWords('best streaming service', 'best streaming services'), []);
});

void test('plural and singular are one word; "ss", "us" and "is" endings are not plurals; the year stays', () => {
  assert.deepEqual(['services', 'service', 'precos', 'business', 'status', 'analysis', 'ads', '2026', 'news', 'series'].map(stem), [
    'service', 'service', 'preco', 'business', 'status', 'analysis', 'ads', '2026', 'news', 'series',
  ]);
  assert.deepEqual(addedWords('melhor servico', 'melhores servicos 2026'), ['melhore', '2026']);
});

void test('topics, added words and term series follow the same occurrences, per day and AI', () => {
  const previous = [
    run('p1', 'chat_gpt', ['hulu', 'Hulu!'], false, '2026-10-10T10:00:00Z'),
    run('p2', 'claude', ['hulu deals', 'best streaming'], false, '2026-10-11T10:00:00Z'),
    run('p3', 'claude', ['hulu pricing'], false, '2026-10-12T10:00:00Z'),
  ];
  const report = buildFanout(
    [
      run('1', 'chat_gpt', ['best streaming hulu'], true, '2026-10-14T10:00:00Z', 'best streaming service', 'Films'),
      run('2', 'chat_gpt', ['best streaming hulu', 'streaming pricing'], false, '2026-10-15T10:00:00Z', 'best streaming service', 'Films'),
      run('3', 'claude', ['hulu pricing'], true, '2026-10-16T10:00:00Z', 'best streaming service', 'Series'),
      run('4', 'chat_gpt', ['hulu'], false, '2026-10-17T10:00:00Z', 'best streaming service', 'Series'),
    ],
    [
      { engine: 'chat_gpt', responses: 3 },
      { engine: 'claude', responses: 1 },
    ],
    [],
    '',
    previous,
  );
  assert.deepEqual(
    report.topics.map((row) => [row.topic, row.occurrences, row.distinct]),
    [['Films', 3, 2], ['Series', 2, 2]],
  );
  assert.equal(report.topics[0].mentionedRate, (1 / 3) * 100);
  assert.equal(report.queries.find((row) => row.key === 'hulu pricing')?.topic, 'Series');
  assert.deepEqual(report.added[0], { term: 'hulu', count: 4, rate: (4 / 5) * 100 });
  const hulu = report.termTrend.find((row) => row.term === 'hulu')!;
  assert.equal(hulu.count, 4);
  assert.deepEqual(hulu.daily.map((day) => day.date), ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual(hulu.daily[2].counts, { claude: 1 });
  // 4 searches with the word now against 3 in the previous period (a repeat in one response counts once).
  assert.equal(hulu.change, ((4 - 3) / 3) * 100);
  // "pricing" has no search in the previous period but "hulu pricing": 2 now, 1 before.
  assert.equal(report.termTrend.find((row) => row.term === 'pricing')?.change, 100);
  // No searches with the word before is "no comparison", never 0% or infinity; nor is no previous period at all.
  assert.equal(report.termTrend.find((row) => row.term === 'streaming')?.change, 200);
  assert.equal(buildFanout([run('1', 'chat_gpt', ['hulu'])], [], [], '', [run('x', 'claude', ['other'])]).termTrend[0].change, null);
  assert.equal(buildFanout([run('1', 'chat_gpt', ['hulu'])], [], []).termTrend[0].change, null);
  assert.equal(buildFanout([], [], []).termTrend.length, 0);
});

void test('a gap is per AI against that AI average and needs enough responses', () => {
  const many = (engine: 'chat_gpt' | 'claude', count: number, mentioned: number, query: string, prefix: string) =>
    Array.from({ length: count }, (_, at) => run(`${prefix}${at}`, engine, [query], at < mentioned));
  const runs = [
    ...many('chat_gpt', 20, 10, 'compare mubi', 'a'),
    ...many('chat_gpt', 40, 40, 'best streaming', 'b'),
    ...many('claude', 20, 0, 'compare mubi', 'c'),
    ...many('claude', 5, 0, 'rare criterion', 'd'),
  ];
  const gaps = buildQueryGaps(runs);
  const mubi = gaps.find((gap) => gap.term === 'mubi' && gap.engine === 'chat_gpt')!;
  assert.deepEqual([mubi.responses, mubi.missing, mubi.rate], [20, 10, 50]);
  assert.equal(Math.round(mubi.baseline), 83);
  // Claude's average is 0%: nothing stands out there, and an AI is never judged by another's average.
  assert.equal(gaps.some((gap) => gap.engine === 'claude'), false);
  // Below the minimum number of responses there is no gap.
  assert.equal(gaps.some((gap) => gap.term === 'criterion'), false);
  assert.deepEqual(buildQueryGaps([]), []);
});

void test('a term narrows only the table of queries, listing every search that has the word', () => {
  const runs = [
    run('1', 'chat_gpt', ['best streaming service', 'channel guide']),
    run('2', 'chat_gpt', ['Best Streaming Service']),
    run('3', 'claude', ['criterion channel films', 'channels list']),
  ];
  const coverage = [{ engine: 'chat_gpt' as const, responses: 2 }, { engine: 'claude' as const, responses: 1 }];
  const whole = buildFanout(runs, coverage, []);
  const narrowed = buildFanout(runs, coverage, [], 'channel');
  // "channel" finds "channels" too: plural and singular are the same word, so the filter accepts either.
  const expected = ['channel guide', 'channels list', 'criterion channel films'];
  assert.deepEqual(narrowed.queries.map((row) => row.key).sort(), expected);
  assert.deepEqual(buildFanout(runs, coverage, [], 'channels').queries.map((row) => row.key).sort(), expected);
  assert.equal(narrowed.hasMoreQueries, false);
  // Everything else is the same as without the term.
  assert.equal(narrowed.occurrences, whole.occurrences);
  assert.deepEqual(narrowed.termTrend, whole.termTrend);
  assert.equal(whole.queries.length, 4);
});

void test('"news" is not "new releases", and a term lists more than 200 searches with its own series', () => {
  const runs = [
    run('n', 'chat_gpt', ['netflix new releases', 'latest news netflix']),
    run('m', 'chat_gpt', Array.from({ length: 205 }, (_, i) => `rare${i} service`)),
  ];
  const coverage = [{ engine: 'chat_gpt' as const, responses: 2 }];
  assert.deepEqual(buildFanout(runs, coverage, [], 'news').queries.map((row) => row.key), ['latest news netflix']);
  const all = buildFanout(runs, coverage, [], 'services');
  assert.equal(all.queries.length, 205);
  assert.equal(all.hasMoreQueries, false);
  // A rare word outside the offered series still comes with its own, under its canonical name.
  const rare = buildFanout(runs, coverage, [], 'rare7');
  assert.equal(rare.termTrend.find((row) => row.term === 'rare7')?.count, 1);
});

void test('singular and plural share a key, and the screen shows the form the searches use most', () => {
  const key = (words: string[]) => new Set(words.map(stem));
  for (const pair of [['documentary', 'documentaries'], ['movie', 'movies'], ['service', 'services']]) assert.equal(key(pair).size, 1, pair.join('/'));
  assert.deepEqual(['news', 'series', 'business', 'status', '2026'].map(stem), ['news', 'series', 'business', 'status', '2026']);
  const runs = [
    run('1', 'chat_gpt', ['best documentaries', 'documentaries netflix']),
    run('2', 'chat_gpt', ['documentary netflix', 'movies hulu']),
    run('3', 'claude', ['movie hulu', 'movies pricing']),
  ];
  const coverage = [{ engine: 'chat_gpt' as const, responses: 2 }, { engine: 'claude' as const, responses: 1 }];
  for (const typed of ['documentary', 'documentaries']) {
    const report = buildFanout(runs, coverage, [], typed);
    assert.equal(report.queries.length, 3);
    assert.equal(report.termTrend.find((row) => row.count === 3)?.term, 'documentaries');
  }
  const report = buildFanout(runs, coverage, [], '');
  assert.deepEqual(report.termTrend.filter((row) => /^(documentar|movie)/.test(row.term)).map((row) => [row.term, row.count]), [['documentaries', 3], ['movies', 3]]);
  assert.ok(!report.termTrend.some((row) => row.term === 'documentarie' || row.term === 'movy'));
});

void test('a term keeps its accents as written while accented and plain spellings count as one', () => {
  const runs = [
    run('1', 'chat_gpt', ['taxa de conversão e-commerce', 'otimização de conversão']),
    run('2', 'chat_gpt', ['conversao loja', 'otimização seo']),
    run('3', 'claude', ['conversão média', 'otimizacao site']),
  ];
  const report = buildFanout(runs, [{ engine: 'chat_gpt' as const, responses: 2 }, { engine: 'claude' as const, responses: 1 }], [], '');
  const terms = new Map(report.termTrend.map((row) => [row.term, row.count]));
  assert.equal(terms.get('conversão'), 4);
  assert.equal(terms.get('otimização'), 3);
  assert.ok(!terms.has('conversao') && !terms.has('otimizacao'));
  // The accented form wins a tie.
  const tie = buildFanout([run('1', 'chat_gpt', ['conversao loja', 'conversão site'])], [{ engine: 'chat_gpt' as const, responses: 1 }], [], '');
  assert.ok(tie.termTrend.some((row) => row.term === 'conversão'));
});

test('an accented word where the brand is missing (a gap) keeps its series: the report never fails on it', () => {
  // A gap names its word as written ("conversão"); its daily series is under the key without accents. Read by the label,
  // the series was missing and the whole report failed (Query Fan Out and Top terms of a Portuguese project, 10/11/2026).
  const runs = Array.from({ length: 40 }, (_, i) => ({
    ...run(`r${i}`, 'chat_gpt', [i < 20 ? 'melhores agências de conversão' : 'agência digital barata']),
    created_at: `2026-11-0${1 + (i % 7)}T10:00:00.000Z`,
    mentioned: i >= 20,
  }));
  const report = buildFanout(runs, [{ engine: 'chat_gpt' as const, responses: 40 }], [{ name: 'Conversion', own: true }], '');
  const conversion = report.termTrend.find((row) => row.term === 'conversão');
  assert.ok(conversion, 'the gap word has its series, shown as written');
  assert.equal(conversion.daily.reduce((sum, day) => sum + (day.counts.chat_gpt ?? 0), 0), 20);
});

void test('top terms count phrases of two and three words beside single words, and what appears with each in the same search', () => {
  const prompt = 'melhor agência de SEO';
  const report = buildFanout(
    [
      run('a', 'chat_gpt', ['agência de SEO em São Paulo preço', 'agência SEO avaliações clientes'], false, '2026-10-16T10:00:00Z', prompt),
      run('b', 'chat_gpt', ['agencia seo sao paulo 2026'], false, '2026-10-16T10:00:00Z', prompt),
      run('c', 'claude', ['SEO em São Paulo preço médio', 'avaliações de clientes agência SEO'], false, '2026-10-17T10:00:00Z', prompt),
      run('d', 'claude', ['consultoria seo pequenas empresas', 'agência seo rio de janeiro preço'], false, '2026-10-17T10:00:00Z', prompt),
    ],
    [{ engine: 'chat_gpt', responses: 2 }, { engine: 'claude', responses: 2 }],
    [],
  );
  const terms = new Map(report.phrases.map((row) => [row.term, row]));
  // "São Paulo" is one term, written as the searches write it most; "São" and "Paulo" alone say nothing more.
  assert.equal(terms.get('são paulo')?.count, 3);
  assert.equal(terms.get('são paulo')?.words, 2);
  assert.ok(!terms.has('são') && !terms.has('paulo') && !terms.has('sao paulo'));
  // A longer phrase is listed beside the shorter one when it holds only part of its searches.
  assert.equal(terms.get('são paulo preço')?.count, 2);
  assert.equal(terms.get('preço')?.count, 3);
  assert.equal(terms.get('preço')!.rate.toFixed(1), ((3 / 7) * 100).toFixed(1));
  // What appears with a term in the same search: another listed term with no word in common.
  assert.deepEqual(terms.get('são paulo')?.with, [{ term: 'preço', count: 2 }]);
  assert.deepEqual(terms.get('preço')?.with, [{ term: 'são paulo', count: 2 }]);
  // The prompt's own words are not a term, nor a phrase that holds one.
  assert.ok(!terms.has('seo') && !terms.has('agência') && !terms.has('seo em são paulo'));
  assert.equal(terms.get('avaliações clientes')?.count, 2);
  // A single search is not a pattern.
  assert.ok(!terms.has('consultoria') && !terms.has('rio de janeiro'));
});

void test('a phrase keeps the stop word inside it as written, never at either end', () => {
  assert.deepEqual(
    phrasesOf('Avaliações de clientes').map((phrase) => phrase.form),
    ['avaliações', 'avaliações de clientes', 'clientes'],
  );
  assert.deepEqual(
    phrasesOf('Avaliações de clientes').map((phrase) => phrase.key),
    ['avaliacoe', 'avaliacoe cliente', 'cliente'],
  );
});

void test('the table narrows to a phrase as to a word: its searches, its own series and its label as written', () => {
  const report = buildFanout(
    [
      run('a', 'chat_gpt', ['agência de SEO em São Paulo', 'seo paulo santos'], false, '2026-10-16T10:00:00Z', 'melhor agência'),
      run('b', 'claude', ['sao paulo agencias seo'], false, '2026-10-17T10:00:00Z', 'melhor agência'),
    ],
    [{ engine: 'chat_gpt', responses: 1 }, { engine: 'claude', responses: 1 }],
    [],
    'São Paulo',
  );
  assert.deepEqual(report.queries.map((row) => row.key).sort(), ['agencia de seo em sao paulo', 'sao paulo agencias seo']);
  const series = report.termTrend.find((row) => row.term === 'são paulo');
  assert.equal(series?.count, 2);
  assert.equal(series?.daily.length, 2);
  assert.equal(termKey('Agências de SEO'), 'agencia seo');
  assert.equal(termKey('channels'), stem('channels'));
});

void test('Spanish searches drop their articles and prepositions like Portuguese and English ones', () => {
  assert.equal(termKey('Las mejores agencias de SEO en Madrid'), 'mejore agencia seo madrid');
  assert.equal(termKey('¿Cuál es el precio de una agencia SEO?'), 'precio agencia seo');
  assert.deepEqual(
    phrasesOf('agencias de SEO en Madrid').filter((phrase) => phrase.key === 'seo madrid').map((phrase) => phrase.form),
    ['seo en madrid'],
  );
});
