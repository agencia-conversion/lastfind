# Instalar o Lastfind na sua própria conta da Cloudflare

[English](install.md)

Este guia leva você do zero até um Lastfind privado e funcionando. Você não precisa ser desenvolvedor, mas vai digitar alguns comandos no terminal. Reserve cerca de 30 minutos na primeira vez, a maior parte criando contas.

**O que você ganha:** um site privado, num endereço como `https://meu-lastfind.seu-nome.workers.dev`, onde você acompanha como as assistentes de IA (ChatGPT, Gemini, Claude, Perplexity, Google AI Mode e AI Overviews) falam da sua marca. Só você entra, com uma chave que o instalador cria para você.

## Quanto custa

Você paga cada serviço diretamente. O Lastfind em si é gratuito (AGPL-3.0-only) e não cobra nada.

| Serviço | Para que serve | Custo |
| --- | --- | --- |
| [Cloudflare](https://www.cloudflare.com) | Hospeda o site e guarda seus dados | Os limites gratuitos cobrem uma instalação pequena. A Cloudflare pode pedir um meio de pagamento para ativar o R2 (armazenamento de arquivos); ela só cobra o que passar do limite gratuito. Se aparecerem erros de "exceeded CPU" ou tempo esgotado com muitos prompts, passe para o Workers Paid (cerca de US$ 5 por mês). |
| [DataForSEO](https://dataforseo.com) | Coleta as respostas das IAs | Pré-pago; a recarga mínima é de US$ 50 (confirme na [página de preços](https://dataforseo.com/pricing)). Cada resposta coletada custa cerca de US$ 0,0012 no ChatGPT, Gemini, Google AI Mode e AI Overviews, cerca de US$ 0,006 no Perplexity e cerca de US$ 0,018 no Claude (medido em uma execução real em outubro de 2026; o DataForSEO pode mudar os preços). |
| [OpenRouter](https://openrouter.ai) (opcional) | Avalia o quanto as respostas falam bem da sua marca (sentimento) | Crédito pré-pago; uma fração de centavo por resposta avaliada. Você pode pular. |
| [OpenAI](https://platform.openai.com/api-keys) ou [Anthropic](https://platform.claude.com/settings/keys) (opcional) | Rodam o Agente, os wizards e as intenções de busca com modelos próprios (e o modelo de decisão da OpenAI) antes do OpenRouter, na ordem que você define em Admin, Provedores. Um plano do ChatGPT ou do Claude com créditos mensais de API paga essas chamadas quando a chave vem da organização vinculada a ele | Pagamento por uso, ou os créditos de API do seu plano. Você pode pular. |

**Exemplo.** 20 prompts só no ChatGPT, coletados uma vez por dia: 600 respostas por mês, cerca de US$ 0,72. Os mesmos 20 prompts nas seis assistentes custam cerca de US$ 17 por mês, quase tudo Claude e Perplexity. Comece só com o ChatGPT e acrescente modelos quando vir valor.

### Limites de gasto

Toda chamada paga (uma resposta coletada, uma avaliação de sentimento, uma rodada do Semantic Branding, uma resposta do Agente) é reservada antes de sair e acertada pelo custo real depois. Três limites impedem que um engano esgote seus saldos. Quando um deles para o trabalho, nada mais é enviado e a Visão geral do projeto diz qual foi.

- **Orçamento mensal de cada projeto.** Um valor em US$ por mês cobre tudo o que o projeto gasta. Um projeto novo começa com US$ 50 por mês. Mude em **Configurações → Monitoramento → Orçamento**: outro valor, **Sem orçamento**, o campo vazio para o padrão (US$ 50) ou 0 para parar o trabalho pago do projeto. O mesmo cartão mostra o mês até agora por módulo e avisa passado 80% ou quando o ritmo do mês passaria do orçamento.
- **Coletas por mês e por dia.** A instalação limita a coleta a 1.500 respostas por mês (`SELF_HOST_MONTHLY_LIMIT`) e 1.000 por dia (`GLOBAL_DAILY_RUN_LIMIT`). Para mudar, edite em `vars` no arquivo `wrangler.selfhost.json` e rode `npm run deploy:selfhost`. O número diário também pode ser definido no app (próximo item), que vale sobre o arquivo.
- **Freio da instalação (opcional).** **Admin → Uso e custos** pode pôr um teto para todos os projetos juntos: US$ por mês, US$ por dia e coletas por dia. Nenhum vem definido; um campo vazio volta ao padrão. A mesma página mostra para onde vai o dinheiro, por projeto, módulo, IA e dia, com o orçamento de cada projeto.

## Licença comercial

O software gratuito é licenciado sob AGPL-3.0-only. Quem oferece uma versão modificada a terceiros, inclusive como serviço web, precisa disponibilizar o código-fonte correspondente sob AGPL-3.0. Para usar sem essas obrigações, a Conversion oferece uma [licença comercial](../COMMERCIAL-LICENSE.md): [comercial@conversion.com.br](mailto:comercial@conversion.com.br).

## Instalação em um clique (Deploy to Cloudflare)

Sem terminal. Você precisa de uma conta na Cloudflare (o Passo 3 explica; o R2 precisa estar ativado, o que pode pedir um meio de pagamento), uma conta no GitHub ou no GitLab e, para coletar, uma conta no DataForSEO (Passo 2).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/agencia-conversion/lastfind)

1. Clique no botão e entre na Cloudflare. Escolha um nome para o Worker (por exemplo `meu-lastfind`) e mantenha o banco, o bucket e o armazenamento de projetos sugeridos: a Cloudflare cria tudo na sua conta.
2. Preencha os cinco valores pedidos. Cada campo explica o seu:
   - `APP_URL`: o endereço que o Worker vai ter, `https://<nome do worker>.<seu subdomínio>.workers.dev`. O seu subdomínio fica em **Workers & Pages → Account details**.
   - `OWNER_EMAIL`: o seu e-mail, para identificar você na tela.
   - `OWNER_ACCESS_KEY`: a chave com que você vai entrar, com pelo menos 32 caracteres (`openssl rand -base64 32`, ou uma senha longa do seu gerenciador de senhas). Guarde-a lá.
   - `SESSION_SECRET` e `CREDENTIALS_KEY`: dois valores aleatórios diferentes (`openssl rand -hex 32`). Guarde o `CREDENTIALS_KEY` no gerenciador de senhas: ele sela as chaves que você salva no app.
3. Clique em **Deploy**. A Cloudflare copia o repositório para a sua conta Git, instala, monta (`npm run build`), aplica as migrações do banco e publica (`npm run deploy`). Leva alguns minutos.
4. Abra o seu endereço com `/app` no fim, cole a chave de acesso e entre. A [configuração guiada](#a-configuração-guiada) abre: as chaves dos provedores (cada uma testada de graça no endpoint do provedor e salva selada), os padrões e depois o primeiro projeto.
5. Siga para o [Passo 7](#passo-7-primeiro-projeto-e-prompts).

**Atualizar uma instalação em um clique.** A sua cópia do repositório é sua: para atualizar, traga a nova versão pública (**Sync fork** no GitHub, ou um pull na sua cópia) e a Cloudflare monta e publica a cada push no branch principal. Seus dados, chaves e a chave de proprietário continuam. A instalação em um clique não usa o `npm run setup`; use um caminho ou o outro numa instalação, não os dois.

## A configuração guiada

Na primeira vez que você abre a sua instalação (`/app`), a configuração guiada abre antes de tudo. Ela roda uma vez: depois de concluída, não abre mais, e tudo o que ela pede muda depois no app.

1. **Conta de admin.** Uma instalação ainda sem chave de proprietário (publicada sem `OWNER_ACCESS_KEY`) pede o **token de configuração** e o seu e-mail, e cria uma chave de acesso aleatória: a chave aparece uma vez só e o Lastfind guarda apenas o hash, então copie-a para o gerenciador de senhas. O token de configuração prova que foi você quem publicou, para ninguém que encontre o endereço antes tomar a instalação:
   - defina você mesmo como secret do Worker antes da primeira visita: `npx wrangler secret put SETUP_TOKEN` (qualquer valor longo e aleatório, por exemplo `openssl rand -base64 32`); ou
   - deixe sem definir: na primeira visita a instalação cria um e o imprime uma vez no log do Worker. Rode `npx wrangler tail <nome do seu worker>` antes de abrir o endereço e copie a linha `Lastfind setup token, shown once`. Perdeu? Defina o `SETUP_TOKEN` como acima; ele tem prioridade.

   Tokens errados são recusados, e depois de 5 de um mesmo endereço em 15 minutos esse endereço espera. Uma instalação feita com `npm run setup` ou com o botão Deploy já tem a chave de proprietário: entre com ela e a configuração começa no passo seguinte, sem token.
2. **Provedores.** Primeiro o DataForSEO (coleta as respostas das IAs; recomendado agora, senão a coleta espera), depois os provedores de modelo na ordem em que as chamadas os usam: OpenAI, Anthropic, OpenRouter (recomendado: o OpenRouter, o único com os modelos de decisão dos classificadores). Cada cartão testa a chave no endpoint gratuito do provedor antes de salvar; as chaves salvas ficam seladas com o `CREDENTIALS_KEY`. Chaves que o seu Worker já tem como secrets aparecem como em uso.
3. **Padrões.** O idioma da interface, o fuso que as coletas seguem e um teto mensal para a instalação inteira (recomendado: US$ 100 para começar; o trabalho pago pausa quando o mês chega a ele). Mude depois em **Configurações → Monitoramento** e **Admin → Uso e custos**.
4. **Começar.** O que está definido e **Criar o primeiro projeto**, que abre o assistente de projeto ([Passo 7](#passo-7-primeiro-projeto-e-prompts)).

As chaves mudam depois em **Admin → Provedores**.

## Passo 1. Prepare o computador

Você precisa de:

- Um Mac, um computador Linux, ou Windows com [WSL](https://learn.microsoft.com/windows/wsl/install) (abra um terminal Ubuntu e trabalhe nele).
- **Node.js 22.13 ou mais novo.** Baixe em [nodejs.org](https://nodejs.org). Confira com `node --version`.
- **Git**, ou a possibilidade de baixar um ZIP. Confira com `git --version`.

Abra um terminal (Mac: Terminal; Windows: Ubuntu; Linux: o seu terminal).

## Passo 2. Crie a conta no DataForSEO

1. Cadastre-se em [dataforseo.com](https://dataforseo.com) e confirme o e-mail.
2. Adicione saldo (veja a tabela de custos). Sem saldo, a coleta falha.
3. Abra **API Access** no painel. Anote o **login da API** (o e-mail da conta) e a **senha da API**. Essa senha da API é gerada pelo DataForSEO e **não** é a senha que você usa para entrar no site. Ela aparece nas primeiras 24 horas depois do cadastro; depois, use "Send by e-mail" nessa página para recebê-la de novo.

## Passo 3. Crie a conta na Cloudflare e escolha como conectar

1. Cadastre-se em [cloudflare.com](https://dash.cloudflare.com/sign-up) e confirme o e-mail.
2. No painel, abra **R2 Object Storage** e ative se for pedido. O Lastfind guarda ali as respostas originais. O instalador para com uma mensagem clara se o R2 não estiver ativo.
3. Escolha **uma** forma de conectar:
   - **No seu próprio computador (mais fácil):** não faça nada agora. Durante a instalação uma janela do navegador abre; entre na conta e clique em *Allow*.
   - **Em servidor, ou se nenhuma janela abrir:** crie um token de API. Vá em [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → *Create Token* → *Create Custom Token*, com permissões de *Account* **Workers Scripts: Edit**, **D1: Edit** e **Workers R2 Storage: Edit** (e *Account Settings: Read*), para a sua conta. Copie o token e, antes de rodar a instalação, defina no terminal:

     ```sh
     export CLOUDFLARE_API_TOKEN="cole-o-token-aqui"
     export CLOUDFLARE_ACCOUNT_ID="cole-o-id-da-conta-aqui"   # aparece na página inicial do painel, à direita
     ```

## Passo 4. OpenRouter (opcional)

Pule este passo se você só quer acompanhar visibilidade. Para sentimento, crie uma conta em [openrouter.ai](https://openrouter.ai), adicione alguns dólares de crédito e crie uma chave em [openrouter.ai/keys](https://openrouter.ai/keys). Ela começa com `sk-or-`. Você pode adicioná-la depois rodando `npm run setup` de novo.

Avançado: para revisar com outro modelo, escolha em **Admin → Classificadores** depois de entrar (um modelo por função, para todos os projetos). A variável de Worker `LASTFIND_CLASSIFIER_MODELS` em `wrangler.selfhost.json` (em `vars`), por exemplo `{"source_types":"liquid/d1-ultra"}`, faz o mesmo pelo arquivo; o modelo escolhido no Admin vale sobre ela. Se o modelo escolhido falhar, a revisão se repete uma vez no modelo padrão.

## Passo 5. Baixe e instale

```sh
git clone https://github.com/agencia-conversion/lastfind.git
cd lastfind
npm ci
npm run setup -- --lang pt-BR
```

(Sem Git? Baixe o repositório como ZIP no GitHub, descompacte, abra um terminal dentro da pasta e rode os dois últimos comandos.)

O `npm ci` baixa as dependências (um ou dois minutos; avisos de "audit" ou "install-scripts" são normais). Depois o `npm run setup`:

1. Pede o login e a senha do DataForSEO (a senha não aparece ao digitar) e **confere na hora**. Um valor errado é explicado em palavras simples e você pode digitar de novo.
2. Opcionalmente pede a chave do OpenRouter e confere.
3. Conecta à Cloudflare, pergunta um nome para a sua instalação (por exemplo `meu-lastfind`) e o seu e-mail.
4. Cria o banco de dados, o armazenamento dos projetos e o arquivo privado de respostas, publica o site e mostra o endereço.

Suas chaves ficam só nos arquivos `.env` e `.lastfind/` desta pasta e como segredos do seu próprio Worker. Não são enviadas a nenhum outro lugar. A instalação nunca cobra nada e nunca muda o seu plano da Cloudflare. O que a instalação coloca no seu Worker está em [Chaves, segredos e limites](#chaves-segredos-e-limites).

Dá para rodar a instalação de novo quando quiser: ela reaproveita o que já existe e não perde nada. Para conferir suas chaves sem instalar nada, rode `npm run setup -- --check-only`.

> **Faça backup destes arquivos.** `wrangler.selfhost.json`, `.env` e a pasta `.lastfind/` são a única ligação entre esta pasta e a sua instalação, e `.lastfind/access-key.txt` é a sua única chave de entrada. Copie para um lugar seguro (a chave, para um gerenciador de senhas). Nunca compartilhe nem publique.

## Passo 6. Entre

No final, a instalação mostra o seu endereço (terminado em `/app`) e onde está a chave. Para mostrar a sua chave de proprietário:

```sh
cat .lastfind/access-key.txt        # Mac, Linux, WSL
```

Abra o endereço, cole a chave e clique em **Entrar na minha instalação**: a [configuração guiada](#a-configuração-guiada) abre primeiro. Guarde a chave no gerenciador de senhas. Se perdê-la, rode `npm run setup` de novo: ele publica outra vez com a mesma chave guardada em `.lastfind/access-key.txt` (se esse arquivo sumiu, a instalação cria uma chave nova).

## Passo 7. Primeiro projeto e prompts

1. Depois de entrar, preencha **Marca** (por exemplo *Conversion*), **Domínio** (`conversion.com.br`), idioma e país e clique em **Criar projeto**. O formulário começa em *Estados Unidos* e inglês: busque o país na lista (qualquer país); para uma marca brasileira escolha *Brasil* e o idioma passa para português. Prompts e respostas ficam em português ou inglês; uma IA que não coleta no país escolhido aparece abaixo do campo. Toda IA responde nos dois idiomas.
2. Abra **Prompts** → **Adicionar prompt**. Um prompt é uma pergunta que seus clientes poderiam fazer a uma IA, por exemplo *Quais são as melhores agências de otimização de conversão do Brasil?* Escolha os modelos de IA (o ChatGPT vem marcado) e salve. Dá para colar até 100 prompts de uma vez.
3. **Quando os dados aparecem.** Adicionar um prompt inicia a primeira coleta na hora (isso gasta saldo do DataForSEO). As respostas chegam conforme cada modelo termina, não todas juntas: Google AI Overviews e AI Mode em cerca de um minuto, ChatGPT, Gemini e Perplexity normalmente em poucos minutos, Claude em cerca de 30 minutos. Nas nossas duas rodadas de teste com 17 prompts, a fila do DataForSEO fez ChatGPT, Perplexity ou Gemini levarem até 45 minutos uma vez e o Gemini cerca de duas horas uma vez. Abra **Prompts → Respostas**: cada resposta aparece ali assim que o modelo termina, e os relatórios vão se preenchendo conforme elas chegam. Depois disso cada prompt é coletado todo dia por volta das 04:00 no seu fuso horário (o do navegador quando você criou o primeiro projeto); **Configurações → Monitoramento** muda o horário e o fuso, ou deixa o projeto semanal no dia que você escolher (segunda-feira por padrão).
4. Tela vazia significa "ainda sem dados", nunca "zero". Se nenhuma resposta chegar em 15 minutos, veja a Solução de problemas.

**Sentimento (precisa do OpenRouter).** Com uma chave do OpenRouter, as respostas novas de todo projeto são avaliadas automaticamente: o agendador as revisa em segundo plano depois de cada coleta, dentro do orçamento mensal do projeto (**Configurações → Monitoramento → Orçamento**), e classifica do mesmo jeito as fontes que elas citam. Os resultados aparecem na coluna **Sentimento** de **Marcas**, no cartão **Índice de sentimento** da Visão geral e na página de cada marca; os primeiros chegam minutos depois da primeira coleta (a Cloudflare pode levar até 15 minutos para iniciar o agendador de uma instalação nova). Para parar em um projeto, desmarque **Habilitar avaliação** em **Configurações → Concorrentes → Descoberta de marcas e sentimento** e clique em **Salvar alterações**. Sem a chave do OpenRouter nada é avaliado; adicione uma em **Admin → Provedores**.

## Atualizar

Seus dados ficam na sua conta da Cloudflare, então atualizar só troca o código.

```sh
cd lastfind
git pull
npm ci
npm run deploy:selfhost
```

Se você usou ZIP, baixe o novo ZIP, descompacte numa pasta **nova**, rode `npm ci`, copie `.env`, `wrangler.selfhost.json` e a pasta `.lastfind/` da pasta antiga para ela e rode `npm run deploy:selfhost`. A publicação mantém o seu Worker, banco, projetos, armazenamento e chave de proprietário. Confira que `https://seu-endereço/api/health` mostra `"ok":true` e que seus projetos continuam lá.

## Backup

Um backup completo tem três partes, além dos arquivos privados do Passo 5.

- **Dados dos projetos.** No app, **Configurações → Dados do projeto** faz um backup em segundo plano (guardado no seu bucket R2, os 3 mais recentes por 30 dias), baixa e restaura. Pelo terminal, `npm run storage -- list` mostra seus projetos e `npm run storage -- export --project ID_DO_PROJETO --output backup-ID_DO_PROJETO.ndjson` salva um; `npm run storage -- --help` descreve a restauração. O arquivo de um projeto também leva as suas conversas com o Agente, como cópia de registro: a restauração confere e pula essas conversas, e nunca muda uma conversa. Detalhes: [SELF_HOST_STORAGE.md](../packages/core/SELF_HOST_STORAGE.md).
- **Banco de controle.** `npx wrangler d1 export NOME-DO-BANCO --remote --config wrangler.selfhost.json --output backup-controle.sql` (o banco tem o mesmo nome da sua instalação). Ele guarda configurações, orçamentos, decisões de marca, Semantic Branding, os artefatos, o Cérebro e as skills do Agente, e as chaves salvas no Admin, que continuam seladas e só abrem com o `CREDENTIALS_KEY` guardado em `.lastfind/secrets.json`.
- **Respostas originais.** As exportações referenciam o arquivo privado do R2, mas não o copiam. Faça backup com as [ferramentas do R2](https://developers.cloudflare.com/r2/) se precisar das respostas brutas.

## Chaves, segredos e limites

A instalação grava estes segredos no seu Worker e guarda uma cópia em `.lastfind/secrets.json`. Cada um é aleatório e tem uma função:

| Segredo | O que faz |
| --- | --- |
| `OWNER_ACCESS_KEY_HASH` | Confere a sua chave de proprietário (a chave em si fica só em `.lastfind/access-key.txt`) |
| `SESSION_SECRET` | Assina a sua sessão |
| `CREDENTIALS_KEY` | Sela as chaves de provedor que você salva em **Admin → Provedores** |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `OPENROUTER_API_KEY` | As chaves de provedor que você digitou na instalação |

Uma instalação em um clique tem `OWNER_ACCESS_KEY` (a própria chave, que você digitou) no lugar de `OWNER_ACCESS_KEY_HASH`, mais `APP_URL` e `OWNER_EMAIL`, e nenhuma chave de provedor até você salvar no app.

- **Chaves de provedor no app.** A [configuração guiada](#a-configuração-guiada) pede uma vez; **Admin → Provedores** mostra quais chaves estão valendo (nunca o valor), testa de graça e deixa trocar uma. Uma chave salva ali vale sobre a da instalação; remover volta para a da instalação.
- **Uso da Cloudflare (opcional).** **Admin → Uso e custos** pode mostrar o que a sua conta da Cloudflare usou no mês (Workers, D1, Durable Objects, R2) e o custo estimado. Crie um token de API no painel da Cloudflare (**My Profile → API Tokens → Create Token → Custom token**) com uma só permissão, **Account → Account Analytics → Read**, limitado à sua conta, depois salve-o com o ID da sua conta em **Admin → Provedores**, cartão Cloudflare (lá ele fica selado e é testado de graça). O secret `CLOUDFLARE_ANALYTICS_TOKEN` e a variável `CLOUDFLARE_ACCOUNT_ID` do Worker continuam valendo como reserva. Sem eles a seção diz que não está configurada.
- **Limites que o app aplica sozinho.** Uma conexão de app de IA (Configurações → Apps de IA) faz no máximo 60 chamadas por minuto. Novos registros de apps de IA são limitados por endereço e no total a cada hora. A entrada aceita no máximo dez tentativas de chave por minuto de um mesmo endereço (a chave que o `npm run setup` cria tem 256 bits aleatórios; a chave digitada numa instalação em um clique fica protegida por esse limite). Nenhuma regra de rate limiting da Cloudflare é necessária; se você puser um domínio próprio na frente, pode criar regras no painel da Cloudflare.

## Remover a instalação

Isto apaga os seus dados. Exporte um backup antes. No painel da Cloudflare:

1. **Workers & Pages** → seu Worker → *Settings* → *Delete* (isso também remove o armazenamento dos projetos).
2. **D1** → seu banco → *Delete*.
3. **R2 Object Storage** → seu bucket `…-raw-…` → esvazie e depois apague.

Depois apague a pasta e revogue as chaves do DataForSEO/OpenRouter e o token da Cloudflare se não precisar mais deles.

## Solução de problemas

| O que aparece | O que significa e o que fazer |
| --- | --- |
| `O Node.js … é antigo demais` | Instale o Node.js 22.13 ou mais novo em [nodejs.org](https://nodejs.org), abra um terminal **novo** e rode `npm ci` de novo. |
| `O DataForSEO não aceitou esse login e senha` | Use o **login da API** (e-mail da conta) e a **senha da API** da página *API Access* do painel, não a senha do site. Rode `npm run setup -- --check-only` para testar de novo. |
| `DataForSEO: login aceito, mas o saldo está zerado` | Adicione saldo no DataForSEO. As coletas falham até lá. |
| `O OpenRouter não aceitou essa chave` | Copie a chave de novo em [openrouter.ai/keys](https://openrouter.ai/keys). Ou pule o OpenRouter apertando Enter nessa pergunta. |
| `Você não está conectado à Cloudflare` | Rode `npm run setup` num terminal normal (um navegador abre) ou defina `CLOUDFLARE_API_TOKEN` como no Passo 3. |
| `A Cloudflare recusou o acesso` | O token não tem permissões suficientes. Recrie com *Edit* em Workers Scripts, D1 e Workers R2 Storage para a conta certa e defina `CLOUDFLARE_ACCOUNT_ID`. |
| `R2 is required … Activate R2` | Abra **R2 Object Storage** no painel da Cloudflare, ative (a Cloudflare pode pedir um meio de pagamento) e rode `npm run setup` de novo. |
| `Worker … already exists` / `Já existe um banco de dados chamado …` | Esse nome já está em uso na sua conta por outra coisa. Rode de novo com outro nome: `npm run setup -- --name meu-outro-nome`. |
| Publicou, mas o endereço não abre | Endereços `workers.dev` novos podem levar um ou dois minutos. Se você nunca escolheu um subdomínio `workers.dev`, abra **Workers & Pages** no painel uma vez para criá-lo e rode `npm run deploy:selfhost`. |
| `Esta pasta já tem a instalação …` | Uma pasta guarda uma instalação. Use esse nome para atualizá-la, ou clone/descompacte uma cópia nova para outra. |
| A entrada diz que a chave é inválida | Cole a linha inteira de `.lastfind/access-key.txt`, sem espaços. |
| A página fica em "Carregando seu workspace…" logo após instalar ou atualizar | Espere um minuto e atualize a página (Ctrl/Cmd+Shift+R). A Cloudflare leva um instante para servir os arquivos novos em todo lugar. |
| Nenhuma resposta depois de 15 minutos | Confira o saldo do DataForSEO e depois `https://seu-endereço/api/health`. O agendador roda a cada 5 minutos; a primeira resposta pode levar até 15 minutos e algumas respostas (o Gemini em um dos nossos testes) levaram cerca de duas horas, então um modelo ainda ausente de **Respostas** por um tempo é normal. |
| "O monitoramento está desligado: esta instalação não tem credenciais da DataForSEO" | Salve em **Admin → Provedores** ou rode `npm run setup` de novo. |
| "O monitoramento está temporariamente indisponível" | Falta ao Worker o armazenamento dos projetos ou o arquivo de respostas. Rode `npm run deploy:selfhost` (ou `npm run setup`) de novo. |
| Muitos prompts dão tempo esgotado ou "exceeded CPU" | Limites gratuitos da Cloudflare. Passe para o Workers Paid (cerca de US$ 5 por mês) ou acompanhe menos prompts. |
| As coletas pararam no meio do mês, ou a Visão geral diz "Coleta pausada" | Um limite de gasto foi atingido; a Visão geral diz qual (veja [Limites de gasto](#limites-de-gasto)). Aumente o orçamento do projeto em Configurações → Monitoramento → Orçamento, o freio da instalação em Admin → Uso e custos, ou os limites de coleta em `wrangler.selfhost.json` (e rode `npm run deploy:selfhost`). |

## Vercel, Netlify e outras hospedagens

O Lastfind **não** está disponível na Vercel (nem na Netlify e similares). Ele depende de serviços exclusivos da Cloudflare: D1 para o banco de controle, Durable Objects com SQLite para cada projeto, R2 para as respostas originais e Cron Triggers para a coleta diária. Não há equivalente direto nesses lugares, por isso não oferecemos instruções. A Cloudflare é o lugar suportado para rodar.

## Ajuda

Abra uma issue no repositório do projeto. Nunca cole chaves, senhas ou o conteúdo de `.env` ou `.lastfind/` numa issue.
