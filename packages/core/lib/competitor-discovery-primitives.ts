export type DiscoveryPrimitiveAnswer = {
  id: string;
  answer: string;
  sources: { url: string; domain: string; title: string }[];
  createdAt: string;
};

export type DiscoveryPrimitiveSeed = {
  name: string;
  domain: string;
  aliases?: string[];
  domains?: string[];
};

export type DiscoveryStructure =
  | 'table'
  | 'list'
  | 'heading'
  | 'emphasis'
  | 'link'
  | 'prose';

export type DiscoveryLink = {
  label: string;
  labelStart: number;
  labelEnd: number;
  rawUrl: string;
  start: number;
  end: number;
};

type DiscoveryEmphasis = {
  value: string;
  start: number;
  end: number;
};

export type DiscoveryLine = {
  text: string;
  start: number;
  end: number;
  structure: DiscoveryStructure;
  inReferenceSection: boolean;
  links: DiscoveryLink[];
  emphasis: DiscoveryEmphasis[];
};

type VisibleToken = {
  value: string;
  normalized: string;
  start: number;
  end: number;
  capitalized: boolean;
  allCaps: boolean;
};

type DiscoveryTableCell = {
  table: number;
  column: number;
  start: number;
  end: number;
  normalizedValue: string;
  repetitionRatio: number;
};

export type ParsedDiscoveryAnswer = {
  text: string;
  visibleText: string;
  lines: DiscoveryLine[];
  links: DiscoveryLink[];
  tokens: VisibleToken[];
  tokenIndexByStart: Map<number, number>;
  casingByToken: Map<string, number>;
  tableCellByTokenStart: Map<number, DiscoveryTableCell>;
  workUnits: number;
};

export type CompetitorSpanPrimitive = {
  id: string;
  answerId: string;
  answerIndex: number;
  name: string;
  normalizedName: string;
  start: number;
  end: number;
  zoneStart: number;
  zoneEnd: number;
  structure: DiscoveryStructure;
  linkedDomain: string | null;
  linkedUrl: string | null;
  citationLike: boolean;
  inReferenceSection: boolean;
  extractionPriority: number;
  features: Record<string, number>;
};

type CompetitorSpanDraft = Omit<CompetitorSpanPrimitive, 'features'> & {
  featureZone: CandidateZone;
};

export const MAX_DISCOVERY_ANSWER_CHARACTERS = 180_000;
export const MAX_DISCOVERY_TOKENS = 50_000;
export const MAX_DISCOVERY_ZONE_TOKENS = 12;
export const MAX_DISCOVERY_SPANS_PER_ANSWER = 2_048;
export const MAX_DISCOVERY_SELECTED_PER_ANSWER = 256;

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) =>
    character.codePointAt(0)!,
  );
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

const REFERENCE_HEADING_RE =
  /^\s*(?:#{1,6}\s*)?(?:fontes|fontes consultadas|refer[eê]ncias|references|(?:research\s+)?sources)\s*:?\s*$/iu;
const SOURCE_LINE_RE = /^\s*(?:[-+*•]\s*)?(?:research\s+)?sources?\s*:/iu;
const CITATION_PREFIX_RE =
  /\b(?:according to|cited by|dados (?:da|de|do)|estudo (?:da|de|do)|fonte|report(?:ed)? by|segundo|source|sources|via)\s*(?::\s*)?$/iu;
const PUBLISHER_PREDICATE_RE =
  /^(?:argues?|covers?|describes?|explains?|notes?|published|publishes|reported|reports?|said|says|writes?|afirma|cobre|descreve|explica|informa|observa|publica|publicou|relata|relatou)(?=$|[^\p{L}\p{N}_])/iu;
const NAME_CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'of', 'the']);

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function competitorSpanIdentity(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function structureForLine(line: string): DiscoveryStructure {
  if (/^\s*#{1,6}\s+\d+[.)]\s*/u.test(line)) return 'list';
  if (/^\s*#{1,6}\s+/u.test(line)) return 'heading';
  if ((line.match(/\|/g) ?? []).length >= 2) return 'table';
  if (/^\s*(?:[-+*•]|\d+[.)])\s+/u.test(line)) return 'list';
  return 'prose';
}

function safeDomain(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/^www\./u, '')
      .replace(/\.$/u, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

function predicateSuffix(value: string): string {
  return value
    .slice(0, 180)
    .trimStart()
    .replace(/^[*_~`,;:—–-]+/u, '');
}

function citationAt(
  line: DiscoveryLine,
  start: number,
  length: number,
): boolean {
  if (line.inReferenceSection || SOURCE_LINE_RE.test(line.text)) return true;
  const localStart = start - line.start;
  const before = line.text.slice(Math.max(0, localStart - 80), localStart);
  const after = line.text.slice(localStart + length, localStart + length + 100);
  return (
    CITATION_PREFIX_RE.test(before) ||
    PUBLISHER_PREDICATE_RE.test(predicateSuffix(after))
  );
}

function tokenizeVisible(value: string, offset = 0): VisibleToken[] {
  const tokens: VisibleToken[] = [];
  const tokenPattern = /[\p{L}\p{M}\p{N}&+’'/-]+/gu;
  for (const match of value.matchAll(tokenPattern)) {
    if (tokens.length >= MAX_DISCOVERY_TOKENS) break;
    const surface = match[0];
    const start = offset + (match.index ?? 0);
    const letters = surface.match(/\p{L}/gu) ?? [];
    const uppercase = surface.match(/\p{Lu}/gu) ?? [];
    tokens.push({
      value: surface,
      normalized: normalizedText(surface),
      start,
      end: start + surface.length,
      capitalized: /^\p{Lu}/u.test(surface) || /^[A-Z]{2}/u.test(surface),
      allCaps: letters.length > 1 && uppercase.length === letters.length,
    });
  }
  return tokens;
}

function tableCells(
  lines: DiscoveryLine[],
  visibleText: string,
  tokens: VisibleToken[],
): Map<number, DiscoveryTableCell> {
  const cells: DiscoveryTableCell[] = [];
  let table = -1;
  let previousTableLine = -2;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (line.structure !== 'table') continue;
    if (lineIndex !== previousTableLine + 1) table++;
    previousTableLine = lineIndex;
    const separators = [-1];
    for (let index = 0; index < line.text.length; index++)
      if (line.text[index] === '|') separators.push(index);
    separators.push(line.text.length);
    const segments = Array.from(
      { length: Math.max(0, separators.length - 1) },
      (_, index) => ({
        start: (separators[index] ?? -1) + 1,
        end: separators[index + 1] ?? line.text.length,
      }),
    );
    if (
      segments[0] &&
      !line.text.slice(segments[0].start, segments[0].end).trim()
    )
      segments.shift();
    if (
      segments.at(-1) &&
      !line.text.slice(segments.at(-1)!.start, segments.at(-1)!.end).trim()
    )
      segments.pop();
    for (let column = 0; column < segments.length; column++) {
      const segment = segments[column]!;
      let start = line.start + segment.start;
      let end = line.start + segment.end;
      while (start < end && /\s/u.test(visibleText[start] ?? '')) start++;
      while (end > start && /\s/u.test(visibleText[end - 1] ?? '')) end--;
      const normalizedValue = normalizedText(visibleText.slice(start, end));
      if (!normalizedValue || /^:?-{3,}:?$/u.test(normalizedValue)) continue;
      cells.push({
        table,
        column,
        start,
        end,
        normalizedValue,
        repetitionRatio: 0,
      });
    }
  }
  const columnCounts = new Map<string, number>();
  const valueCounts = new Map<string, number>();
  for (const cell of cells) {
    const columnKey = `${cell.table}:${cell.column}`;
    const valueKey = `${columnKey}:${cell.normalizedValue}`;
    columnCounts.set(columnKey, (columnCounts.get(columnKey) ?? 0) + 1);
    valueCounts.set(valueKey, (valueCounts.get(valueKey) ?? 0) + 1);
  }
  for (const cell of cells) {
    const columnKey = `${cell.table}:${cell.column}`;
    cell.repetitionRatio =
      (valueCounts.get(`${columnKey}:${cell.normalizedValue}`) ?? 1) /
      Math.max(1, columnCounts.get(columnKey) ?? 1);
  }
  const byTokenStart = new Map<number, DiscoveryTableCell>();
  let cellIndex = 0;
  for (const token of tokens) {
    while (cells[cellIndex] && cells[cellIndex]!.end <= token.start)
      cellIndex++;
    const cell = cells[cellIndex];
    if (cell && token.start >= cell.start && token.end <= cell.end)
      byTokenStart.set(token.start, cell);
  }
  return byTokenStart;
}

export function parseCompetitorDiscoveryAnswer(
  sourceText: string,
): ParsedDiscoveryAnswer {
  const text = sourceText.slice(0, MAX_DISCOVERY_ANSWER_CHARACTERS);
  const lines: DiscoveryLine[] = [];
  let lineStart = 0;
  let inReferenceSection = false;
  for (let index = 0; index <= text.length; index++) {
    if (index !== text.length && text.charCodeAt(index) !== 10) continue;
    const lineText = text.slice(lineStart, index);
    const structure = structureForLine(lineText);
    if (REFERENCE_HEADING_RE.test(lineText)) inReferenceSection = true;
    else if (structure === 'heading') inReferenceSection = false;
    lines.push({
      text: lineText,
      start: lineStart,
      end: index,
      structure,
      inReferenceSection,
      links: [],
      emphasis: [],
    });
    lineStart = index + 1;
  }

  const masked = new Uint8Array(text.length);
  const links: DiscoveryLink[] = [];
  let openBracket = -1;
  let openEmphasis = -1;
  let currentLine = 0;
  let workUnits = text.length;
  for (let index = 0; index < text.length; index++) {
    while (currentLine + 1 < lines.length && index > lines[currentLine]!.end)
      currentLine++;
    const character = text[index] ?? '';
    if (character === '\n') {
      openBracket = -1;
      openEmphasis = -1;
      continue;
    }
    if (character === '[') {
      openBracket = index;
      continue;
    }
    if (
      character === ']' &&
      text[index + 1] === '(' &&
      openBracket >= 0 &&
      index - openBracket > 1 &&
      index - openBracket <= 2_049 &&
      (text.startsWith('http://', index + 2) ||
        text.startsWith('https://', index + 2))
    ) {
      let cursor = index + 2;
      const urlStart = cursor;
      while (
        cursor < text.length &&
        cursor - urlStart <= 2_048 &&
        !/[\s\][{}<>]/u.test(text[cursor] ?? '') &&
        text[cursor] !== ')'
      ) {
        cursor++;
        workUnits++;
      }
      if (text[cursor] === ')') {
        const link: DiscoveryLink = {
          label: text.slice(openBracket + 1, index),
          labelStart: openBracket + 1,
          labelEnd: index,
          rawUrl: text.slice(urlStart, cursor),
          start: openBracket,
          end: cursor + 1,
        };
        links.push(link);
        lines[currentLine]!.links.push(link);
        masked[openBracket] = 1;
        if (openBracket > 0 && text[openBracket - 1] === '!')
          masked[openBracket - 1] = 1;
        for (let unit = index; unit <= cursor; unit++) masked[unit] = 1;
        index = cursor;
        openBracket = -1;
        continue;
      }
      index = Math.max(index, cursor - 1);
      openBracket = -1;
      continue;
    }
    if (character === '*' && text[index + 1] === '*') {
      if (openEmphasis >= 0 && index - openEmphasis > 2) {
        const emphasis: DiscoveryEmphasis = {
          value: text.slice(openEmphasis + 2, index),
          start: openEmphasis + 2,
          end: index,
        };
        lines[currentLine]!.emphasis.push(emphasis);
        masked[openEmphasis] = 1;
        masked[openEmphasis + 1] = 1;
        masked[index] = 1;
        masked[index + 1] = 1;
        openEmphasis = -1;
      } else openEmphasis = index;
      index++;
    }
  }
  for (let index = 0; index < text.length; index++) {
    if (
      !text.startsWith('http://', index) &&
      !text.startsWith('https://', index)
    )
      continue;
    let cursor = index;
    while (cursor < text.length && !/[\s)\]}>;,]/u.test(text[cursor] ?? '')) {
      cursor++;
      workUnits++;
    }
    for (let unit = index; unit < cursor; unit++) masked[unit] = 1;
    index = cursor - 1;
  }
  const visibleUnits: string[] = [];
  for (let index = 0; index < text.length; index++)
    visibleUnits.push(masked[index] ? ' ' : (text[index] ?? ''));
  const visibleText = visibleUnits.join('');
  const tokens = tokenizeVisible(visibleText);
  const tokenIndexByStart = new Map(
    tokens.map((token, index) => [token.start, index]),
  );
  const casingCounts = new Map<
    string,
    { capitalized: number; total: number }
  >();
  for (const token of tokens) {
    const count = casingCounts.get(token.normalized) ?? {
      capitalized: 0,
      total: 0,
    };
    count.total++;
    if (token.capitalized) count.capitalized++;
    casingCounts.set(token.normalized, count);
  }
  const casingByToken = new Map(
    [...casingCounts].map(([token, count]) => [
      token,
      count.capitalized / count.total,
    ]),
  );
  const tableCellByTokenStart = tableCells(lines, visibleText, tokens);
  return {
    text,
    visibleText,
    lines,
    links,
    tokens,
    tokenIndexByStart,
    casingByToken,
    tableCellByTokenStart,
    workUnits,
  };
}

const parsedAnswerCache = new WeakMap<object, ParsedDiscoveryAnswer>();

export function preparedCompetitorDiscoveryAnswer(
  answer: DiscoveryPrimitiveAnswer,
): ParsedDiscoveryAnswer {
  const cached = parsedAnswerCache.get(answer);
  if (cached) return cached;
  const parsed = parseCompetitorDiscoveryAnswer(answer.answer);
  parsedAnswerCache.set(answer, parsed);
  return parsed;
}

type CandidateZone = {
  start: number;
  end: number;
  structure: DiscoveryStructure;
  linkedUrl: string | null;
  citationLike: boolean;
  inReferenceSection: boolean;
  explicit: boolean;
};

function trimZone(text: string, start: number, end: number): [number, number] {
  while (start < end && /\s|[*_~`#"'“”‘’([{]/u.test(text[start] ?? '')) start++;
  while (end > start && /\s|[*_~`#"'“”‘’\])},.;:!?]/u.test(text[end - 1] ?? ''))
    end--;
  return [start, end];
}

function seedSpans(
  parsed: ParsedDiscoveryAnswer,
  seeds: DiscoveryPrimitiveSeed[],
): { start: number; end: number }[] {
  const normalized = normalizedWithOffsets(parsed.text);
  const spans: { start: number; end: number }[] = [];
  for (const seed of seeds)
    for (const value of [seed.name, ...(seed.aliases ?? [])]) {
      const needle = normalizedText(value);
      if (!needle) continue;
      let cursor = normalized.text.indexOf(needle);
      while (cursor >= 0) {
        const before = normalized.text[cursor - 1] ?? ' ';
        const after = normalized.text[cursor + needle.length] ?? ' ';
        if (before === ' ' && after === ' ')
          spans.push({
            start: normalized.starts[cursor] ?? 0,
            end: normalized.ends[cursor + needle.length - 1] ?? 0,
          });
        cursor = normalized.text.indexOf(
          needle,
          cursor + Math.max(1, needle.length),
        );
      }
    }
  return spans;
}

function mergedSpans(
  spans: { start: number; end: number }[],
): { start: number; end: number }[] {
  const ordered = [...spans].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: { start: number; end: number }[] = [];
  for (const span of ordered) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end)
      previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function overlapsSpan(
  spans: { start: number; end: number }[],
  start: number,
  end: number,
): boolean {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const span = spans[middle]!;
    if (span.end <= start) low = middle + 1;
    else if (span.start >= end) high = middle - 1;
    else return true;
  }
  return false;
}

function normalizedWithOffsets(value: string): {
  text: string;
  starts: number[];
  ends: number[];
} {
  const output: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;
  let previousSpace = true;
  for (const sourceCharacter of value) {
    const sourceEnd = sourceOffset + sourceCharacter.length;
    const normalized = sourceCharacter
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    for (const character of normalized) {
      const emitted = /[\p{L}\p{N}]/u.test(character) ? character : ' ';
      if (emitted === ' ' && previousSpace) {
        if (ends.length) ends[ends.length - 1] = sourceEnd;
        continue;
      }
      for (let unit = 0; unit < emitted.length; unit++) {
        output.push(emitted[unit] ?? '');
        starts.push(sourceOffset);
        ends.push(sourceEnd);
      }
      previousSpace = emitted === ' ';
    }
    sourceOffset = sourceEnd;
  }
  if (output.at(-1) === ' ') {
    output.pop();
    starts.pop();
    ends.pop();
  }
  return { text: output.join(''), starts, ends };
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function boundedReservoir<
  T extends { id: string; start: number; end: number; normalizedName: string },
>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const edge = Math.max(1, Math.floor(limit / 4));
  const first = values.slice(0, edge);
  const last = values.slice(-edge);
  const retained = new Set([...first, ...last].map((value) => value.id));
  const middleLimit = limit - retained.size;
  const middle = values
    .slice(edge, -edge)
    .sort(
      (left, right) =>
        stableHash(left.id) - stableHash(right.id) ||
        compareUnicodeCodePoints(left.id, right.id),
    )
    .slice(0, middleLimit);
  return [...first, ...middle, ...last]
    .filter(
      (value, index, all) =>
        all.findIndex((item) => item.id === value.id) === index,
    )
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
    );
}

function spanShape(value: string): string {
  return Array.from(value)
    .map((character) =>
      /\p{Lu}/u.test(character)
        ? 'A'
        : /\p{Ll}/u.test(character)
          ? 'a'
          : /\p{N}/u.test(character)
            ? '0'
            : 'x',
    )
    .join('')
    .replace(/(.)\1+/gu, '$1')
    .slice(0, 20);
}

function keepsNameRunTogether(value: string): boolean {
  return !/\S/u.test(value) || /^\s*&\s*$/u.test(value);
}

function isNameConnector(token: VisibleToken): boolean {
  return token.value === '&' || NAME_CONNECTORS.has(token.normalized);
}

function tokensInRange(
  tokens: VisibleToken[],
  start: number,
  end: number,
): VisibleToken[] {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (tokens[middle]!.start < start) low = middle + 1;
    else high = middle;
  }
  const selected: VisibleToken[] = [];
  for (let index = low; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.start >= end) break;
    if (token.end <= end) selected.push(token);
  }
  return selected;
}

function roleFeatures(
  parsed: ParsedDiscoveryAnswer,
  zone: CandidateZone,
  zoneTokens: VisibleToken[],
  spanTokens: VisibleToken[],
  surface: string,
  bundleCasingByToken: Map<string, number>,
  seedColumnsByTable: Map<number, Set<number>>,
): Record<string, number> {
  const features = new Map<string, number>();
  const add = (name: string, value = 1) => features.set(name, value);
  add(`structure=${zone.structure}`);
  add(`token_count=${Math.min(5, spanTokens.length)}`);
  add(
    `zone_token_count=${Math.min(MAX_DISCOVERY_ZONE_TOKENS, zoneTokens.length)}`,
  );
  add('span_zone_fraction', spanTokens.length / Math.max(1, zoneTokens.length));
  add(`shape=${spanShape(surface)}`);
  add(
    `position=${Math.min(9, Math.floor((zone.start / Math.max(1, parsed.text.length)) * 10))}`,
  );
  if (zone.citationLike) add('citation');
  if (zone.inReferenceSection) add('reference_section');
  if (spanTokens.every((token) => token.capitalized)) add('all_title');
  if (spanTokens.some((token) => token.allCaps)) add('contains_all_caps');
  if (/\p{N}/u.test(surface)) add('contains_digit');
  if (spanTokens[0]?.start === zoneTokens[0]?.start) add('starts_zone');
  if (spanTokens.at(-1)?.end === zoneTokens.at(-1)?.end) add('ends_zone');

  for (const token of spanTokens) {
    add(`candidate=${token.normalized}`);
    if (token.normalized.length >= 2) {
      add(`candidate_prefix2=${token.normalized.slice(0, 2)}`);
      add(`candidate_suffix2=${token.normalized.slice(-2)}`);
    }
    if (token.normalized.length >= 3) {
      add(`candidate_prefix3=${token.normalized.slice(0, 3)}`);
      add(`candidate_suffix3=${token.normalized.slice(-3)}`);
    }
  }
  const firstSpanToken = spanTokens[0];
  const lastSpanToken = spanTokens.at(-1);
  if (firstSpanToken) {
    add(`candidate_first=${firstSpanToken.normalized}`);
    if (firstSpanToken.normalized.length >= 3)
      add(`candidate_first_suffix3=${firstSpanToken.normalized.slice(-3)}`);
  }
  if (lastSpanToken) {
    add(`candidate_last=${lastSpanToken.normalized}`);
    if (lastSpanToken.normalized.length >= 3)
      add(`candidate_last_suffix3=${lastSpanToken.normalized.slice(-3)}`);
  }

  const firstSpanTokenIndex =
    parsed.tokenIndexByStart.get(spanTokens[0]!.start) ?? 0;
  const lastSpanTokenIndex =
    parsed.tokenIndexByStart.get(spanTokens.at(-1)!.start) ??
    firstSpanTokenIndex;
  for (let distance = 1; distance <= 3; distance++) {
    const left = parsed.tokens[firstSpanTokenIndex - distance];
    const right = parsed.tokens[lastSpanTokenIndex + distance];
    if (left) {
      add(`left${distance}=${left.normalized}`);
      if (left.normalized.length >= 3)
        add(`left${distance}_suffix3=${left.normalized.slice(-3)}`);
    }
    if (right) {
      add(`right${distance}=${right.normalized}`);
      if (right.normalized.length >= 3)
        add(`right${distance}_suffix3=${right.normalized.slice(-3)}`);
    }
  }
  const leftAdjacent = parsed.tokens[firstSpanTokenIndex - 1];
  const rightAdjacent = parsed.tokens[lastSpanTokenIndex + 1];
  add(
    'left1_bundle_casing',
    leftAdjacent ? (bundleCasingByToken.get(leftAdjacent.normalized) ?? 0) : 0,
  );
  add(
    'right1_bundle_casing',
    rightAdjacent
      ? (bundleCasingByToken.get(rightAdjacent.normalized) ?? 0)
      : 0,
  );

  const tableCell = parsed.tableCellByTokenStart.get(spanTokens[0]!.start);
  if (tableCell) {
    const seedColumns = seedColumnsByTable.get(tableCell.table);
    if (seedColumns?.has(tableCell.column))
      add('cell_index_equals_seed_cell_index');
    if (seedColumns?.size) {
      const distance = Math.min(
        ...[...seedColumns].map((column) =>
          Math.abs(column - tableCell.column),
        ),
      );
      add(`column_distance_to_nearest_seed_cell=${Math.min(3, distance)}`);
    }
    add('column_value_repetition_ratio', tableCell.repetitionRatio);
  }

  const casing = spanTokens.map(
    (spanToken) => bundleCasingByToken.get(spanToken.normalized) ?? 0,
  );
  add(
    'bundle_casing_consistency',
    casing.length
      ? casing.reduce((sum, value) => sum + value, 0) / casing.length
      : 0,
  );
  return Object.fromEntries(
    [...features.entries()].sort(([left], [right]) =>
      compareUnicodeCodePoints(left, right),
    ),
  );
}

function zoneSpans(
  answer: DiscoveryPrimitiveAnswer,
  answerIndex: number,
  parsed: ParsedDiscoveryAnswer,
  zone: CandidateZone,
  blocked: { start: number; end: number }[],
): CompetitorSpanDraft[] {
  const [zoneStart, zoneEnd] = trimZone(parsed.text, zone.start, zone.end);
  if (zoneEnd <= zoneStart) return [];
  const tokens = tokensInRange(parsed.tokens, zoneStart, zoneEnd);
  if (!tokens.length || tokens.length > MAX_DISCOVERY_ZONE_TOKENS) return [];
  const spans = new Map<string, { start: number; end: number }>();
  const add = (startIndex: number, endIndex: number) => {
    const selected = tokens.slice(startIndex, endIndex + 1);
    const start = selected[0]?.start;
    const end = selected.at(-1)?.end;
    if (start === undefined || end === undefined || end - start > 80) return;
    if (overlapsSpan(blocked, start, end)) return;
    const surface = parsed.text.slice(start, end);
    if (!/\p{L}/u.test(surface)) return;
    spans.set(`${start}:${end}`, { start, end });
  };
  if (zone.explicit)
    for (let start = 0; start < tokens.length; start++)
      for (let end = start; end < tokens.length && end - start < 5; end++)
        add(start, end);
  for (let start = 0; start < tokens.length; start++) {
    if (!tokens[start]!.capitalized) continue;
    for (let end = start; end < tokens.length && end - start < 5; end++) {
      const token = tokens[end]!;
      if (!token.capitalized && !isNameConnector(token)) break;
      if (token.capitalized) add(start, end);
    }
  }
  const linked = parsed.links.find(
    (link) => link.labelStart === zoneStart && link.labelEnd === zoneEnd,
  );
  return [...spans.values()].map((span) => {
    const name = parsed.text.slice(span.start, span.end);
    const normalizedName = competitorSpanIdentity(name);
    const equivalentLink =
      linked && span.start === linked.labelStart && span.end === linked.labelEnd
        ? linked
        : null;
    return {
      id: `${answer.id}:${span.start}:${span.end}:${normalizedName}`,
      answerId: answer.id,
      answerIndex,
      name,
      normalizedName,
      start: span.start,
      end: span.end,
      zoneStart,
      zoneEnd,
      structure: zone.structure,
      linkedDomain: equivalentLink ? safeDomain(equivalentLink.rawUrl) : null,
      linkedUrl: equivalentLink?.rawUrl ?? null,
      citationLike: zone.citationLike,
      inReferenceSection: zone.inReferenceSection,
      extractionPriority:
        zone.structure === 'table' || zone.structure === 'link'
          ? 4
          : zone.structure === 'list' || zone.structure === 'emphasis'
            ? 3
            : zone.structure === 'prose'
              ? 2
              : 1,
      featureZone: { ...zone, start: zoneStart, end: zoneEnd },
    };
  });
}

export function enumerateCompetitorSpans(
  answer: DiscoveryPrimitiveAnswer,
  seeds: DiscoveryPrimitiveSeed[],
  answerIndex = 0,
  options: { bundleCasingByToken?: Map<string, number> } = {},
): { parsed: ParsedDiscoveryAnswer; spans: CompetitorSpanPrimitive[] } {
  const parsed = preparedCompetitorDiscoveryAnswer(answer);
  const blocked = mergedSpans(seedSpans(parsed, seeds));
  const seedColumnsByTable = new Map<number, Set<number>>();
  for (const seedSpan of blocked) {
    const cell = parsed.tableCellByTokenStart.get(seedSpan.start);
    if (!cell) continue;
    const columns = seedColumnsByTable.get(cell.table) ?? new Set<number>();
    columns.add(cell.column);
    seedColumnsByTable.set(cell.table, columns);
  }
  const zones = new Map<string, CandidateZone>();
  const addZone = (zone: CandidateZone) => {
    const [start, end] = trimZone(parsed.text, zone.start, zone.end);
    if (end <= start) return;
    const key = `${start}:${end}`;
    const previous = zones.get(key);
    if (!previous || zone.explicit || zone.structure !== 'prose')
      zones.set(key, { ...zone, start, end });
  };

  for (const line of parsed.lines) {
    for (const link of line.links)
      addZone({
        start: link.labelStart,
        end: link.labelEnd,
        structure: line.structure === 'prose' ? 'link' : line.structure,
        linkedUrl: link.rawUrl,
        citationLike: citationAt(
          line,
          link.labelStart,
          link.labelEnd - link.labelStart,
        ),
        inReferenceSection: line.inReferenceSection,
        explicit: true,
      });
    for (const emphasis of line.emphasis)
      addZone({
        start: emphasis.start,
        end: emphasis.end,
        structure: line.structure === 'prose' ? 'emphasis' : line.structure,
        linkedUrl: null,
        citationLike: citationAt(
          line,
          emphasis.start,
          emphasis.end - emphasis.start,
        ),
        inReferenceSection: line.inReferenceSection,
        explicit: true,
      });

    if (line.structure === 'table') {
      const localStart = line.text.startsWith('|') ? 1 : 0;
      const separator = line.text.indexOf('|', localStart);
      const end = separator >= 0 ? separator : line.text.length;
      const cell = line.text.slice(localStart, end);
      if (!/^\s*:?-{3,}:?\s*$/u.test(cell))
        addZone({
          start: line.start + localStart,
          end: line.start + end,
          structure: 'table',
          linkedUrl: null,
          citationLike: citationAt(
            line,
            line.start + localStart,
            end - localStart,
          ),
          inReferenceSection: line.inReferenceSection,
          explicit: true,
        });
    }
    if (line.structure === 'list') {
      const marker =
        line.text.match(/^\s*(?:#{1,6}\s+\d+[.)]|[-+*•]|\d+[.)])\s+/u)?.[0]
          .length ?? 0;
      const rest = line.text.slice(marker);
      const separator = rest.search(/\s*(?::|\||\s[—–]\s)\s*/u);
      const end = separator >= 0 ? marker + separator : line.text.length;
      addZone({
        start: line.start + marker,
        end: line.start + end,
        structure: 'list',
        linkedUrl: null,
        citationLike: citationAt(line, line.start + marker, end - marker),
        inReferenceSection: line.inReferenceSection,
        explicit: true,
      });
    }

    const occupied = [
      ...line.links.map((link) => [link.start, link.end] as const),
      ...line.emphasis.map(
        (value) => [value.start - 2, value.end + 2] as const,
      ),
    ];
    const lineTokens = tokensInRange(parsed.tokens, line.start, line.end);
    let runStart = -1;
    let lastCapital = -1;
    const flush = () => {
      if (runStart < 0 || lastCapital < runStart) return;
      const start = lineTokens[runStart]!.start;
      const end = lineTokens[lastCapital]!.end;
      if (!occupied.some(([left, right]) => start < right && end > left))
        addZone({
          start,
          end,
          structure: line.structure,
          linkedUrl: null,
          citationLike: citationAt(line, start, end - start),
          inReferenceSection: line.inReferenceSection,
          explicit: false,
        });
    };
    for (let index = 0; index <= lineTokens.length; index++) {
      const token = lineTokens[index];
      const previous = index > 0 ? lineTokens[index - 1] : undefined;
      if (
        token &&
        runStart >= 0 &&
        previous &&
        !keepsNameRunTogether(
          parsed.visibleText.slice(previous.end, token.start),
        )
      ) {
        flush();
        runStart = -1;
        lastCapital = -1;
      }
      if (token?.capitalized) {
        if (runStart < 0) runStart = index;
        lastCapital = index;
      } else if (token && runStart >= 0 && isNameConnector(token)) {
        continue;
      } else {
        flush();
        runStart = -1;
        lastCapital = -1;
      }
    }
  }

  const buckets = {
    structured: [] as CompetitorSpanDraft[],
    prose: [] as CompetitorSpanDraft[],
    heading: [] as CompetitorSpanDraft[],
  };
  for (const zone of [...zones.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const produced = zoneSpans(answer, answerIndex, parsed, zone, blocked);
    const bucket =
      zone.structure === 'heading'
        ? buckets.heading
        : zone.structure === 'prose'
          ? buckets.prose
          : buckets.structured;
    bucket.push(...produced);
  }
  const retained = [
    ...boundedReservoir(buckets.structured, 1_024),
    ...boundedReservoir(buckets.prose, 896),
    ...boundedReservoir(buckets.heading, 128),
  ];
  const merged = new Map<string, CompetitorSpanDraft>();
  for (const span of retained) {
    const previous = merged.get(span.id);
    if (!previous) merged.set(span.id, span);
    else {
      if (span.extractionPriority > previous.extractionPriority) {
        previous.structure = span.structure;
        previous.extractionPriority = span.extractionPriority;
      }
      previous.linkedDomain ??= span.linkedDomain;
      previous.linkedUrl ??= span.linkedUrl;
      previous.citationLike ||= span.citationLike;
      previous.inReferenceSection ||= span.inReferenceSection;
    }
  }
  const spans = [...merged.values()]
    .slice(0, MAX_DISCOVERY_SPANS_PER_ANSWER)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
    )
    .map(({ featureZone, ...span }): CompetitorSpanPrimitive => {
      const zoneTokens = tokensInRange(
        parsed.tokens,
        featureZone.start,
        featureZone.end,
      );
      const spanTokens = tokensInRange(parsed.tokens, span.start, span.end);
      return {
        ...span,
        features: roleFeatures(
          parsed,
          featureZone,
          zoneTokens,
          spanTokens,
          span.name,
          options.bundleCasingByToken ?? parsed.casingByToken,
          seedColumnsByTable,
        ),
      };
    });
  return { parsed, spans };
}

export function competitorBundleCasing(
  answers: DiscoveryPrimitiveAnswer[],
): Map<string, number> {
  const counts = new Map<string, { capitalized: number; total: number }>();
  for (const answer of answers)
    for (const token of preparedCompetitorDiscoveryAnswer(answer).tokens) {
      const count = counts.get(token.normalized) ?? {
        capitalized: 0,
        total: 0,
      };
      count.total++;
      if (token.capitalized) count.capitalized++;
      counts.set(token.normalized, count);
    }
  return new Map(
    [...counts].map(([token, count]) => [
      token,
      count.capitalized / count.total,
    ]),
  );
}
