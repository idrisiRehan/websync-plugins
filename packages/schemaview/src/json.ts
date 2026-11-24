// A strict JSON parser (RFC 8259, the grammar JSON.parse accepts) that keeps the line of
// every value. JSON.parse can't report where a property is, and its error messages differ
// between engines, so findings could not point at a line without this.

export type JsonNode =
  | { kind: "object"; line: number; props: Map<string, JsonNode> }
  | { kind: "array"; line: number; items: JsonNode[] }
  | { kind: "string"; line: number; value: string }
  | { kind: "number"; line: number; value: number }
  | { kind: "boolean"; line: number; value: boolean }
  | { kind: "null"; line: number };

export type JsonObject = Extract<JsonNode, { kind: "object" }>;

export type JsonParseResult =
  | { ok: true; value: JsonNode; duplicateKeys: { key: string; line: number }[] }
  | { ok: false; error: string; line: number };

const MAX_DEPTH = 512;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class JsonError extends Error {}

/** Parses `text`, numbering lines from `firstLine` (the line the text starts on in its file). */
export function parseJson(text: string, firstLine = 1): JsonParseResult {
  let pos = 0;
  let line = firstLine;
  const duplicateKeys: { key: string; line: number }[] = [];

  const fail = (message: string): never => {
    throw new JsonError(message);
  };
  const describe = (c: string | undefined): string => (c === undefined ? "the end of the input" : `"${c}"`);

  const skipSpace = (): void => {
    for (; pos < text.length; pos++) {
      const c = text[pos];
      if (c === "\n") line++;
      else if (c !== " " && c !== "\t" && c !== "\r") return;
    }
  };

  const unexpected = (): never => {
    const c = text[pos];
    if (c === undefined) return fail("Unexpected end of input (a missing } or ]?).");
    if (c === "'") return fail("Strings must use double quotes, not single quotes.");
    if (c === "/") return fail("JSON doesn't allow comments.");
    return fail(`Unexpected ${describe(c)}.`);
  };

  const parseString = (): string => {
    pos++; // opening quote
    let out = "";
    let start = pos;
    for (;;) {
      if (pos >= text.length) fail("Unterminated string (a missing closing quote?).");
      const c = text.charCodeAt(pos);
      if (c === 0x22) break;
      if (c < 0x20) fail(c === 0x0a || c === 0x0d ? "Unescaped line break inside a string. Write it as \\n." : "Unescaped control character inside a string.");
      if (c !== 0x5c) {
        pos++;
        continue;
      }
      out += text.slice(start, pos);
      const e = text[pos + 1];
      if (e === "u") {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape in a string (it needs four hex digits).");
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
      } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
        out += ESCAPES[e];
        pos += 2;
      } else {
        fail(`Invalid escape "\\${e ?? ""}" in a string.`);
      }
      start = pos;
    }
    out += text.slice(start, pos);
    pos++; // closing quote
    return out;
  };

  const parseValue = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail(`Nested more than ${MAX_DEPTH} levels deep.`);
    skipSpace();
    const at = line;
    const c = text[pos];
    if (c === "{") {
      pos++;
      const props = new Map<string, JsonNode>();
      skipSpace();
      if (text[pos] === "}") {
        pos++;
        return { kind: "object", line: at, props };
      }
      for (;;) {
        skipSpace();
        if (text[pos] !== '"') {
          if (text[pos] === "}") fail('Trailing comma before "}". JSON doesn\'t allow one.');
          if (/[A-Za-z_$@]/.test(text[pos] ?? "")) fail("Property names must be in double quotes.");
          unexpected();
        }
        const keyLine = line;
        const key = parseString();
        skipSpace();
        if (text[pos] !== ":") fail(`Expected ":" after the property name "${key}".`);
        pos++;
        const value = parseValue(depth + 1);
        // JSON.parse keeps the last value of a repeated key, so this does too.
        if (props.has(key)) duplicateKeys.push({ key, line: keyLine });
        props.set(key, value);
        skipSpace();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          return { kind: "object", line: at, props };
        }
        if (text[pos] === undefined) unexpected();
        fail(`Expected "," or "}" after the value of "${key}" (a missing comma?).`);
      }
    }
    if (c === "[") {
      pos++;
      const items: JsonNode[] = [];
      skipSpace();
      if (text[pos] === "]") {
        pos++;
        return { kind: "array", line: at, items };
      }
      for (;;) {
        skipSpace();
        if (text[pos] === "]") fail('Trailing comma before "]". JSON doesn\'t allow one.');
        items.push(parseValue(depth + 1));
        skipSpace();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          return { kind: "array", line: at, items };
        }
        if (text[pos] === undefined) unexpected();
        fail('Expected "," or "]" after an array item (a missing comma?).');
      }
    }
    if (c === '"') return { kind: "string", line: at, value: parseString() };
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) {
      NUMBER.lastIndex = pos;
      const m = NUMBER.exec(text);
      if (!m) fail("Invalid number.");
      pos = NUMBER.lastIndex;
      return { kind: "number", line: at, value: Number(m![0]) };
    }
    if (text.startsWith("true", pos) || text.startsWith("false", pos)) {
      const value = c === "t";
      pos += value ? 4 : 5;
      return { kind: "boolean", line: at, value };
    }
    if (text.startsWith("null", pos)) {
      pos += 4;
      return { kind: "null", line: at };
    }
    return unexpected();
  };

  try {
    const value = parseValue(0);
    skipSpace();
    if (pos < text.length) {
      fail(text[pos] === "{" || text[pos] === "[" ? "A second JSON value follows the first. Put several items in one array or in @graph." : `Unexpected ${describe(text[pos])} after the end of the JSON.`);
    }
    return { ok: true, value, duplicateKeys };
  } catch (error) {
    if (error instanceof JsonError) return { ok: false, error: error.message, line };
    throw error;
  }
}
