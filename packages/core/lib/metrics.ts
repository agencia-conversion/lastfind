import type { BrandTarget, Citation, Run } from './types.ts';
export function normalizeText(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
export function normalizeDomain(input: string) {
  const value = input.trim().toLowerCase();
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      url.port
    )
      throw 0;
    return url.hostname.replace(/^www\./, '');
  } catch {
    throw new Error('Informe um domínio válido, como sua-marca.com.');
  }
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function matchesBrand(answer: string, target: BrandTarget) {
  const clean = normalizeText(answer.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'));
  const name = normalizeText(target.name).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  return (
    !!name &&
    new RegExp(`(^|[^\\p{L}\\p{N}])${name}($|[^\\p{L}\\p{N}])`, 'u').test(clean)
  );
}
export function extractResponse(
  result: Record<string, unknown>,
  engine = 'chat_gpt',
) {
  const sources = new Map<string, Citation>(),
    consulted = new Map<string, Citation>();
  let consultedAvailable = false;
  const add = (target: Map<string, Citation>, entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const source of entries) {
      if (!source || typeof source !== 'object') continue;
      const url = safeUrl(source.url);
      if (url)
        target.set(url, {
          url,
          domain: new URL(url).hostname.replace(/^www\./, ''),
          title: String(source.title || source.source || new URL(url).hostname),
        });
    }
  };
  const visit = (node: unknown, depth = 0): string => {
    if (depth > 12 || !node || typeof node !== 'object') return '';
    if (Array.isArray(node))
      return node
        .map((x) => visit(x, depth + 1))
        .filter(Boolean)
        .join('\n\n');
    const o = node as Record<string, unknown>;
    // Only the final answer contributes to brand visibility and citations.
    if (o.type === 'reasoning') return '';
    add(sources, o.sources);
    add(sources, o.references);
    add(sources, o.annotations);
    if (Array.isArray(o.search_results)) {
      consultedAvailable = true;
      add(consulted, o.search_results);
    }
    // Inspect children for evidence even when a parent has its own full text.
    const children = [o.items, o.sections]
      .map((x) => visit(x, depth + 1))
      .filter(Boolean)
      .join('\n\n');
    for (const key of ['markdown', 'original_text', 'text', 'description']) {
      if (typeof o[key] === 'string' && o[key].trim()) return o[key] as string;
    }
    return children;
  };
  let input: unknown = result;
  if (engine === 'google_ai_overviews' || engine === 'google_ai_mode') {
    // Organic links are not evidence of the AI's answer or browsing activity.
    input = Array.isArray(result.items)
      ? result.items.filter(
          (x: Record<string, unknown>) => x.type === 'ai_overview',
        )
      : [];
  }
  const answer = visit(input);
  const available = !!answer.trim();
  if (!available && engine !== 'google_ai_overviews')
    throw new Error('A coleta retornou uma resposta vazia.');
  return {
    answer,
    sources: [...sources.values()],
    consultedSources: consultedAvailable ? [...consulted.values()] : null,
    searchQueries: Array.isArray(result.fan_out_queries)
      ? result.fan_out_queries.filter((x): x is string => typeof x === 'string')
      : [],
    responseAvailable: available,
    model:
      typeof result.model === 'string'
        ? result.model
        : typeof result.model_name === 'string'
          ? result.model_name
          : engine,
  };
}
export function summarize(runs: Run[], _brandName: string) {
  const complete = runs.filter(
    (r) => r.status === 'complete' && r.response_available !== false,
  );
  const mentioned = complete.filter((r) => r.mentions[r.brand_name]).length;
  const totalMentions = complete.reduce(
    (sum, r) => sum + Object.values(r.mentions).filter(Boolean).length,
    0,
  );
  const citations = new Set(
    complete.flatMap((r) => r.sources.map((s) => s.domain)),
  );
  return {
    responses: complete.length,
    visibility: complete.length ? (mentioned / complete.length) * 100 : 0,
    shareOfVoice: totalMentions ? (mentioned / totalMentions) * 100 : 0,
    citedDomains: citations.size,
    mentions: mentioned,
    cost: runs.reduce((a, r) => a + r.cost, 0),
  };
}
export function csvCell(value: string | number | boolean | null | undefined) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export function runsCsv(runs: Run[]) {
  return (
    '\uFEFF' +
    [
      [
        'Data UTC',
        'Prompt',
        'Motor',
        'Status',
        'Marcas mencionadas',
        'Domínios citados',
        'Fontes citadas (URLs)',
        'Fontes consultadas (URLs)',
        'Dados de consulta disponíveis',
        'Custo USD',
      ],
      ...runs.map((r) => [
        r.created_at,
        r.prompt_text,
        r.engine,
        r.status,
        Object.entries(r.mentions)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join('; '),
        r.sources.map((s) => s.domain).join('; '),
        r.sources.map((s) => s.url).join('; '),
        r.consulted_sources?.map((s) => s.url).join('; ') ?? '',
        r.consulted_sources != null,
        r.cost,
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
