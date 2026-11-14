// The AI bots page of the product guide (/docs/ai-bots), shared by both editions. In its own file because it names
// Cloudflare: the customer connects their own Cloudflare zone, so the steps must name it (tests/no-provider-name.test.mjs).
import { CLOUDFLARE_TOKEN_TEMPLATE_URL } from '@/lib/ai-bots';
import { DocsH2 as H2, type DocsSection, type Translate } from './docs-layout';

export function aiBotsDocsSection(l: Translate): DocsSection {
  return {
    id: 'ai-bots',
    related: ['sources', 'settings-workspace'],
    group: 'product',
    name: l('Traffic', 'Tráfego'),
    title: l('Traffic: which AIs read your site, and what they send back.', 'Tráfego: quais IAs leem o seu site, e o que mandam de volta.'),
    description: l(
      'The AI crawlers that visit your site, the pages they read, the errors they hit and the visits LLM answers send back (AI Traffic), from your Cloudflare.',
      'Os robôs de IA que visitam o seu site, as páginas que leem, os erros que encontram e as visitas que as respostas dos LLMs mandam (Tráfego de IA), pela sua Cloudflare.',
    ),
    subs: [
      { id: 'ai-bots-connect', label: l('Connect Cloudflare', 'Conecte a Cloudflare') },
      { id: 'ai-bots-read', label: l('What the screen shows', 'O que a tela mostra') },
      { id: 'ai-bots-limits', label: l('Limits', 'Limites') },
    ],
    body: (
      <>
        <p>
          {l(
            'Traffic reads your site’s own Cloudflare analytics: no tag, no script and nothing installed on the site. It is available on every Lastfind plan. Your site must be served through Cloudflare (its DNS proxied, the orange cloud).',
            'Tráfego lê as análises da Cloudflare do seu próprio site: sem tag, sem script e sem nada instalado no site. Está disponível em todos os planos do Lastfind. O seu site precisa passar pela Cloudflare (o DNS com proxy, a nuvem laranja).',
          )}
        </p>
        <H2 id="ai-bots-connect">{l('Connect Cloudflare', 'Conecte a Cloudflare')}</H2>
        <ol>
          <li>
            {l('In Lastfind, open Settings, then Traffic, and choose ', 'No Lastfind, abra Configurações, depois Tráfego, e escolha ')}
            <a href={CLOUDFLARE_TOKEN_TEMPLATE_URL} target="_blank" rel="noreferrer">{l('Create token in Cloudflare', 'Criar token na Cloudflare')}</a>
            {l(
              '. Cloudflare opens its token form already filled in, read only: Account > Account Analytics > Read; Zone > Analytics > Read; Zone > Zone > Read.',
              '. A Cloudflare abre o formulário do token já preenchido, só leitura: Account > Account Analytics > Read; Zone > Analytics > Read; Zone > Zone > Read.',
            )}
          </li>
          <li>
            {l('Under Zone Resources, keep all zones or pick your site’s zone. Choose Continue to summary, then Create Token.', 'Em Zone Resources, mantenha todas as zonas ou escolha a do seu site. Escolha Continue to summary e depois Create Token.')}
          </li>
          <li>
            {l(
              'Copy the token and paste it in Lastfind: it is checked with Cloudflare at once. Then choose your site’s zone.',
              'Copie o token e cole no Lastfind: ele é conferido com a Cloudflare na hora. Depois escolha a zona do seu site.',
            )}
          </li>
        </ol>
        <p>
          {l(
            'The token only reads analytics: it cannot change anything in your Cloudflare account. Lastfind checks it with Cloudflare before saving it, stores it encrypted and never shows it again. Workspace admins replace it or disconnect in Settings, Traffic; disconnecting deletes the token at once and keeps the days already collected. Revoking the token in Cloudflare also stops the collection, and the screen asks to reconnect in Settings.',
            'O token só lê análises: ele não muda nada na sua conta da Cloudflare. O Lastfind confere o token com a Cloudflare antes de salvar, guarda criptografado e nunca o mostra de novo. Admins do workspace trocam ou desconectam em Configurações, Tráfego; desconectar apaga o token na hora e mantém os dias já coletados. Revogar o token na Cloudflare também para a coleta, e a tela pede para reconectar em Configurações.',
          )}
        </p>
        <H2 id="ai-bots-read">{l('What the screen shows', 'O que a tela mostra')}</H2>
        <p>
          {l(
            'On connecting, Lastfind reads the last 30 days, then one more day every day, so the history grows past the 31 days Cloudflare keeps. The header’s period applies; the AI, topic, tag and brand filters do not. Traffic has three pages in the sidebar: Overview, AI Bots and AI Traffic. Together they show the AI bot visits and their share of all visits, the pages they read, the distinct bots and their companies, the error rate (404, 403 and 5xx), the visits by purpose (training, search, user request) per day or week, every bot with its visits, pages, errors and last visit, the most read pages and whether a monitored answer cited them, and what your site answered the bots.',
            'Ao conectar, o Lastfind lê os últimos 30 dias e depois mais um dia todos os dias, então o histórico cresce além dos 31 dias que a Cloudflare guarda. Vale o período do cabeçalho; os filtros de IA, tópico, tag e marca não. Tráfego tem três páginas na barra lateral: Visão geral, Bots de IA e Tráfego de IA. Juntas mostram as visitas de bots de IA e a parcela delas em todas as visitas, as páginas que leram, os bots diferentes e as empresas, a taxa de erro (404, 403 e 5xx), as visitas por finalidade (treinamento, busca, pedido de usuário) por dia ou semana, cada bot com visitas, páginas, erros e última visita, as páginas mais lidas e se uma resposta monitorada as citou, e o que o seu site respondeu aos bots.',
          )}
        </p>
        <p>
          {l(
            'AI Traffic, on paid Cloudflare plans (Pro and above): the visits that arrive from links in LLM answers (ChatGPT, Perplexity, Claude, Gemini, Copilot and others), the ranking of the LLMs that send them, their days and the pages they land on, and whether a monitored answer cited those pages. The Overview’s Visits by purpose chart switches between bot visits and visits from LLMs. On the Free plan Cloudflare does not report where visits came from, so those parts say so instead of showing zero. Landing pages are read from 13 November 2026 on.',
            'Tráfego de IA, nos planos pagos da Cloudflare (Pro ou superior): as visitas que chegam por links em respostas de LLMs (ChatGPT, Perplexity, Claude, Gemini, Copilot e outros), o ranking dos LLMs que as mandam, os dias e as páginas onde chegam, e se uma resposta monitorada citou essas páginas. O gráfico Visitas por finalidade da Visão geral alterna entre visitas de bots e visitas vindas de LLMs. No plano Free a Cloudflare não informa de onde vieram as visitas, então essas partes dizem isso em vez de mostrar zero. As páginas de entrada são lidas a partir de 13 de novembro de 2026.',
          )}
        </p>
        <p>
          {l(
            'Open a bot, an LLM or a page to see only its figures, or choose a day in a chart to read only that day. The bot and LLM filters are in the filter bar, and each view has its own address to share.',
            'Abra um bot, um LLM ou uma página para ver só os números dele, ou escolha um dia num gráfico para ler só aquele dia. Os filtros de bot e de LLM ficam na barra de filtros, e cada vista tem um endereço próprio para compartilhar.',
          )}
        </p>
        <H2 id="ai-bots-limits">{l('Limits', 'Limites')}</H2>
        <p>
          {l(
            'Bots are recognized by the name they declare (their user agent), which anyone can fake. The figures are estimates from Cloudflare’s sampled analytics. A day keeps up to 10,000 combinations of bot, page and status, the most visited first. Today’s figures are partial until the next day’s collection.',
            'Os robôs são reconhecidos pelo nome que declaram (o user agent), que qualquer um pode falsificar. Os números são estimativas das análises por amostragem da Cloudflare. Um dia guarda até 10.000 combinações de robô, página e status, as mais visitadas primeiro. Os números de hoje são parciais até a coleta do dia seguinte.',
          )}
        </p>
      </>
    ),
  };
}
