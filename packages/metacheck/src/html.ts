// A lenient HTML tokenizer: enough to read a page's metadata. It emits start tags with
// attributes, end tags, text and the doctype, each with a line number. It follows the WHATWG
// tokenizer where that matters for metadata (attribute parsing, comments, raw text in
// <script>, <style> and <noscript>, escapable raw text in <title> and <textarea>) and, like a browser,
// never throws: any input produces tokens. It does not build a tree; callers track nesting.
//
// Not implemented: the full named character reference table (only common entities are
// decoded, see ENTITIES; others are left as written), script data escape states, foreign
// content (SVG, MathML) and the tree builder's implied tags.

export type HtmlToken =
  | { type: "start"; tag: string; attrs: Record<string, string>; selfClosing: boolean; line: number }
  | { type: "end"; tag: string; line: number }
  | { type: "text"; text: string; line: number }
  | { type: "doctype"; value: string; line: number };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122", hellip: "\u2026", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D", laquo: "\u00AB", raquo: "\u00BB",
  bull: "\u2022", middot: "\u00B7", euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2",
  sect: "\u00A7", deg: "\u00B0", times: "\u00D7", divide: "\u00F7", para: "\u00B6", rarr: "\u2192",
};
const REFERENCE = /&(?:#[xX]([0-9A-Fa-f]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g;
const TAG_NAME = /[^\t\n\f\r />]*/y;
const ATTR_NAME = /[^\t\n\f\r />][^\t\n\f\r />=]*/y;
const UNQUOTED_VALUE = /[^\t\n\f\r >]*/y;
const SPACE = /[\t\n\f\r ]*/y;
const ASCII_LETTER = /[A-Za-z]/;
const COMMENT_END = /--!?>/g;
// Elements whose content is text up to the matching end tag. Only <title> and <textarea>
// decode character references in that text.
const RAW_TEXT_END: Record<string, RegExp> = {
  script: /<\/script[\t\n\f\r />]/gi,
  style: /<\/style[\t\n\f\r />]/gi,
  title: /<\/title[\t\n\f\r />]/gi,
  textarea: /<\/textarea[\t\n\f\r />]/gi,
  // Raw text when scripting is on, which is how browsers and Google's renderer parse it.
  noscript: /<\/noscript[\t\n\f\r />]/gi,
};
// Numeric references to 0x80-0x9F mean windows-1252 characters, as in browsers (WHATWG
// "numeric character reference end state").
const WINDOWS_1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const DECODED_RAW_TEXT = new Set(["title", "textarea"]);

/** Decodes numeric character references and the common named ones in ENTITIES. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (match, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name !== undefined) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : match;
    const cp = parseInt(hex ?? dec!, hex !== undefined ? 16 : 10);
    if (cp >= 0x80 && cp <= 0x9f) return String.fromCodePoint(WINDOWS_1252[cp - 0x80]);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(cp);
  });
}

function skip(re: RegExp, html: string, pos: number): number {
  re.lastIndex = pos;
  re.exec(html);
  return re.lastIndex;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  end: number;
}

/** Reads a tag whose name starts at `start`. Returns null when the input ends inside it. */
function readTag(html: string, start: number): Tag | null {
  TAG_NAME.lastIndex = start;
  const name = TAG_NAME.exec(html)![0].toLowerCase();
  // Null prototype, so an attribute named "__proto__" is just an attribute.
  const attrs: Record<string, string> = Object.create(null);
  let selfClosing = false;
  let pos = TAG_NAME.lastIndex;
  while (pos < html.length) {
    const c = html[pos];
    if (c === ">") return { name, attrs, selfClosing, end: pos + 1 };
    selfClosing = false;
    if (c === "/") {
      selfClosing = html[pos + 1] === ">";
      pos++;
      continue;
    }
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") {
      pos++;
      continue;
    }
    ATTR_NAME.lastIndex = pos;
    const attrName = ATTR_NAME.exec(html)![0].toLowerCase();
    pos = skip(SPACE, html, ATTR_NAME.lastIndex);
    let value = "";
    if (html[pos] === "=") {
      pos = skip(SPACE, html, pos + 1);
      const quote = html[pos];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, pos + 1);
        if (close === -1) return null;
        value = html.slice(pos + 1, close);
        pos = close + 1;
      } else {
        UNQUOTED_VALUE.lastIndex = pos;
        value = UNQUOTED_VALUE.exec(html)![0];
        pos = UNQUOTED_VALUE.lastIndex;
      }
      value = decodeEntities(value);
    }
    // A repeated attribute is ignored; the first one wins, as in browsers.
    if (!(attrName in attrs)) attrs[attrName] = value;
  }
  return null;
}

/** Splits HTML into tokens. Comments, processing instructions and CDATA are dropped. */
export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let line = 1;
  let nextNewline = html.indexOf("\n");
  const lineAt = (pos: number): number => {
    while (nextNewline !== -1 && nextNewline < pos) {
      line++;
      nextNewline = html.indexOf("\n", nextNewline + 1);
    }
    return line;
  };
  const pushText = (start: number, end: number, decode: boolean): void => {
    if (end <= start) return;
    const raw = html.slice(start, end);
    const text = decode ? decodeEntities(raw) : raw;
    const last = tokens.at(-1);
    if (last?.type === "text") last.text += text;
    else tokens.push({ type: "text", text, line: lineAt(start) });
  };
  const closeAt = (from: number): number => {
    const gt = html.indexOf(">", from);
    return gt === -1 ? html.length : gt + 1;
  };

  let pos = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  let textStart = pos;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    const next = html[lt + 1] ?? "";
    let end: number;
    if (html.startsWith("<!--", lt)) {
      // "<!-->" and "<!--->" close at once, and "--!>" closes like "-->", as in browsers. An
      // unclosed comment runs to the end.
      if (html.startsWith(">", lt + 4)) end = lt + 5;
      else if (html.startsWith("->", lt + 4)) end = lt + 6;
      else {
        COMMENT_END.lastIndex = lt + 4;
        const close = COMMENT_END.exec(html);
        end = close ? close.index + close[0].length : html.length;
      }
      pushText(textStart, lt, true);
    } else if (next === "!" || next === "?") {
      end = closeAt(lt + 2);
      pushText(textStart, lt, true);
      if (/^<!doctype/i.test(html.slice(lt, lt + 9))) {
        tokens.push({ type: "doctype", value: html.slice(lt + 9, html[end - 1] === ">" ? end - 1 : end).trim(), line: lineAt(lt) });
      }
    } else if (next === "/") {
      pushText(textStart, lt, true);
      if (ASCII_LETTER.test(html[lt + 2] ?? "")) {
        const tag = readTag(html, lt + 2);
        if (!tag) {
          textStart = html.length;
          break;
        }
        tokens.push({ type: "end", tag: tag.name, line: lineAt(lt) });
        end = tag.end;
      } else {
        end = closeAt(lt + 2);
      }
    } else if (ASCII_LETTER.test(next)) {
      const tag = readTag(html, lt + 1);
      if (!tag) {
        pushText(textStart, lt, true);
        textStart = html.length;
        break;
      }
      pushText(textStart, lt, true);
      tokens.push({ type: "start", tag: tag.name, attrs: tag.attrs, selfClosing: tag.selfClosing, line: lineAt(lt) });
      end = tag.end;
      const rawEnd = RAW_TEXT_END[tag.name];
      if (rawEnd) {
        rawEnd.lastIndex = end;
        const close = rawEnd.exec(html);
        const contentEnd = close ? close.index : html.length;
        pushText(end, contentEnd, DECODED_RAW_TEXT.has(tag.name));
        if (!close) {
          textStart = html.length;
          break;
        }
        tokens.push({ type: "end", tag: tag.name, line: lineAt(close.index) });
        end = closeAt(close.index);
      }
    } else {
      // A "<" that starts no markup is text.
      pos = lt + 1;
      continue;
    }
    pos = textStart = end;
  }
  pushText(textStart, html.length, true);
  return tokens;
}
