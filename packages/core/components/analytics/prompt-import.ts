import type { DemoPrompt } from './demo-data';

const countries = ['Brazil', 'United States'];

// Small RFC-style parser for the local preview. Nothing is submitted to a provider.
export function parseDemoPromptImport(
  input: string,
): Omit<DemoPrompt, 'id' | 'status'>[] {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  if (text.length > 100_000) throw new Error('size');
  const firstLine = text.split(/\r?\n/)[0];
  const separator =
    firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else field += char;
    } else if (!quoted && [separator, '\n', '\r'].includes(char)) {
      row.push(field.trim());
      field = '';
      if (char !== separator) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (quoted) throw new Error('quotes');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift()?.map((value) => value.toLowerCase()) ?? [];
  const textIndex = header.findIndex((value) =>
    ['prompt', 'text', 'texto'].includes(value),
  );
  if (textIndex < 0) throw new Error('header');
  if (!rows.length || rows.length > 100) throw new Error('rows');
  const topicIndex = header.findIndex((value) =>
    ['topic', 'tema'].includes(value),
  );
  const tagsIndex = header.indexOf('tags');
  const countryIndex = header.findIndex((value) =>
    ['country', 'país', 'pais'].includes(value),
  );
  return rows.map((values) => {
    const prompt = values[textIndex] ?? '';
    const topic = values[topicIndex] || 'General';
    const country = values[countryIndex] || 'Brazil';
    if (prompt.length < 5 || prompt.length > 1000 || topic.length > 60)
      throw new Error('length');
    if (!countries.includes(country)) throw new Error('country');
    const tags = [
      ...new Set(
        (values[tagsIndex] || '')
          .split('|')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 10 || tags.some((value) => value.length > 40))
      throw new Error('tags');
    return { text: prompt, topic, country, tags };
  });
}
