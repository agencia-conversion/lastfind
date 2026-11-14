/**
 * Which model each cheap classifier/evaluator uses. The code keeps the current
 * model as the default; the server setting LASTFIND_CLASSIFIER_MODELS, a JSON
 * object such as {"source_types":"liquid/d1-ultra"}, replaces it per classifier,
 * and a model saved in Admin > Classifiers (one per function, `platform_settings`
 * key `classifier:<function>`) replaces both. The code default doubles as the
 * previous engine a failed call falls back to.
 */
export const CLASSIFIERS = [
  'source_types',
  'brand_research_liquid',
  'brand_research_jev',
  'brand_research_decisions',
  'brand_roles',
  'brand_mentions',
  'brand_mentions_tiebreak',
  'brand_mentions_reader',
  'brand_mentions_confirm',
  'brand_domain',
  'semantic',
  'agent',
  'fanout_intents',
  'semantic_attributes',
  'semantic_reader',
  'brain_wizard',
  'agent_curator',
  'project_wizard',
  'comparison_reader',
] as const;
export type Classifier = (typeof CLASSIFIERS)[number];
/** A model of OpenRouter's typed Decisions endpoint (closed labels with probabilities), as opposed to a chat model that writes text. */
export const isDecisionModel = (model: string) => /^(?:liquid|typesafe)\//u.test(model) || model.endsWith('-decisions');

/**
 * What an admin configures: one model per function. The three sentiment evaluators (`brand_research_*`, chosen per
 * project before this setting existed) are one function here: a saved sentiment model applies to every project.
 */
export const CLASSIFIER_FUNCTIONS = [
  {
    id: 'sentiment',
    label: ['Sentiment', 'Sentimento'],
    decides: ['Whether an answer speaks well or badly of a brand', 'Se uma resposta fala bem ou mal de uma marca'],
    rerun: true,
  },
  {
    id: 'source_types',
    label: ['Source types', 'Tipos de fonte'],
    decides: ['The type of site and page of a cited source', 'O tipo de site e de página de uma fonte citada'],
    rerun: false,
  },
  {
    id: 'brand_roles',
    label: ['Roles per question', 'Papéis por pergunta'],
    decides: ['What a discovered name is: competitor, client, supplier, partner or mention', 'O que um nome descoberto é: concorrente, cliente, fornecedor, parceiro ou menção'],
    rerun: true,
  },
  {
    id: 'brand_mentions',
    label: ['Common-word brand checks', 'Checagem de marcas com nome comum'],
    decides: ['Whether a mention of a monitored name that is also a common word names the brand ("Conversion" the agency or the word); by default the roles model', 'Se uma menção de um nome monitorado que também é palavra comum é a marca ("Conversion" a agência ou a palavra); por padrão o modelo dos papéis'],
    rerun: true,
  },
  {
    id: 'brand_mentions_tiebreak',
    label: ['Own brand: tie-breaker', 'Marca do projeto: desempate'],
    decides: ["When the two questions about a mention of the project's own brand disagree or are unsure, reads the whole answer and decides", 'Quando as duas perguntas sobre uma menção da marca do projeto discordam ou ficam em dúvida, lê a resposta inteira e decide'],
    rerun: true,
  },
  {
    id: 'brand_mentions_reader',
    label: ['Own brand: reader', 'Marca do projeto: leitura final'],
    decides: [
      "When the tie-breaker is unsure too, reads the answer, quotes the passage that decides it and searches once for businesses with the same name (a chat model, with web search for that search). A decision model named here reads it as one closed question, without a quote; the search stays on the agent's model",
      'Quando o desempate também fica em dúvida, lê a resposta, cita o trecho que decide e busca uma vez empresas com o mesmo nome (um modelo de chat, com busca na web nessa busca). Um modelo de decisão escolhido aqui lê numa pergunta fechada, sem citar trecho; a busca segue no modelo do agente',
    ],
    rerun: true,
  },
  {
    id: 'brand_mentions_confirm',
    label: ['Own brand: second reader', 'Marca do projeto: segunda leitura'],
    decides: [
      'When the reader says a mention of the project\'s own brand is a same-named business, reads it again with another model; only when both agree is it not counted (another family than the reader)',
      'Quando a leitura final diz que uma menção da marca do projeto é uma empresa homônima, lê de novo com outro modelo; só quando os dois concordam ela não conta (outra família que a da leitura final)',
    ],
    rerun: true,
  },
  {
    id: 'brand_domain',
    label: ['Brand domain', 'Domínio da marca'],
    decides: ['The official domain of a discovered brand', 'O domínio oficial de uma marca descoberta'],
    rerun: false,
  },
  {
    id: 'fanout_intents',
    label: ['Search intents', 'Intenções de busca'],
    decides: ['Groups the searches the AIs run into intents with their entities (writes names, so a chat model)', 'Agrupa as buscas que as IAs fazem em intenções com suas entidades (escreve nomes, por isso um modelo de chat)'],
    rerun: false,
  },
  {
    id: 'agent',
    label: ['Agent', 'Agente'],
    decides: ['Answers questions about a project in the chat and writes its artifacts', 'Responde perguntas sobre um projeto no chat e escreve seus artefatos'],
    rerun: false,
  },
  {
    id: 'semantic_attributes',
    label: ['Semantic Branding: attributes', 'Semantic Branding: atributos'],
    decides: ['Suggests the attributes of a segment and their definitions in the attribute wizard (with web search)', 'Sugere os atributos de um segmento e suas definições no wizard de atributos (com busca na web)'],
    rerun: false,
  },
  {
    id: 'semantic_reader',
    label: ['Semantic Branding: reading answers', 'Semantic Branding: leitura das respostas'],
    decides: [
      'Scores each brand on each attribute from an answer in prose (an AI Overview). Default: the search data provider\'s reader; a decision model named here answers one closed question per pair, in one call, without a quote, so its notes stay at 59 or below (no evidence)',
      'Dá a nota de cada marca em cada atributo a partir de uma resposta em texto corrido (um AI Overview). Padrão: o leitor do provedor de dados de busca; um modelo de decisão escolhido aqui responde uma pergunta fechada por par, numa chamada, sem trecho do texto, então suas notas ficam em 59 ou menos (sem evidência)',
    ],
    rerun: false,
  },
  {
    id: 'brain_wizard',
    label: ['Agent: Brain wizard', 'Agente: wizard do Cérebro'],
    decides: ["Writes a project's Brain files from its site and what the web says about the brand (with web search)", 'Escreve os arquivos do Cérebro de um projeto a partir do site e do que a web diz da marca (com busca na web)'],
    rerun: false,
  },
  {
    id: 'agent_curator',
    label: ['Agent: learning review', 'Agente: revisão de aprendizado'],
    decides: ["Reads finished conversations and their ratings, and keeps what the team taught the agent in the Brain, the Memory or a skill (no web search)", 'Lê as conversas terminadas e suas avaliações, e guarda o que o time ensinou ao agente no Cérebro, na Memória ou numa skill (sem busca na web)'],
    rerun: false,
  },
  {
    id: 'project_wizard',
    label: ['New project wizard', 'Wizard de novo projeto'],
    decides: ["Suggests a new project's competitors (with web search), topics and prompts from its brand, site and market, and its Comparison products, attributes and personas", 'Sugere os concorrentes (com busca na web), os tópicos e os prompts de um projeto novo a partir da marca, do site e do mercado, e os produtos, atributos e personas da Comparação'],
    rerun: false,
  },
  {
    id: 'comparison_reader',
    label: ['Comparison: reading answers', 'Comparação: leitura das respostas'],
    decides: ['Copies the score each answer gives each option on each attribute, its place and the fact behind it (a chat model fixed in the code, one call per answer: a decision model cannot quote)', 'Copia a nota que cada resposta dá a cada opção em cada atributo, o lugar e o fato que a sustenta (um modelo de chat fixo no código, uma chamada por resposta: um modelo de decisão não cita trechos)'],
    rerun: false,
  },
] as const satisfies readonly { id: string; label: readonly [string, string]; decides: readonly [string, string]; rerun: boolean }[];
export type ClassifierFunction = (typeof CLASSIFIER_FUNCTIONS)[number]['id'];
/**
 * Functions whose model is the code's and nothing else (Admin shows it, without a choice): Comparison's reader copies scores and quotes
 * facts, which needs a chat model of a known price, so neither a saved model nor the server setting replaces it.
 */
export const FIXED_CLASSIFIERS: readonly ClassifierFunction[] = ['comparison_reader'];
/** The function a classifier id belongs to (the three sentiment evaluators share one). */
export const classifierFunction = (id: Classifier): ClassifierFunction | null =>
  id.startsWith('brand_research_') ? 'sentiment' : id === 'semantic' ? null : (id as ClassifierFunction);

export const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/**
 * A missing or invalid entry keeps the default (invalid ones are logged), so a typo never stops a classifier.
 * `stored` is the model Admin saved for the classifier's function, which wins over the server setting.
 */
export function classifierEngines(
  raw: string,
  id: Classifier,
  current: string,
  warn: (message: string) => void = console.warn,
  stored: string | null = null,
): { model: string; fallback: string | null } {
  if (stored && MODEL.test(stored)) return stored === current ? { model: current, fallback: null } : { model: stored, fallback: current };
  let configured: unknown;
  if (raw.trim())
    try {
      configured = (JSON.parse(raw) as Record<string, unknown> | null)?.[id];
    } catch {
      warn('LASTFIND_CLASSIFIER_MODELS is not valid JSON; using the default models.');
    }
  if (configured == null || configured === current) return { model: current, fallback: null };
  if (typeof configured !== 'string' || !MODEL.test(configured)) {
    warn(`LASTFIND_CLASSIFIER_MODELS.${id} is not a model name; using ${current}.`);
    return { model: current, fallback: null };
  }
  return { model: configured, fallback: current };
}
