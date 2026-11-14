// The public demo's Agent: example conversations about the Netflix study, shown read-only by the real chat (AgentChat with
// `demo`). Pure data: nothing here calls the agent, a model or a search provider, and the demo's composer sends nothing
// (guard: tests/demo-agent.test.mjs). Its figures are frozen data blocks with their date, as an artifact keeps them; they
// are the home's product illustration's (apps/site PreviewScreens.tsx: the same brands and figures, guard:
// apps/site/tests/output.test.mjs), so the demo and the home tell one story.
import type { Artifact, ConversationSummary, MessageView } from './agent';

type T = (en: string, pt: string) => string;
export type AgentDemo = {
  conversations: ConversationSummary[];
  messages: Record<string, MessageView[]>;
  artifacts: Record<string, Artifact>;
};

const DAY = 86_400_000;
const block = (value: Record<string, unknown>) => ['```live', JSON.stringify(value), '```'].join('\n');

/** The demo's conversations, dated from `now` (today, yesterday, three days ago) so the list reads as a team's recent work. */
export function agentDemo(t: T, now = Date.now()): AgentDemo {
  const at = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3_600_000).toISOString();
  const project = 'netflix-demo-streaming';
  const period = { days: 28 };

  const report: Artifact = {
    id: 'demo-artifact-report',
    project_id: project,
    conversation_id: 'demo-competitors',
    title: t('Where Netflix loses to competitors', 'Onde a Netflix perde para concorrentes'),
    kind: 'report',
    content: [
      `# ${t('Where Netflix loses to competitors', 'Onde a Netflix perde para concorrentes')}`,
      t(
        'Netflix is the brand the AIs name most in streaming answers, but it is not first in every topic. This report shows where competitors are ahead and what to do about it.',
        'A Netflix é a marca que as IAs mais citam nas respostas sobre streaming, mas não é a primeira em todos os tópicos. Este relatório mostra onde os concorrentes estão à frente e o que fazer.',
      ),
      `## ${t('Brands in AI answers', 'Marcas nas respostas de IA')}`,
      block({
        id: 'b_d3a001', data: 'brands', shape: 'table', period, mode: 'frozen', captured_at: at(1, 2),
        snapshot: [
          { x: 'Netflix', visibility: 62.6, shareOfVoice: 26.3 },
          { x: 'Disney+', visibility: 56.3, shareOfVoice: 23.6 },
          { x: 'Prime Video', visibility: 44.6, shareOfVoice: 18.7 },
          { x: 'HBO Max', visibility: 33.8, shareOfVoice: 14.2 },
          { x: 'Apple TV+', visibility: 25.1, shareOfVoice: 10.5 },
          { x: 'Paramount+', visibility: 16.0, shareOfVoice: 6.7 },
        ],
      }),
      `## ${t('Where competitors lead', 'Onde os concorrentes lideram')}`,
      t(
        '- **Family suitability:** Disney+ is named first in most answers about children and family films.\n- **Value for money:** Prime Video wins when the question is about price, because the AIs bundle it with shipping.\n- **Film selection:** HBO Max is named for prestige films and HBO series.',
        '- **Indicado para família:** a Disney+ aparece primeiro na maioria das respostas sobre filmes infantis e para a família.\n- **Custo-benefício:** a Prime Video ganha quando a pergunta é sobre preço, porque as IAs a somam ao frete.\n- **Seleção de filmes:** a HBO Max é citada por filmes premiados e séries da HBO.',
      ),
      `## ${t('What to do next', 'O que fazer agora')}`,
      t(
        '1. Publish a page on Netflix family profiles and parental controls: it is the source the AIs lack.\n2. Answer price comparisons with the plans side by side, ads plan included.\n3. Get Netflix films into the review sites the AIs cite most for prestige films.',
        '1. Publicar uma página sobre perfis infantis e controle parental da Netflix: é a fonte que falta às IAs.\n2. Responder às comparações de preço com os planos lado a lado, incluindo o plano com anúncios.\n3. Levar os filmes da Netflix aos sites de crítica que as IAs mais citam para filmes premiados.',
      ),
    ].join('\n\n'),
    created_at: at(1, 2),
    updated_at: at(1, 2),
    share_token: null,
    version: 1,
    live: false,
    updated_by: 'agent',
  };

  const content: Artifact = {
    id: 'demo-artifact-content',
    project_id: project,
    conversation_id: 'demo-content',
    title: t('Netflix for families: profiles, controls and what to watch', 'Netflix para a família: perfis, controles e o que assistir'),
    kind: 'content',
    content: [
      `# ${t('Netflix for families: profiles, controls and what to watch', 'Netflix para a família: perfis, controles e o que assistir')}`,
      t(
        'Choosing a streaming service for the whole family comes down to three things: what children can watch, how much control parents have, and whether the catalog keeps everyone interested. Here is how Netflix handles each one.',
        'Escolher um streaming para a família toda depende de três coisas: o que as crianças podem assistir, quanto controle os pais têm e se o catálogo mantém todos interessados. Veja como a Netflix resolve cada uma.',
      ),
      `## ${t('Kids profiles', 'Perfis infantis')}`,
      t(
        'Every account can have a kids profile with its own catalog, chosen by age rating. Children see only titles for their age, and the profile can be locked with a PIN.',
        'Toda conta pode ter um perfil infantil com catálogo próprio, escolhido pela classificação indicativa. As crianças veem apenas títulos da sua idade, e o perfil pode ser bloqueado com um PIN.',
      ),
      `## ${t('Parental controls', 'Controle parental')}`,
      t(
        'Parents can block single titles, turn off autoplay and see what each profile watched. The settings are per profile, so older children can get more freedom.',
        'Os pais podem bloquear títulos específicos, desligar a reprodução automática e ver o que cada perfil assistiu. As configurações são por perfil, então filhos mais velhos podem ter mais liberdade.',
      ),
      `## ${t('What to watch together', 'O que assistir juntos')}`,
      t(
        'Animated films, nature documentaries and family competition shows are the titles most recommended for watching together.',
        'Filmes de animação, documentários de natureza e programas de competição em família são os títulos mais indicados para assistir juntos.',
      ),
    ].join('\n\n'),
    outline: t('1. Kids profiles\n2. Parental controls\n3. What to watch together', '1. Perfis infantis\n2. Controle parental\n3. O que assistir juntos'),
    research: t(
      '- "netflix parental controls": the top 3 explain the PIN, none compares with other services.\n- Answers about family streaming cite Disney+ first and lack a page on Netflix kids profiles.',
      '- "controle parental netflix": o top 3 explica o PIN, nenhum compara com outros serviços.\n- As respostas sobre streaming para família citam a Disney+ primeiro e não têm uma página sobre os perfis infantis da Netflix.',
    ),
    created_at: at(3, 1),
    updated_at: at(3, 1),
    share_token: null,
    version: 1,
    live: false,
    updated_by: 'agent',
  };

  const summary = (artifact: Artifact) => ({ id: artifact.id, title: artifact.title, kind: artifact.kind, updated_at: artifact.updated_at });
  const answer = (id: string, text: string, tools: Extract<MessageView, { role: 'assistant' }>['tools'], artifacts: Artifact[] = []): MessageView => ({
    id,
    role: 'assistant',
    text,
    tools,
    artifacts: artifacts.map(summary),
    pending: [],
  });

  const visibility: MessageView[] = [
    { id: 'demo-visibility-q', role: 'user', text: t('How is Netflix doing in AI answers, and which AI names it least?', 'Como a Netflix está nas respostas de IA, e qual IA a cita menos?') },
    answer(
      'demo-visibility-a',
      [
        t(
          'In the last 28 days Netflix appears in **63%** of the AI answers about streaming, up 14 points, and it is the first brand named in most of them.',
          'Nos últimos 28 dias a Netflix aparece em **63%** das respostas de IA sobre streaming, 14 pontos a mais, e é a primeira marca citada na maioria delas.',
        ),
        block({
          id: 'b_d3a002', data: 'overview', shape: 'metrics', period, mode: 'frozen', captured_at: at(0, 1),
          snapshot: [
            { key: 'visibility', value: 62.6, delta: 14.0 },
            { key: 'shareOfVoice', value: 26.3, delta: 4.5 },
            { key: 'citationPresence', value: 29.3, delta: 6.4 },
            { key: 'mentionPosition', value: 1.6 },
          ],
        }),
        block({
          id: 'b_d3a003', data: 'models', shape: 'bar', metric: 'visibility', period, mode: 'frozen', captured_at: at(0, 1),
          snapshot: [
            { x: 'ChatGPT', visibility: 63.6 },
            { x: 'AI Overviews', visibility: 61.8 },
            { x: 'Gemini', visibility: 61.8 },
          ],
        }),
        t(
          'AI Overviews and Gemini name Netflix least, 62% against 64% on ChatGPT: their answers about price lean on comparison sites, where Prime Video and HBO Max show up first. Citations are where Netflix has the most room: its own pages are cited in 29% of the answers.',
          'O AI Overviews e o Gemini são as IAs que menos citam a Netflix, 62% contra 64% no ChatGPT: as respostas sobre preço se apoiam em sites de comparação, onde Prime Video e HBO Max aparecem primeiro. As citações são onde a Netflix tem mais espaço: as páginas dela são citadas em 29% das respostas.',
        ),
      ].join('\n\n'),
      [
        { id: 'demo-v1', name: 'get_overview', state: 'done', input: { days: 28 } },
        { id: 'demo-v2', name: 'compare_ai_models', state: 'done', input: { days: 28 } },
        { id: 'demo-v3', name: 'list_sources', state: 'done', input: { days: 28, engine: 'google_ai_overviews' } },
      ],
    ),
  ];

  const competitors: MessageView[] = [
    { id: 'demo-competitors-q', role: 'user', text: t('Write a report on the topics where competitors beat Netflix, with what to do next.', 'Escreva um relatório dos tópicos em que os concorrentes ganham da Netflix, com o que fazer.') },
    answer(
      'demo-competitors-a',
      t(
        'Netflix leads overall, but loses three topics: **family suitability** to Disney+, **value for money** to Prime Video and **film selection** to HBO Max. I wrote the report with the brands table and three actions.',
        'A Netflix lidera no geral, mas perde três tópicos: **indicado para família** para a Disney+, **custo-benefício** para a Prime Video e **seleção de filmes** para a HBO Max. Escrevi o relatório com a tabela de marcas e três ações.',
      ),
      [
        { id: 'demo-c1', name: 'compare_brands', state: 'done', input: { days: 28 } },
        { id: 'demo-c2', name: 'list_prompts', state: 'done', input: { days: 28 } },
        { id: 'demo-c3', name: 'get_semantic_branding', state: 'done', input: { days: 28 } },
        { id: 'demo-c4', name: 'create_artifact', state: 'done', input: { title: report.title } },
      ],
      [report],
    ),
  ];

  const writing: MessageView[] = [
    { id: 'demo-content-q', role: 'user', text: t('Research the keywords about family streaming and write an article for the best opportunity.', 'Pesquise as palavras-chave sobre streaming para família e escreva um artigo para a melhor oportunidade.') },
    answer(
      'demo-content-a',
      t(
        'The best opportunity is **netflix parental controls**: steady searches, and the top 3 explain the PIN without comparing services. I wrote the article with its outline and research.',
        'A melhor oportunidade é **controle parental netflix**: buscas constantes, e o top 3 explica o PIN sem comparar serviços. Escrevi o artigo com o outline e a pesquisa.',
      ),
      [
        { id: 'demo-w1', name: 'keyword_ideas', state: 'done', input: { keyword: t('family streaming', 'streaming para família') } },
        {
          id: 'demo-w2',
          name: 'search_results',
          state: 'done',
          input: { keyword: t('netflix parental controls', 'controle parental netflix') },
          output: {
            organic: [
              { position: 1, title: t('Parental controls on Netflix', 'Controle parental na Netflix'), url: 'https://help.netflix.com/node/264', domain: 'help.netflix.com' },
              { position: 2, title: t('How to set up Netflix for kids', 'Como configurar a Netflix para crianças'), url: 'https://www.example.com/netflix-kids', domain: 'example.com' },
            ],
          },
        },
        { id: 'demo-w3', name: 'read_page', state: 'done', input: { url: 'https://help.netflix.com/node/264' } },
        { id: 'demo-w4', name: 'create_artifact', state: 'done', input: { title: content.title } },
      ],
      [content],
    ),
  ];

  const conversation = (id: string, title: string, artifact: Artifact): ConversationSummary => ({ id, title, pinned: false, created_at: artifact.created_at, updated_at: artifact.updated_at });
  return {
    conversations: [
      { id: 'demo-visibility', title: t('Netflix in AI answers', 'A Netflix nas respostas de IA'), pinned: false, created_at: at(0, 1), updated_at: at(0, 1) },
      conversation('demo-competitors', t('Topics where competitors lead', 'Tópicos em que os concorrentes lideram'), report),
      conversation('demo-content', t('Article: Netflix for families', 'Artigo: Netflix para a família'), content),
    ],
    messages: { 'demo-visibility': visibility, 'demo-competitors': competitors, 'demo-content': writing },
    artifacts: { [report.id]: report, [content.id]: content },
  };
}
