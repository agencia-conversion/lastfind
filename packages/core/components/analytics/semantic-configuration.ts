/** Session-only configuration; metrics and evidence never belong to project setup. */
export type SemanticConfiguredAttribute = {
  id: string;
  name: string;
  description: string;
};
export type SemanticConfiguration = {
  enabled: boolean;
  attributes: SemanticConfiguredAttribute[];
};

const definitions = [
  [
    'technical',
    'Technical SEO',
    'SEO técnico',
    'Technical diagnosis and implementation.',
    'Diagnóstico técnico e implementação.',
  ],
  [
    'ai',
    'AI search expertise',
    'Especialista em busca com IA',
    'Visibility in AI-generated answers.',
    'Visibilidade nas respostas geradas por IA.',
  ],
  [
    'enterprise',
    'Enterprise growth',
    'Crescimento enterprise',
    'Organic growth for complex organizations.',
    'Crescimento orgânico para organizações complexas.',
  ],
  [
    'research',
    'Original research',
    'Pesquisa original',
    'Original studies and first-party evidence.',
    'Estudos originais e evidências próprias.',
  ],
  [
    'content',
    'Content strategy',
    'Estratégia de conteúdo',
    'Useful content aligned with search intent.',
    'Conteúdo útil alinhado à intenção de busca.',
  ],
  [
    'measurement',
    'Measurable outcomes',
    'Resultados mensuráveis',
    'Clear measurement of organic outcomes.',
    'Mensuração clara dos resultados orgânicos.',
  ],
];

/** This default belongs only to the existing synthetic Conversion project. */
export function defaultSemanticConfiguration(
  locale = 'en',
): SemanticConfiguration {
  const pt = locale === 'pt' || locale === 'pt-BR';
  return {
    enabled: true,
    attributes: definitions.map(
      ([id, en, br, enDescription, ptDescription]) => ({
        id,
        name: pt ? br : en,
        description: pt ? ptDescription : enDescription,
      }),
    ),
  };
}

export function validateSemanticConfiguration(
  configuration: SemanticConfiguration,
): 'count' | 'id' | 'name' | 'duplicate' | 'description' | null {
  if (!configuration.enabled) return null;
  if (
    configuration.attributes.length < 1 ||
    configuration.attributes.length > 10
  )
    return 'count';
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const attribute of configuration.attributes) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(attribute.id) ||
      ids.has(attribute.id)
    )
      return 'id';
    if (attribute.name.trim().length < 2 || attribute.name.trim().length > 60)
      return 'name';
    const name = attribute.name
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en');
    if (names.has(name)) return 'duplicate';
    if (attribute.description.trim().length > 240) return 'description';
    ids.add(attribute.id);
    names.add(name);
  }
  return null;
}

export function semanticAttributeFingerprint(
  attribute: SemanticConfiguredAttribute,
): string {
  // Only the two exact, authored translations share one canonical concept.
  // User-edited names or descriptions still receive their own strict signature.
  const definition = definitions.find(([id]) => id === attribute.id);
  if (
    definition &&
    ((attribute.name.trim() === definition[1] &&
      attribute.description.trim() === definition[3]) ||
      (attribute.name.trim() === definition[2] &&
        attribute.description.trim() === definition[4]))
  )
    return `lastfind-semantic-default-v1/${attribute.id}`;
  return JSON.stringify([
    attribute.id,
    attribute.name.trim(),
    attribute.description.trim(),
  ]);
}

export type SemanticConfigurationSession = {
  configuration: SemanticConfiguration;
  language: 'en-US' | 'pt-BR';
};
export function semanticConfigurationSessionKey(scope: {
  accountId: string;
  userId: string;
  workspaceId: string;
  projectId: string;
}): string {
  return `lastfind.semantic-attributes.v1:${JSON.stringify([
    scope.accountId,
    scope.userId,
    scope.workspaceId,
    scope.projectId,
  ])}`;
}

function parseConfigurationSession(
  value: unknown,
): SemanticConfigurationSession | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    (record.language !== 'en-US' && record.language !== 'pt-BR')
  )
    return null;
  const raw = record.configuration;
  if (!raw || typeof raw !== 'object') return null;
  const configuration = raw as Record<string, unknown>;
  if (
    typeof configuration.enabled !== 'boolean' ||
    !Array.isArray(configuration.attributes) ||
    configuration.attributes.length > 10
  )
    return null;
  const ids = new Set<string>();
  const attributes: SemanticConfiguredAttribute[] = [];
  for (const rawAttribute of configuration.attributes) {
    if (!rawAttribute || typeof rawAttribute !== 'object') return null;
    const attribute = rawAttribute as Record<string, unknown>;
    if (
      typeof attribute.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(attribute.id) ||
      ids.has(attribute.id) ||
      typeof attribute.name !== 'string' ||
      attribute.name.length > 60 ||
      typeof attribute.description !== 'string' ||
      attribute.description.length > 240
    )
      return null;
    ids.add(attribute.id);
    attributes.push({
      id: attribute.id,
      name: attribute.name,
      description: attribute.description,
    });
  }
  const parsed = { enabled: configuration.enabled, attributes };
  if (validateSemanticConfiguration(parsed)) return null;
  return {
    configuration: parsed,
    language: record.language as 'en-US' | 'pt-BR',
  };
}

/** The tab stores settings only, never scores, evidence, snapshots or account data. */
export function readSemanticConfigurationSession(
  key: string,
  storage?: Pick<Storage, 'getItem'>,
): SemanticConfigurationSession | null {
  try {
    const raw = (storage ?? window.sessionStorage).getItem(key);
    // Ten bounded attributes fit comfortably; reject oversized or corrupt storage.
    if (!raw || raw.length > 20_000) return null;
    return parseConfigurationSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeSemanticConfigurationSession(
  key: string,
  value: SemanticConfigurationSession,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const parsed = parseConfigurationSession({ version: 1, ...value });
    if (!parsed) return false;
    (storage ?? window.sessionStorage).setItem(
      key,
      JSON.stringify({ version: 1, ...parsed }),
    );
    return true;
  } catch {
    // Restricted storage and quota errors must not block editing in memory.
    return false;
  }
}
