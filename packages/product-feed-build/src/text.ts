// Text helpers for feed values: HTML descriptions to plain text, cleaning cell text, length
// limits by characters (code points, as Google and OpenAI count them), and ids that fit a
// length limit while staying unique and stable.

import { decodeEntities, tokenizeHtml } from "metacheck";

// Elements whose content is code or fallback markup, never product text.
const HIDDEN = new Set(["script", "style", "noscript", "template"]);
// Elements that start a new line of text.
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre", "section", "table", "tr", "ul",
]);
// C0 controls other than tab, line feed and carriage return, DEL, and the noncharacters U+FFFE
// and U+FFFF: never meaningful in a feed value, and (except DEL) not allowed in XML 1.0.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffe\uffff]/g;

/** The value without control characters; line breaks are kept. */
export function withoutControls(value: string): string {
  return value.replace(CONTROL, "");
}

/** One line of text: controls removed, runs of white space (tabs, line breaks) made one space. */
export function oneLine(value: string): string {
  return withoutControls(value).replace(/\s+/g, " ").trim();
}

/**
 * Plain text from a description: tags dropped, script and style content left out, block
 * elements (paragraphs, list items, line breaks) as line breaks, entities decoded.
 */
export function htmlToText(html: string): string {
  // Plain text (no tags) keeps its own line breaks; in HTML they are just white space. Both
  // platforms' description fields are HTML, so "Fish &amp; Chips" without tags is still decoded.
  if (!/<[a-z!/?]/i.test(html)) return html.split(/\r?\n/).map((line) => oneLine(decodeEntities(line))).filter((l) => l !== "").join("\n");
  const lines: string[] = [];
  let line = "";
  let hidden = 0;
  for (const token of tokenizeHtml(withoutControls(html))) {
    if (token.type === "text") {
      if (hidden === 0) line += token.text;
    } else if (token.type === "start" || token.type === "end") {
      if (HIDDEN.has(token.tag)) {
        if (token.type === "end") hidden = Math.max(0, hidden - 1);
        else if (!token.selfClosing) hidden++;
      } else if (BLOCK.has(token.tag)) {
        lines.push(line);
        line = "";
      } else if (token.tag === "td" || token.tag === "th") {
        line += " ";
      }
    }
  }
  lines.push(line);
  return lines.map(oneLine).filter((l) => l !== "").join("\n");
}

/** Length in characters (code points), so an emoji counts once. */
export function charLength(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

/** Cuts text to at most `max` characters at a word boundary. */
export function truncateWords(value: string, max: number): string {
  if (charLength(value) <= max) return value;
  // One character past the limit shows whether the cut falls inside a word.
  const head = Array.from(value).slice(0, max + 1).join("");
  const space = head.search(/\s\S*$/);
  return (space > 0 ? head.slice(0, space) : Array.from(head).slice(0, max).join("")).trimEnd();
}

// 32-bit FNV-1a: a short, stable fingerprint, not a security measure.
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * An id of at most `max` characters. A longer one keeps its start and gets "-" plus a
 * fingerprint of the whole value, so the same input always gives the same id and two ids
 * that share a long prefix stay apart.
 */
export function fitId(value: string, max: number): string {
  if (charLength(value) <= max) return value;
  return `${Array.from(value).slice(0, max - 9).join("")}-${fingerprint(value)}`;
}
