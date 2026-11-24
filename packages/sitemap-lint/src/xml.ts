// A small, strict XML reader for sitemap files. It checks well-formedness (XML 1.0 and
// Namespaces in XML 1.0) and builds an element tree with line numbers, so every finding can
// point at a line.
//
// Deliberately limited:
// - No DTD processing. A DOCTYPE is skipped and reported, and only the five predefined
//   entities and numeric character references are expanded. External entities (XXE) and
//   entity expansion attacks ("billion laughs") are impossible by construction.
// - Not a general XML parser: no validation against a schema, and no support for encodings
//   other than the string it is given (sitemaps must be UTF-8; see lint.ts).

export interface XmlElement {
  /** Qualified name as written, e.g. "url" or "image:image". */
  name: string;
  localName: string;
  /** Namespace URI, or null when the element is in no namespace. */
  namespace: string | null;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Character data of direct text and CDATA content, entities decoded. */
  text: string;
  line: number;
}

export type XmlParseResult =
  | { ok: true; root: XmlElement; doctype: boolean; declaredEncoding: string | null }
  | { ok: false; error: string; line: number };

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// XML 1.0 s2.2 Char: tab, LF and CR are the only C0 controls allowed; U+FFFE and U+FFFF never.
const INVALID_CHAR = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/;
const NAME = /[A-Za-z_:À-�][-\w.:·À-�]*/y;
const SPACE = /[ \t\r\n]*/y;
const REFERENCE = /&(?:([A-Za-z_][\w.-]*)|#([0-9]+)|#x([0-9A-Fa-f]+));/y;

class XmlSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

function isAllowedCodePoint(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}

function checkChars(raw: string, pos: number): void {
  const bad = INVALID_CHAR.exec(raw);
  if (bad) {
    const code = bad[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new XmlSyntaxError(`Control character U+${code} is not allowed in XML. Remove it.`, pos + bad.index);
  }
}

/** Decodes entity and character references in text or an attribute value starting at `pos`. */
function decode(raw: string, pos: number): string {
  checkChars(raw, pos);
  if (!raw.includes("&")) return raw;
  let out = "";
  let last = 0;
  for (let amp = raw.indexOf("&"); amp !== -1; amp = raw.indexOf("&", last)) {
    REFERENCE.lastIndex = amp;
    const m = REFERENCE.exec(raw);
    if (!m) {
      throw new XmlSyntaxError("Unescaped \"&\". Write it as &amp; (common in URLs with query strings).", pos + amp);
    }
    let value: string;
    if (m[1] !== undefined) {
      if (!(m[1] in PREDEFINED)) {
        throw new XmlSyntaxError(`Undefined entity &${m[1]};. Only &amp; &lt; &gt; &quot; &apos; and numeric references can be used.`, pos + amp);
      }
      value = PREDEFINED[m[1]];
    } else {
      const cp = parseInt(m[2] ?? m[3], m[2] !== undefined ? 10 : 16);
      if (!isAllowedCodePoint(cp)) throw new XmlSyntaxError(`Character reference ${m[0]} is not a character allowed in XML.`, pos + amp);
      value = String.fromCodePoint(cp);
    }
    out += raw.slice(last, amp) + value;
    last = REFERENCE.lastIndex;
  }
  return out + raw.slice(last);
}

interface Frame {
  el: XmlElement;
  scope: Map<string, string | null>;
}

export function parseXml(input: string): XmlParseResult {
  // Line numbers are counted incrementally: element positions only move forward. The next
  // newline is remembered, so a long single-line file isn't rescanned for every element.
  let line = 1;
  let nextNewline = input.indexOf("\n");
  const lineAt = (pos: number): number => {
    while (nextNewline !== -1 && nextNewline < pos) {
      line++;
      nextNewline = input.indexOf("\n", nextNewline + 1);
    }
    return line;
  };
  const errorLine = (pos: number): number => input.slice(0, pos).split("\n").length;

  const expectName = (pos: number, what: string): string => {
    NAME.lastIndex = pos;
    const m = NAME.exec(input);
    if (!m) throw new XmlSyntaxError(`Expected ${what} name.`, pos);
    return m[0];
  };
  const skipSpace = (pos: number): number => {
    SPACE.lastIndex = pos;
    SPACE.exec(input);
    return SPACE.lastIndex;
  };

  const len = input.length;
  const start = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: Frame[] = [];
  const rootScope = new Map<string, string | null>([["xml", XML_NAMESPACE], ["", null]]);
  let root = null as XmlElement | null;
  let doctype = false;
  let declaredEncoding: string | null = null;
  let pos = start;

  try {
    while (pos < len) {
      const lt = input.indexOf("<", pos);
      const textEnd = lt === -1 ? len : lt;
      if (textEnd > pos) {
        const raw = input.slice(pos, textEnd);
        const top = stack[stack.length - 1];
        if (top) top.el.text += decode(raw, pos);
        else if (/[^ \t\r\n]/.test(raw)) {
          throw new XmlSyntaxError(root ? "Text after the root element." : "Text before the root element.", pos + raw.search(/[^ \t\r\n]/));
        }
      }
      if (lt === -1) break;
      pos = lt;

      if (input.startsWith("<?", pos)) {
        const end = input.indexOf("?>", pos + 2);
        if (end === -1) throw new XmlSyntaxError("Unterminated processing instruction: missing \"?>\".", pos);
        const body = input.slice(pos + 2, end);
        if (/^xml[ \t\r\n]/.test(body)) {
          if (pos !== start) throw new XmlSyntaxError("The XML declaration must be at the very start of the file.", pos);
          declaredEncoding = /encoding[ \t\r\n]*=[ \t\r\n]*["']([^"']*)["']/.exec(body)?.[1] ?? null;
        }
        pos = end + 2;
      } else if (input.startsWith("<!--", pos)) {
        const end = input.indexOf("-->", pos + 4);
        if (end === -1) throw new XmlSyntaxError("Unterminated comment: missing \"-->\".", pos);
        pos = end + 3;
      } else if (input.startsWith("<![CDATA[", pos)) {
        const top = stack[stack.length - 1];
        if (!top) throw new XmlSyntaxError("CDATA section outside the root element.", pos);
        const end = input.indexOf("]]>", pos + 9);
        if (end === -1) throw new XmlSyntaxError("Unterminated CDATA section: missing \"]]>\".", pos);
        const raw = input.slice(pos + 9, end);
        checkChars(raw, pos + 9);
        top.el.text += raw;
        pos = end + 3;
      } else if (input.startsWith("<!DOCTYPE", pos)) {
        if (root || stack.length) throw new XmlSyntaxError("A DOCTYPE must come before the root element.", pos);
        pos = skipDoctype(input, pos);
        doctype = true;
      } else if (input.startsWith("<!", pos)) {
        throw new XmlSyntaxError("Unexpected markup declaration.", pos);
      } else if (input.startsWith("</", pos)) {
        const name = expectName(pos + 2, "closing tag");
        const after = skipSpace(pos + 2 + name.length);
        if (input[after] !== ">") throw new XmlSyntaxError(`Expected ">" to end </${name}>.`, after);
        const top = stack.pop();
        if (!top) throw new XmlSyntaxError(`Closing tag </${name}> has no matching opening tag.`, pos);
        if (top.el.name !== name) {
          throw new XmlSyntaxError(`Expected </${top.el.name}> (opened on line ${top.el.line}) but found </${name}>.`, pos);
        }
        pos = after + 1;
      } else {
        if (root && stack.length === 0) throw new XmlSyntaxError("A second root element. An XML file has exactly one root element.", pos);
        pos = readStartTag(pos);
      }
    }
    const open = stack[stack.length - 1];
    if (open) throw new XmlSyntaxError(`<${open.el.name}> (opened on line ${open.el.line}) is never closed.`, len);
    if (!root) throw new XmlSyntaxError("No root element.", len);
    return { ok: true, root, doctype, declaredEncoding };
  } catch (error) {
    if (error instanceof XmlSyntaxError) return { ok: false, error: error.message, line: errorLine(error.pos) };
    throw error;
  }

  function readStartTag(lt: number): number {
    const name = expectName(lt + 1, "element");
    let p = lt + 1 + name.length;
    const attributes: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      const afterSpace = skipSpace(p);
      if (input.startsWith("/>", afterSpace)) {
        selfClosing = true;
        p = afterSpace + 2;
        break;
      }
      if (input[afterSpace] === ">") {
        p = afterSpace + 1;
        break;
      }
      if (afterSpace >= len) throw new XmlSyntaxError(`Unterminated start tag <${name}>.`, lt);
      if (afterSpace === p) throw new XmlSyntaxError(`Expected a space, ">" or "/>" in <${name}>.`, p);
      const attr = expectName(afterSpace, "attribute");
      let q = skipSpace(afterSpace + attr.length);
      if (input[q] !== "=") throw new XmlSyntaxError(`Attribute ${attr} needs a value: ${attr}="...".`, q);
      q = skipSpace(q + 1);
      const quote = input[q];
      if (quote !== '"' && quote !== "'") throw new XmlSyntaxError(`The value of ${attr} must be in quotes.`, q);
      const close = input.indexOf(quote, q + 1);
      if (close === -1) throw new XmlSyntaxError(`Unterminated value for attribute ${attr}.`, q);
      const raw = input.slice(q + 1, close);
      const angle = raw.indexOf("<");
      if (angle !== -1) throw new XmlSyntaxError(`"<" is not allowed in an attribute value. Write it as &lt;.`, q + 1 + angle);
      if (attr in attributes) throw new XmlSyntaxError(`Attribute ${attr} appears twice in <${name}>.`, afterSpace);
      attributes[attr] = decode(raw, q + 1);
      p = close + 1;
    }

    const parent = stack[stack.length - 1];
    let scope = parent?.scope ?? rootScope;
    for (const [attr, value] of Object.entries(attributes)) {
      if (attr !== "xmlns" && !attr.startsWith("xmlns:")) continue;
      if (scope === (parent?.scope ?? rootScope)) scope = new Map(scope);
      scope.set(attr === "xmlns" ? "" : attr.slice(6), value === "" ? null : value);
    }
    const resolve = (qname: string, isElement: boolean): string | null => {
      const parts = qname.split(":");
      if (parts.length > 2 || parts.some((part) => part === "")) throw new XmlSyntaxError(`"${qname}" is not a valid namespaced name.`, lt);
      if (parts.length === 1) return isElement ? (scope.get("") ?? null) : null;
      if (!scope.has(parts[0])) throw new XmlSyntaxError(`Namespace prefix "${parts[0]}" in "${qname}" is not declared.`, lt);
      return scope.get(parts[0]) ?? null;
    };
    for (const attr of Object.keys(attributes)) {
      if (attr !== "xmlns" && !attr.startsWith("xmlns:")) resolve(attr, false);
    }

    const el: XmlElement = {
      name,
      localName: name.includes(":") ? name.slice(name.indexOf(":") + 1) : name,
      namespace: resolve(name, true),
      attributes,
      children: [],
      text: "",
      line: lineAt(lt),
    };
    if (parent) parent.el.children.push(el);
    else root = el;
    if (!selfClosing) stack.push({ el, scope });
    return p;
  }
}

// Skips <!DOCTYPE ...>, including an internal subset in [...] and quoted strings. Nothing in
// it is processed.
function skipDoctype(input: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let i = start + 9; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ">" && depth <= 0) return i + 1;
  }
  throw new XmlSyntaxError("Unterminated DOCTYPE.", start);
}
