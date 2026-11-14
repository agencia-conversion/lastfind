// Server-safe, explicit API copy. Unknown errors fail closed rather than leaking
// provider messages, SQL, user input or credentials into a JSON response.
import { SKILL_CHECKS } from '../agent-learning.ts';

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
  // What the agent learns (lib/agent-learning.ts, lib/server/agent-skills.ts, agent-curator.ts).
  ...Object.values(SKILL_CHECKS),
  ['Skill not found.', 'Skill não encontrada.'],
  ['Lastfind uses this name. Choose another.', 'O Lastfind usa este nome. Escolha outro.'],
  ['The name in the text and the skill differ.', 'O nome no texto e o da skill são diferentes.'],
  ['A skill with this name exists.', 'Já existe uma skill com este nome.'],
  ['This skill changed while you were editing it.', 'Esta skill mudou enquanto você editava.'],
  ['A workspace keeps up to 25 skills of its own on: turn one off first.', 'Um workspace mantém até 25 skills próprias ligadas: desligue uma antes.'],
  ['The Memory stays: clear its lines instead.', 'A Memória fica: apague as linhas dela.'],
  ['Version not found.', 'Versão não encontrada.'],
  ['This changed again since. Open its history.', 'Isto mudou de novo depois. Abra o histórico.'],
  ['Enter an amount in US$, or 0 to turn learning off.', 'Informe um valor em US$, ou 0 para desligar o aprendizado.'],
  ['Enter an amount in US$, or 0 to stop the checks.', 'Informe um valor em US$, ou 0 para parar as checagens.'],
  ['Above US$ 10 a month, or unlimited, a Lastfind admin sets it.', 'Acima de US$ 10 por mês, ou ilimitado, um admin do Lastfind define.'],
  ['A Lastfind admin set this limit: only a Lastfind admin changes it.', 'Um admin do Lastfind definiu este limite: só um admin do Lastfind muda.'],
  ['This skill changed since the agent proposed this: the proposal no longer applies.', 'Esta skill mudou depois da proposta do agente: a proposta não vale mais.'],
  ['Try again.', 'Tente de novo.'],
  // Comparison (lib/server/comparison.ts, lib/comparison.ts comparisonIssues).
  ['Invalid revision.', 'Revisão inválida.'],
  ['Invalid filter.', 'Filtro inválido.'],
  ['Comparison settings changed. Reload before saving.', 'As configurações da Comparação mudaram. Recarregue antes de salvar.'],
  ['AI suggestions need the model key: an admin adds it in Admin > Providers. You can still add products, attributes and personas by hand.', 'As sugestões da IA precisam da chave do modelo: um admin a cadastra em Admin › Provedores. Você ainda pode adicionar produtos, atributos e personas à mão.'],
  ['The limit for AI suggestions was reached this month. You can still add products, attributes and personas by hand.', 'O limite de sugestões da IA deste mês foi atingido. Você ainda pode adicionar produtos, atributos e personas à mão.'],
  ["We couldn't generate suggestions right now. Try again, or add them by hand.", 'Não conseguimos gerar sugestões agora. Tente de novo ou adicione à mão.'],
  ["We couldn't generate products to compare right now. Try again, skip this step, or add them later in Comparison.", 'Não conseguimos gerar produtos para comparar agora. Tente de novo, pule esta etapa ou adicione depois em Comparação.'],
  ['Each product needs its own name.', 'Cada produto precisa de um nome próprio.'],
  ['Each attribute needs its own name.', 'Cada atributo precisa de um nome próprio.'],
  ['Each persona needs its own name.', 'Cada persona precisa de um nome próprio.'],
  ['Invalid brand research configuration.', 'Configuração de pesquisa de marcas inválida.'],
  ['Unknown setting.', 'Configuração desconhecida.'],
  ['Invalid value.', 'Valor inválido.'],
  ['Enter the login and the password.', 'Informe o login e a senha.'],
  ['Enter the key.', 'Informe a chave.'],
  ['List every model provider once.', 'Liste cada provedor de modelo uma vez.'],
  ['Enter the token and the account ID.', 'Informe o token e o ID da conta.'],
  ['The account ID is set by the deployment.', 'O ID da conta é definido na implantação.'],
  ['An account ID has 32 characters, 0-9 and a-f.', 'Um ID de conta tem 32 caracteres, de 0 a 9 e de a a f.'],
  ['Unknown provider.', 'Provedor desconhecido.'],
  ['Unknown classifier.', 'Classificador desconhecido.'],
  ['The model of this function is fixed.', 'O modelo desta função é fixo.'],
  ['Enter a model name such as provider/model.', 'Informe um nome de modelo como provedor/modelo.'],
  ['This does not look like a Google OAuth web client value.', 'Isto não parece um valor de cliente OAuth web do Google.'],
  ['Choose a project.', 'Escolha um projeto.'],
  ['The agent is not available on this account.', 'O agente não está disponível nesta conta.'],
  ['The agent is not configured yet.', 'O agente ainda não está configurado.'],
  ['The agent is not configured yet: an admin needs to add the model key in Admin > Providers.', 'O agente ainda não está configurado: um admin precisa cadastrar a chave do modelo em Admin › Provedores.'],
  ['This conversation is still answering.', 'Esta conversa ainda está respondendo.'],
  ['This project reached its monthly agent limit.', 'Este projeto atingiu o limite mensal do agente.'],
  ['Write a message.', 'Escreva uma mensagem.'],
  ['This message is too long.', 'Esta mensagem é longa demais.'],
  ['Nothing is waiting for confirmation.', 'Nada está aguardando confirmação.'],
  ['Conversation not found.', 'Conversa não encontrada.'],
  ['Artifact not found.', 'Artefato não encontrado.'],
  ['Enter a title.', 'Informe um título.'],
  ['The content is too long.', 'O conteúdo é longo demais.'],
  ['The version is missing.', 'Falta a versão.'],
  ['This artifact changed while you were editing it.', 'Este artefato mudou enquanto você editava.'],
  ['Choose a type.', 'Escolha um tipo.'],
  ['A Brain file is only renamed.', 'Um arquivo do Cérebro só pode ser renomeado.'],
  ['Only a content has publication fields.', 'Só um conteúdo tem campos de publicação.'],
  ['The Brain keeps at least one file.', 'O Cérebro fica com pelo menos um arquivo.'],
  ['Choose the files to save.', 'Escolha os arquivos para salvar.'],
  ['Enter the site, such as example.com.', 'Informe o site, como exemplo.com.br.'],
  ['Generating the Brain needs the model key: an admin adds it in Admin > Providers. You can still write the files by hand.', 'Gerar o Cérebro precisa da chave do modelo: um admin a cadastra em Admin › Provedores. Você ainda pode escrever os arquivos à mão.'],
  ['The model chosen for the Brain costs more than one generation may spend. An admin changes it in Admin > Classifiers.', 'O modelo escolhido para o Cérebro custa mais do que uma geração pode gastar. Um admin o troca em Admin › Classificadores.'],
  ['The AI spending limit was reached for now. Try again later. You can still write the files by hand.', 'O limite de gasto com IA foi atingido por enquanto. Tente mais tarde. Você ainda pode escrever os arquivos à mão.'],
  ['The AI is busy right now. Try again in a minute. You can still write the files by hand.', 'A IA está ocupada agora. Tente de novo em um minuto. Você ainda pode escrever os arquivos à mão.'],
  ['The AI did not return a usable Brain. Try again.', 'A IA não devolveu um Cérebro utilizável. Tente de novo.'],
  // The New project wizard's AI suggestions (lib/server/new-project-ai.ts).
  ["We couldn't generate reliable competitors right now. Try again, or add them by hand.", 'Não foi possível gerar concorrentes confiáveis agora. Tente novamente, ou adicione à mão.'],
  ["We couldn't generate attributes right now. Try again, write them by hand, or set up Semantic Branding later.", 'Não foi possível gerar atributos agora. Tente novamente, escreva à mão, ou configure o Semantic Branding depois.'],
  ["We couldn't generate reliable topics right now. Try again, or add them by hand.",'Não foi possível gerar tópicos confiáveis agora. Tente novamente, ou adicione à mão.'],
  ["We couldn't generate reliable prompts right now. Try again, or write them by hand.", 'Não foi possível gerar prompts confiáveis agora. Tente novamente, ou escreva à mão.'],
  ['AI suggestions need the model key: an admin adds it in Admin > Providers. You can still fill in the wizard by hand.', 'As sugestões da IA precisam da chave do modelo: um admin a cadastra em Admin › Provedores. Você ainda pode preencher o wizard à mão.'],
  ['The model chosen for the New project wizard costs more than one suggestion may spend. An admin changes it in Admin > Classifiers.', 'O modelo escolhido para o wizard de novo projeto custa mais do que uma sugestão pode gastar. Um admin o troca em Admin › Classificadores.'],
  ['The AI spending limit for suggestions was reached for now. You can still fill in the wizard by hand.', 'O limite de gasto com IA para sugestões foi atingido por enquanto. Você ainda pode preencher o wizard à mão.'],
  ['Choose a wizard step.', 'Escolha um passo do wizard.'],
  ['Enter the brand, with at least two letters or numbers.', 'Informe a marca, com pelo menos duas letras ou números.'],
  ['Select from 1 to 10 topics.', 'Selecione de 1 a 10 tópicos.'],
  ['This data block is not valid.', 'Este bloco de dados não é válido.'],
  ['This plan allows up to the default limit.', 'Este plano permite até o limite padrão.'],
  ['Only the last message can be edited.', 'Só a última mensagem pode ser editada.'],
  ['Your account has no credits left this month.', 'Sua conta não tem mais créditos neste mês.'],
  ['Send up to 4 images (PNG, JPEG, WebP or GIF).', 'Envie até 4 imagens (PNG, JPEG, WebP ou GIF).'],
  ['This installation has no per-project ceiling.', 'Esta instalação não tem teto por projeto.'],
  ['Enter a ceiling between 0 and 1000.', 'Informe um teto entre 0 e 1000.'],
  ['Invalid ceiling request.', 'Pedido de teto inválido.'],
  ['This project changed meanwhile, or evaluation is not enabled for it. Reload before saving.', 'Este projeto mudou enquanto isso, ou a avaliação não está ativada para ele. Recarregue antes de salvar.'],
  ['Brand research settings changed. Reload before saving.', 'As configurações de pesquisa de marcas mudaram. Recarregue antes de salvar.'],
  ['Brand research settings changed. Reload before evaluating.', 'As configurações de pesquisa de marcas mudaram. Recarregue antes de avaliar.'],
  ['Enable brand research in Settings before evaluating.', 'Ative a pesquisa de marcas em Settings antes de avaliar.'],
  ['Manual evaluation processing is available in previews only.', 'O processamento manual de avaliações está disponível somente em previews.'],
  ['Invalid brand research operation.', 'Operação de pesquisa de marcas inválida.'],
  ['Choose a valid evaluator.', 'Escolha um avaliador válido.'],
  ['Preview research scope is truncated or exceeds 600 answers.', 'O escopo de avaliação do preview está truncado ou excede 600 respostas.'],
  ['Invalid research filter.', 'Filtro de pesquisa inválido.'],
  ['Saved answer changed; refresh and try again.', 'A resposta salva mudou; atualize e tente novamente.'],
  ['This project is not authorized for brand research.', 'Este projeto não está autorizado para pesquisa de marcas.'],
  ['Evaluation is not available on this installation.', 'A avaliação não está disponível nesta instalação.'],
  ['Research budget is full.', 'O orçamento de pesquisa está esgotado.'],
  ['Invalid source type.', 'Tipo de fonte inválido.'],
  ['Invalid source origin.', 'Origem da fonte inválida.'],
  ['Invalid source owner.', 'Dono da fonte inválido.'],
  ['Invalid source sort.', 'Ordem de fontes inválida.'],
  ['Your role in this workspace does not allow this action.', 'Seu papel neste workspace não permite esta ação.'],
  ['AI apps cannot use this action.', 'Apps de IA não podem usar esta ação.'],
  ['This access does not allow changes.', 'Este acesso não permite alterações.'],
  ['Workspace not found.', 'Workspace não encontrado.'],
  ['Use lowercase letters, numbers and single hyphens, up to 48 characters.', 'Use letras minúsculas, números e hífens simples, até 48 caracteres.'],
  ['This address is reserved. Choose another.', 'Este endereço é reservado. Escolha outro.'],
  ['Another workspace already uses this address.', 'Outro workspace já usa este endereço.'],
  ['Another project in this workspace already uses this address.', 'Outro projeto deste workspace já usa este endereço.'],
  ['Only workspace admins change the address.', 'Só administradores do workspace alteram o endereço.'],
  ['Name the workspace with 2 to 80 characters.', 'Dê ao workspace um nome de 2 a 80 caracteres.'],
  ['Choose a name or an address for the workspace.', 'Escolha um nome ou um endereço para o workspace.'],
  ['A new workspace starts on Free, so you can create one only while none of the workspaces you own is on Free.', 'Um workspace novo começa no Free, então você só pode criar um enquanto nenhum dos workspaces de que você é dono estiver no Free.'],
  ['Choose a workspace.', 'Escolha um workspace.'],
  // The account photo (app/api/avatar/route.ts).
  ['Choose a JPG, PNG or WebP image.', 'Escolha uma imagem JPG, PNG ou WebP.'],
  ['The photo must be smaller than 500 KB.', 'A foto deve ter menos de 500 KB.'],
  ['Profile photos are not available in this installation.', 'Fotos de perfil não estão disponíveis nesta instalação.'],
  ['Access not found.', 'Acesso não encontrado.'],
  ['You have reached the limit of 20 personal access tokens. Revoke one first.', 'Você atingiu o limite de 20 tokens de acesso pessoal. Revogue um antes.'],
  ['You have reached the limit of 20 connected apps. Disconnect one first.', 'Você atingiu o limite de 20 apps conectados. Desconecte um antes.'],
  ['This connection request is invalid.', 'Este pedido de conexão é inválido.'],
  ['This app is unknown, or its details could not be read.', 'Este app é desconhecido, ou não foi possível ler os dados dele.'],
  ['The return address of this app does not match its registration.', 'O endereço de retorno deste app não corresponde ao cadastro dele.'],
  ['This app must protect the connection with PKCE (S256).', 'Este app precisa proteger a conexão com PKCE (S256).'],
  ['This app asked for access to another server.', 'Este app pediu acesso a outro servidor.'],
  ['This app asked for permissions Lastfind does not offer.', 'Este app pediu permissões que o Lastfind não oferece.'],
  ['Choose domains or URLs.', 'Escolha domínios ou URLs.'],
  ['Enable the evaluator in Settings before classifying sources.', 'Ative o avaliador em Configurações antes de classificar as fontes.'],
  ['Source classification is not available on this installation.', 'A classificação de fontes não está disponível nesta instalação.'],
  ['This project is not authorized for source classification.', 'Este projeto não está autorizado para classificação de fontes.'],
  ['Select at least one available AI model.', 'Selecione pelo menos um modelo de IA disponível.'],
  ['Add between 1 and 100 questions.', 'Adicione entre 1 e 100 perguntas.'],
  ['This question exists with different organization or state. Edit the existing question.', 'Esta pergunta existe com outra organização ou estado. Edite a pergunta existente.'],
  ['These questions already exist.', 'Estas perguntas já existem.'],
  ['This question changed. Refresh and try again.', 'Esta pergunta mudou. Atualize e tente novamente.'],
  ['This question already exists.', 'Esta pergunta já existe.'],
  ['Remove Gemini monitoring before changing this project language.', 'Remova o monitoramento do Gemini antes de alterar o idioma deste projeto.'],
  ['No project settings supplied.', 'Nenhuma configuração do projeto foi informada.'],
  ['Select up to 100 questions.', 'Selecione até 100 perguntas.'],
  ['Question not found in this project.', 'Pergunta não encontrada neste projeto.'],
  ['Semantic configuration not found.', 'Configuração semântica não encontrada.'],
  ['Invalid semantic revision.', 'Revisão semântica inválida.'],
  ['Semantic settings changed. Reload before saving.', 'As configurações semânticas mudaram. Recarregue antes de salvar.'],
  ['Invalid semantic filter.', 'Filtro semântico inválido.'],
  ['Invalid semantic cursor.', 'Cursor semântico inválido.'],
  ['Invalid semantic configuration.', 'Configuração semântica inválida.'],
  ['Choose one to ten semantic attributes.', 'Escolha de um a dez atributos semânticos.'],
  ['Invalid semantic attribute.', 'Atributo semântico inválido.'],
  ['Choose 3 to 10 attributes.', 'Escolha de 3 a 10 atributos.'],
  ['Each attribute needs a definition of 100 to 200 characters.', 'Cada atributo precisa de uma definição de 100 a 200 caracteres.'],
  ['Attribute names must be unique.', 'Os nomes dos atributos não podem se repetir.'],
  ['Each attribute needs a name of 2 to 60 characters.', 'Cada atributo precisa de um nome de 2 a 60 caracteres.'],
  ['Generating attributes needs the model key: an admin adds it in Admin > Providers. You can still write attributes by hand.', 'Gerar atributos precisa da chave do modelo: um admin a cadastra em Admin › Provedores. Você ainda pode escrever atributos à mão.'],
  ['The spending limit for generating attributes was reached this month. You can still write attributes by hand.', 'O limite de gasto para gerar atributos foi atingido este mês. Você ainda pode escrever atributos à mão.'],
  ['The AI did not return usable attributes. Try again.', 'A IA não devolveu atributos utilizáveis. Tente de novo.'],
  ['Semantic attributes must be unique.', 'Os atributos semânticos devem ser únicos.'],
  ['The source search query is too long.', 'A busca de fontes é muito longa.'],
  ['Invalid cursor.', 'Cursor inválido.'],
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
  [
    'Project restores are run by the Lastfind team.',
    'A restauração de projetos é feita pela equipe do Lastfind.',
  ],
  [
    'Only backups Lastfind made of this project can be restored here.',
    'Aqui só é possível restaurar backups que o Lastfind fez deste projeto.',
  ],
  ['A restore of this project is already running.', 'Já há uma restauração deste projeto em andamento.'],
  ['The file is not a complete Lastfind backup.', 'O arquivo não é um backup completo do Lastfind.'],
  ['This backup belongs to another project.', 'Este backup é de outro projeto.'],
  ['Could not keep a backup of the current state, so nothing was restored.', 'Não foi possível guardar um backup do estado atual, então nada foi restaurado.'],
  ['The upload was interrupted. Choose the file again.', 'O envio foi interrompido. Escolha o arquivo de novo.'],
  ['The restore stopped. Try again.', 'A restauração parou. Tente de novo.'],
  ['The file is larger than 1 GB.', 'O arquivo tem mais de 1 GB.'],
  ['Invalid upload part.', 'Parte do envio inválida.'],
  ['Restore not found.', 'Restauração não encontrada.'],
  ['Backup not found.', 'Backup não encontrado.'],
  ['Archived project not found.', 'Projeto arquivado não encontrado.'],
  ['Type the project name exactly as shown to delete it.', 'Digite o nome do projeto exatamente como aparece para excluí-lo.'],
  [
    'Invalid competitor analysis operation.',
    'Operação de análise de concorrentes inválida.',
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
    'Project targets changed during restore. Export a current snapshot and try again.',
    'As marcas monitoradas mudaram durante a restauração. Exporte um snapshot atual e tente novamente.',
  ],
  [
    'Project changed before restore activation.',
    'O projeto mudou antes da ativação da restauração.',
  ],
  ['Sign in to continue.', 'Entre na sua conta para continuar.'],
  ['Invalid AI engine.', 'Motor inválido.'],
  [
    'Monitoring is off: this installation has no search data key; add it in Admin > Providers.',
    'O monitoramento está desligado: esta instalação não tem a chave de dados de busca; adicione em Admin > Provedores.',
  ],
  [
    'Monitoring is temporarily unavailable.',
    'O monitoramento está temporariamente indisponível.',
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
    'A monitoring run allowlist must contain unique run IDs.',
    'A lista autorizada de execuções de monitoramento deve conter IDs únicos.',
  ],
  [
    'Monitoring provider is unavailable.',
    'O provedor de monitoramento está indisponível.',
  ],
  [
    'Choose an available AI channel.',
    'Escolha uma plataforma de IA disponível.',
  ],
  ['Use up to 8 tags per prompt.', 'Use até 8 tags por prompt.'],
  ['Use up to 10 name variations.', 'Use no máximo 10 variações de nome.'],
  [
    'Brand: use at least one letter or number.',
    'Marca: use pelo menos uma letra ou número.',
  ],
  [
    'Competitor: use at least one letter or number.',
    'Concorrente: use pelo menos uma letra ou número.',
  ],
  [
    'Name variation: use at least one letter or number.',
    'Variação de nome: use pelo menos uma letra ou número.',
  ],
  ['Use up to 10 additional domains.', 'Use no máximo 10 domínios adicionais.'],
  ['Do not repeat competitor domains.', 'Não repita os domínios dos concorrentes.'],
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
  ['Invalid sentiment filter.', 'Filtro de sentimento inválido.'],
  ['Invalid citation filter.', 'Filtro de citação inválido.'],
  ['Invalid report date.', 'Data do relatório inválida.'],
  [
    'Choose both dates for a custom period.',
    'Escolha as duas datas para um período personalizado.',
  ],
  ['Choose both dates for the comparison period.', 'Escolha as duas datas do período de comparação.'],
  [
    'Choose a comparison period of 1 to 90 days that starts before the period.',
    'Escolha um período de comparação de 1 a 90 dias que comece antes do período.',
  ],
  ['Invalid tag filter.', 'Filtro de tag inválido.'],
  ['Invalid topic filter.', 'Filtro de tópico inválido.'],
  ['Select a project.', 'Selecione um projeto.'],
  ['Choose a tracked brand.', 'Escolha uma marca monitorada.'],
  ['Choose a query.', 'Escolha uma query.'],
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
  ['Add up to 10 competitors.', 'Adicione no máximo 10 concorrentes.'],
  ['Competitor limit reached. Remove, reject or merge a monitored competitor first.', 'Limite de concorrentes atingido. Remova, rejeite ou junte um concorrente monitorado antes.'],
  ['Enter a domain for this brand before confirming it.', 'Informe o domínio desta marca antes de confirmar.'],
  ['This brand is already monitored.', 'Esta marca já está monitorada.'],
  ['Choose another brand to merge into.', 'Escolha outra marca para juntar.'],
  ['This brand cannot be merged there.', 'Esta marca não pode ser juntada ali.'],
  ['Your own brand cannot be reviewed here.', 'Sua própria marca não pode ser revisada aqui.'],
  ['Invalid brand decision.', 'Decisão de marca inválida.'],
  ['Invalid table key.', 'Chave de tabela inválida.'],
  ['hidden must be an array of column keys.', 'hidden deve ser uma lista de chaves de coluna.'],
  ['This decision was already undone or does not exist.', 'Esta decisão já foi desfeita ou não existe.'],
  ['The brand list changed. Reload and try again.', 'A lista de marcas mudou. Recarregue e tente novamente.'],
  ['This decision can no longer be undone because the brand list changed since.', 'Esta decisão não pode mais ser desfeita porque a lista de marcas mudou desde então.'],
  ['Nothing to undo.', 'Nada para desfazer.'],
  ['Do not repeat the brand name in aliases.', 'Não repita o nome da marca nas variações.'],
  ['Do not repeat the primary domain in additional domains.', 'Não repita o domínio principal nos domínios adicionais.'],
  ['Do not use a competitor name as an alias.', 'Não use o nome de um concorrente como variação.'],
  ['Do not use a competitor domain as an additional domain.', 'Não use o domínio de um concorrente como domínio adicional.'],
  ['Do not use your brand domain as a competitor domain.', 'Não use o domínio da marca como domínio de um concorrente.'],
  ['Invalid competitor.', 'Concorrente inválido.', 'Concorrente inválido'],
  [
    'Use distinct names for your brand and competitors.',
    'Use nomes diferentes para a marca e seus concorrentes.',
  ],
  ['Project not found.', 'Projeto não encontrado.'],
  ['Not found.', 'Não encontrado.'],
  ['Invalid access key.', 'Chave de acesso inválida.'],
  ['Too many attempts. Try again in a minute.', 'Muitas tentativas. Tente de novo em um minuto.'],
  ['Choose projects on automatic evaluations.', 'Escolha projetos com avaliação automática.'],
  ['Access denied.', 'Acesso negado.'],
  ['Invalid identifier.', 'Identificador inválido.'],
  ['Invalid frequency.', 'Frequência inválida.'],
  ['Invalid hour.', 'Horário inválido.'],
  ['Invalid day.', 'Dia inválido.'],
  ['Only workspace admins change the collection schedule.', 'Só admins do workspace mudam a agenda de coleta.'],
  ['Only workspace admins change data retention.', 'Só admins do workspace mudam a retenção de dados.'],
  ['Invalid retention.', 'Retenção inválida.'],
  ['Choose a time zone from the list.', 'Escolha um fuso horário da lista.'],
  ['Your plan sets how often Semantic Branding is collected.', 'O seu plano define a frequência do Semantic Branding.'],
  ['Choose a brand.', 'Escolha uma marca.'],
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
  ['Weight: use a number from 0 to 1000.', 'Peso: use um número de 0 a 1000.'],
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
  // The AI service failed (lib/server/model-errors.ts): never its name, status or reply.
  ['The AI service is unavailable right now. Try again in a few minutes.', 'O serviço de IA está indisponível agora. Tente de novo em alguns minutos.'],
  // Budgets and plans (lib/server/project-budgets.ts, spend-guards.ts, agent.ts, the project routes).
  ["The free plan includes one project at a time and a few new projects a month. Archive it to start another, or wait for next month if this month's were used.", 'O plano grátis inclui um projeto por vez e poucos projetos novos por mês. Arquive-o para começar outro, ou espere o próximo mês se os deste mês já foram usados.'],
  ['This workspace has no AI credits left this month: they are shared by all its projects.', 'Este workspace não tem mais créditos de IA neste mês: eles são divididos entre todos os projetos.'],
  ['This project reached its monthly budget. A workspace admin can raise it in Settings > Monitoring > Budget.', 'Este projeto atingiu o orçamento do mês. Um admin do workspace pode aumentá-lo em Configurações > Monitoramento > Orçamento.'],
  ['This mailbox already has a Lastfind account under another address. Sign in with the address you used before.', 'Esta caixa de email já tem uma conta no Lastfind com outro endereço. Entre com o endereço que você já usa.'],
  ['Paused for now, it resumes on its own soon. If it lasts more than a day, contact support.', 'Pausado por enquanto, volta sozinho em breve. Se durar mais de um dia, fale com o suporte.'],
  ['Costs are visible to workspace admins.', 'Os custos são visíveis para admins do workspace.'],
  ['Enter a monthly budget in US$, or 0 to stop paid work.', 'Informe um orçamento mensal em US$, ou 0 para parar o trabalho pago.'],
  ['A project with no budget is set by the Lastfind team.', 'Projeto sem orçamento só pela equipe do Lastfind.'],
  ['Your plan does not allow a budget this high. Lower it, or ask the Lastfind team.', 'Seu plano não permite um orçamento tão alto. Diminua o valor, ou fale com a equipe do Lastfind.'],
  ['This installation has no automatic evaluations.', 'Esta instalação não tem avaliações automáticas.'],
  ['Invalid request.', 'Solicitação inválida.'],
  ['Only a Lastfind admin changes this.', 'Só um admin do Lastfind muda isto.'],
  ['Enter a limit of 0 or more, or leave it empty for the default.', 'Informe um limite de 0 ou mais, ou deixe vazio para o padrão.'],
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
  const AI = '(?:ChatGPT|Gemini|Claude|Perplexity|Google AI Mode|AI Overviews)';
  const country = new RegExp(`^(${AI}) is not available in this project's country\\.$`).exec(message);
  if (country)
    return locale === 'en' ? message : `${country[1]} não está disponível no país deste projeto.`;
  const move = new RegExp(`^Remove (${AI}(?:, ${AI})*) monitoring before changing this project country\\.$`).exec(message);
  if (move)
    return locale === 'en'
      ? message
      : `Remova o monitoramento de ${move[1]} antes de alterar o país deste projeto.`;
  const named = /^An attribute names the brand (.{1,120}); describe it without brand names\.$/.exec(message);
  if (named)
    return locale === 'en' ? message : `Um atributo cita a marca ${named[1]}; descreva-o sem nomes de marcas.`;
  const brainMonth = /^The spending limit for generating the Brain was reached this month\. It resets on (\d{4}-\d{2}-\d{2})\. You can still write the files by hand\.$/.exec(message);
  if (brainMonth) {
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${brainMonth[1]}T00:00:00Z`));
    return locale === 'en'
      ? `The spending limit for generating the Brain was reached this month. It resets on ${day}. You can still write the files by hand.`
      : `O limite de gasto para gerar o Cérebro deste mês foi atingido. Ele volta em ${day}. Você ainda pode escrever os arquivos à mão.`;
  }
  // Admin only (Admin > Algorithms): why a generation failed, the provider's or the reader's own message, never content.
  const brainDetail = /^The AI did not return a usable Brain: (.{1,200})$/.exec(message);
  if (brainDetail) return locale === 'en' ? message : `A IA não devolveu um Cérebro utilizável: ${brainDetail[1]}`;
  // Comparison's rules (lib/comparison.ts comparisonIssues): a product's or item's name in the sentence.
  const comparison: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^Your plan compares up to (\d{1,3}) products\.$/, (m) => `Seu plano compara até ${m[1]} produtos.`],
    [/^Compare up to (\d{1,3}) products\.$/, (m) => `Compare até ${m[1]} produtos.`],
    [/^Use up to (\d{1,3}) (personas|attributes)\.$/, (m) => `Use até ${m[1]} ${m[2] === 'personas' ? 'personas' : 'atributos'}.`],
    [/^"(.{0,80})" is too short: use at least 2 characters\.$/, (m) => `"${m[1]}" é curto demais: use pelo menos 2 caracteres.`],
    [/^Add at least one competitor to (.{1,80})\.$/, (m) => `Adicione pelo menos um concorrente a ${m[1]}.`],
    [/^(.{1,80}): compare against up to (\d{1,3}) competitors\.$/, (m) => `${m[1]}: compare com até ${m[2]} concorrentes.`],
    [/^(.{1,80}): each option must be a different brand from yours\.$/, (m) => `${m[1]}: cada opção precisa ser uma marca diferente da sua.`],
    [/^Choose at least one attribute for (.{1,80})\.$/, (m) => `Escolha pelo menos um atributo para ${m[1]}.`],
    [/^(.{1,80}): choose up to (\d{1,3}) attributes\.$/, (m) => `${m[1]}: escolha até ${m[2]} atributos.`],
  ];
  for (const [pattern, pt] of comparison) {
    const found = pattern.exec(message);
    if (found) return locale === 'en' ? message : pt(found);
  }
  const filter = /^Invalid (topic|tag|prompt) filter\.$/.exec(message);
  if (filter)
    return locale === 'en'
      ? message
      : `Filtro de ${{ topic: 'tópico', tag: 'tag', prompt: 'prompt' }[filter[1]]} inválido.`;
  return locale === 'en'
    ? 'Could not complete this operation. Please try again.'
    : 'Não foi possível concluir a operação. Tente novamente.';
}
