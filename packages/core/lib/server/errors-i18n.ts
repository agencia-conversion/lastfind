// Server-safe, explicit API copy. Unknown errors fail closed rather than leaking
// provider messages, SQL, user input or credentials into a JSON response.
export type ApiLocale = 'en' | 'pt-BR';
export function errorLocale(cookie: string | null): ApiLocale {
  if (!cookie || cookie.length > 8192) return 'en';
  const value = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('lastfind_locale='))
    ?.slice('lastfind_locale='.length);
  return value === 'pt-BR' ? 'pt-BR' : 'en';
}
const messages: readonly (readonly [string, string, ...string[]])[] = [
  [
    'Restore verification has started. Upload to a new restore generation.',
    'A verificação da restauração começou. Envie para uma nova geração de restauração.',
  ],
  [
    'Restore checksum differs from the exported snapshot. The active generation is unchanged.',
    'O checksum da restauração difere do snapshot exportado. A geração ativa permanece inalterada.',
  ],
  [
    'The response archive failed its integrity check.',
    'O arquivo da resposta não passou na verificação de integridade.',
  ],
  [
    'Invalid project storage operation.',
    'Operação de armazenamento do projeto inválida.',
  ],
  ['Send JSON.', 'Envie JSON.'],
  ['Storage batch is too large.', 'O lote de armazenamento é muito grande.'],
  [
    'Project analytics are temporarily unavailable.',
    'As análises do projeto estão temporariamente indisponíveis.',
  ],
  [
    'Project storage batch is too large.',
    'O lote de armazenamento do projeto é muito grande.',
  ],
  [
    'Project publication is already running.',
    'A publicação do projeto já está em andamento.',
  ],
  [
    'Finish pending publications before exporting the project.',
    'Conclua as publicações pendentes antes de exportar o projeto.',
  ],
  [
    'The snapshot does not belong to this project or is invalid.',
    'O snapshot não pertence a este projeto ou é inválido.',
  ],
  [
    'Finish pending publications before restoring the project.',
    'Conclua as publicações pendentes antes de restaurar o projeto.',
  ],
  ['Invalid restore batch.', 'Lote de restauração inválido.'],
  ['Unknown restore generation.', 'Geração de restauração desconhecida.'],
  [
    'Project changed during restore. Export a current snapshot and try again.',
    'O projeto mudou durante a restauração. Exporte um snapshot atual e tente novamente.',
  ],
  [
    'Project changed before restore activation.',
    'O projeto mudou antes da ativação da restauração.',
  ],
  ['Sign in to continue.', 'Entre na sua conta para continuar.'],
  ['Invalid AI engine.', 'Motor inválido.'],
  [
    'Monitoring is temporarily unavailable.',
    'O monitoramento está temporariamente indisponível.',
    'A integração DataForSEO ainda não foi configurada pelo operador.',
  ],
  ['Send a JSON request.', 'Envie JSON.', 'Envie um conteúdo JSON.'],
  ['The request is too large.', 'Conteúdo muito grande.', 'Payload too large.'],
  ['Invalid JSON.', 'JSON inválido.'],
  ['Invalid request origin.', 'Origem da solicitação inválida.'],
  ['Cross-site request blocked.', 'Solicitação externa bloqueada.'],
  [
    'Add or activate a prompt to track responses.',
    'Adicione ou ative um prompt para acompanhar as respostas.',
  ],
  [
    'Monitoring is waiting for pending responses or the monthly credit reset.',
    'O monitoramento aguarda respostas pendentes ou a renovação dos créditos mensais.',
  ],
  [
    'Monitoring provider is unavailable.',
    'O provedor de monitoramento está indisponível.',
  ],
  [
    'Choose an available AI channel.',
    'Escolha uma plataforma de IA disponível.',
  ],
  [
    'Gemini is available in projects with English as their language.',
    'Gemini está disponível em projetos com idioma inglês.',
  ],
  ['Use up to 8 tags per prompt.', 'Use até 8 tags por prompt.'],
  [
    'Add between 1 and 100 prompts at a time.',
    'Adicione entre 1 e 100 prompts por vez.',
  ],
  [
    'These prompts already exist or the project limit was reached.',
    'Os prompts já existem ou o limite do projeto foi atingido.',
  ],
  ['Prompt not found.', 'Prompt não encontrado.'],
  ['Invalid state.', 'Estado inválido.'],
  [
    'This prompt already exists or the account capacity was reached.',
    'O prompt já existe ou a capacidade da conta foi atingida.',
  ],
  ['Choose a period from 1 to 90 days.', 'Escolha um período de 1 a 90 dias.'],
  ['Invalid AI channel.', 'Canal de IA inválido.'],
  ['Invalid response status.', 'Status de resposta inválido.'],
  ['Invalid mention filter.', 'Filtro de menção inválido.'],
  ['Invalid opportunity filter.', 'Filtro de oportunidade inválido.'],
  ['Invalid source filter.', 'Filtro de fonte inválido.'],
  ['Select a project.', 'Selecione um projeto.'],
  ['Choose a tracked brand.', 'Escolha uma marca monitorada.'],
  ['The search query is too long.', 'O texto da busca é muito longo.'],
  ['Invalid page cursor.', 'Cursor de página inválido.'],
  ['Invalid page.', 'Página inválida.'],
  ['Invalid source.', 'Fonte inválida.'],
  [
    'Enter a valid domain, such as your-brand.com.',
    'Informe um domínio válido, como sua-marca.com.',
    'Domínio inválido',
  ],
  ['Invalid market.', 'Mercado inválido.'],
  ['Invalid language.', 'Idioma inválido.'],
  ['Add up to 5 competitors.', 'Adicione no máximo 5 concorrentes.'],
  ['Invalid competitor.', 'Concorrente inválido.', 'Concorrente inválido'],
  [
    'Use distinct names for your brand and competitors.',
    'Use nomes diferentes para a marca e seus concorrentes.',
  ],
  ['Project not found.', 'Projeto não encontrado.'],
  ['Not found.', 'Não encontrado.'],
  ['Invalid access key.', 'Chave de acesso inválida.'],
  ['Access denied.', 'Acesso negado.'],
  ['Invalid identifier.', 'Identificador inválido.'],
  ['Invalid frequency.', 'Frequência inválida.'],
  ['Select between 1 and 100 prompts.', 'Selecione de 1 a 100 prompts.'],
  ['Invalid prompt.', 'Prompt inválido.'],
  ['Could not create the project.', 'Não foi possível criar o projeto.'],
  [
    'Monitoring runs daily at 4 AM Brasília time.',
    'O monitoramento é diário, às 4h de Brasília.',
  ],
  ['Invalid schedule.', 'Agendamento inválido.'],
  [
    'Archive Gemini prompts before changing this project to Portuguese.',
    'Arquive os prompts do Gemini antes de mudar este projeto para português.',
  ],
  ['Select up to 100 prompts.', 'Selecione até 100 prompts.'],
  ['Invalid action.', 'Ação inválida.'],
  ['Prompt not found in this project.', 'Prompt não encontrado neste projeto.'],
  ['Invalid prompts.', 'Prompts inválidos.'],
  ['Collection not found.', 'Coleta não encontrada.'],
  ['Invalid report.', 'Relatório inválido.'],
  ['Response not found.', 'Resposta não encontrada.'],
  [
    'The original provider JSON was not archived for this response.',
    'O JSON original do provedor não foi arquivado para esta resposta.',
  ],
  [
    'The response archive is temporarily unavailable.',
    'O arquivo da resposta está temporariamente indisponível.',
  ],
  [
    'The archived provider JSON is no longer available.',
    'O JSON arquivado do provedor não está mais disponível.',
  ],
  ['Topic not found.', 'Tópico não encontrado.'],
  [
    'Move or archive prompts before deleting the topic.',
    'Mova ou arquive os prompts antes de excluir o tópico.',
  ],
  [
    'A topic with this name already exists.',
    'Já existe um tópico com esse nome.',
  ],
  [
    'Could not complete this operation. Please try again.',
    'Não foi possível concluir a operação. Tente novamente.',
  ],
  [
    'This AI channel is not available for this account.',
    'Este canal de IA não está disponível para esta conta.',
  ],
];
const lookup = new Map<string, readonly [string, string]>();
for (const [en, pt, ...aliases] of messages)
  for (const key of [en, pt, ...aliases]) lookup.set(key, [en, pt]);
const fields: Record<string, string> = {
  Marca: 'Brand',
  Domínio: 'Domain',
  Concorrente: 'Competitor',
  'Domínio do concorrente': 'Competitor domain',
  Projeto: 'Project',
  Tópico: 'Topic',
  Nome: 'Name',
  Prompt: 'Prompt',
  Tema: 'Topic',
  Tag: 'Tag',
  Identificador: 'Identifier',
};
export function knownApiMessage(message: string): boolean {
  return lookup.has(message);
}
export function localizeApiError(message: string, locale: ApiLocale): string {
  const pair = lookup.get(message);
  if (pair) return pair[locale === 'pt-BR' ? 1 : 0];
  const field =
    /^([^:]{1,40}): use entre (\d{1,6}) e (\d{1,6}) caracteres\.$/.exec(
      message,
    );
  if (field && fields[field[1]])
    return locale === 'pt-BR'
      ? message
      : `${fields[field[1]]}: use between ${field[2]} and ${field[3]} characters.`;
  const engine =
    /^(ChatGPT|Gemini|Claude|Perplexity|Google AI Mode|AI Overviews) aceita até (\d{1,6}) caracteres por prompt\.$/.exec(
      message,
    );
  if (engine)
    return locale === 'pt-BR'
      ? message
      : `${engine[1]} accepts up to ${engine[2]} characters per prompt.`;
  const filter = /^Invalid (topic|tag|prompt) filter\.$/.exec(message);
  if (filter)
    return locale === 'en'
      ? message
      : `Filtro de ${{ topic: 'tópico', tag: 'tag', prompt: 'prompt' }[filter[1]]} inválido.`;
  return locale === 'en'
    ? 'Could not complete this operation. Please try again.'
    : 'Não foi possível concluir a operação. Tente novamente.';
}
