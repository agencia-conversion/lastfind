import { demoModels, type DemoModel, type DemoPrompt } from './demo-data.ts';
import {
  validateSemanticConfiguration,
  type SemanticConfiguration,
} from './semantic-configuration.ts';

export type PromptIntent = 'discovery' | 'comparison' | 'purchase' | 'branded';
export type OnboardingCompetitor = { name: string; domain: string };
export type OnboardingResult = {
  brandName: string;
  domain: string;
  segment: string;
  country: string;
  language?: 'en-US' | 'pt-BR';
  semantic?: SemanticConfiguration;
  competitors: OnboardingCompetitor[];
  prompts: DemoPrompt[];
  models: DemoModel[];
};
export type OnboardingPrompt = DemoPrompt & {
  intent: PromptIntent;
  selected: boolean;
  edited: boolean;
  origin: 'suggested' | 'custom';
  semanticAttributeId?: string;
};
export type OnboardingDraft = Omit<OnboardingResult, 'prompts'> & {
  prompts: OnboardingPrompt[];
  language: 'en-US' | 'pt-BR';
  semantic: SemanticConfiguration;
  semanticInitialized: boolean;
  promptHistory: OnboardingPrompt[];
};
export type OnboardingError =
  | 'brand'
  | 'domain'
  | 'segment'
  | 'country'
  | 'language'
  | 'semantic-count'
  | 'semantic-id'
  | 'semantic-name'
  | 'semantic-duplicate'
  | 'semantic-description'
  | 'competitor-name'
  | 'competitor-domain'
  | 'competitor-duplicate'
  | 'competitors-limit'
  | 'prompts-empty'
  | 'prompts-limit'
  | 'prompt-invalid'
  | 'prompt-duplicate'
  | 'models-empty';

export const onboardingIntents: PromptIntent[] = [
  'discovery',
  'comparison',
  'purchase',
  'branded',
];
export const onboardingSegments = [
  {
    value: 'Streaming services',
    en: 'Streaming services',
    pt: 'Serviços de streaming',
  },
  { value: 'SEO agencies', en: 'SEO agencies', pt: 'Agências de SEO' },
  {
    value: 'Business software',
    en: 'Business software',
    pt: 'Software para empresas',
  },
  { value: 'Online stores', en: 'Online stores', pt: 'Lojas online' },
  {
    value: 'Professional services',
    en: 'Professional services',
    pt: 'Serviços profissionais',
  },
];

export function createOnboardingDraft(locale = 'en-US'): OnboardingDraft {
  return {
    brandName: '',
    domain: '',
    segment: '',
    country: locale === 'pt-BR' ? 'Brazil' : 'United States',
    language: locale === 'pt-BR' ? 'pt-BR' : 'en-US',
    semantic: { enabled: true, attributes: [] },
    semanticInitialized: false,
    promptHistory: [],
    competitors: [],
    prompts: [],
    models: [...demoModels],
  };
}

export function normalizeOnboardingDomain(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 500) return null;
  try {
    const parsed = new URL(text.includes('://') ? text : `https://${text}`);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host.length <= 253 &&
      /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/.test(host)
      ? host
      : null;
  } catch {
    return null;
  }
}

export function normalizePromptText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function promptIsDuplicate(
  text: string,
  prompts: Pick<DemoPrompt, 'text'>[],
  excludedId?: string,
): boolean {
  const key = normalizePromptText(text);
  return prompts.some(
    (prompt) =>
      (!excludedId || !('id' in prompt) || prompt.id !== excludedId) &&
      normalizePromptText(prompt.text) === key,
  );
}

const intentTags: Record<PromptIntent, string> = {
  discovery: 'Discovery',
  comparison: 'Comparison',
  purchase: 'High intent',
  branded: 'Branded',
};

/** Editable starting points, never claims inferred from a website. */
export function onboardingAttributeSuggestions(
  segment: string,
  language = 'en-US',
): SemanticConfiguration['attributes'] {
  const choices: Record<string, [string, string, string][]> = {
    'SEO agencies': [
      ['expertise', 'SEO expertise', 'Especialização em SEO'],
      ['transparency', 'Transparent reporting', 'Transparência nos resultados'],
      ['growth', 'Sustainable growth', 'Crescimento sustentável'],
    ],
    'Business software': [
      ['ease', 'Ease of use', 'Facilidade de uso'],
      ['reliability', 'Reliability', 'Confiabilidade'],
      ['support', 'Helpful support', 'Suporte que resolve'],
    ],
    'Online stores': [
      ['quality', 'Product quality', 'Qualidade dos produtos'],
      ['delivery', 'Reliable delivery', 'Entrega confiável'],
      ['service', 'Customer care', 'Cuidado com o cliente'],
    ],
    'Professional services': [
      ['expertise', 'Expertise', 'Especialização'],
      ['trust', 'Trust', 'Confiança'],
      ['service', 'Personal service', 'Atendimento próximo'],
    ],
    'Streaming services': [
      ['catalog', 'Catalog variety', 'Variedade do catálogo'],
      ['original', 'Original productions', 'Produções originais'],
      ['experience', 'Viewing experience', 'Experiência de assistir'],
    ],
  };
  const values = choices[segment] ?? [
    ['quality', 'Quality', 'Qualidade'],
    ['trust', 'Trust', 'Confiança'],
    ['service', 'Customer care', 'Cuidado com o cliente'],
  ];
  return values.map(([id, en, pt]) => ({
    id: `attribute-${id}`,
    name: language === 'pt-BR' ? pt : en,
    description: '',
  }));
}

export function initializeOnboardingPositioning(
  draft: OnboardingDraft,
): OnboardingDraft {
  if (draft.semanticInitialized) return draft;
  return {
    ...draft,
    semanticInitialized: true,
    semantic: {
      ...draft.semantic,
      attributes: onboardingAttributeSuggestions(draft.segment, draft.language),
    },
  };
}

export function onboardingSuggestions(
  draft: Pick<
    OnboardingDraft,
    'brandName' | 'domain' | 'segment' | 'country' | 'competitors'
  > &
    Partial<Pick<OnboardingDraft, 'language' | 'semantic'>>,
  locale = 'en-US',
): OnboardingPrompt[] {
  const language = draft.language ?? locale;
  const pt = language === 'pt-BR';
  const segment = onboardingSegments.find(
    (item) => item.value === draft.segment,
  );
  const category = (
    segment ? (pt ? segment.pt : segment.en) : draft.segment
  ).toLocaleLowerCase(language);
  const brand = `${draft.brandName.trim()} (${normalizeOnboardingDomain(draft.domain) ?? draft.domain.trim()}), ${pt ? 'na categoria' : 'in the category'} ${category},`;
  const location = pt
    ? draft.country === 'Brazil'
      ? 'no Brasil'
      : 'nos Estados Unidos'
    : draft.country === 'Brazil'
      ? 'in Brazil'
      : 'in the United States';
  const topics = pt
    ? {
        discovery: 'Descoberta',
        comparison: 'Avaliação de alternativas',
        purchase: 'Decisão de compra',
        branded: 'Percepção da marca',
      }
    : {
        discovery: 'Discovery',
        comparison: 'Evaluating options',
        purchase: 'Purchase decisions',
        branded: 'Brand perception',
      };
  const questions: {
    id: string;
    intent: PromptIntent;
    text: string;
    attributeId?: string;
    topic?: string;
  }[] = [
    {
      id: 'discovery-1',
      intent: 'discovery',
      text: pt
        ? `Quais marcas de ${category} você recomenda ${location}, e por quê?`
        : `Which ${category} brands would you recommend ${location}, and why?`,
    },
    {
      id: 'discovery-2',
      intent: 'discovery',
      text: pt
        ? `O que considerar ao escolher entre as opções de ${category} ${location}?`
        : `What should I consider when choosing between ${category} options ${location}?`,
    },
    {
      id: 'comparison-1',
      intent: 'comparison',
      text: pt
        ? `Compare as principais opções de ${category} ${location}: pontos fortes e limitações.`
        : `Compare the leading ${category} options ${location}: strengths and limitations.`,
    },
    {
      id: 'purchase-1',
      intent: 'purchase',
      text: pt
        ? `Quais opções de ${category} oferecem bom custo-benefício ${location}?`
        : `Which ${category} options offer good value for money ${location}?`,
    },
  ];
  if (draft.semantic?.enabled) {
    for (const attribute of draft.semantic.attributes) {
      const name = attribute.name.trim();
      questions.push(
        {
          id: `attribute-${attribute.id}-discovery`,
          intent: 'discovery',
          attributeId: attribute.id,
          topic: name,
          text: pt
            ? `Quais marcas de ${category} você associa a “${name}” ${location}? Explique o motivo e cite exemplos quando houver.`
            : `Which ${category} brands do you associate with “${name}” ${location}? Explain why and give examples where available.`,
        },
        {
          id: `attribute-${attribute.id}-branded`,
          intent: 'branded',
          attributeId: attribute.id,
          topic: name,
          text: pt
            ? `Em que medida ${brand} é associada a “${name}”? Explique os pontos favoráveis, as limitações e o que não é possível concluir.`
            : `To what extent is ${brand} associated with “${name}”? Explain supporting points, limitations, and what cannot be concluded.`,
        },
      );
    }
  }
  return questions.map(({ id, intent, text, attributeId, topic }, index) => ({
    id: `suggestion-${id}`,
    text,
    intent,
    topic: topic ?? topics[intent],
    tags: [
      ...new Set([
        intentTags[intent],
        intent === 'branded' ? 'Branded' : 'Non-branded',
        ...(attributeId ? ['Semantic Branding'] : []),
      ]),
    ],
    ...(attributeId ? { semanticAttributeId: attributeId } : {}),
    country: draft.country,
    status: 'active',
    selected: index < 10,
    edited: false,
    origin: 'suggested',
  }));
}

export function refreshOnboardingSuggestions(
  draft: OnboardingDraft,
  locale = 'en-US',
): OnboardingPrompt[] {
  const fresh = onboardingSuggestions(draft, locale);
  const custom = draft.prompts.filter((prompt) => prompt.origin === 'custom');
  const previousById = new Map(
    [...draft.promptHistory, ...draft.prompts].map((prompt) => [
      prompt.id,
      prompt,
    ]),
  );
  let available = Math.max(
    0,
    10 -
      custom.filter((prompt) => prompt.selected).length -
      fresh.filter((prompt) => previousById.get(prompt.id)?.selected).length,
  );
  const suggested = fresh.map((prompt) => {
    const previous = previousById.get(prompt.id);
    if (previous)
      return {
        ...(previous.edited ? previous : prompt),
        country: draft.country,
        selected: previous.selected,
      };
    const selected = prompt.selected && available > 0;
    if (selected) available--;
    return { ...prompt, selected };
  });
  return [
    ...suggested,
    ...custom.map((prompt) => ({ ...prompt, country: draft.country })),
  ];
}

export function validateOnboarding(
  draft: OnboardingDraft,
  step: number,
): OnboardingError | null {
  if (step === 0) {
    if (draft.brandName.trim().length < 2 || draft.brandName.trim().length > 80)
      return 'brand';
    if (!normalizeOnboardingDomain(draft.domain)) return 'domain';
    if (draft.segment.trim().length < 2 || draft.segment.trim().length > 100)
      return 'segment';
    if (!['Brazil', 'United States'].includes(draft.country)) return 'country';
    if (!['pt-BR', 'en-US'].includes(draft.language)) return 'language';
  }
  if (step === 1) {
    const semanticIssue = validateSemanticConfiguration(draft.semantic);
    if (semanticIssue) return `semantic-${semanticIssue}`;
    const competitors = draft.competitors.filter(
      (item) => item.name.trim() || item.domain.trim(),
    );
    if (competitors.length > 5) return 'competitors-limit';
    const own = normalizeOnboardingDomain(draft.domain);
    const names = new Set([normalizePromptText(draft.brandName)]);
    const domains = new Set([own]);
    for (const competitor of competitors) {
      if (
        competitor.name.trim().length < 2 ||
        competitor.name.trim().length > 80
      )
        return 'competitor-name';
      const domain = normalizeOnboardingDomain(competitor.domain);
      if (!domain) return 'competitor-domain';
      const name = normalizePromptText(competitor.name);
      if (domains.has(domain) || names.has(name)) return 'competitor-duplicate';
      names.add(name);
      domains.add(domain);
    }
  }
  if (step === 2) {
    const selected = draft.prompts.filter((prompt) => prompt.selected);
    if (!selected.length) return 'prompts-empty';
    if (selected.length > 10) return 'prompts-limit';
    const texts = new Set<string>();
    for (const prompt of selected) {
      if (
        prompt.text.trim().length < 10 ||
        prompt.text.trim().length > 1000 ||
        !prompt.topic.trim() ||
        prompt.topic.trim().length > 60
      )
        return 'prompt-invalid';
      const key = normalizePromptText(prompt.text);
      if (texts.has(key)) return 'prompt-duplicate';
      texts.add(key);
    }
  }
  if (step === 3 && !draft.models.some((model) => demoModels.includes(model)))
    return 'models-empty';
  return null;
}

export function completeOnboarding(
  draft: OnboardingDraft,
  id = () => crypto.randomUUID(),
): OnboardingResult {
  for (let step = 0; step < 4; step++) {
    const error = validateOnboarding(draft, step);
    if (error) throw new Error(error);
  }
  return {
    brandName: draft.brandName.trim(),
    domain: normalizeOnboardingDomain(draft.domain)!,
    segment: draft.segment.trim(),
    country: draft.country,
    language: draft.language,
    semantic: {
      enabled: draft.semantic.enabled,
      attributes: draft.semantic.attributes.map((attribute) => ({
        ...attribute,
        name: attribute.name.trim(),
        description: attribute.description.trim(),
      })),
    },
    competitors: draft.competitors
      .filter((item) => item.name.trim() || item.domain.trim())
      .map((item) => ({
        name: item.name.trim(),
        domain: normalizeOnboardingDomain(item.domain)!,
      })),
    prompts: draft.prompts
      .filter((prompt) => prompt.selected)
      .map((prompt) => ({
        id: `p-${id()}`,
        text: prompt.text.trim(),
        topic: prompt.topic.trim(),
        tags: [...prompt.tags],
        country: draft.country,
        status: 'active',
      })),
    models: demoModels.filter((model) => draft.models.includes(model)),
  };
}
