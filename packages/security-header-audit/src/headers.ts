// Turns the header shapes callers actually have into the one shape the rules read: a plain
// object with lower-cased names, where a header sent more than once becomes one value joined
// with ", " (RFC 9110 s5.3 treats a repeated field and one comma-separated field as equivalent).

/** A header value as Node's `IncomingHttpHeaders` and similar objects hold it. */
export type HeaderValue = string | number | readonly string[] | undefined | null;

/**
 * Anything that holds response headers: a fetch `Headers` object, a plain object (Node's
 * `res.headers`, Axios, a test fixture), or an iterable of `[name, value]` pairs.
 */
export type HeaderInput = Headers | Iterable<readonly [string, string]> | Readonly<Record<string, HeaderValue>>;

/** Lower-cased header name to value. Repeated headers are joined with ", ". */
export type NormalizedHeaders = Record<string, string>;

function isIterable(input: unknown): input is Iterable<readonly [string, string]> {
  return typeof (input as Iterable<unknown>)?.[Symbol.iterator] === "function";
}

function add(out: NormalizedHeaders, name: string, value: string): void {
  const key = name.trim().toLowerCase();
  if (!key) return;
  const trimmed = value.trim();
  out[key] = key in out ? `${out[key]}, ${trimmed}` : trimmed;
}

/** Normalizes any supported header input. Names are case-insensitive; null/undefined values are dropped. */
export function normalizeHeaders(input: HeaderInput): NormalizedHeaders {
  const out: NormalizedHeaders = {};
  if (isIterable(input)) {
    for (const [name, value] of input) add(out, name, value);
    return out;
  }
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) add(out, name, String(v));
    else add(out, name, String(value));
  }
  return out;
}

/**
 * Parses a raw HTTP/1.x header block, such as the output of `curl -sI` or `curl -sIL`.
 * When the text holds several responses (redirects, `100 Continue`), only the last one is read,
 * because that is the response a browser renders. Text with no status line is read as plain
 * `Name: value` lines. Obsolete line folding (RFC 9112 s5.2) is joined with a single space.
 */
export function parseRawHeaders(text: string): NormalizedHeaders {
  const lines = text.split(/\r?\n/);
  let start = 0;
  lines.forEach((line, i) => {
    if (/^HTTP\/\d(\.\d)?\s+\d{3}/i.test(line)) start = i + 1;
  });

  const pairs: [string, string][] = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === "") {
      if (pairs.length) break;
      continue;
    }
    const last = pairs[pairs.length - 1];
    if (/^[ \t]/.test(line) && last) {
      last[1] = `${last[1]} ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    pairs.push([line.slice(0, colon), line.slice(colon + 1)]);
  }
  return normalizeHeaders(pairs);
}
