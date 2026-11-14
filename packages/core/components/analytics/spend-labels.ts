// What each spend module and limit is called on screen (Settings > Monitoring > Budget and Admin > Usage and costs share them).
import type { SpendModule } from '@/lib/platform-spend';

type Copy = (en: string, pt: string) => string;
export const moduleLabel = (module: SpendModule | string, t: Copy) =>
  ({
    collection: t('Collection', 'Coleta'),
    semantic: 'Semantic Branding',
    products: t('Products', 'Produtos'),
    sentiment: t('Sentiment', 'Sentimento'),
    sourceTypes: t('Source types', 'Tipos de fonte'),
    roles: t('Brand roles', 'Papéis das marcas'),
    mentions: t('Common-word brand checks', 'Checagem de marcas com nome comum'),
    intents: t('Search intents', 'Intenções de busca'),
    attributes: t('Attribute suggestions', 'Sugestão de atributos'),
    brain: t('Brain setup', 'Configuração do Cérebro'),
    learning: t('Agent learning', 'Aprendizado do agente'),
    domains: t('Brand domains', 'Domínios de marca'),
    agent: t('Agent', 'Agente'),
    setup: t('New project setup', 'Configuração de novo projeto'),
    comparison: t('Comparison', 'Comparação'),
    legacy: t('Old evaluator', 'Avaliador antigo'),
    earlier: t('Still running from earlier months', 'Ainda em andamento de meses anteriores'),
  })[module] ?? module;

/** Why work stopped (spend-guards.ts BlockReason), in words a customer can act on. */
export const blockLabel = (reason: string, t: Copy) =>
  ({
    platform: t('Paused for now, it resumes on its own soon', 'Pausado por enquanto, volta sozinho em breve'),
    project_budget: t("This project's monthly budget is used up", 'O orçamento mensal deste projeto acabou'),
    credits: t("The account's collection credits are used up", 'Os créditos de coleta da conta acabaram'),
    agent_credits: t("The account's AI credits are used up", 'Os créditos de IA da conta acabaram'),
    panel_rounds: t('The plan allows no more Semantic Branding rounds this month', 'O plano não permite mais rodadas de Semantic Branding neste mês'),
    run_limit: t('The collection limit of the plan or the installation was reached', 'O limite de coletas do plano ou da instalação foi atingido'),
    operation: t('A limit of the module itself was reached', 'Um limite do próprio módulo foi atingido'),
  })[reason] ?? reason;

/** The platform's own pause, said to the customer after "Paused: ": nothing for them to do, no internals. */
export const platformPauseCopy = (t: Copy) =>
  t('it resumes on its own soon, nothing for you to do. If it lasts more than a day, contact support.', 'volta sozinho em breve, você não precisa fazer nada. Se durar mais de um dia, fale com o suporte.');

/** What the customer can do about a block: only the project budget is theirs to change; the rest renews or resumes by itself. */
export const blockRemedy = (reason: string, t: Copy) =>
  reason === 'project_budget'
    ? t('A workspace admin can raise it in Settings > Monitoring > Budget.', 'Um admin do workspace pode aumentá-lo em Configurações > Monitoramento > Orçamento.')
    : reason === 'credits' || reason === 'run_limit'
      ? t('Collection resumes when the limit renews at the start of the next period.', 'A coleta volta quando o limite renovar, no início do próximo período.')
      : t('No action is needed: collection resumes automatically. If it lasts more than a day, contact support.', 'Você não precisa fazer nada: a coleta volta automaticamente. Se durar mais de um dia, fale com o suporte.');

export const usdFormat = (locale: string) => (value: number) =>
  new Intl.NumberFormat(locale === 'pt-BR' ? 'pt-BR' : 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/**
 * Why Semantic Branding's next round did not start and what lifts it (semantic-panel.ts `blocked`), never "within minutes": the
 * project's budget is the workspace's to raise, the brake for all projects the admin's (the customer of a hosted plan is told it resumes).
 */
export const panelBlockCopy = (reason: string, admin: boolean, t: Copy) =>
  reason === 'platform'
    ? admin
      ? t('Semantic Branding is paused: the monthly limit for all projects has no room for its next round. Raise it in Admin > Usage and costs.', 'O Semantic Branding está pausado: o limite mensal de todos os projetos não tem espaço para a próxima rodada. Aumente-o em Admin > Uso e custos.')
      : `${t('Semantic Branding is paused: ', 'O Semantic Branding está pausado: ')}${platformPauseCopy(t)}`
    : reason === 'panel_rounds'
      ? t('Semantic Branding is paused: the rounds of this month are used up. The next round runs when they renew next month.', 'O Semantic Branding está pausado: as rodadas deste mês acabaram. A próxima rodada roda quando elas renovarem no mês que vem.')
      : t("Semantic Branding is paused: this project's monthly budget has no room for its next round. Raise it in Settings > Monitoring > Budget.", 'O Semantic Branding está pausado: o orçamento mensal deste projeto não tem espaço para a próxima rodada. Aumente-o em Configurações > Monitoramento > Orçamento.');
