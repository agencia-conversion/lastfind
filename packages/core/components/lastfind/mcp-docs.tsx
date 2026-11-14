// No 'use client': the docs' server reads mcpDocsSubs for its pages' metadata. Its hooks and components are only
// rendered inside client components (the docs layout, Settings).
import { useSyncExternalStore, type ReactNode } from 'react';

type Translate = (en: string, pt: string) => string;

/** The page's own address, read after hydration (the server renders the fallback). */
export function useOrigin() {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );
}

/** What to paste in each app: the server address and, for a personal access token, the header that carries it. */
export function mcpSnippets(url: string, t: Translate, token?: string) {
  const header = token ? `Authorization: Bearer ${token}` : '';
  const cursor = { mcpServers: { lastfind: token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url } } };
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      where: t('Run in your terminal', 'Rode no seu terminal'),
      code: `claude mcp add --transport http lastfind ${url}${token ? ` --header "${header}"` : ''}`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      where: t('Add to .cursor/mcp.json (project) or ~/.cursor/mcp.json', 'Adicione em .cursor/mcp.json (projeto) ou ~/.cursor/mcp.json'),
      code: JSON.stringify(cursor, null, 2),
    },
    {
      id: 'other',
      label: t('Other apps', 'Outros apps'),
      where: t('Server address and request header', 'Endereço do servidor e cabeçalho da requisição'),
      code: token ? `${url}\n${header}` : url,
    },
  ];
}

/** The headings of the section, for a docs page's navigation and scroll spy. */
export const mcpDocsSubs = (l: Translate) => [
  { id: 'ai-apps-claude', label: 'Claude' },
  { id: 'ai-apps-chatgpt', label: 'ChatGPT' },
  { id: 'ai-apps-cursor', label: 'Cursor' },
  { id: 'ai-apps-tokens', label: l('Personal access tokens', 'Tokens de acesso pessoal') },
  { id: 'ai-apps-tools', label: l('What apps can do', 'O que os apps podem fazer') },
  { id: 'ai-apps-revoke', label: l('Disconnect and revoke', 'Desconectar e revogar') },
];

const PlainH3 = ({ id, children }: { id: string; children: ReactNode }) => <h3 id={id}>{children}</h3>;
const PlainCode = ({ code }: { code: string }) => <pre><code>{code}</code></pre>;

/**
 * "AI apps (MCP)" in the documentation of both editions: the server address, how to connect Claude, ChatGPT and
 * Cursor, what the tools can and cannot do, what can start monitoring runs and how to revoke access. Each page passes
 * its own heading and code block so the section looks like the rest of it.
 */
export function McpDocs({
  l,
  fallbackOrigin,
  H3 = PlainH3,
  Code = PlainCode,
}: {
  l: Translate;
  /** Shown until the page knows its own address (server render). */
  fallbackOrigin: string;
  H3?: (props: { id: string; children: ReactNode }) => ReactNode;
  Code?: (props: { code: string }) => ReactNode;
}) {
  const url = `${useOrigin() || fallbackOrigin}/mcp`;
  const [claudeCode, cursor] = mcpSnippets(url, l);
  const cursorToken = JSON.stringify({ mcpServers: { lastfind: { url, headers: { Authorization: 'Bearer ${env:LASTFIND_TOKEN}' } } } }, null, 2);
  return (
    <>
      <p>
        {l(
          'Lastfind runs an MCP server, so Claude, ChatGPT, Cursor and other AI apps can read your reports and, if you allow it, make safe changes for you. Add this address to the app:',
          'O Lastfind tem um servidor MCP, para que Claude, ChatGPT, Cursor e outros apps de IA leiam seus relatórios e, se você permitir, façam alterações seguras por você. Adicione este endereço no app:',
        )}
      </p>
      <Code code={url} />
      <p>
        {l(
          'The app opens Lastfind in your browser: sign in, review the request and approve. Reading is always included; changes only if you tick Allow changes. The connection then appears in Settings > AI apps.',
          'O app abre o Lastfind no navegador: entre, confira o pedido e aprove. Leitura sempre vem incluída; alterações só se você marcar Permitir alterações. A conexão aparece em Configurações > Apps de IA.',
        )}
      </p>

      <H3 id="ai-apps-claude">Claude</H3>
      <p>
        {l(
          'On claude.ai or the desktop app, open Customize > Connectors, choose + Add and then Add custom connector. Name it Lastfind, paste the address, continue and keep the suggested sign-in. On Team and Enterprise plans an owner adds it under Organization settings > Connectors, and each person clicks Connect.',
          'No claude.ai ou no app de desktop, abra Customize > Connectors, escolha + Add e depois Add custom connector. Dê o nome Lastfind, cole o endereço, continue e mantenha o login sugerido. Nos planos Team e Enterprise, um owner adiciona em Organization settings > Connectors, e cada pessoa clica em Connect.',
        )}
      </p>
      <p>{l('In Claude Code, run this and then /mcp to sign in:', 'No Claude Code, rode isto e depois /mcp para entrar:')}</p>
      <Code code={claudeCode.code} />

      <H3 id="ai-apps-chatgpt">ChatGPT</H3>
      <p>
        {l(
          'Custom MCP servers need developer mode, which your plan or workspace admin may have to allow (Settings > Apps > Advanced settings). Then open chatgpt.com/plugins, choose + and Add custom MCP server, paste the address, choose OAuth and create it. ChatGPT renames these menus often; if yours differ, look for custom connectors or MCP servers.',
          'Servidores MCP personalizados exigem o modo desenvolvedor, que seu plano ou o admin do workspace pode precisar liberar (Settings > Apps > Advanced settings). Depois abra chatgpt.com/plugins, escolha + e Add custom MCP server, cole o endereço, escolha OAuth e crie. O ChatGPT muda esses menus com frequência; se os seus forem diferentes, procure por conectores personalizados ou servidores MCP.',
        )}
      </p>

      <H3 id="ai-apps-cursor">Cursor</H3>
      <p>{l('Add Lastfind to .cursor/mcp.json in a project, or to ~/.cursor/mcp.json for every project. Cursor opens the browser to sign in the first time.', 'Adicione o Lastfind em .cursor/mcp.json de um projeto, ou em ~/.cursor/mcp.json para todos. O Cursor abre o navegador para você entrar na primeira vez.')}</p>
      <Code code={cursor.code} />

      <H3 id="ai-apps-tokens">{l('Personal access tokens', 'Tokens de acesso pessoal')}</H3>
      <p>
        {l(
          'For an app or script that cannot sign in on its own, create a token in Settings > AI apps > New token: name, workspace, permission and expiry (30 days, 90 days or 1 year), up to 20 tokens at a time. It is shown only once. The app sends it in the Authorization header, for example in Cursor:',
          'Para um app ou script que não consegue entrar sozinho, crie um token em Configurações > Apps de IA > Novo token: nome, workspace, permissão e validade (30 dias, 90 dias ou 1 ano), até 20 tokens ao mesmo tempo. Ele aparece uma única vez. O app envia o token no cabeçalho Authorization, por exemplo no Cursor:',
        )}
      </p>
      <Code code={cursorToken} />
      <p>{l('Keep the token in the LASTFIND_TOKEN environment variable, never in a shared file.', 'Guarde o token na variável de ambiente LASTFIND_TOKEN, nunca num arquivo compartilhado.')}</p>

      <H3 id="ai-apps-tools">{l('What apps can do', 'O que os apps podem fazer')}</H3>
      <p>
        {l(
          'Read, with any connection: projects, overview, prompts, answers, brand comparison, discovered brands, sentiment, sources and the detail of each source, source types, AI models, query fan-out, products, opportunities and Semantic Branding with its evidence, with the same filters and periods as the app. Missing data comes back as missing, never as zero.',
          'Ler, com qualquer conexão: projetos, visão geral, prompts, respostas, comparação de marcas, marcas descobertas, sentimento, fontes e o detalhe de cada fonte, tipos de fonte, modelos de IA, query fan-out, produtos, oportunidades e Semantic Branding com suas evidências, com os mesmos filtros e períodos do app. Dado ausente volta como ausente, nunca como zero.',
        )}
      </p>
      <p>
        {l(
          'Change, only with Allow changes and a member, admin or owner role: create, edit, pause, resume, archive and restore prompts; organize them with topics and tags; create, rename and delete empty topics; confirm, reject, rename, merge or undo discovered brands. Apps ask you before each change, and every change is listed in Settings > AI apps > Recent actions.',
          'Alterar, só com Permitir alterações e papel de membro, admin ou responsável: criar, editar, pausar, retomar, arquivar e restaurar prompts; organizar com tópicos e tags; criar, renomear e excluir tópicos vazios; confirmar, recusar, renomear, juntar ou desfazer marcas descobertas. Os apps perguntam antes de cada alteração, e toda alteração aparece em Configurações > Apps de IA > Ações recentes.',
        )}
      </p>
      <p>
        {l(
          'Never: plans, billing, members, project settings, creating or archiving projects, backups, exports, refreshing analyses or administration.',
          'Nunca: planos, cobrança, membros, configurações do projeto, criar ou arquivar projetos, backups, exportações, atualizar análises ou administração.',
        )}
      </p>
      <p>
        {l(
          'Only creating or resuming prompts starts monitoring: they are collected exactly like prompts added in the app (in the next scheduled run on Cloud, right away in an independent installation), within the same limits. Reading never calls an AI or a data provider.',
          'Só criar ou retomar prompts inicia monitoramento: eles são coletados exatamente como prompts adicionados no app (na próxima coleta agendada no Cloud, na hora numa instalação independente), dentro dos mesmos limites. Ler nunca chama uma IA nem um provedor de dados.',
        )}
      </p>

      <H3 id="ai-apps-revoke">{l('Disconnect and revoke', 'Desconectar e revogar')}</H3>
      <p>
        {l(
          'Settings > AI apps lists every connected app and token with its workspace, permission and last use. Disconnect or Revoke cuts access at once. Tokens expire on their date, app connections after 30 days without use, and a person removed from a workspace loses access through every app.',
          'Configurações > Apps de IA lista cada app conectado e token com workspace, permissão e último uso. Desconectar ou Revogar corta o acesso na hora. Tokens expiram na data escolhida, conexões de apps depois de 30 dias sem uso, e quem é removido de um workspace perde o acesso por todos os apps.',
        )}
      </p>
    </>
  );
}
