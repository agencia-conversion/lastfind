# DataForSEO: plataformas e evidências

Verificado em 05/09/2026 nas fontes oficiais e nos endpoints autenticados `models` (sem custo).

| Plataforma | Endpoint base | Execução | Observações |
| --- | --- | --- | --- |
| ChatGPT | `ai_optimization/chat_gpt/llm_scraper` | Standard, prioridade 1, lote | Resposta da interface de busca. `sources` são citações; `search_results` são resultados recuperados, inclusive não usados. |
| Gemini | `ai_optimization/gemini/llm_scraper` | Standard, prioridade 1, lote | Resposta da interface, em inglês ou português (o português vai como `pt-BR`: o scraper recusa `pt` e `pt-PT`). |
| Claude | `ai_optimization/claude/llm_responses` | Standard, lote | Modelo puro `claude-sonnet-5`, com raciocínio e sem busca web; a mensagem de sistema pede para citar e avaliar só o que o modelo sabe com segurança e dizer quando não sabe. Resposta da API do modelo, não scraping da interface. Até 72h na fila do provedor. |
| Perplexity | `ai_optimization/perplexity/llm_responses` | Live, uma tarefa por chamada | `sonar`, opção econômica. DataForSEO não oferece Standard nesta plataforma; a execução é iniciada na mesma janela diária, com concorrência limitada. |
| Google AI Mode | `serp/google/ai_mode` | Standard, prioridade 1, lote | Extrai o bloco `ai_overview` e suas referências. |
| Google AI Overviews | `serp/google/organic` | Standard, prioridade 1, lote | `load_async_ai_overview=true`, profundidade 10. Ausência de AI Overview é um resultado válido sem resposta de IA; resultados orgânicos não são convertidos em citações. |

Fontes consultadas só são preenchidas a partir de listas explicitamente retornadas pelo provedor. `null` significa dado indisponível, `[]` significa lista retornada vazia. Anotações de respostas e referências de AI Overview são citações. Fan-out queries são armazenadas como buscas relacionadas, não como URLs consultadas.

A instalação pessoal inclui todas as plataformas acima; limites de idioma e tamanho do provedor são validados antes de enviar. Novas plataformas precisam de um endpoint documentado e um adaptador testado, não apenas um ícone ou nome no seletor. Não há endpoint de monitoramento de respostas de Copilot/Grok documentado nesta matriz.

## Fontes

- [Visão geral de LLM Responses](https://docs.dataforseo.com/v3/ai_optimization-llm_responses-overview/)
- [Scraper versus Responses](https://dataforseo.com/help-center/what-is-llm-scraper-api-and-what-data-does-it-provide)
- [ChatGPT: resultado estruturado e fontes](https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-task_get-advanced/)
- [Claude: Standard](https://docs.dataforseo.com/v3/ai_optimization-claude-llm_responses-task_post/)
- [Perplexity: Live](https://docs.dataforseo.com/v3/ai_optimization-perplexity-llm_responses-live/)
- [Google AI Mode: Standard](https://docs.dataforseo.com/v3/serp-google-ai_mode-task_post/)
- [Google Organic: AI Overview assíncrono](https://docs.dataforseo.com/v3/serp/google/organic/task_post/)
- [Preços LLM Scraper](https://dataforseo.com/pricing/ai-optimization/llm-scraper)

## Identidade visual

Ícones locais da distribuição `@lobehub/icons-static-svg@1.91.0`: OpenAI, Gemini, Claude, Perplexity e Google. O ícone de AI Mode (`ai-mode.svg`) é um desenho original do Lastfind (lupa com brilho), sem a marca do Google. [Lobe Icons](https://github.com/lobehub/lobe-icons), licença MIT preservada em `public/icons/ai/LICENSE`. Os nomes/logotipos pertencem aos respectivos titulares; seu uso identifica as plataformas.

Favicons usam o domínio público informado pelo usuário via Google S2. A imagem é carregada pelo navegador sem referrer, com fallback para a inicial da marca. O servidor Lastfind não faz fetch de URLs arbitrárias.

Claude Standard reserves a $0.01 advance plus the task fee. Completed costs replace that advance with the returned `money_spent`; free task GET calls are not zero-cost model answers. [Official pricing](https://dataforseo.com/pricing/ai-optimization/llm-responses). Reasoning summaries do not contribute to answer text or brand visibility.

## Provedores de modelo em ordem

Os classificadores, o agente e os wizards chamam modelos por três provedores, na ordem definida em Admin › Provedores (padrão: OpenAI, Anthropic, OpenRouter). Cada chamada vai ao primeiro provedor com chave que a atende; quando ele recusa (sem crédito, cota, limite de taxa, erro do servidor, chave recusada), passa na hora ao próximo, sem cobrança pela recusa. Sem chave, o provedor é pulado: só com a chave do OpenRouter tudo roda como antes.

- **OpenAI** (`OPENAI_API_KEY`): Responses API para as chamadas de texto e Decisions API (`POST /v1/decisions`, `gpt-6-luna`) para o modelo de decisão da OpenAI (`openai/gpt-6-luna-decisions` em Admin › Classificadores).
- **Anthropic** (`ANTHROPIC_API_KEY`): Messages API para as chamadas de texto. Não atende modelos de decisão: a API não dá probabilidades por rótulo.
- **OpenRouter** (`OPENROUTER_API_KEY`): todos os modelos, inclusive os de decisão da Liquid e da TypeSafe, que só existem lá.

O modelo salvo em Admin › Classificadores roda como está no OpenRouter, e direto na OpenAI ou na Anthropic quando é deles. O agente, os wizards, as intenções de busca e a revisão de aprendizado rodam um modelo próprio do provedor quando o salvo é de outra família (`DIRECT_MODELS` em `lib/model-providers.ts`); um modelo de decisão nunca troca. O custo de uma chamada direta é calculado pelos tokens a preço de tabela (`directCost`); o do OpenRouter é o que ele informa. Admin › Uso e custos mostra o gasto por provedor de modelo.
