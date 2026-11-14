// What the agent's message box makes of an attached file, in the browser (nothing is uploaded before the message): an
// image shrunk to a JPEG, a PDF as it is (the model reads it), and any other file it can read as its text: plain text,
// CSV, JSON, Markdown, code, and Word, Excel, PowerPoint and OpenDocument files from the XML inside them. The agent
// reads that text under the file's name (`readableFiles` in lib/agent.ts).
import { AGENT_FILE_BYTES_MAX, AGENT_FILE_CHARS_MAX, AGENT_IMAGE_CHARS_MAX, AGENT_PDF_BYTES_MAX, type AgentFile } from './agent';

/** Why a file stays out: no text could be read from it, or it is over the size the agent takes. */
export type FileRefusal = 'unreadable' | 'too-large';

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

/** An image as the agent takes it: JPEG, at most 1600 px a side and AGENT_IMAGE_CHARS_MAX as a data URL (smaller tries if not). */
async function shrinkImage(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  let side = 1600;
  let quality = 0.86;
  for (let attempt = 0; attempt < 5; attempt++, side *= 0.75, quality -= 0.08) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    // A transparent screenshot keeps a white page under it (JPEG has no transparency).
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= AGENT_IMAGE_CHARS_MAX) return url;
  }
  return null;
}

/** The files of a ZIP whose names pass `wanted`, as text (Office and OpenDocument files are ZIPs of XML); null if not a ZIP. */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(0, true) !== 0x04034b50) return null;
  const files = new Map<string, string>();
  let at = view.getUint32(end + 16, true);
  for (let count = view.getUint16(end + 10, true); count > 0 && view.getUint32(at, true) === 0x02014b50; count--) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (!wanted(name) || (method !== 0 && method !== 8)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.slice(start, start + size);
    const data = method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    files.set(name, new TextDecoder().decode(data));
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (ENTITIES[code] ?? whole),
  );
/** XML as its text: `lines` end a line (a paragraph, a row), `cells` end a cell (a tab). */
const xmlText = (xml: string, lines: RegExp, cells?: RegExp) =>
  unescapeXml((cells ? xml.replace(cells, '\t') : xml).replace(lines, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A spreadsheet column's index from its letters (A is 0). */
const column = (letters: string) => [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;

/** One Excel sheet as tab-separated rows, each cell in its own column. */
function sheetText(xml: string, strings: string[]) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
    .map(([, row]) => {
      const cells: string[] = [];
      for (const [, attributes, body = ''] of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = /\bt="(\w+)"/.exec(attributes)?.[1];
        const value = unescapeXml(type === 'inlineStr' ? body.replace(/<[^>]+>/g, '') : (/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''));
        const index = column(/\br="([A-Z]+)/.exec(attributes)?.[1] ?? '');
        cells[index < 0 ? cells.length : index] = type === 's' ? (strings[Number(value)] ?? '') : value;
      }
      return Array.from(cells, (cell) => cell ?? '').join('\t');
    })
    .join('\n');
}

const OFFICE_PARTS = /^(?:word\/document\.xml|xl\/(?:sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)|ppt\/slides\/slide\d+\.xml|content\.xml)$/;

/** The text of a Word, Excel, PowerPoint or OpenDocument file; null when the bytes are not one. */
export async function documentText(bytes: Uint8Array) {
  const parts = await unzip(bytes, (name) => OFFICE_PARTS.test(name));
  if (!parts) return null;
  const word = parts.get('word/document.xml');
  if (word) return xmlText(word, /<\/w:p>|<w:br\b[^>]*\/>/g, /<w:tab\/>/g);
  const workbook = parts.get('xl/workbook.xml');
  if (workbook) {
    const strings = [...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) =>
      unescapeXml([...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(([, text]) => text).join('')),
    );
    const targets = new Map([...(parts.get('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map(([, id, target]) => [id, `xl/${target.replace(/^\/?xl\//, '')}`]));
    return [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)]
      .map(([, name, id]) => `# ${unescapeXml(name)}\n${sheetText(parts.get(targets.get(id) ?? '') ?? '', strings)}`)
      .join('\n\n');
  }
  const slides = [...parts.keys()].filter((name) => name.startsWith('ppt/slides/')).sort((a, b) => Number(/\d+/.exec(a)) - Number(/\d+/.exec(b)));
  if (slides.length) return slides.map((name, index) => `# Slide ${index + 1}\n${xmlText(parts.get(name) ?? '', /<\/a:p>/g)}`).join('\n\n');
  const content = parts.get('content.xml');
  if (!content) return null;
  if (content.includes('<office:spreadsheet'))
    return xmlText(content.replace(/<table:table\b[^>]*\btable:name="([^"]*)"[^>]*>/g, '\n# $1\n').replace(/<\/text:p>/g, ' '), /<\/table:table-row>/g, /<\/table:table-cell>/g);
  return xmlText(content, /<\/text:(?:p|h)>/g, /<text:tab\/>/g);
}

/** Bytes as text when they are text: UTF-8, or the Windows Latin encoding spreadsheets often export; null for binary. */
export function plainText(bytes: Uint8Array) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** A file's text as the agent's attachment: at most AGENT_FILE_CHARS_MAX characters (the agent says when it was cut). */
export function textFile(name: string, text: string): AgentFile {
  const bytes = new TextEncoder().encode(text.slice(0, AGENT_FILE_CHARS_MAX));
  return { name, mediaType: 'text/plain', url: `data:text/plain;charset=utf-8;base64,${toBase64(bytes)}` };
}

/** One attached file as the agent takes it, or why it stays out. */
export async function readAttachment(file: File): Promise<AgentFile | FileRefusal> {
  if (/^image\/(?!svg)/.test(file.type)) {
    const url = await shrinkImage(file);
    return url ? { name: file.name, mediaType: 'image/jpeg', url } : 'unreadable';
  }
  if (file.size > AGENT_FILE_BYTES_MAX) return 'too-large';
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    return file.size > AGENT_PDF_BYTES_MAX ? 'too-large' : { name: file.name, mediaType: 'application/pdf', url: `data:application/pdf;base64,${toBase64(bytes)}` };
  const text = (await documentText(bytes).catch(() => null)) ?? plainText(bytes);
  return text?.trim() ? textFile(file.name, text) : 'unreadable';
}
