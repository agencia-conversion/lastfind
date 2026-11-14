// The product guide shared by both editions' docs: every report, the Agent and every setting, one page each
// (/docs/<id>), with screenshots of the public demo project. Plain module (no hooks), so the server reads the
// pages' titles and descriptions for their metadata. Each edition adds its own sections (plans, installation) around it.
// Screens are described by what they do, not by how they look, so a restyle does not outdate the guide.
import type { ReactNode } from 'react';
import { DocsFigure as Figure, DocsH2 as H2, DocsPath as Path, type DocsSection, type Translate } from './docs-layout';
import { aiBotsDocsSection } from './ai-bots-docs';

export type DocsEdition = 'cloud' | 'selfhost';

function Settings({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl>
      {rows.map(([term, description], index) => (
        <div key={index}>
          <dt>{term}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function productDocsSections(l: Translate, edition: DocsEdition): DocsSection[] {
  const cloud = edition === 'cloud';
  return [
    {
      id: 'start',
      related: ['overview', 'prompts', 'settings-monitoring'],
      group: 'use',
      name: l('Getting started', 'Primeiros passos'),
      title: l('Start in a few minutes.', 'Comece em poucos minutos.'),
      description: l(
        'Create a project, add the questions buyers ask the AIs and your competitors, and learn when the first data arrives.',
        'Crie um projeto, adicione as perguntas que os compradores fazem às IAs e os seus concorrentes, e saiba quando chegam os primeiros dados.',
      ),
      subs: [
        { id: 'start-project', label: l('Create a project', 'Crie um projeto') },
        { id: 'start-prompts', label: l('Add prompts', 'Adicione prompts') },
        { id: 'start-competitors', label: l('Add competitors', 'Adicione concorrentes') },
        { id: 'start-collection', label: l('When data arrives', 'Quando os dados chegam') },
        { id: 'start-navigation', label: l('Find your way', 'Como navegar') },
      ],
      body: (
        <>
          <p>
            {l(
              'Lastfind asks the AIs your customers use (ChatGPT, Gemini, Google AI Mode and AI Overviews) the questions they ask, every day or every week, and shows whether your brand appears, in what position, with what sentiment and which sources back the answer.',
              'O Lastfind faz às IAs que os seus clientes usam (ChatGPT, Gemini, Google AI Mode e AI Overviews) as perguntas que eles fazem, todo dia ou toda semana, e mostra se a sua marca aparece, em que posição, com que sentimento e quais fontes sustentam a resposta.',
            )}
          </p>
          {cloud ? (
            <p>
              {l(
                'On lastfind.ai, Start for free in the header creates your free account with Google or an email code, no password. Signed in, the header shows your avatar (Open app, Settings, Sign out) and Open app; on a device where you are not signed in, the round button beside the language signs you in.',
                'Em lastfind.ai, Começar grátis no header cria a sua conta grátis com o Google ou um código por email, sem senha. Com a sessão aberta, o header mostra o seu avatar (Abrir app, Configurações, Sair) e Abrir app; num aparelho sem sessão, o botão redondo ao lado do idioma faz o login.',
              )}
            </p>
          ) : null}
          <H2 id="start-project">{l('1. Create a project', '1. Crie um projeto')}</H2>
          <p>
            {l(
              'A project is one brand in one market. New project opens a wizard in six steps: Project (brand, domain, an optional project name, update frequency, market, which starts on the open project’s country or yours, and language), Competitors (up to 10, each with its domains, the main one first, and its aliases, typed as badges), Topics, Prompts (for each topic), AIs (with Semantic Branding and its attributes, reviewed there and set up with the project unless you unselect it) and Review. The AI suggests the competitors, topics, prompts and Semantic Branding attributes from your brand, site and market while you go through the steps; click any cell to edit it, remove or unselect any, ask again with Suggest, or write them by hand. Create project saves it all at once and starts the first collection right away: the Overview says the first answers are on their way and updates on its own.',
              'Um projeto é uma marca num mercado. Novo projeto abre um assistente em seis passos: Projeto (marca, domínio, um nome de projeto opcional, frequência de atualização, mercado, que começa no país do projeto aberto ou no seu, e idioma), Concorrentes (até 10, cada um com os domínios, o principal primeiro, e os apelidos, digitados como etiquetas), Tópicos, Prompts (para cada tópico), IAs (com o Semantic Branding e os atributos dele, revisados ali e configurados com o projeto se você não desmarcar) e Revisão. A IA sugere os concorrentes, os tópicos, os prompts e os atributos do Semantic Branding a partir da sua marca, do site e do mercado enquanto você avança; clique numa célula para editar, remova ou desmarque qualquer um, peça de novo em Sugerir, ou escreva à mão. Criar projeto salva tudo de uma vez e inicia a primeira coleta na hora: a Visão geral avisa que as primeiras respostas estão a caminho e se atualiza sozinha.',
            )}
          </p>
          <H2 id="start-prompts">{l('2. Add prompts', '2. Adicione prompts')}</H2>
          <p>
            {l(
              'A prompt is a question a buyer asks an AI, such as “which streaming service has the best original series?”. In Prompts, use Add prompt or the menu beside it to Import CSV (up to 100 questions at a time). Group prompts by topic (Manage topics) and mark audiences or journey stages with tags.',
              'Um prompt é uma pergunta que um comprador faz a uma IA, como “qual streaming tem as melhores séries originais?”. Em Prompts, use Adicionar prompt ou o menu ao lado para Importar CSV (até 100 perguntas por vez). Agrupe os prompts por tópico (Gerenciar tópicos) e marque públicos ou etapas da jornada com tags.',
            )}
          </p>
          <p>
            {l(
              'Keep questions that name your brand apart from category questions: mixing them makes prompted mentions look like spontaneous discovery.',
              'Separe as perguntas que citam a sua marca das perguntas de categoria: misturar as duas faz menções induzidas parecerem descoberta espontânea.',
            )}
          </p>
          <H2 id="start-competitors">{l('3. Add competitors', '3. Adicione concorrentes')}</H2>
          <p>
            {l('Track up to 10 competitors in ', 'Acompanhe até 10 concorrentes em ')}
            <Path>{l('Settings > Competitors > Competitor list', 'Configurações > Concorrentes > Lista de concorrentes')}</Path>
            {l(
              '. Lastfind also finds the other brands the answers name; you decide which ones to monitor or reject in Brands.',
              '. O Lastfind também encontra as outras marcas que as respostas citam; você decide quais monitorar ou rejeitar em Marcas.',
            )}
          </p>
          <H2 id="start-collection">{l('4. When data arrives', '4. Quando os dados chegam')}</H2>
          <p>
            {cloud
              ? l(
                  'New prompts enter the project’s next scheduled collection: daily, or weekly on the chosen day, at the time set in Settings > Monitoring, in the workspace’s time zone (Monday 04:00 by default). Free collects once a week. The workspace’s prompts are shared by all its projects.',
                  'Prompts novos entram na próxima coleta agendada do projeto: diária, ou semanal no dia escolhido, no horário definido em Configurações > Monitoramento, no fuso horário do workspace (segunda às 04:00 por padrão). O Free coleta uma vez por semana. Os prompts do workspace são divididos entre todos os projetos.',
                )
              : l(
                  'New prompts are collected right away, then daily, or weekly on the chosen day, at the time set in Settings > Monitoring, in the workspace’s time zone (Monday 04:00 by default).',
                  'Prompts novos são coletados na hora e depois diariamente, ou semanalmente no dia escolhido, no horário definido em Configurações > Monitoramento, no fuso horário do workspace (segunda às 04:00 por padrão).',
                )}{' '}
            {l(
              'Each AI answers at its own pace: most within 45 minutes, sometimes a few hours. Collection runs on the server, so you can close the browser.',
              'Cada IA responde no seu ritmo: a maioria em até 45 minutos, às vezes algumas horas. A coleta roda no servidor, então você pode fechar o navegador.',
            )}
          </p>
          <H2 id="start-navigation">{l('5. Find your way', '5. Como navegar')}</H2>
          <p>
            {l(
              'The sidebar lists the reports (Overview, Prompts, Semantic Branding, Brands, Sources, Comparison, Traffic, Shopping, AI models) and the Agent; Prompts, Sources, Comparison, Traffic, Shopping and the Agent open their own pages under them (Shopping: Overview, Brands and Products). Settings is at its foot. The menu under your name shows this month’s usage (prompts, topics, collections and the Agent’s ',
              'A barra lateral lista os relatórios (Visão geral, Prompts, Semantic Branding, Marcas, Fontes, Produtos, Modelos de IA) e o Agente; Prompts, Fontes, Produtos e o Agente abrem as próprias páginas embaixo deles (Produtos: Visão geral, Marcas e Produtos). Configurações fica no rodapé. O menu com o seu nome mostra o uso do mês (prompts, tópicos, coletas e ',
            )}
            {cloud ? l('AI credits', 'os créditos de IA do Agente') : l('project budget', 'o orçamento do projeto')}
            {l(
              '), the interface language, My profile and this documentation. The bar at the top filters every report; filters that do not fit fold into a Filters button. Each screen has its own address, so you can share exactly what you see with your team.',
              '), o idioma da interface, Meu perfil e esta documentação. A barra no topo filtra todos os relatórios; os filtros que não cabem ficam num botão Filtros. Cada tela tem um endereço próprio, então você compartilha com o time exatamente o que está vendo.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'metrics',
      related: ['overview', 'brands', 'filters'],
      group: 'product',
      name: l('Metrics', 'Métricas'),
      title: l('What each number means.', 'O que cada número significa.'),
      description: l(
        'How Lastfind measures visibility, share of voice, position, citations, sentiment and the Semantic Branding score in AI answers, and how topic weights combine them.',
        'Como o Lastfind mede visibilidade, share of voice, posição, citações, sentimento e o score do Semantic Branding nas respostas de IA, e como os tópicos pesam.',
      ),
      subs: [
        { id: 'visibility', label: l('Visibility', 'Visibilidade') },
        { id: 'share-of-voice', label: 'Share of voice' },
        { id: 'position', label: l('Average position', 'Posição média') },
        { id: 'citations', label: l('Citations', 'Citações') },
        { id: 'sentiment', label: l('Sentiment', 'Sentimento') },
        { id: 'semantic-score', label: l('Semantic Branding score', 'Score do Semantic Branding') },
        { id: 'topic-weights', label: l('Topic weights', 'Peso dos tópicos') },
      ],
      body: (
        <>
          <H2 id="visibility">{l('Visibility', 'Visibilidade')}</H2>
          <p>
            {l(
              'The share of valid answers that mention your brand. A mention is the brand’s name in the answer text, not necessarily a recommendation. An AI Overview that Google did not show is not an answer.',
              'A parcela das respostas válidas que citam a sua marca. Menção é o nome da marca no texto da resposta, não necessariamente uma recomendação. Um AI Overview que o Google não mostrou não é resposta.',
            )}
          </p>
          <H2 id="share-of-voice">Share of voice</H2>
          <p>
            {l(
              'Your share of the mentions of every brand in the answers: the ones you monitor and the ones Lastfind discovers. Each brand counts once per answer. Names you rejected, names still in review and names that are a customer, supplier, partner, source or not a brand stay out.',
              'A sua parte nas menções de todas as marcas das respostas: as que você monitora e as que o Lastfind descobre. Cada marca conta uma vez por resposta. Ficam de fora os nomes que você rejeitou, os que ainda estão em revisão e os que são cliente, fornecedor, parceiro, fonte ou não são marca.',
            )}
          </p>
          <H2 id="position">{l('Average position', 'Posição média')}</H2>
          <p>
            {l(
              'Where your brand first appears among the brands of an answer, averaged over the answers that mention it: 1 is first. Lower is better, and it only exists where the brand appears.',
              'Onde a sua marca aparece primeiro entre as marcas de uma resposta, na média das respostas que a citam: 1 é a primeira. Quanto menor, melhor, e só existe onde a marca aparece.',
            )}
          </p>
          <H2 id="citations">{l('Citations', 'Citações')}</H2>
          <p>
            {l(
              'A citation is a link the answer shows as its source. The citation rate is the share of answers that link to one of your domains (primary and additional, set in Brand and market).',
              'Citação é um link que a resposta mostra como fonte. A taxa de citação é a parcela das respostas que trazem link para um dos seus domínios (principal e adicionais, definidos em Marca e mercado).',
            )}
          </p>
          <H2 id="sentiment">{l('Sentiment', 'Sentimento')}</H2>
          <p>
            {l(
              'Each answer gives each brand it names a score from 0 to 100 on fixed criteria, starting at 50: promoter from 60 to 100, neutral from 40 to 59, detractor from 0 to 39. The sentiment index averages the questions, so a question with many answers does not outweigh the others. The bar shows the share of promoter, neutral and detractor answers.',
              'Cada resposta dá a cada marca que cita uma nota de 0 a 100 por critérios fixos, partindo de 50: promotora de 60 a 100, neutra de 40 a 59, detratora de 0 a 39. O índice de sentimento faz a média por pergunta, para que uma pergunta com muitas respostas não pese mais que as outras. A barra mostra a parcela de respostas promotoras, neutras e detratoras.',
            )}
          </p>
          <H2 id="semantic-score">{l('Semantic Branding score', 'Score do Semantic Branding')}</H2>
          <p>
            {l(
              'Each AI gives each brand a note from 0 to 100 on each attribute; a note of 60 or more needs a concrete fact of that attribute. An attribute is the mean across the AIs, and a brand’s score is the mean of its attributes, each weighing the same. The score shown is steadied over the latest collections, because one AI’s note of a brand moves several points from one day to the next with no change in what the AIs say: each AI’s note is a weighted mean of its notes in the last 7 daily collections (3 weekly ones; monthly ones are not steadied), each collection weighing half as much every 2 days (every week). On the production projects this cut the day-to-day movement of a brand’s score two to four times. A real change still shows within a few days: about a third of it the next day, half after two days. The day’s own score is shown under the score, and the justifications keep each AI’s notes of the day. A brand with no note of its own in the period has no score, never one carried from before.',
              'Cada IA dá a cada marca uma nota de 0 a 100 em cada atributo; nota de 60 ou mais exige um fato concreto desse atributo. O atributo é a média entre as IAs, e o score da marca é a média dos atributos, cada um com o mesmo peso. O score mostrado é estabilizado sobre as coletas mais recentes, porque a nota de uma IA para uma marca varia vários pontos de um dia para o outro sem mudança no que as IAs dizem: a nota de cada IA é uma média ponderada das notas dela nas últimas 7 coletas diárias (3 semanais; as mensais não são estabilizadas), e cada coleta pesa metade a cada 2 dias (a cada semana). Nos projetos em produção isso reduziu de duas a quatro vezes a variação diária do score de uma marca. Uma mudança real continua aparecendo em poucos dias: cerca de um terço no dia seguinte e metade depois de dois dias. O score só do dia aparece abaixo do score, e as justificativas guardam as notas de cada IA no dia. Uma marca sem nota própria no período não tem score, nunca um trazido de antes.',
            )}
          </p>
          <H2 id="topic-weights">{l('Topic weights', 'Peso dos tópicos')}</H2>
          <p>
            {l('Rates across topics are weighted averages. Set each topic’s weight in ', 'As taxas entre tópicos são médias ponderadas. Defina o peso de cada tópico em ')}
            <Path>{l('Settings > Monitoring > Topics: weight and models', 'Configurações > Monitoramento > Tópicos: peso e modelos')}</Path>
            {l('; a topic without a weight takes the smallest one.', '; um tópico sem peso recebe o menor.')}
          </p>
          <p>
            {l(
              'A missing number is never shown as zero: when an AI did not answer or a report has no data for the period, the screen says so.',
              'Um número ausente nunca aparece como zero: quando uma IA não respondeu ou o relatório não tem dados no período, a tela diz isso.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'filters',
      related: ['metrics', 'overview'],
      group: 'product',
      name: l('Filters and export', 'Filtros e exportação'),
      title: l('Filter, compare and export.', 'Filtre, compare e exporte.'),
      description: l(
        'Filter every report by period, AI, topic, tag and brand, compare it with another period and export the filtered answers as CSV.',
        'Filtre cada relatório por período, IA, tópico, tag e marca, compare com outro período e exporte as respostas filtradas em CSV.',
      ),
      subs: [],
      body: (
        <>
          <p>{l('The bar at the top of every report filters it:', 'A barra no topo de cada relatório filtra a tela:')}</p>
          <Settings
            rows={[
              [l('Period', 'Período'), l('Today, the last 7, 14, 28 (the default) or 30 days, or a custom range of up to 90 days.', 'Hoje, os últimos 7, 14, 28 (o padrão) ou 30 dias, ou um intervalo personalizado de até 90 dias.')],
              [l('Compare with', 'Comparar com'), l('The previous period of the same length, a custom period, or no comparison. Changes show beside each number.', 'O período anterior de mesma duração, um período personalizado ou nenhuma comparação. A variação aparece ao lado de cada número.')],
              [l('AI models', 'Modelos de IA'), l('One or more AIs, and whether to include answers made with web search.', 'Uma ou mais IAs, e se inclui as respostas feitas com busca na web.')],
              [l('Topics and tags', 'Tópicos e tags'), l('Limit the report to some topics or tags; with several tags, choose answers with any of them or with all.', 'Limite o relatório a alguns tópicos ou tags; com várias tags, escolha respostas com qualquer uma ou com todas.')],
              [l('Brands', 'Marcas'), l('All brands, only the monitored ones, or the ones you pick. It changes which brands are listed, never the numbers. The menu opens on its search box, then lists every brand: yours, the monitored ones, then the discovered ones, most mentioned first.', 'Todas as marcas, só as monitoradas ou as que você escolher. Muda quais marcas aparecem, nunca os números. O menu abre na busca e depois lista todas as marcas: a sua, as monitoradas e as descobertas, das mais citadas para as menos.')],
            ]}
          />
          <p>
            {l(
              'Click a number, an AI, a topic or a brand to open the answers behind it in Responses. Export downloads a CSV of the whole filtered period, not only the visible page. Reports cover up to 90 days; older answers stay stored.',
              'Clique num número, numa IA, num tópico ou numa marca para abrir as respostas por trás dele em Respostas. Exportar baixa um CSV de todo o período filtrado, não só da página visível. Os relatórios cobrem até 90 dias; respostas mais antigas continuam guardadas.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'overview',
      related: ['metrics', 'brands', 'sources'],
      group: 'product',
      name: l('Overview', 'Visão geral'),
      title: l('Overview: the whole picture on one screen.', 'Visão geral: o quadro inteiro numa tela.'),
      description: l(
        'The Overview screen: share of voice, position, visibility, citations and sentiment by AI, the brand trend, the ranking and Semantic Branding.',
        'A tela Visão geral: share of voice, posição, visibilidade, citações e sentimento por IA, a tendência das marcas, o ranking e o Semantic Branding.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="overview"
            alt={l(
              'Overview of the Netflix demo project: share of voice, average position, visibility, citations and sentiment by AI, the brand trend chart and the brand ranking.',
              'Visão geral do projeto de demonstração da Netflix: share of voice, posição média, visibilidade, citações e sentimento por IA, o gráfico de tendência das marcas e o ranking de marcas.',
            )}
          />
          <p>
            {l(
              'The first row shows share of voice, average position, visibility, citations and sentiment, each broken down by AI. Below them: the brand trend (share of voice, visibility or position by day, week or month), the brand ranking, the Semantic Branding radar beside the brands’ scores, coverage by topic, the sources and site types the AIs rely on, and the latest answers. When monitoring is paused or a limit stopped collection, the Overview says which. Every brand chart draws your brand and the nine biggest by default; the legend names the ones drawn, and its +N at the end turns on any other.',
              'A primeira linha mostra share of voice, posição média, visibilidade, citações e sentimento, cada um aberto por IA. Abaixo: a tendência das marcas (share of voice, visibilidade ou posição por dia, semana ou mês), o ranking de marcas, o radar do Semantic Branding ao lado dos scores das marcas, a cobertura por tópico, as fontes e tipos de site em que as IAs se apoiam e as respostas mais recentes. Quando o monitoramento está pausado ou um limite parou a coleta, a Visão geral diz qual. Todo gráfico de marcas desenha a sua marca e as nove maiores por padrão; a legenda nomeia as desenhadas, e o +N no fim liga qualquer outra.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'prompts',
      related: ['settings-monitoring', 'ai-models', 'brands'],
      group: 'product',
      name: l('Prompts and responses', 'Prompts e respostas'),
      title: l('Prompts, responses and Query Fan Out.', 'Prompts, respostas e Query Fan Out.'),
      description: l(
        'Manage the questions you monitor, read every AI answer with its brands, sentiment and sources, and see the searches the AIs ran.',
        'Gerencie as perguntas que você monitora, leia cada resposta de IA com marcas, sentimento e fontes, e veja as buscas que as IAs fizeram.',
      ),
      subs: [
        { id: 'prompts-list', label: 'Prompts' },
        { id: 'responses', label: l('Responses', 'Respostas') },
        { id: 'fan-out', label: 'Query Fan Out' },
      ],
      body: (
        <>
          <H2 id="prompts-list">Prompts</H2>
          <Figure
            priority
            shot="prompts"
            alt={l(
              'The Prompts table with each question’s AI models, tags, visibility, share of voice, sentiment and position.',
              'A tabela de Prompts com os modelos de IA, as tags, a visibilidade, o share of voice, o sentimento e a posição de cada pergunta.',
            )}
          />
          <p>
            {l(
              'Every question with its AIs, tags and metrics for the period. The tabs split Active, Inactive and Archived prompts. Columns chooses what the table shows, More filters narrows it (for example to questions where only competitors appear), and the menu of each row pauses, archives or restores it. Pausing keeps history and the prompt’s place in the account’s limits; archiving frees it. Open a prompt to see its answers, brands and sources over time.',
              'Cada pergunta com as suas IAs, tags e métricas do período. As abas separam prompts Ativos, Inativos e Arquivados. Colunas escolhe o que a tabela mostra, Mais filtros restringe (por exemplo, às perguntas em que só concorrentes aparecem) e o menu de cada linha pausa, arquiva ou restaura. Pausar guarda o histórico e o lugar do prompt nos limites da conta; arquivar libera esse lugar. Abra um prompt para ver as respostas, marcas e fontes ao longo do tempo.',
            )}
          </p>
          <p>
            {l(
              'A question can use the project’s default AIs, its topic’s or its own: the most specific choice applies.',
              'Uma pergunta pode usar as IAs padrão do projeto, as do seu tópico ou as suas: vale a escolha mais específica.',
            )}
          </p>
          <H2 id="responses">{l('Responses', 'Respostas')}</H2>
          <Figure
            shot="responses"
            alt={l(
              'Responses: the collected answers, filtered to those that mention the brand, with the AI, the date and the brands named.',
              'Respostas: as respostas coletadas, filtradas às que citam a marca, com a IA, a data e as marcas citadas.',
            )}
          />
          <p>
            {l(
              'Every collected answer, with filters by AI, mention and citation. Open one to read the original text as the AI wrote it, the brands it names with their sentiment and the reason, and the links it cited or consulted. This is the evidence behind every number.',
              'Cada resposta coletada, com filtros por IA, menção e citação. Abra uma para ler o texto original como a IA escreveu, as marcas citadas com o sentimento e o motivo, e os links que ela citou ou consultou. É a evidência por trás de cada número.',
            )}
          </p>
          <H2 id="fan-out">Query Fan Out</H2>
          <p>
            {l(
              'The searches the AIs ran on the web to answer your prompts, grouped by intent. They show what an AI looks for before it recommends, and which pages it may find.',
              'As buscas que as IAs fizeram na web para responder aos seus prompts, agrupadas por intenção. Elas mostram o que uma IA procura antes de recomendar e quais páginas ela pode encontrar.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'brands',
      related: ['settings-competitors', 'metrics', 'sources'],
      group: 'product',
      name: l('Brands', 'Marcas'),
      title: l('Brands: you and every competitor the AIs name.', 'Marcas: você e cada concorrente que as IAs citam.'),
      description: l(
        'One ranking of your brand, the competitors you monitor and the brands the AIs name, with share of voice, visibility, position and sentiment.',
        'Um ranking da sua marca, dos concorrentes que você monitora e das marcas que as IAs citam, com share of voice, visibilidade, posição e sentimento.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="brands"
            alt={l(
              'The Brands ranking with share of voice, mentions, visibility, position and sentiment for each brand.',
              'O ranking de Marcas com share of voice, menções, visibilidade, posição e sentimento de cada marca.',
            )}
          />
          <p>
            {l(
              'One ranking of your brand, the competitors you monitor and the brands Lastfind discovers in the answers, with share of voice, mentions, visibility, position and sentiment. In the top bar’s Brands menu, On this screen switches to Discovered, to decide or Rejected to review new names.',
              'Um ranking da sua marca, dos concorrentes que você monitora e das marcas que o Lastfind descobre nas respostas, com share of voice, menções, visibilidade, posição e sentimento. No menu Marcas da barra do topo, Nesta tela troca para Descobertas, para decidir ou Rejeitadas para revisar nomes novos.',
            )}
          </p>
          <Settings
            rows={[
              [l('Monitor', 'Monitorar'), l('Makes a discovered brand a tracked competitor. Review or confirm its domain first, so citations count for it.', 'Transforma uma marca descoberta em concorrente acompanhado. Revise ou confirme o domínio antes, para as citações contarem para ela.')],
              [l('Reject', 'Rejeitar'), l('Takes a name out of share of voice; Reopen brings it back.', 'Tira um nome do share of voice; Reabrir traz de volta.')],
              [l('Merge', 'Mesclar'), l('Joins two names of the same brand. Undo reverses a decision.', 'Junta dois nomes da mesma marca. Desfazer reverte uma decisão.')],
            ]}
          />
          <p>
            {l(
              'Open a brand to see its trend, the questions where it appears and the answers behind its sentiment. Brand decisions reinterpret up to the 10,000 newest saved answers of the last 90 days without asking the AIs again.',
              'Abra uma marca para ver a tendência, as perguntas em que ela aparece e as respostas por trás do sentimento. As decisões sobre marcas reinterpretam até as 10.000 respostas salvas mais recentes dos últimos 90 dias, sem perguntar de novo às IAs.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'sources',
      related: ['brands', 'prompts'],
      group: 'product',
      name: l('Sources', 'Fontes'),
      title: l('Sources: the pages behind the answers.', 'Fontes: as páginas por trás das respostas.'),
      description: l(
        'The domains and pages the AIs cite or consult when they answer, with each one’s site type, owner and how often it appears.',
        'Os domínios e as páginas que as IAs citam ou consultam ao responder, com o tipo de site, o dono e a frequência de cada um.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="sources"
            alt={l(
              'Sources by domain, with how often each one is cited or consulted, its site type and its owner.',
              'Fontes por domínio, com a frequência com que cada uma é citada ou consultada, o tipo de site e o dono.',
            )}
          />
          <p>
            {l(
              'The domains and URLs the AIs rely on. A cited source is a link shown with the answer; a consulted source is a page the AI reports reading, cited or not. Filter All sources, Cited or Consulted. Each source has a Site type (corporate, editorial, press, UGC, social, reference…), a Content type (article, comparison, listicle, product page…) and an Owner (you, a competitor or a third party). Open a domain or URL to see the prompts and answers that use it.',
              'Os domínios e URLs em que as IAs se apoiam. Fonte citada é um link mostrado com a resposta; fonte consultada é uma página que a IA informa ter lido, citada ou não. Filtre Todas as fontes, Citadas ou Consultadas. Cada fonte tem um Tipo de site (corporativo, editorial, imprensa, UGC, social, referência…), um Tipo de conteúdo (artigo, comparação, lista, página de produto…) e um Dono (você, um concorrente ou um terceiro). Abra um domínio ou URL para ver os prompts e as respostas que o usam.',
            )}
          </p>
          <p>
            {l(
              'Not every AI reports the pages it consulted. AI models shows which ones do; an AI that does not is unavailable data, not an empty list.',
              'Nem toda IA informa as páginas que consultou. Modelos de IA mostra quais informam; uma IA que não informa é dado indisponível, não lista vazia.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'products',
      related: ['prompts', 'sources'],
      group: 'product',
      name: l('Shopping', 'Shopping'),
      title: l('Shopping: your brand in the AIs’ shopping cards.', 'Shopping: a sua marca nos cartões de compra das IAs.'),
      description: l(
        'How often ChatGPT, Google AI Mode and AI Overviews answer with product cards, your brand in them, the top products and the stores.',
        'Com que frequência o ChatGPT, o Google AI Mode e o AI Overviews respondem com cartões de produto, a sua marca neles, os produtos principais e as lojas.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="products"
            alt={l(
              'Shopping overview: the share of answers with product cards, your brand in the cards, your position, the top products and the stores.',
              'Visão geral de Shopping: a parcela de respostas com cartões de produto, a sua marca nos cartões, a sua posição, os produtos principais e as lojas.',
            )}
          />
          <p>
            {l(
              'When someone asks what to buy, ChatGPT, Google AI Mode and AI Overviews can answer with product cards. Shopping reads those cards in the answers you already monitor, with no extra question: Overview shows how often cards appear and your brand’s place in them, Brands ranks the brands in the cards, and Products lists every product with its price, stores and position. Each page has its own item under Shopping in the sidebar, with the path at the top of the screen. Open a brand to see its products, stores and position day by day, or a product to see its price range, the rating its cards showed, its prompts and the answers that showed it.',
              'Quando alguém pergunta o que comprar, o ChatGPT, o Google AI Mode e o AI Overviews podem responder com cartões de produto. Shopping lê esses cartões nas respostas que você já monitora, sem pergunta extra: Visão geral mostra com que frequência aparecem cartões e o lugar da sua marca neles, Marcas ordena as marcas dos cartões e Produtos lista cada produto com preço, lojas e posição. Cada página tem o seu item em Shopping na barra lateral, com o caminho no topo da tela. Abra uma marca para ver os produtos, as lojas e a posição dia a dia, ou um produto para ver a faixa de preço, a nota que os cartões mostraram, os prompts e as respostas que o mostraram.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'comparison',
      related: ['semantic-branding', 'settings-competitors', 'settings-monitoring'],
      group: 'product',
      name: l('Comparison', 'Comparação'),
      title: l('Comparison: does the AI pick you?', 'Comparação: a IA escolhe você?'),
      description: l(
        'The AIs score your brand and its competitors on each attribute, with a fact behind every score: see your score, win rate and ranking.',
        'As IAs dão nota à sua marca e aos concorrentes em cada atributo, com um fato por trás: veja a sua nota, a taxa de vitória e o ranking.',
      ),
      subs: [
        { id: 'comparison-setup', label: l('Products, attributes and personas', 'Produtos, atributos e personas') },
        { id: 'comparison-question', label: l('The question', 'A pergunta') },
        { id: 'comparison-metrics', label: l('What the screens show', 'O que as telas mostram') },
        { id: 'comparison-limits', label: l('AIs, frequency and limits', 'IAs, frequência e limites') },
      ],
      body: (
        <>
          <p>
            {l(
              'Buyers ask AIs to compare products more than to discover them. Comparison asks the AIs that question for your brand and shows how often they pick it. Its section in the project menu has four pages: Overview, Products, Attributes and Personas.',
              'O comprador pede às IAs para comparar produtos mais do que para descobri-los. A Comparação faz essa pergunta às IAs pela sua marca e mostra com que frequência elas a escolhem. A seção dela no menu do projeto tem quatro páginas: Visão geral, Produtos, Atributos e Personas.',
            )}
          </p>
          <H2 id="comparison-setup">{l('Products, attributes and personas', 'Produtos, atributos e personas')}</H2>
          <p>
            {l(
              'A product is something your brand sells, such as "SEO consulting". Each product has its own competitors, taken from the project’s competitors or added by hand (up to 10), and its own attributes (1 to 8), chosen from the project’s attribute library, where attributes sit in groups you reuse across products. You may import Semantic Branding’s attributes; they are never added on their own. Personas are the kinds of buyer you sell to: three are suggested from your site, and you can edit them and add up to 10.',
              'Um produto é algo que a sua marca vende, como "consultoria de SEO". Cada produto tem os seus concorrentes, tirados dos concorrentes do projeto ou acrescentados à mão (até 10), e os seus atributos (1 a 8), escolhidos na biblioteca de atributos do projeto, onde os atributos ficam em grupos que você reaproveita entre produtos. Você pode importar os atributos do Semantic Branding; eles nunca entram sozinhos. Personas são os perfis de comprador para quem você vende: três são sugeridas a partir do seu site, e você pode editá-las e chegar a 10.',
            )}
          </p>
          <p>
            {l(
              'Generate products and attributes, on the Products page, reads your site’s home page and suggests products, the attributes of each (shared between products when it makes sense) and personas. Nothing is saved until you pick what to keep. The New project wizard offers the same step, Comparison, which you can skip.',
              'Gerar produtos e atributos, na página Produtos, lê a página inicial do seu site e sugere produtos, os atributos de cada um (compartilhados entre produtos quando faz sentido) e personas. Nada é salvo até você escolher o que fica. O assistente de Novo projeto tem o mesmo passo, Comparação, que você pode pular.',
            )}
          </p>
          <H2 id="comparison-question">{l('The question', 'A pergunta')}</H2>
          <p>
            {l(
              'Each period, every AI is asked one question per product and persona: "Which {product} is best for {persona}? Options: {options}." For each attribute it ranks the options and gives each a score from 0 to 100, with one checkable fact about that option. The scale is the one Semantic Branding uses: 60 or more only with a fact, 80 or more only when the option stands out, 90 or more for one option per attribute. The options are your brand and that product’s competitors, in a new random order in every question, and none is marked as yours.',
              'A cada período, cada IA recebe uma pergunta por produto e persona: "Qual {produto} é melhor para {persona}? Opções: {opções}." Em cada atributo ela ordena as opções e dá a cada uma nota de 0 a 100, com um fato verificável daquela opção. A escala é a mesma do Semantic Branding: 60 ou mais só com um fato, 80 ou mais só quando a opção se destaca, 90 ou mais para uma opção por atributo. As opções são a sua marca e os concorrentes daquele produto, numa ordem sorteada a cada pergunta, e nenhuma é marcada como sua.',
            )}
          </p>
          <p>
            {l(
              'Lastfind copies each score and its fact out of every answer, then checks it: a score of 60 or more with no fact behind it counts as 59; an answer whose order on an attribute contradicts its own scores, one with a fact for almost none of its scores, or one with no score at all is discarded. It is counted as a discarded answer, with the reason, and never enters any figure or counts as a zero. An answer that could not be read is tried again and never counts as a loss.',
              'O Lastfind copia de cada resposta as notas e os fatos e depois confere: nota 60 ou mais sem fato que a sustente conta como 59; uma resposta cuja ordem num atributo contradiz as próprias notas, uma com fato para quase nenhuma das notas ou uma sem nenhuma nota é descartada. Ela é contada como resposta descartada, com o motivo, e nunca entra em nenhum número nem conta como zero. Uma resposta que não pôde ser lida é lida de novo e nunca conta como derrota.',
            )}
          </p>
          <H2 id="comparison-metrics">{l('What the screens show', 'O que as telas mostram')}</H2>
          <p>
            {l(
              'Every figure comes from the attribute scores, so they never contradict each other. In each answer the overall score of an option is the mean of its attribute scores; the places and the winner, the single highest score, follow from it. The screens show the mean score, the win rate (the answers your brand wins, out of those where it was an option) and the average position, overall, on each attribute, for each product and each persona, beside every competitor, and the discarded answers. Each product has its own page: its scores against each competitor, their evolution in the period, the fact behind each AI’s score and the answers themselves. Overview filters by product and persona; the header’s AI and period apply everywhere. A figure without answers shows a dash, never zero.',
              'Todos os números vêm das notas por atributo, então nunca se contradizem. Em cada resposta, a nota geral de uma opção é a média das notas dela nos atributos; o lugar e o vencedor, a maior nota sozinha, vêm dela. As telas mostram a nota média, a taxa de vitória (as respostas que a sua marca vence, entre aquelas em que era opção) e a posição média, no geral, em cada atributo, por produto e por persona, ao lado de cada concorrente, e as respostas descartadas. Cada produto tem a sua página: as notas contra cada concorrente, a evolução no período, o fato por trás da nota de cada IA e as próprias respostas. A Visão geral filtra por produto e persona; a IA e o período do cabeçalho valem em todas as páginas. Um número sem respostas aparece como um traço, nunca como zero.',
            )}
          </p>
          <H2 id="comparison-limits">{l('AIs, frequency and limits', 'IAs, frequência e limites')}</H2>
          <p>
            {l(
              'ChatGPT, Gemini and Google AI Mode are asked, among the AIs your project monitors. Google AI Overviews answers a search and cannot take instructions, so it shows as not asked, with that reason; an AI not served in your project’s country is left out, and the screen says why. The questions follow your project’s collection: once a day, or once a week on a weekly plan (Settings > Monitoring). A product or persona you add is asked in the same period. Each question counts against the project’s monthly budget.',
              'São perguntados o ChatGPT, o Gemini e o Google AI Mode, entre as IAs que o projeto monitora. O Google AI Overviews responde a uma busca e não aceita instruções, então aparece como não perguntado, com esse motivo; uma IA que não atende o país do projeto fica de fora, e a tela diz por quê. As perguntas seguem a coleta do projeto: uma vez por dia, ou uma vez por semana num plano semanal (Configurações > Monitoramento). Um produto ou persona que você acrescenta é perguntado no mesmo período. Cada pergunta conta no orçamento mensal do projeto.',
            )}
          </p>
          {cloud ? (
            <p>
              {l(
                'Comparison is in every plan. The free plan compares up to 3 products on its one AI, ChatGPT, once a week.',
                'A Comparação está em todos os planos. O plano grátis compara até 3 produtos na única IA dele, o ChatGPT, uma vez por semana.',
              )}
            </p>
          ) : null}
        </>
      ),
    },
    aiBotsDocsSection(l),
    {
      id: 'ai-models',
      related: ['settings-monitoring', 'metrics'],
      group: 'product',
      name: l('AI models', 'Modelos de IA'),
      title: l('AI models: compare the AIs side by side.', 'Modelos de IA: compare as IAs lado a lado.'),
      description: l(
        'Compare the AIs side by side: every metric by AI, where your brand is strong or missing, and which AIs report the pages they read.',
        'Compare as IAs lado a lado: cada métrica por IA, onde a sua marca é forte ou falta, e quais IAs informam as páginas que leram.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="ai-models"
            alt={l(
              'AI models: visibility, share of voice, position, citations and sentiment for each AI, and whether it reports consulted sources.',
              'Modelos de IA: visibilidade, share of voice, posição, citações e sentimento de cada IA, e se ela informa as fontes consultadas.',
            )}
          />
          <p>
            {l(
              'Every metric by AI, to see where your brand is strong and where it is missing. The Consulted sources provided column says whether each AI reports the pages it read; a dash means it does not send that list.',
              'Cada métrica por IA, para ver onde a sua marca é forte e onde falta. A coluna Fontes consultadas informadas diz se cada IA informa as páginas que leu; um traço quer dizer que ela não envia essa lista.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'semantic-branding',
      related: ['settings-semantic', 'brands'],
      group: 'product',
      name: 'Semantic Branding',
      title: l('Semantic Branding: what the AIs associate with your brand.', 'Semantic Branding: o que as IAs associam à sua marca.'),
      description: l(
        'Each AI scores your brand and your competitors from 0 to 100 on the attributes buyers compare, with the reason and sources behind every score.',
        'Cada IA dá à sua marca e aos concorrentes uma nota de 0 a 100 nos atributos que os compradores comparam, com o motivo e as fontes de cada nota.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="semantic-branding"
            alt={l(
              'Semantic Branding: each brand’s score from 0 to 100 on the attributes buyers compare, as rated by each AI.',
              'Semantic Branding: a nota de 0 a 100 de cada marca nos atributos que os compradores comparam, segundo cada IA.',
            )}
          />
          <p>
            {l(
              'Lastfind asks each AI your project monitors to score your brand and your competitors from 0 to 100 on the attributes buyers compare (value for money, catalogue, ease of use…), on one scale: 0–59 the attribute is weakly perceived by the market, 60–79 well perceived, 80–89 fully perceived with good quality, 90–100 fully recognised by the market as the reference for excellence (one brand per attribute at most). Each AI first ranks the brands on the attribute, then scores them: brands ranked apart are at least 5 points apart. Every score of 60 or more needs evidence: a concrete fact of that attribute, with its source when the AI gives one, or the words of the answer it was read from; a brand the AI barely knows, or without a fact, stays at 59 or below. It keeps the reason, the evidence and the sources behind every score. Summary gives the overall score by AI; Associations (Who is associated with what) shows the AIs’ mean score for each brand on each attribute, with a trophy on the highest and a competitor less than 5 points from your brand in gray (margin of error), and a cell opens its justification; Radar draws your brand and the nine highest scores on the same chart, its legend hides or shows each one and its +N adds the others; Justifications and Sources show why.',
              'O Lastfind pede a cada IA que o seu projeto monitora que dê à sua marca e aos concorrentes uma nota de 0 a 100 nos atributos que os compradores comparam (custo-benefício, catálogo, facilidade de uso…), numa escala só: 0–59 o atributo é pouco percebido pelo mercado, 60–79 bem percebido, 80–89 totalmente percebido, com boa qualidade, 90–100 totalmente reconhecido pelo mercado como a referência em excelência (uma marca por atributo no máximo). Cada IA primeiro ordena as marcas no atributo e depois dá as notas: marcas em posições diferentes ficam a pelo menos 5 pontos. Toda nota de 60 ou mais exige evidência: um fato concreto desse atributo, com a fonte quando a IA a dá, ou as palavras da resposta de onde a nota foi lida; marca que a IA mal conhece, ou sem fato, fica em 59 ou menos. Guarda o motivo, as evidências e as fontes de cada nota. Resumo traz a nota geral por IA; Associações (Quem é associado a quê) mostra a média das notas das IAs para cada marca em cada atributo, com um troféu na maior e em cinza o concorrente a menos de 5 pontos da sua marca (margem de erro), e uma célula abre a justificativa; Radar desenha a sua marca e as nove maiores notas no mesmo gráfico, a legenda esconde ou mostra cada uma e o +N acrescenta as outras; Justificativas e Fontes mostram o porquê.',
            )}
          </p>
          <p>
            {l(
              'Every AI your project monitors is asked the same way as in the daily collection, in English or Portuguese: ChatGPT, Gemini, Google AI Mode and AI Overviews in what a person sees, with the AI’s own search. AI Overviews answers one search for every group of up to five brands, so every brand gets its turn. An AI enabled after today’s collection joins the next one. A brand you just added shows “Next round” in its cells until the next collection asks about it. Facts are given only when the AI is sure.',
              'Cada IA que o seu projeto monitora é perguntada do mesmo jeito que na coleta diária, em inglês ou português: ChatGPT, Gemini, Google AI Mode e AI Overviews no que uma pessoa vê, com a busca da própria IA. O AI Overviews responde uma busca para cada grupo de até cinco marcas, para toda marca ter a vez. Uma IA ligada depois da coleta do dia entra na próxima. Uma marca que você acabou de adicionar mostra “Próxima rodada” nas células até a próxima coleta perguntar sobre ela. Fatos só vêm quando a IA tem certeza.',
            )}
          </p>
          <p>
            {l('Turn it on and choose 3 to 10 attributes in ', 'Ative e escolha de 3 a 10 atributos em ')}
            <Path>{l('Settings > Semantic Branding', 'Configurações > Semantic Branding')}</Path>
            {l(
              '. One AI is enough for a score; with two or more it also shows a margin. The period and AI filters apply; topics and tags do not, because it asks its own questions. The info icon beside each block explains how it is calculated.',
              '. Uma IA basta para o score; com duas ou mais ele mostra também a margem. Os filtros de período e de IA valem; tópicos e tags não, porque ele faz as próprias perguntas. O ícone de informação ao lado de cada bloco explica o cálculo.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'agent',
      related: ['settings-agent', 'ai-apps'],
      group: 'product',
      name: l('Agent', 'Agente'),
      title: l('The Agent: ask your data, create content.', 'O Agente: pergunte aos seus dados, crie conteúdo.'),
      description: l(
        'Ask your data in plain language, get documents, reports and tables, write SEO content measured against Google’s top results and teach it your brand.',
        'Pergunte aos seus dados em linguagem comum, receba documentos, relatórios e tabelas, escreva conteúdo SEO medido contra o topo do Google e ensine a sua marca.',
      ),
      subs: [
        { id: 'agent-chat', label: 'Chat' },
        { id: 'agent-contents', label: l('Contents and artifacts', 'Conteúdos e artefatos') },
        { id: 'agent-brain', label: l('Brain and skills', 'Cérebro e skills') },
      ],
      body: (
        <>
          <p>
            {cloud
              ? l(
                  'The Agent comes with every plan’s AI credits, Free’s 1,000 a month included. It answers with the same numbers you see in the reports and asks before changing prompts, topics or other project data; what it changes in the Brain, Memory and skills shows in the chat and can be undone.',
                  'O Agente vem com os créditos de IA de todo plano, incluídos os 1.000 por mês do Free. Ele responde com os mesmos números que você vê nos relatórios e pede aprovação antes de mudar prompts, tópicos e outros dados do projeto; o que ele muda no Cérebro, na Memória e nas skills aparece no chat e pode ser desfeito.',
                )
              : l(
                  'The Agent answers with the same numbers you see in the reports and asks before changing prompts, topics or other project data; what it changes in the Brain, Memory and skills shows in the chat and can be undone. It uses the installation’s model key (Admin > Providers) and the project’s budget.',
                  'O Agente responde com os mesmos números que você vê nos relatórios e pede aprovação antes de mudar prompts, tópicos e outros dados do projeto; o que ele muda no Cérebro, na Memória e nas skills aparece no chat e pode ser desfeito. Ele usa a chave de modelos da instalação (Admin > Provedores) e o orçamento do projeto.',
                )}
          </p>
          <H2 id="agent-chat">Chat</H2>
          <p>
            {l(
              'Ask in plain language, for example “which competitor grew most in ChatGPT this month?”, and attach a PDF, a spreadsheet or an image for context. While it works, the last line of its message, after the text and artifacts so far, says what it is doing now in words, with a timer: the step under way (“Searching the web…”), or Thinking…; while it writes, a thin cursor marks the end of the text. The steps already done stay at the top, each with how long it took, and fold into “Thought for 12 s” when it ends; one that failed has a red dot and says why. A conversation still answering shows a small spinner in the list, and a dot when a new answer is waiting for you. A message sent meanwhile steers the next step. The artifact or content the chat is about stays on screen but read-only until the answer ends, under a banner that says “Editing the artifact…” with a timer and Stop, so your edits and the Agent’s never overlap; what it changed is highlighted for a moment when it lands. A short message, such as a greeting, gets a quick answer. Your conversations are listed beside the chat and only you see them. Rate an answer to teach it.',
              'Pergunte em linguagem comum, por exemplo “qual concorrente mais cresceu no ChatGPT este mês?”, e anexe um PDF, uma planilha ou uma imagem para dar contexto. Enquanto trabalha, a última linha da mensagem, depois do texto e dos artefatos já feitos, diz em palavras o que ele faz agora, com um cronômetro: a etapa em andamento (“Pesquisando na web…”), ou Pensando…; enquanto escreve, um cursor fino marca o fim do texto. As etapas concluídas ficam no topo, cada uma com quanto levou, e dobram em “Pensou por 12 s” quando ele termina; uma que falhou tem um ponto vermelho e diz o motivo. Uma conversa que ainda responde mostra um spinner pequeno na lista, e um ponto quando há uma resposta nova esperando por você. Uma mensagem enviada nesse meio-tempo direciona a próxima etapa. O artefato ou o conteúdo de que o chat trata continua na tela, mas só para leitura até a resposta terminar, com um aviso “Editando o artefato…” com cronômetro e Parar, para que as suas edições e as do Agente nunca se cruzem; o que ele mudou fica destacado por um momento quando chega. Uma mensagem curta, como um cumprimento, recebe uma resposta rápida. As suas conversas ficam listadas ao lado do chat e só você as vê. Avalie uma resposta para ensiná-lo.',
            )}
          </p>
          <p>
            {l(
              'Ask Lastfind, at the bottom right of every project screen, opens the same chat in a panel floating over the screen; Pin to the side keeps it as a sidebar on the right (a full-height sheet on a phone), Open in a new window takes the conversation to its own window (Back to the panel brings it home), and Close leaves only the button. It knows the page you are on, with its period, filters and the item open there, and suggests questions about it, such as “summarize what matters on this page” or “explain these metrics”; the answer cites the numbers that screen shows and links to it. Its conversations are the chat’s own: History lists them. An artifact’s Chat opens in the same panel.',
              'O Ask Lastfind, no canto inferior direito de todas as telas do projeto, abre o mesmo chat num painel flutuante sobre a tela; Fixar na lateral o mantém como barra lateral à direita (uma folha de altura inteira no celular), Abrir em nova janela leva a conversa para uma janela própria (Voltar ao painel a traz de volta) e Fechar deixa só o botão. Ele sabe em que página você está, com período, filtros e o item aberto, e sugere perguntas sobre ela, como “resuma o que importa nesta página” ou “explique estas métricas”; a resposta cita os números dessa tela e aponta para ela. As conversas são as do próprio chat: Histórico lista todas. O Chat de um artefato abre no mesmo painel.',
            )}
          </p>
          <H2 id="agent-contents">{l('Contents and artifacts', 'Conteúdos e artefatos')}</H2>
          <p>
            {l(
              'An artifact is what the Agent writes for you: a document, a report, a table, a brief or a content piece, each with its own icon. When you do not name a type, it makes a document, the general kind; a report is a data report, and a content piece is marketing text to publish, such as a blog post, an article for search, a landing page or a product page. Charts go inside an artifact. Artifacts with live data can update themselves, and Share creates a public link anyone can read. Contents are those pieces to publish: each has an Overview (title tag, meta description, slug and the comparison with the pages that rank today), the Content itself, an Outline and the Research it used, in a panel at the page’s right edge that folds to one button without moving the text. A content piece or an artifact opened from its list is a page of its own, without the chat: a back arrow returns to the list, the type’s icon sits before the title, and Chat opens the conversation beside it. New artifact, on the Artifacts list, starts a blank document for you to write or to ask the Agent about. In More, Width sets how wide the text reads: Narrow, Standard (an A4 sheet, the default), Wide or Full width, kept for each artifact on this device. Opportunities lists the questions where competitors appear and you do not, with Create content beside each one.',
              'Um artefato é o que o Agente escreve para você: um documento, um relatório, uma tabela, um brief ou um conteúdo, cada um com o seu ícone. Quando você não diz o tipo, ele cria um documento, o tipo geral; relatório é o relatório de dados, e conteúdo é o texto de marketing para publicar, como um post de blog, um artigo para a busca, uma landing page ou uma página de produto. Gráficos vão dentro de um artefato. Artefatos com dados ao vivo podem se atualizar sozinhos, e Compartilhar cria um link público que qualquer pessoa lê. Conteúdos são esses textos para publicar: cada um tem Visão geral (title tag, meta description, slug e a comparação com as páginas que ranqueiam hoje), o Conteúdo em si, um Outline e a Pesquisa usada, num painel na borda direita da página que se recolhe num botão sem mover o texto. Um conteúdo ou um artefato aberto pela sua lista é uma página própria, sem o chat: a seta de voltar leva à lista, o ícone do tipo fica antes do título, e o botão Chat abre a conversa ao lado. Novo artefato, na lista de Artefatos, começa um documento em branco para você escrever ou pedir ao Agente. Em Mais, Largura define a largura do texto: Estreita, Padrão (uma folha A4, o padrão), Larga ou Largura total, guardada para cada artefato neste dispositivo. Oportunidades lista as perguntas em que concorrentes aparecem e você não, com Criar conteúdo ao lado de cada uma.',
            )}
          </p>
          <p>
            {l(
              'Before a content piece’s first draft, the Agent reads the Brain and searches what your own site already published on the topic, so your pages back the text as first-hand evidence. It then reads the top three Google results; Lastfind counts their words and yours, and a page it could not read is marked as not read, never estimated.',
              'Antes do primeiro rascunho de um conteúdo, o Agente lê o Cérebro e pesquisa o que o seu próprio site já publicou sobre o tema, para que as suas páginas sustentem o texto como evidência de primeira mão. Depois lê os três primeiros resultados do Google; o Lastfind conta as palavras deles e as suas, e uma página que não pôde ser lida aparece como não lida, nunca estimada.',
            )}
          </p>
          <H2 id="agent-brain">{l('Brain and skills', 'Cérebro e skills')}</H2>
          <p>
            {l(
              'The Brain holds what the Agent must know about your brand (positioning, products, audience, voice), read on every turn; Generate with AI drafts it from your website, and you keep only what is right. Memory keeps what the team taught in conversations. Skills are repeatable ways of working, such as how to write a comparison page; the Agent can propose a new skill from work your team repeats, and you turn each one on or off. Agent > Skills lists them like artifacts, all with the same skill icon, with a search and a status filter.',
              'O Cérebro guarda o que o Agente precisa saber da sua marca (posicionamento, produtos, público, tom de voz) e é lido em todo turno; Gerar com IA faz um rascunho a partir do seu site, e você fica só com o que está certo. A Memória guarda o que o time ensinou nas conversas. Skills são formas de trabalhar que se repetem, como escrever uma página de comparação; o Agente pode propor uma skill nova a partir de um trabalho que o time repete, e você liga ou desliga cada uma. Agente > Skills lista as skills como os artefatos, todas com o mesmo ícone de skill, com busca e filtro de status.',
            )}
          </p>
          <p>
            {l('What the Agent spends counts toward the project’s monthly budget, when it has one (', 'O que o Agente gasta entra no orçamento mensal do projeto, quando ele tem um (')}
            <Path>{l('Settings > Monitoring > Budget', 'Configurações > Monitoramento > Orçamento')}</Path>
            {l('). ', '). ')}
            {cloud
              ? l(
                  'On Cloud it uses the workspace’s AI credits, shared by all its projects and apart from collection: 1 US cent of AI cost is 10 credits, and Free comes with 1,000 a month. The menu under your name, at the foot of the sidebar, shows the credits left this month on every project screen, always in whole credits, and counts them down while an answer spends them.',
                  'No Cloud ele usa os créditos de IA do workspace, divididos entre todos os projetos e separados da coleta: 1 centavo de dólar de custo de IA vale 10 créditos, e o Free vem com 1.000 por mês. O menu com o seu nome, no pé da barra lateral, mostra os créditos restantes no mês em todas as telas do projeto, sempre em créditos inteiros, e os desconta enquanto uma resposta os gasta.',
                )
              : l(
                  'The menu under your name, at the foot of the sidebar, shows what is left of the project’s budget this month, or what it spent when it has no budget.',
                  'O menu com o seu nome, no pé da barra lateral, mostra quanto resta do orçamento do projeto no mês, ou quanto ele gastou quando não tem orçamento.',
                )}
          </p>
        </>
      ),
    },
    {
      id: 'settings-brand',
      related: ['settings-competitors', 'semantic-branding'],
      group: 'settings',
      name: l('Brand and market', 'Marca e mercado'),
      title: l('Brand and market.', 'Marca e mercado.'),
      description: l(
        'How Lastfind recognizes your brand (name, variations and domains) and the market it asks in: country, language, category and audience.',
        'Como o Lastfind reconhece a sua marca (nome, variações e domínios) e o mercado em que pergunta: país, idioma, categoria e público.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="settings-brand"
            alt={l(
              'Settings, Brand and market: brand identity, market and project address.',
              'Configurações, Marca e mercado: identidade da marca, mercado e endereço do projeto.',
            )}
          />
          <p>
            {cloud
              ? l(
                  'How Lastfind recognizes your brand and where it asks. Viewers only read Settings; members and above change project settings. Every card saves with Save changes.',
                  'Como o Lastfind reconhece a sua marca e onde pergunta. Leitores só leem as Configurações; membros e acima alteram as configurações do projeto. Cada cartão salva com Salvar alterações.',
                )
              : l(
                  'How Lastfind recognizes your brand and where it asks. Every card saves with Save changes.',
                  'Como o Lastfind reconhece a sua marca e onde pergunta. Cada cartão salva com Salvar alterações.',
                )}
          </p>
          <Settings
            rows={[
              [l('Brand identity', 'Identidade da marca'), l('Brand name, primary domain, name variations and additional domains. Variations catch other spellings; domains decide which citations are yours. Changes reinterpret saved answers.', 'Nome da marca, domínio principal, variações do nome e domínios adicionais. As variações pegam outras grafias; os domínios decidem quais citações são suas. Alterações reinterpretam as respostas salvas.')],
              [l('Market', 'Mercado'), l('Country, language of prompts and answers, category and audience: where and in which language the AIs are asked, and the context for suggestions.', 'País, idioma dos prompts e respostas, categoria e público: onde e em que idioma as IAs são consultadas, e o contexto das sugestões.')],
              [l('Project link', 'Link do projeto'), l('The link that opens this project: a short code, never its name, so renaming the project keeps it.', 'O link que abre este projeto: um código curto, nunca o nome, então renomear o projeto o mantém.')],
              [l('Danger zone', 'Zona de perigo'), l('Owner only. Archive project stops monitoring and removes the project from the project menu, keeping its history (Settings > Projects brings it back). Delete project, after typing the project’s name, stops its collections at once and deletes for good its answers, original AI answers, reports, prompts, topics, competitors, schedule, agent conversations, artifacts, contents, Brain and backups; usage and spending records stay, as the plan counts them. It cannot be undone.', 'Só o dono. Arquivar projeto para o monitoramento e tira o projeto do menu, guardando o histórico (Configurações > Projetos o traz de volta). Excluir projeto, depois de digitar o nome do projeto, para as coletas na hora e exclui para sempre as respostas, as respostas originais das IAs, relatórios, prompts, tópicos, concorrentes, agenda, conversas, artefatos, conteúdos e Cérebro do agente e os backups; os registros de uso e gasto ficam, como o plano os conta. Não dá para desfazer.')],
            ]}
          />
        </>
      ),
    },
    {
      id: 'settings-competitors',
      related: ['brands', 'settings-brand'],
      group: 'settings',
      name: l('Competitors', 'Concorrentes'),
      title: l('Competitor settings.', 'Configurações de concorrentes.'),
      description: l(
        'The competitors you monitor, up to 10 with their domains, and how brand discovery and sentiment read the other brands in the answers.',
        'Os concorrentes que você monitora, até 10 com os seus domínios, e como a descoberta de marcas e o sentimento leem as outras marcas das respostas.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="settings-competitors"
            alt={l('Settings, Competitors: the competitor list and brand discovery.', 'Configurações, Concorrentes: a lista de concorrentes e a descoberta de marcas.')}
          />
          <Settings
            rows={[
              [l('Competitor list', 'Lista de concorrentes'), l('Up to 10 competitors with their domains: Add competitor, Edit, Remove (type the name to confirm).', 'Até 10 concorrentes com os seus domínios: Adicionar concorrente, Editar, Remover (digite o nome para confirmar).')],
              [l('Brand discovery and sentiment', 'Descoberta de marcas e sentimento'), l('Turns on the evaluation that reads the sentiment of each brand and the type of each source, and suggests competitors found in comparable answers, with the evidence, for you to add.', 'Liga a avaliação que lê o sentimento de cada marca e o tipo de cada fonte, e sugere concorrentes encontrados em respostas comparáveis, com as evidências, para você adicionar.')],
              [l('Checking names that are also common words', 'Checagem de nomes que também são palavras comuns'), cloud
                ? l('When a monitored name is also an ordinary word (Apple, Conversion), the text settles most mentions for free; the rest go to a decision model, a fraction of a cent each, and count only once it says they name the brand. Monthly limit: US$ 1 by default; workspace admins can raise it up to US$ 10 (above that, Lastfind sets it) and 0 stops the checks. Past 80% the block warns. When the limit runs out, nothing more is asked: the mentions that need the model wait, not counted, until next month or a higher limit, and the block says how many wait.', 'Quando um nome monitorado também é uma palavra comum (Apple, Conversion), o texto resolve a maioria das menções de graça; as demais vão a um modelo de decisão, uma fração de centavo cada, e só contam quando ele diz que são a marca. Limite mensal: US$ 1 por padrão; admins do workspace podem subir até US$ 10 (acima disso, o Lastfind define) e 0 para as checagens. Depois de 80% o bloco avisa. Quando o limite acaba, nada mais é perguntado: as menções que precisam do modelo aguardam, sem contar, até o próximo mês ou um limite maior, e o bloco diz quantas aguardam.')
                : l('When a monitored name is also an ordinary word (Apple, Conversion), the text settles most mentions for free; the rest go to a decision model, a fraction of a cent each, and count only once it says they name the brand. Monthly limit: US$ 1 by default; you can set any amount or Unlimited, and 0 stops the checks. Past 80% the block warns. When the limit runs out, nothing more is asked: the mentions that need the model wait, not counted, until next month or a higher limit, and the block says how many wait. Without a model key nothing is spent and these names count as the text finds them.', 'Quando um nome monitorado também é uma palavra comum (Apple, Conversion), o texto resolve a maioria das menções de graça; as demais vão a um modelo de decisão, uma fração de centavo cada, e só contam quando ele diz que são a marca. Limite mensal: US$ 1 por padrão; você pode definir qualquer valor ou Ilimitado, e 0 para as checagens. Depois de 80% o bloco avisa. Quando o limite acaba, nada mais é perguntado: as menções que precisam do modelo aguardam, sem contar, até o próximo mês ou um limite maior, e o bloco diz quantas aguardam. Sem chave de modelo nada é gasto e esses nomes contam como o texto os encontra.')],
              [l('Your own brand', 'A sua marca'), l('Your brand is checked the same way, more strictly: it is asked twice in different words, and a mention still in doubt is read again in full. A mention is left out as another business with the same name only when two AI models from different makers agree, each quoting the answer; when they disagree, it waits for a review and does not count until then.', 'A sua marca passa pela mesma checagem, com mais rigor: é perguntada duas vezes, com palavras diferentes, e uma menção ainda em dúvida é lida de novo por inteiro. Uma menção só fica de fora como outra empresa de mesmo nome quando dois modelos de IA de fabricantes diferentes concordam, cada um citando a resposta; quando discordam, ela aguarda revisão e não conta até lá.')],
            ]}
          />
        </>
      ),
    },
    {
      id: 'settings-monitoring',
      related: ['scheduler', 'plans', 'spending', 'ai-models'],
      group: 'settings',
      name: l('Monitoring and budget', 'Monitoramento e orçamento'),
      title: l('Monitoring and budget.', 'Monitoramento e orçamento.'),
      description: l(
        'When the AIs are asked (daily or weekly, day, time and time zone), the default AI models, topic weights and the project’s monthly budget.',
        'Quando as IAs são perguntadas (diária ou semanalmente, dia, horário e fuso), os modelos de IA padrão, o peso dos tópicos e o orçamento mensal do projeto.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="settings-monitoring"
            alt={l(
              'Settings, Monitoring: the collection schedule with frequency, time and the workspace’s time zone, and the default AI models.',
              'Configurações, Monitoramento: a agenda de coleta com frequência, horário e o fuso horário do workspace, e os modelos de IA padrão.',
            )}
          />
          <Settings
            rows={[
              [l('Collection schedule', 'Agenda de coleta'), l('Frequency (daily or weekly), the day of a weekly collection and the time, in the workspace’s time zone, which every project shares (Monday 04:00 by default). Workspace admins change them. Pause monitoring stops new collections and keeps history; tasks already sent still finish.', 'Frequência (diária ou semanal), o dia da coleta semanal e o horário, no fuso horário do workspace, que vale para todos os projetos (segunda às 04:00 por padrão). Admins do workspace alteram. Pausar monitoramento para as coletas novas e guarda o histórico; tarefas já enviadas ainda terminam.')],
              [l('Default AI models', 'Modelos de IA padrão'), l('The AIs every question uses unless its topic or the question itself chooses others.', 'As IAs que toda pergunta usa, a não ser que o tópico ou a própria pergunta escolha outras.')],
              [l('Topics: weight and models', 'Tópicos: peso e modelos'), l('Manage topics, set how much each topic counts in the overall rates and, if needed, its own AIs.', 'Gerencie os tópicos, defina quanto cada um pesa nas taxas gerais e, se precisar, as IAs próprias dele.')],
              [l('Budget', 'Orçamento'), cloud ? l('The workspace’s plan is one pool of prompts and credits that all its projects share; the project’s monthly budget is an optional cap inside it, for everything the project spends (collection, evaluations, Semantic Branding, the Agent), with what each part spent so far. Change sets the cap; empty is no cap; 0 stops paid work. Workspace admins and the owner see and change it.', 'O plano do workspace é um só conjunto de prompts e créditos que todos os projetos dividem; o orçamento mensal do projeto é um teto opcional dentro dele, para tudo o que o projeto gasta (coleta, avaliações, Semantic Branding, o Agente), com o que cada parte já gastou. Alterar define o teto; vazio é sem teto; 0 para o trabalho pago. Admins do workspace e o responsável veem e alteram.') : l('One monthly budget for everything the project spends (collection, evaluations, Semantic Branding, the Agent), US$ 50 for a new project, with what each part spent so far. Change sets the amount; No budget removes the cap; 0 stops paid work.', 'Um orçamento mensal para tudo o que o projeto gasta (coleta, avaliações, Semantic Branding, o Agente), US$ 50 num projeto novo, com o que cada parte já gastou. Alterar define o valor; Sem orçamento tira o teto; 0 para o trabalho pago.')],
              ...(cloud ? [] : ([[l('Provider keys', 'Chaves dos provedores'), l('Whether each provider key is set. The keys stay on your Worker; Open Admin to test or replace them.', 'Se cada chave de provedor está definida. As chaves ficam no seu Worker; Abrir Admin para testar ou trocar.')]] as [ReactNode, ReactNode][])),
            ]}
          />
          <p>
            {l(
              'When the budget is reached, paid work stops until the next month or until you raise it, and the Overview says so. A warning appears past 80%.',
              'Quando o orçamento acaba, o trabalho pago para até o mês seguinte ou até você aumentar, e a Visão geral avisa. Um alerta aparece depois de 80%.',
            )}
          </p>
        </>
      ),
    },
    {
      id: 'settings-semantic',
      related: ['semantic-branding', 'settings-brand'],
      group: 'settings',
      name: 'Semantic Branding',
      title: l('Semantic Branding settings.', 'Configurações do Semantic Branding.'),
      description: l(
        'Turn Semantic Branding on, choose the 3 to 10 attributes the AIs score and how often the panel is collected.',
        'Ative o Semantic Branding, escolha os 3 a 10 atributos que as IAs avaliam e com que frequência o painel é coletado.',
      ),
      subs: [],
      body: (
        <>
          <Figure
            priority
            shot="settings-semantic"
            alt={l('Settings, Semantic Branding: activation, brand attributes and collection frequency.', 'Configurações, Semantic Branding: ativação, atributos da marca e frequência da coleta.')}
          />
          <Settings
            rows={[
              [l('Activation and attributes', 'Ativação e atributos'), l('Evaluate brand associations turns the panel on. Brand attributes are the 3 to 10 qualities the AIs score; Edit or generate attributes opens a wizard that proposes them from your market.', 'Avaliar associações da marca liga o painel. Atributos da marca são as 3 a 10 qualidades que as IAs pontuam; Editar ou gerar atributos abre um assistente que os propõe a partir do seu mercado.')],
              [l('Collection frequency', 'Frequência da coleta'), cloud ? l('Daily, weekly or monthly: how often the AIs are asked, which also sets the chart’s periods. It saves after a confirmation. Free collects it once a month, asking only each AI’s free plan (its interface and its free model), and the screen says so.', 'Diária, semanal ou mensal: com que frequência as IAs são consultadas, o que também define os períodos do gráfico. Salva depois de uma confirmação. O Free coleta uma vez por mês, perguntando só ao plano gratuito de cada IA (a interface e o modelo gratuito), e a tela avisa.') : l('Daily, weekly or monthly: how often the AIs are asked, which also sets the chart’s periods. It saves after a confirmation.', 'Diária, semanal ou mensal: com que frequência as IAs são consultadas, o que também define os períodos do gráfico. Salva depois de uma confirmação.')],
            ]}
          />
        </>
      ),
    },
    {
      id: 'settings-agent',
      related: ['agent', 'ai-apps'],
      group: 'settings',
      name: l('Agent', 'Agente'),
      title: l('Agent settings.', 'Configurações do Agente.'),
      description: l(
        'What Create content opens and how the Agent learns from your team’s conversations and feedback, with an optional monthly limit.',
        'O que Criar conteúdo abre e como o Agente aprende com as conversas e o feedback do time, com um limite mensal opcional.',
      ),
      subs: [],
      body: (
        <>
          <Settings
            rows={[
              [l('Creating content', 'Criação de conteúdo'), l('What Create content opens: ask each time, the wizard or the chat.', 'O que Criar conteúdo abre: perguntar sempre, o assistente ou o chat.')],
              [l('Learning from conversations and feedback', 'Aprender com conversas e feedback'), l('An optional monthly limit in US$ for what the Agent spends learning from finished and rated conversations; 0 turns learning off. Workspace admins and the owner change it.', 'Um limite mensal opcional em US$ para o que o Agente gasta aprendendo com conversas terminadas e avaliadas; 0 desliga o aprendizado. Admins do workspace e o responsável alteram.')],
            ]}
          />
        </>
      ),
    },
    {
      id: 'settings-data',
      related: ['backup', 'settings-workspace'],
      group: 'settings',
      name: l('Project data', 'Dados do projeto'),
      title: l('Project data: retention, backup and restore.', 'Dados do projeto: retenção, backup e restauração.'),
      description: l(
        'Choose how long the project keeps each answer’s text, and make, download and restore a backup. Archive and delete are in Brand and market.',
        'Escolha por quanto tempo o projeto guarda o texto de cada resposta, e faça, baixe e restaure um backup. Arquivar e excluir ficam em Marca e mercado.',
      ),
      subs: [],
      body: (
        <>
          <Settings
            rows={[
              [l('Data retention', 'Retenção de dados'), l('How long the project keeps the full text of each answer and its original response: 90 days (recommended), 6 months, 1 year, 2 years or everything. Brands, positions, sources, sentiment and Semantic Branding scores are kept for good, so every report and trend stays the same; an older answer keeps its numbers, and its text no longer opens. A new project starts at 90 days. Only workspace admins change it.', 'Por quanto tempo o projeto guarda o texto completo de cada resposta e a resposta original: 90 dias (recomendado), 6 meses, 1 ano, 2 anos ou tudo. Marcas, posições, fontes, sentimento e notas do Semantic Branding ficam guardados sempre, então todo relatório e tendência continuam iguais; uma resposta mais antiga mantém os números, e o texto dela deixa de abrir. Um projeto novo começa com 90 dias. Só admins do workspace mudam.')],
              [l('Backups', 'Backups'), l('Make backup creates a file with the project’s answers, evidence and history, with checksums, in the background. The 3 most recent are kept for 30 days; Download saves one. Your Agent conversations go with it.', 'Gerar backup cria, em segundo plano, um arquivo com as respostas, evidências e o histórico do projeto, com checksums. Os 3 mais recentes ficam guardados por 30 dias; Baixar salva um. As suas conversas com o Agente vão junto.')],
              [l('Restore a backup', 'Restaurar backup'), l('Replaces the project’s answers and history with the backup’s; settings, prompts and monitoring do not change, and a backup of the current state is made first.', 'Troca as respostas e o histórico do projeto pelos do backup; configurações, prompts e monitoramento não mudam, e um backup do estado atual é feito antes.')],
            ]}
          />
          <p>{l('Only the owner backs up and restores.', 'Só o responsável faz backup e restaura.')}</p>
        </>
      ),
    },
    {
      id: 'settings-workspace',
      related: ['plans', 'settings-data'],
      group: 'settings',
      name: cloud ? l('Projects and members', 'Projetos e membros') : l('Projects', 'Projetos'),
      title: cloud ? l('Projects and members.', 'Projetos e membros.') : l('Projects.', 'Projetos.'),
      description: l(
        'The workspace’s projects, archived ones included, and its members: invite people and choose what each role can see and change.',
        'Os projetos do workspace, inclusive os arquivados, e os seus membros: convide pessoas e escolha o que cada papel pode ver e alterar.',
      ),
      subs: [],
      body: (
        <>
          <Figure priority shot="settings-projects" alt={l('Settings, Projects: active projects and the archived ones.', 'Configurações, Projetos: os projetos ativos e os arquivados.')} />
          <p>
            {l(
              'Projects lists the workspace’s projects; New project creates one. Archived projects can be shown and unarchived: they come back with their history, and monitoring stays paused until you resume it.',
              'Projetos lista os projetos do workspace; Novo projeto cria um. Os projetos arquivados podem ser mostrados e desarquivados: voltam com o histórico, e o monitoramento fica pausado até você retomar.',
            )}
          </p>
          {cloud ? (
            <>
              <p>
                {l(
                  'Members invites up to 20 people by email and sets their role. The invited person gets access, and the workspace emails, only after accepting the invitation in the app. Owner: everything, including backups and archiving. Admin: also budgets, the collection schedule, members and projects. Member: changes prompts, topics, brands and project settings. Viewer: reads reports only.',
                  'Membros convida até 20 pessoas por email e define o papel de cada uma. A pessoa convidada só tem acesso, e os emails do workspace, depois de aceitar o convite no app. Responsável: tudo, inclusive backups e arquivamento. Admin: também orçamentos, a agenda de coleta, membros e projetos. Membro: altera prompts, tópicos, marcas e configurações do projeto. Leitor: só lê os relatórios.',
                )}
              </p>
            </>
          ) : (
            <p>{l('An independent installation has one owner, who holds every permission.', 'Uma instalação independente tem um único proprietário, com todas as permissões.')}</p>
          )}
        </>
      ),
    },
  ];
}
