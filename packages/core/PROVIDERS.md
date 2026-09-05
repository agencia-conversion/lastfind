# DataForSEO: plataformas e evidências

Verificado em 05/09/2026 nas fontes oficiais e nos endpoints autenticados `models` (sem custo).

| Plataforma | Endpoint base | Execução | Observações |
| --- | --- | --- | --- |
| ChatGPT | `ai_optimization/chat_gpt/llm_scraper` | Standard, prioridade 1, lote | Resposta da interface de busca. `sources` são citações; `search_results` são resultados recuperados, inclusive não usados. |
| Gemini | `ai_optimization/gemini/llm_scraper` | Standard, prioridade 1, lote | Resposta da interface. O scraper aceita inglês nesta integração. |
| Claude | `ai_optimization/claude/llm_responses` | Standard, lote | Modelo econômico `claude-haiku-4-5`, busca web habilitada. Resposta da API do modelo, não scraping da interface. Até 72h na fila do provedor. |
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

Ícones locais da distribuição `@lobehub/icons-static-svg@1.91.0`: OpenAI, Gemini, Claude, Perplexity e Google. [Lobe Icons](https://github.com/lobehub/lobe-icons), licença MIT preservada em `public/icons/ai/LICENSE`. Os nomes/logotipos pertencem aos respectivos titulares; seu uso identifica as plataformas.

Favicons usam o domínio público informado pelo usuário via Google S2. A imagem é carregada pelo navegador sem referrer, com fallback para a inicial da marca. O servidor Lastfind não faz fetch de URLs arbitrárias.

Claude Standard reserves a $0.01 advance plus the task fee. Completed costs replace that advance with the returned `money_spent`; free task GET calls are not zero-cost model answers. [Official pricing](https://dataforseo.com/pricing/ai-optimization/llm-responses). Reasoning summaries do not contribute to answer text or brand visibility.
