// The independent installation's documentation: the shared product guide plus AI apps, setup, schedule, limits, backup
// and Admin, one page each (/docs/<id>). Plain module (no hooks): the server reads the section ids to answer unknown
// pages with a 404, the page renders them.
import { McpDocs, mcpDocsSubs } from '@/components/lastfind/mcp-docs';
import { DocsCode, DocsH2, DocsPath, type DocsSection, type Translate } from '@/components/lastfind/docs/docs-layout';
import { productDocsSections } from '@/components/lastfind/docs/product-docs';

export function selfhostDocsSections(l: Translate): DocsSection[] {
  return [
    ...productDocsSections(l, 'selfhost'),
    {
      id: 'ai-apps',
      related: ['agent', 'settings-agent'],
      group: 'settings',
      name: l('AI apps (MCP)', 'Apps de IA (MCP)'),
      title: l('Use Lastfind from your AI apps.', 'Use o Lastfind nos seus apps de IA.'),
      description: l(
        'Connect Claude, ChatGPT and Cursor to your installation’s data over MCP, with personal access tokens, and disconnect them at any time.',
        'Conecte o Claude, o ChatGPT e o Cursor aos dados da sua instalação por MCP, com tokens de acesso pessoal, e desconecte quando quiser.',
      ),
      subs: mcpDocsSubs(l),
      body: (
        <>
          <McpDocs l={l} fallbackOrigin="https://lastfind.example.com" H3={DocsH2} Code={DocsCode} />
        </>
      ),
    },
    {
      id: 'deploy',
      related: ['scheduler', 'license'],
      group: 'own',
      name: l(
              'Setup',
              'Configuração',
            ),
      title: l('Your independent installation.', 'Sua instalação independente.'),
      description: l(
        'Run the installer from your checkout: it checks your provider keys, connects Cloudflare, deploys and updates your installation.',
        'Rode o instalador no seu checkout: ele confere as chaves dos provedores, conecta a Cloudflare, publica e atualiza a sua instalação.',
      ),
      subs: [],
      body: (
        <>
          <p>
            {l(
              'Run the installer from your checkout. It checks your DataForSEO and OpenRouter keys, connects Cloudflare, deploys and shows where your owner key is saved. Run it again any time to update.',
              'Execute o instalador no seu checkout. Ele confere suas chaves do DataForSEO e do OpenRouter, conecta a Cloudflare, publica e mostra onde está a sua chave de proprietário. Rode de novo quando quiser para atualizar.',
            )}
          </p>
          <DocsCode code={'npm ci\nnpm run setup'} />
          <p>
            {l(
              'The first time you open the installation, the setup wizard opens before anything else: the admin account (on an installation with no key yet, after its one-time setup token: the SETUP_TOKEN secret, or the one printed once to the Worker log), the provider keys, each tested for free, the defaults (language, time zone, a monthly cap) and then your first project. It runs once; afterwards keys change in Admin > Providers.',
              'Na primeira vez que você abre a instalação, a configuração guiada abre antes de tudo: a conta de admin (numa instalação ainda sem chave, depois do token de configuração de uso único: o secret SETUP_TOKEN ou o impresso uma vez no log do Worker), as chaves dos provedores, cada uma testada de graça, os padrões (idioma, fuso, um teto mensal) e depois o primeiro projeto. Ela roda uma vez; depois as chaves mudam em Admin > Provedores.',
            )}
          </p>
          <a href={`https://github.com/agencia-conversion/lastfind/blob/main/docs/${l('install.md', 'install.pt-BR.md')}`} target="_blank" rel="noopener noreferrer">
            {l(
              'Complete installation instructions',
              'Instruções completas de instalação',
            )}
          </a>
        </>
      ),
    },
    {
      id: 'scheduler',
      related: ['settings-monitoring', 'deploy'],
      group: 'own',
      name: l(
              'Monitoring and credentials',
              'Monitoramento e credenciais',
            ),
      title: l(
              'Monitoring and credentials',
              'Monitoramento e credenciais',
            ),
      description: l(
        'The scheduled worker, where provider credentials live, and how to choose daily or weekly collection, its day, time and time zone.',
        'O agendamento, onde ficam as credenciais dos provedores e como escolher a coleta diária ou semanal, o dia, o horário e o fuso.',
      ),
      subs: [],
      body: (
        <p>
          {l(
              'The installer configures the scheduled worker. DataForSEO credentials stay on the server. Choose daily or weekly collection, its day, its time and the time zone in Settings > Monitoring (Monday 04:00 by default). Admin > Overview shows the health of the scheduler, and Admin > Providers which keys are in effect. Standard batch collection is used when supported by the channel. After each run the scheduler also reads the sentiment of new answers and types new cited sources for every project with evaluation on (Settings > Competitors), inside the project’s monthly budget.',
              'O instalador configura o agendamento. As credenciais da DataForSEO ficam no servidor. Escolha a coleta diária ou semanal, o dia, o horário e o fuso horário em Configurações > Monitoramento (segunda às 04:00 por padrão). Admin > Visão geral mostra a saúde do agendador, e Admin > Provedores quais chaves estão valendo. A coleta Standard em lote é usada quando o canal permite. Depois de cada rodada o agendador também lê o sentimento das respostas novas e classifica as fontes citadas novas de todo projeto com avaliação ligada (Configurações > Concorrentes), dentro do orçamento mensal do projeto.',
            )}
        </p>
      ),
    },
    {
      id: 'spending',
      related: ['settings-monitoring', 'admin'],
      group: 'own',
      name: l(
              'Spending limits',
              'Limites de gasto',
            ),
      title: l(
              'Spending limits',
              'Limites de gasto',
            ),
      description: l(
        'Every paid call is reserved before it is sent: each project’s monthly budget, the collection caps and the brake for the whole installation.',
        'Toda chamada paga é reservada antes de sair: o orçamento mensal de cada projeto, os tetos de coleta e o freio da instalação inteira.',
      ),
      subs: [],
      body: (
        <p>
          {l(
              'Every paid call is reserved before it is sent and settled at its real cost. Each project has one monthly budget for everything it spends, US$ 50 for a new project, in Settings > Monitoring > Budget. Collection is also capped per month and per day (SELF_HOST_MONTHLY_LIMIT and GLOBAL_DAILY_RUN_LIMIT), and Admin > Usage and costs shows where the money goes and can set a brake for the whole installation. When a limit stops work, the Overview says which one.',
              'Toda chamada paga é reservada antes de sair e acertada pelo custo real. Cada projeto tem um orçamento mensal para tudo o que gasta, US$ 50 num projeto novo, em Configurações > Monitoramento > Orçamento. A coleta também tem teto por mês e por dia (SELF_HOST_MONTHLY_LIMIT e GLOBAL_DAILY_RUN_LIMIT), e Admin > Uso e custos mostra para onde vai o dinheiro e pode pôr um freio para a instalação inteira. Quando um limite para o trabalho, a Visão geral diz qual.',
            )}
        </p>
      ),
    },
    {
      id: 'backup',
      related: ['settings-data', 'deploy'],
      group: 'own',
      name: l(
              'Backup',
              'Backup',
            ),
      title: l(
              'Backup',
              'Backup',
            ),
      description: l(
        'Back up and restore a project from Settings, and what else a complete backup of your installation needs.',
        'Faça backup e restaure um projeto pelas Configurações, e o que mais um backup completo da sua instalação precisa.',
      ),
      subs: [],
      body: (
        <p>
          {l(
              'Settings > Project data makes, downloads and restores project backups; they also carry your Agent conversations, which a restore skips. A complete backup also needs the control database (wrangler d1 export) and, for the original answers, your R2 bucket.',
              'Configurações > Dados do projeto faz, baixa e restaura backups do projeto; eles também levam as suas conversas com o Agente, que a restauração pula. Um backup completo também precisa do banco de controle (wrangler d1 export) e, para as respostas originais, do seu bucket R2.',
            )}
        </p>
      ),
    },
    {
      id: 'admin',
      related: ['spending', 'scheduler'],
      group: 'own',
      name: 'Admin',
      title: l('Admin: health, costs, keys and models.', 'Admin: saúde, custos, chaves e modelos.'),
      description: l(
        'The owner’s Admin: the health of the installation, usage and costs, provider keys and the model each function uses.',
        'O Admin do proprietário: a saúde da instalação, uso e custos, as chaves dos provedores e o modelo que cada função usa.',
      ),
      subs: [],
      body: (
        <>
          <p>
            {l('The owner opens ', 'O proprietário abre ')}
            <DocsPath>Admin</DocsPath>
            {l(' at the foot of the sidebar.', ' no rodapé da barra lateral.')}
          </p>
          <dl>
            <div>
              <dt>{l('Overview', 'Visão geral')}</dt>
              <dd>{l('The health of the scheduler, storage and publication queue, provider rejections, what setup still misses, and each project’s latest Semantic Branding collection: which AIs gave no scores and why, and how much the brands’ order moved the scores.', 'A saúde do agendador, do armazenamento e da fila de publicação, as recusas dos provedores, o que ainda falta configurar e a última coleta do Semantic Branding de cada projeto: quais IAs não deram notas e por quê, e quanto a ordem das marcas mudou as notas.')}</dd>
            </div>
            <div>
              <dt>{l('Usage and costs', 'Uso e custos')}</dt>
              <dd>{l('Where the money goes, by project, module, AI and day; each project’s budget; and the Platform brake, an optional ceiling per month, per day and in collections per day for the whole installation.', 'Para onde vai o dinheiro, por projeto, módulo, IA e dia; o orçamento de cada projeto; e o Freio da plataforma, um teto opcional por mês, por dia e em coletas por dia para a instalação inteira.')}</dd>
            </div>
            <div>
              <dt>{l('Providers', 'Provedores')}</dt>
              <dd>{l('Test connection (free), replace or remove the DataForSEO key and the model providers\' keys (OpenAI, Anthropic, OpenRouter), and set the order the model calls follow: each goes to the first provider with a key that serves it, and moves to the next when one refuses it (no credit, quota, rate limit). Saved keys are encrypted, write-only and take precedence over the Worker secrets.', 'Testar conexão (grátis), trocar ou remover a chave da DataForSEO e as dos provedores de modelo (OpenAI, Anthropic, OpenRouter), e definir a ordem que as chamadas de modelo seguem: cada uma vai ao primeiro provedor com chave que a atende, e passa ao próximo quando um a recusa (sem crédito, cota, limite de taxa). As chaves salvas ficam cifradas, só de escrita, e valem antes dos segredos do Worker.')}</dd>
            </div>
            <div>
              <dt>{l('Classifiers', 'Classificadores')}</dt>
              <dd>{l('The model each function runs (sentiment, source types, brand roles, the Agent, Semantic Branding and others), with Use default to go back; and whether the Agent learns from conversations.', 'O modelo que cada função usa (sentimento, tipos de fonte, papéis de marca, o Agente, Semantic Branding e outras), com Usar padrão para voltar; e se o Agente aprende com as conversas.')}</dd>
            </div>
          </dl>
        </>
      ),
    },
  ];
}

export function selfhostDocsGroups(l: Translate) {
  return [
    { id: 'use', label: l('Get started', 'Comece') },
    { id: 'product', label: l('Features', 'Recursos') },
    { id: 'settings', label: l('Settings', 'Configurações') },
    { id: 'own', label: l('Your installation', 'Sua instalação') },
  ];
}
