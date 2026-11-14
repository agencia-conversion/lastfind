import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { evidenceSnippet } from '@/lib/brand-decisions';

// Model answers are untrusted: tokens become React elements (never HTML
// strings), raw HTML is shown as text and only http(s)/mailto links are live.
const SAFE_HREF = /^(?:https?:|mailto:)/i;

// Optional brand highlight: names found in the plain text become <mark>; `own`
// marks the selected brand. Matching is whole-word and case-insensitive.
export type AnswerHighlight = { own: string[]; others: string[] };
const Highlight = createContext<AnswerHighlight | null>(null);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function Marked({ text }: { text: string }) {
  const highlight = useContext(Highlight);
  const names = highlight
    ? [...highlight.own, ...highlight.others].filter((name) => name.trim().length > 1)
    : [];
  if (!highlight || !names.length) return <>{withoutStrayBold(text)}</>;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${names.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const own = new Set(highlight.own.map((name) => name.toLowerCase()));
  return (
    <>
      {withoutStrayBold(text).split(pattern).map((part, index) =>
        index % 2 ? (
          <mark key={index} className={own.has(part.toLowerCase()) ? 'live-answer-mark live-answer-mark-own' : 'live-answer-mark'}>{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * A bold marker the parser left as text has no pair it can close with (`** /**` around a link an AI put inside its bold):
 * the words stay, the asterisks go. A written asterisk the answer escaped (`\*`) is its own token and stays.
 */
const withoutStrayBold = (text: string) => text.replace(/\*\*/g, '');

/**
 * Some AIs' answers (Google AI Mode) write a linked name twice, as text and then as its link ("Hulu[Hulu](https://hulu.com)"),
 * which reads "HuluHulu": the copy before the link goes, the link stays.
 */
export function tidyAnswer(text: string) {
  let tidy = '';
  let from = 0;
  for (const match of text.matchAll(/\[([^[\]\n]{1,120})\]\(/gu)) {
    const label = match[1];
    const start = match.index - label.length;
    if (start < from || text.slice(start, match.index) !== label || /[\p{L}\p{N}]/u.test(text[start - 1] ?? '')) continue;
    tidy += text.slice(from, start);
    from = match.index;
  }
  return tidy + text.slice(from);
}

function inline(tokens: Token[] | undefined): ReactNode {
  return (tokens ?? []).map((token, index) => {
    const key = index;
    switch (token.type) {
      case 'strong':
        return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
      case 'em':
        return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
      case 'del':
        return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
      case 'codespan':
        return <code key={key}>{(token as Tokens.Codespan).text}</code>;
      case 'br':
        return <br key={key} />;
      case 'link': {
        const link = token as Tokens.Link;
        return SAFE_HREF.test(link.href) ? (
          <a key={key} href={link.href} target="_blank" rel="noopener noreferrer">
            {inline(link.tokens)}
          </a>
        ) : (
          <Fragment key={key}>{inline(link.tokens)}</Fragment>
        );
      }
      case 'image':
        return <Fragment key={key}>{(token as Tokens.Image).text}</Fragment>;
      case 'text': {
        const text = token as Tokens.Text;
        return <Fragment key={key}>{text.tokens ? inline(text.tokens) : <Marked text={text.text} />}</Fragment>;
      }
      default:
        // escape, html and anything unknown: plain text, never markup.
        return <Fragment key={key}>{(token as { text?: string; raw: string }).text ?? token.raw}</Fragment>;
    }
  });
}

// `headings`: a document's headings stay headings (an artifact, drawn as its editor draws them); an answer's are bold lines.
function blocks(tokens: Token[], headings = false): ReactNode {
  return tokens.map((token, index) => {
    const key = index;
    switch (token.type) {
      case 'space':
        return null;
      case 'paragraph':
        return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
      case 'heading': {
        const heading = token as Tokens.Heading;
        if (!headings) return <p key={key}><strong>{inline(heading.tokens)}</strong></p>;
        const Heading = `h${Math.min(heading.depth, 4)}` as 'h1' | 'h2' | 'h3' | 'h4';
        return <Heading key={key}>{inline(heading.tokens)}</Heading>;
      }
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item, i) => (
          <li key={i}>{blocks(item.tokens, headings)}</li>
        ));
        return list.ordered ? (
          <ol key={key} start={typeof list.start === 'number' ? list.start : undefined}>{items}</ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case 'blockquote':
        return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens, headings)}</blockquote>;
      case 'code':
        return <pre key={key}><code>{(token as Tokens.Code).text}</code></pre>;
      case 'hr':
        return <hr key={key} />;
      case 'text': {
        const text = token as Tokens.Text;
        return <Fragment key={key}>{text.tokens ? inline(text.tokens) : <Marked text={text.text} />}</Fragment>;
      }
      case 'table': {
        // The app's one table (DataTable): the same grid, alignment and cards on a phone as every screen; no sort.
        const table = token as Tokens.Table;
        const align = (cell: Tokens.TableCell) => (cell.align === 'right' ? 'end' : cell.align === 'center' ? 'center' : 'start') as 'start' | 'center' | 'end';
        return (
          <DataTable
            key={key}
            rows={table.rows}
            rowKey={(_, index) => String(index)}
            columns={table.header.map((head, index) => ({
              key: `c${index}`,
              header: inline(head.tokens),
              label: head.text,
              align: align(head),
              mobile: index === 0 ? ('title' as const) : undefined,
              cellClassName: 'whitespace-normal align-top',
              cell: (row: Tokens.TableCell[]) => (row[index] ? inline(row[index].tokens) : null),
            }))}
          />
        );
      }
      default:
        // html, definitions: keep the source text readable.
        return <p key={key}>{(token as { text?: string; raw: string }).text ?? token.raw}</p>;
    }
  });
}

/**
 * An excerpt cut from an answer, made safe to render as markdown: citation markers go, and a link, bold, underline or code
 * span the cut left open at either end loses its marker, so no dangling `**` or `[label](` shows; the text stays.
 */
export function tidyExcerpt(text: string) {
  let value = text
    // Citation markers ("[[1]](url)", their links often already cut from the stored excerpt) say nothing in an excerpt.
    // Stored excerpts often keep the marker with an empty link ("[[1]]( )").
    .replace(/\[\[\d+\]\](?:\(\s*\)|\([^)\s]*\)?)?/gu, ' ')
    // A list item that only held citations says nothing either.
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]*$/gmu, '')
    .replace(/^([^[\]\n]*)\]\([^)\s]*\)/u, '$1')
    .replace(/\[([^\]\n]*)\]\([^)\s]*$/u, '$1')
    .replace(/\[([^\]\n]*)$/u, '$1');
  // Markers pair in order: one followed by text opens, one preceded by text closes the open one; the rest are dropped.
  for (const marker of ['**', '__', '`']) {
    const kept = new Set<number>();
    let open = -1;
    for (let at = value.indexOf(marker); at >= 0; at = value.indexOf(marker, at + marker.length)) {
      if (open >= 0 && /\S/u.test(value[at - 1] ?? ' ')) {
        kept.add(open).add(at);
        open = -1;
      } else if (/\S/u.test(value[at + marker.length] ?? ' ')) open = at;
    }
    let tidy = '';
    let from = 0;
    for (let at = value.indexOf(marker); at >= 0; at = value.indexOf(marker, at + marker.length)) {
      if (kept.has(at)) continue;
      tidy += value.slice(from, at);
      from = at + marker.length;
    }
    value = tidy + value.slice(from);
  }
  return value;
}

/** An evidence excerpt rendered like the answers, with the selected brand under the same text marker. */
export function ExcerptMarkdown({ text, brands }: { text: string; brands: string[] }) {
  return (
    <Highlight.Provider value={{ own: brands, others: [] }}>
      <div className="live-answer">{blocks(marked.lexer(tidyAnswer(tidyExcerpt(text))))}</div>
    </Highlight.Provider>
  );
}

export function AnswerMarkdown({ text, highlight, headings }: { text: string; highlight?: AnswerHighlight; headings?: boolean }) {
  return (
    <Highlight.Provider value={highlight ?? null}>
      <div className="live-answer">{blocks(marked.lexer(tidyAnswer(text)), headings)}</div>
    </Highlight.Provider>
  );
}

/**
 * An excerpt where markup cannot go (inside a button): the answer's markdown reduced to its text around the brand, the
 * brand marked. ExcerptMarkdown is the formatted version for a block.
 */
export function ExcerptSnippet({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      “
      {evidenceSnippet(text, names).map((part, index) =>
        part.match ? <mark key={index} className="rounded-sm bg-highlight px-0.5 text-highlight-foreground">{part.text}</mark> : part.text,
      )}
      ”
    </>
  );
}
