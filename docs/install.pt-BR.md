# Instalar o Lastfind na sua própria conta da Cloudflare

[English](install.md)

Este guia leva você do zero até um Lastfind privado e funcionando. Você não precisa ser desenvolvedor, mas vai digitar alguns comandos no terminal. Reserve cerca de 30 minutos na primeira vez, a maior parte criando contas.

**O que você ganha:** um site privado, num endereço como `https://meu-lastfind.seu-nome.workers.dev`, onde você acompanha como as assistentes de IA (ChatGPT, Gemini, Claude, Perplexity, Google AI Mode e AI Overviews) falam da sua marca. Só você entra, com uma chave que o instalador cria para você.

## Quanto custa

Você paga cada serviço diretamente. O Lastfind em si é gratuito (Apache-2.0) e não cobra nada.

| Serviço | Para que serve | Custo |
| --- | --- | --- |
| [Cloudflare](https://www.cloudflare.com) | Hospeda o site e guarda seus dados | Os limites gratuitos cobrem uma instalação pequena. A Cloudflare pode pedir um meio de pagamento para ativar o R2 (armazenamento de arquivos); ela só cobra o que passar do limite gratuito. Se aparecerem erros de "exceeded CPU" ou tempo esgotado com muitos prompts, passe para o Workers Paid (cerca de US$ 5 por mês). |
| [DataForSEO](https://dataforseo.com) | Coleta as respostas das IAs | Pré-pago; a recarga mínima é de US$ 50 (confirme na [página de preços](https://dataforseo.com/pricing)). Cada resposta coletada custa cerca de US$ 0,0012 no ChatGPT, Gemini, Google AI Mode e AI Overviews, cerca de US$ 0,02 no Perplexity e cerca de US$ 0,06 no Claude. |
| [OpenRouter](https://openrouter.ai) (opcional) | Avalia o quanto as respostas falam bem da sua marca (sentimento) | Crédito pré-pago; uma fração de centavo por resposta avaliada. Você pode pular. |

**Exemplo.** 20 prompts só no ChatGPT, coletados uma vez por dia: 600 respostas por mês, cerca de US$ 0,72. Os mesmos 20 prompts nas seis assistentes custam cerca de US$ 50 por mês, quase tudo Claude e Perplexity. Comece só com o ChatGPT e acrescente modelos quando vir valor.

**Limites de segurança.** A instalação limita a coleta a 1.500 respostas por mês e 1.000 por dia, para que um engano não esgote seu saldo. Para mudar, edite `SELF_HOST_MONTHLY_LIMIT` e `GLOBAL_DAILY_RUN_LIMIT` em `vars` no arquivo `wrangler.selfhost.json` e rode `npm run deploy:selfhost`.

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

Suas chaves ficam só nos arquivos `.env` e `.lastfind/` desta pasta e como segredos do seu próprio Worker. Não são enviadas a nenhum outro lugar. A instalação nunca cobra nada e nunca muda o seu plano da Cloudflare.

Dá para rodar a instalação de novo quando quiser: ela reaproveita o que já existe e não perde nada. Para conferir suas chaves sem instalar nada, rode `npm run setup -- --check-only`.

> **Faça backup destes arquivos.** `wrangler.selfhost.json`, `.env` e a pasta `.lastfind/` são a única ligação entre esta pasta e a sua instalação, e `.lastfind/access-key.txt` é a sua única chave de entrada. Copie para um lugar seguro (a chave, para um gerenciador de senhas). Nunca compartilhe nem publique.

## Passo 6. Entre

No final, a instalação mostra o seu endereço (terminado em `/app`) e onde está a chave. Para mostrar a sua chave de proprietário:

```sh
cat .lastfind/access-key.txt        # Mac, Linux, WSL
```

Abra o endereço, cole a chave e clique em **Entrar na minha instalação**. Guarde a chave no gerenciador de senhas. Se perdê-la, rode `npm run setup` de novo: ele publica outra vez com a mesma chave guardada em `.lastfind/access-key.txt` (se esse arquivo sumiu, a instalação cria uma chave nova).

## Passo 7. Primeiro projeto e prompts

1. Depois de entrar, preencha **Marca** (por exemplo *Conversion*), **Domínio** (`conversion.com.br`), idioma e país e clique em **Criar projeto**.
2. Abra **Prompts** → **Adicionar prompt**. Um prompt é uma pergunta que seus clientes poderiam fazer a uma IA, por exemplo *Quais são as melhores agências de otimização de conversão do Brasil?* Escolha os modelos de IA (o ChatGPT vem marcado) e salve. Dá para colar até 100 prompts de uma vez.
3. **Quando os dados aparecem.** Adicionar um prompt inicia a primeira coleta na hora (isso gasta saldo do DataForSEO). Os resultados costumam aparecer em 2 a 5 minutos: abra **Visão geral** e veja a linha *Monitoramento: diário · 1 pendentes* virar *0 pendentes*. Depois disso cada prompt é coletado todo dia por volta das 04:00 de Brasília.
4. Tela vazia significa "ainda sem dados", nunca "zero". Se *pendente* não diminuir em 15 minutos, veja a Solução de problemas.

**Sentimento opcional (precisa do OpenRouter).** Abra **Configurações → Concorrentes → Descoberta de marcas e sentimento**, marque **Habilitar avaliação**, **Salvar configuração** e depois **Avaliar até 20 respostas**. Os resultados aparecem em **Marcas → Sentimentos** depois da próxima execução do agendador (em cerca de 5 minutos; a Cloudflare pode levar até 15 minutos para iniciar o agendador de uma instalação nova, então no primeiro dia pode demorar mais). Sem a chave do OpenRouter, essa seção pede para adicionar a chave à configuração do servidor: rode `npm run setup` de novo e cole a chave.

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

- **Dados dos projetos.** `npm run storage -- list` mostra seus projetos; `npm run storage -- export --project ID_DO_PROJETO --output backup-ID_DO_PROJETO.ndjson` salva um. A restauração está descrita em `npm run storage -- --help`.
- **Banco de controle.** `npx wrangler d1 export NOME-DO-BANCO --remote --config wrangler.selfhost.json --output backup-controle.sql` (o banco tem o mesmo nome da sua instalação).
- **Respostas originais.** As exportações referenciam o arquivo privado do R2, mas não o copiam. Faça backup com as [ferramentas do R2](https://developers.cloudflare.com/r2/) se precisar das respostas brutas.

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
| A Visão geral fica em "pendente" | Confira o saldo do DataForSEO e depois `https://seu-endereço/api/health`. O agendador roda a cada 5 minutos; a primeira resposta pode levar até 15 minutos. |
| "Monitoring is temporarily unavailable" | Faltam as credenciais do DataForSEO no Worker. Rode `npm run setup` de novo. |
| Muitos prompts dão tempo esgotado ou "exceeded CPU" | Limites gratuitos da Cloudflare. Passe para o Workers Paid (cerca de US$ 5 por mês) ou acompanhe menos prompts. |
| As coletas pararam no meio do mês | Você atingiu o limite de segurança (veja *Quanto custa*). Aumente-o em `wrangler.selfhost.json` e rode `npm run deploy:selfhost`. |

## Vercel, Netlify e outras hospedagens

O Lastfind **não** está disponível na Vercel (nem na Netlify e similares). Ele depende de serviços exclusivos da Cloudflare: D1 para o banco de controle, Durable Objects com SQLite para cada projeto, R2 para as respostas originais e Cron Triggers para a coleta diária. Não há equivalente direto nesses lugares, por isso não oferecemos instruções. A Cloudflare é o lugar suportado para rodar.

## Ajuda

Abra uma issue no repositório do projeto. Nunca cole chaves, senhas ou o conteúdo de `.env` ou `.lastfind/` numa issue.
