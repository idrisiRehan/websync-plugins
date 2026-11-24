// Turns feed text into items: one per data row, XML item/entry, or JSONL record. Reading reuses
// the CSV reader from product-csv-lint and the XML reader from sitemap-lint (ADR 0006), so
// rows keep spreadsheet numbers and XML keeps source lines, and no DTD is ever processed.

import { parseCsv } from "product-csv-lint";
import { parseXml, type XmlElement } from "sitemap-lint";
import type { FeedFormat, Field, Report } from "./spec.ts";

export const GOOGLE_NAMESPACE = "http://base.google.com/ns/1.0";
// Custom attributes, accepted by Google and ignored here.
const GOOGLE_CUSTOM_NAMESPACE = "http://base.google.com/cns/1.0";
const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";

// RSS 2.0 items may use the RSS elements for these three (https://support.google.com/merchants/answer/160589).
const RSS_NATIVE: Record<string, string> = { title: "title", link: "link", description: "description" };
// Atom 1.0 entries use the Atom elements for these, and summary for the description
// (https://support.google.com/merchants/answer/14990811).
const ATOM_NATIVE: Record<string, string> = { title: "title", id: "id", link: "link", summary: "description", updated: "updated" };

/** One attribute occurrence before alias resolution. */
export interface RawField extends Field {
  name: string;
}

export interface RawItem {
  line: number;
  fields: RawField[];
}

export interface ReadResult {
  items: RawItem[];
  /** For delimited files: the header row and its attribute names (first of any duplicates). */
  header: { line: number; names: string[] } | null;
  /** For Atom feeds, whose entries also need an updated element. */
  atom: boolean;
}

export interface ReadContext {
  report: Report;
  /** Maps an attribute name as written to the name the target uses. */
  normalize(name: string): string;
  /** True when `name` (normalized) is an attribute of the target. */
  isKnown(name: string): boolean;
  /** Read a repeated header column as more values of its attribute. */
  repeatedColumns: boolean;
}

/** Guesses the format from the first non-space character, then the first line. */
export function detectFormat(text: string): FeedFormat | null {
  const start = text.search(/\S/);
  if (start === -1) return null;
  const first = text[start];
  if (first === "<") return "xml";
  if (first === "{" || first === "[") return "jsonl";
  const end = text.indexOf("\n", start);
  const line = text.slice(start, end === -1 ? text.length : end);
  return !line.includes("\t") && line.includes(",") ? "csv" : "tsv";
}

export function read(text: string, format: FeedFormat, ctx: ReadContext): ReadResult {
  if (format === "xml") return readXml(text, ctx);
  if (format === "jsonl") return readJsonl(text, ctx);
  return readDelimited(text, format === "tsv" ? "\t" : ",", ctx);
}

const EMPTY: ReadResult = { items: [], header: null, atom: false };

function readDelimited(text: string, delimiter: "\t" | ",", ctx: ReadContext): ReadResult {
  const { records, issues } = parseCsv(text, delimiter);
  for (const issue of issues) {
    if (issue.kind === "quote-unterminated") {
      ctx.report("quote-unterminated", "error", "A value starts with a quote that is never closed, so everything after it was read as one value. Close the quote, or remove it.", { line: issue.row });
    } else if (delimiter === ",") {
      // Only CSV: in Google's tab-separated text a quote may also wrap one value inside a cell,
      // as in General:Range:"10:20 inches" (https://support.google.com/merchants/answer/14998273).
      ctx.report("quote-unexpected", "warning", 'A quote appears inside a value that doesn\'t start with one, or text follows a closing quote. Quotes wrap whole values: write "12"" pizza" to keep a quote inside one.', { line: issue.row });
    }
  }
  const [headerRecord, ...rows] = records;
  if (!headerRecord) return EMPTY;

  const trailingTab = "The row ends with a tab. Remove trailing tabs at the ends of lines.";
  let width = headerRecord.cells.length;
  if (delimiter === "\t" && width > 1 && headerRecord.cells[width - 1].trim() === "") {
    ctx.report("row-trailing-tab", "warning", trailingTab, { line: headerRecord.row });
    width--;
  }
  const columns: { name: string; parts: boolean; index: number }[] = [];
  const names: string[] = [];
  headerRecord.cells.slice(0, width).forEach((cell, index) => {
    const raw = cell.trim();
    if (raw === "") {
      ctx.report("attribute-unknown", "warning", `Column ${index + 1} has no name in the header, so its values are ignored.`, { line: headerRecord.row });
      return;
    }
    // "shipping(country:service:price)" names sub-attributes, and the cells hold "US:Standard:5.00 USD".
    const paren = raw.indexOf("(");
    const name = ctx.normalize(paren > 0 && raw.endsWith(")") ? raw.slice(0, paren) : raw);
    if (names.includes(name)) {
      // Google: "you can also create multiple separate columns" for a repeated attribute (answer 14998273).
      if (ctx.repeatedColumns) {
        columns.push({ name, parts: paren > 0, index });
        return;
      }
      ctx.report("header-duplicate", "warning", `"${raw}" is a second column for ${name}. Only the first is read; put several values in one cell, separated by commas.`, { line: headerRecord.row, attribute: name });
      return;
    }
    names.push(name);
    columns.push({ name, parts: paren > 0, index });
  });

  const items = rows.map((record): RawItem => {
    const cells = record.cells;
    if (cells.length !== width) {
      const trailing = delimiter === "\t" && cells.length > width && cells.slice(width).every((c) => c.trim() === "");
      if (trailing) {
        ctx.report("row-trailing-tab", "warning", trailingTab, { line: record.row });
      } else {
        const sep = delimiter === "\t" ? "tab" : "comma";
        ctx.report("row-width", "error", `The row has ${cells.length} values but the header has ${width}, so values may be under the wrong attribute. Look for a missing or extra ${sep}, or a ${sep} inside a value.`, { line: record.row });
      }
    }
    const fields: RawField[] = [];
    for (const column of columns) {
      const value = (cells[column.index] ?? "").trim();
      if (value === "") continue;
      fields.push({ name: column.name, value, line: record.row, parts: column.parts ? value.split(":").map((p) => p.trim()) : null });
    }
    return { line: record.row, fields };
  });
  return { items, header: { line: headerRecord.row, names }, atom: false };
}

function readXml(text: string, ctx: ReadContext): ReadResult {
  const parsed = parseXml(text);
  if (!parsed.ok) {
    ctx.report("feed-unreadable", "error", `The XML isn't well-formed: ${parsed.error}`, { line: parsed.line });
    return EMPTY;
  }
  const { root } = parsed;
  const atom = root.localName === "feed" && root.namespace === ATOM_NAMESPACE;
  let entries: XmlElement[];
  if (atom) {
    entries = root.children.filter((el) => el.localName === "entry" && el.namespace === ATOM_NAMESPACE);
  } else if (root.localName === "rss" && root.namespace === null) {
    const channel = root.children.find((el) => el.localName === "channel" && el.namespace === null);
    if (!channel) {
      ctx.report("feed-unreadable", "error", "The <rss> element has no <channel>. Put the <item> elements inside <rss><channel>.", { line: root.line });
      return EMPTY;
    }
    entries = channel.children.filter((el) => el.localName === "item" && el.namespace === null);
  } else {
    ctx.report("feed-unreadable", "error", `The root element is <${root.name}>. A product feed is RSS 2.0 (<rss version="2.0">) or Atom 1.0 (<feed xmlns="${ATOM_NAMESPACE}">).`, { line: root.line });
    return EMPTY;
  }

  const native = atom ? ATOM_NATIVE : RSS_NATIVE;
  const misplaced = new Set<string>();
  const items = entries.map((entry): RawItem => {
    const fields: RawField[] = [];
    for (const el of entry.children) {
      let name: string;
      if (el.namespace === GOOGLE_NAMESPACE) {
        name = ctx.normalize(el.localName);
      } else if (el.namespace === (atom ? ATOM_NAMESPACE : null) && el.localName in native) {
        name = native[el.localName];
      } else {
        // Only an unprefixed element with an attribute's name, or a g: prefix bound to the wrong
        // namespace, is a mistake. Other namespaces (media:, custom attributes) are allowed and ignored.
        const unprefixed = el.namespace === (atom ? ATOM_NAMESPACE : null) && ctx.isKnown(ctx.normalize(el.localName));
        const wrongPrefix = el.name.startsWith("g:") && el.namespace !== GOOGLE_CUSTOM_NAMESPACE;
        if ((unprefixed || wrongPrefix) && !misplaced.has(el.name)) {
          misplaced.add(el.name);
          const why = wrongPrefix ? `the g: prefix is bound to "${el.namespace}"` : "it has no g: prefix";
          ctx.report("namespace-wrong", "warning", `<${el.name}> is ignored because ${why}. Declare xmlns:g="${GOOGLE_NAMESPACE}" and write attributes as <g:${el.localName}>. Reported once.`, { line: el.line, attribute: el.localName });
        }
        continue;
      }
      const value = atom && el.localName === "link" && el.namespace === ATOM_NAMESPACE ? (el.attributes.href ?? el.text).trim() : el.text.trim();
      const parts = el.children.length ? el.children.map((c) => c.text.trim()) : null;
      if (value === "" && !parts) continue; // an empty element supplies no value, like an empty cell
      fields.push({ name, value: parts ? parts.join(":") : value, line: el.line, parts, element: true });
    }
    return { line: entry.line, fields };
  });
  return { items, header: null, atom };
}

function readJsonl(text: string, ctx: ReadContext): ReadResult {
  if (text.trimStart().startsWith("[")) {
    ctx.report("feed-unreadable", "error", "This is a JSON array. A JSONL feed has one JSON object per line, with no surrounding brackets.", { line: 1 });
    return EMPTY;
  }
  const items: RawItem[] = [];
  let line = 0;
  for (const raw of text.split("\n")) {
    line++;
    if (raw.trim() === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(raw);
    } catch {
      record = undefined;
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      ctx.report("feed-unreadable", "error", "This line isn't a JSON object. Each line of a JSONL feed holds one complete product record.", { line });
      continue;
    }
    const fields: RawField[] = [];
    for (const [key, json] of Object.entries(record)) {
      if (json === null || json === "" || (Array.isArray(json) && json.length === 0)) continue;
      const value = typeof json === "string" ? json.trim() : typeof json === "object" ? JSON.stringify(json) : String(json);
      fields.push({ name: ctx.normalize(key), value, line, parts: null, json: typeof json === "string" ? undefined : json });
    }
    items.push({ line, fields });
  }
  return { items, header: null, atom: false };
}
