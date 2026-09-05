import { isEngine, ENGINE_META } from './engines.ts';
import type { Project } from './types';
export type PromptDraft = {
  text: string;
  engine: string;
  tag: string;
  tags: string[];
};
export function suggestPrompts(
  profile: Pick<Project, 'category' | 'audience' | 'name' | 'language_code'>,
): PromptDraft[] {
  const en = profile.language_code === 'en';
  const category =
    profile.category.trim() ||
    (en ? 'solutions in this category' : 'soluções nesta categoria');
  const audience =
    profile.audience.trim() || (en ? 'small teams' : 'equipes pequenas');
  const texts = en
    ? [
        [`What are the best ${category} for ${audience}?`, 'Discovery'],
        [`Which ${category} offer the best value for ${audience}?`, 'Purchase'],
        [
          `Compare the leading ${category}: features, limitations and pricing.`,
          'Comparison',
        ],
        [`Which ${category} are easiest to get started with?`, 'Discovery'],
        [
          `What should ${audience} consider when choosing ${category}?`,
          'Purchase',
        ],
        [`What are the main alternatives to ${profile.name}?`, 'Comparison'],
      ]
    : [
        [
          `Quais são as melhores opções de ${category} para ${audience}?`,
          'Descoberta',
        ],
        [
          `Quais opções de ${category} têm o melhor custo-benefício para ${audience}?`,
          'Compra',
        ],
        [
          `Compare as principais opções de ${category}: recursos, limitações e preços.`,
          'Comparação',
        ],
        [
          `Quais opções de ${category} são mais fáceis de começar a usar?`,
          'Descoberta',
        ],
        [
          `O que ${audience} devem considerar ao escolher ${category}?`,
          'Compra',
        ],
        [
          `Quais são as principais alternativas à ${profile.name}?`,
          'Comparação',
        ],
      ];
  return texts.map(([text, tag]) => ({
    text,
    tag,
    engine: 'chat_gpt',
    tags: [],
  }));
}
// RFC-style quoted fields, escaped quotes, CRLF and comma/semicolon delimiters.
export function parsePromptCsv(input: string): PromptDraft[] {
  const text = input.replace(/^\uFEFF/, '');
  if (text.length > 100000) throw new Error('O CSV deve ter até 100 KB.');
  const first = text.split(/\r?\n/)[0] ?? '';
  const sep = first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else field += c;
    } else if (!quoted && (c === sep || c === '\n' || c === '\r')) {
      row.push(field.trim());
      field = '';
      if (c !== sep) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += c;
  }
  if (quoted) throw new Error('Há aspas sem fechamento no CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift()?.map((x) => x.toLowerCase()) ?? [];
  const ti = header.findIndex((h) => ['text', 'prompt', 'texto'].includes(h));
  if (ti < 0)
    throw new Error(
      'O CSV precisa de uma coluna prompt. Use o modelo disponível.',
    );
  const ei = header.findIndex((h) => ['engine', 'motor'].includes(h)),
    topic = header.findIndex((h) => ['topic', 'tema', 'tag'].includes(h)),
    tags = header.indexOf('tags');
  if (!rows.length || rows.length > 100)
    throw new Error('O CSV deve conter entre 1 e 100 prompts.');
  return rows.map((r, i) => {
    const value = r[ti] ?? '';
    if (value.length < 5 || value.length > 1000)
      throw new Error(
        `Linha ${i + 2}: o prompt deve ter entre 5 e 1.000 caracteres.`,
      );
    const engine = (r[ei] || 'chat_gpt')
      .toLowerCase()
      .replace('chatgpt', 'chat_gpt');
    if (!isEngine(engine))
      throw new Error(`Linha ${i + 2}: plataforma desconhecida.`);
    if (value.length > ENGINE_META[engine].maxLength)
      throw new Error(
        `Linha ${i + 2}: esta plataforma aceita até ${ENGINE_META[engine].maxLength} caracteres.`,
      );
    return {
      text: value,
      engine,
      tag: r[topic] || 'Geral',
      tags: (r[tags] || '')
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean),
    };
  });
}
