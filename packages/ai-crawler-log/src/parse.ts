// Access log lines to request records. NCSA Common and Combined are read field by field with a
// scanner rather than one large regular expression, so a hostile line can't cause backtracking;
// JSON lines go through JSON.parse. Nothing here throws on bad input: a line that can't be read
// is null.

/** "auto" reads a line starting with "{" as JSON and anything else as Common or Combined. */
export type LogFormat = "auto" | "combined" | "common" | "json";

export const LOG_FORMATS: readonly LogFormat[] = ["auto", "combined", "common", "json"];

export interface LogEntry {
  /** The client address as logged; may be a hostname or "-" when the server logs one. */
  ip: string | null;
  /** When the request was received, in milliseconds since the epoch. */
  time: number | null;
  method: string | null;
  /** The request target as logged, query included; null when the request line was unreadable. */
  target: string | null;
  status: number | null;
  /** Response bytes; Common Log Format's "-" (no body) is 0. */
  bytes: number | null;
  userAgent: string | null;
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const CLF_TIME = /^(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

// Consecutive log lines mostly share their second, so the last result is kept.
let lastClfText = "";
let lastClfTime: number | null = null;

/** "10/Oct/2000:13:55:36 -0700", the Common Log Format time (Apache %t, nginx $time_local). */
function parseClfTime(text: string): number | null {
  if (text === lastClfText) return lastClfTime;
  const m = CLF_TIME.exec(text);
  let time: number | null = null;
  if (m && MONTHS[m[2]] !== undefined) {
    const offset = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === "-" ? -1 : 1);
    time = Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offset * 60_000;
  }
  lastClfText = text;
  lastClfTime = time;
  return time;
}

// Epoch numbers come in seconds (Caddy "ts", nginx $msec), milliseconds, or nanoseconds
// (Cloudflare's default "unixnano"); the magnitude tells them apart for any date after 1973.
function epochToMs(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e17) return Math.round(n / 1e6);
  if (n >= 1e14) return Math.round(n / 1e3);
  if (n >= 1e11) return Math.round(n);
  return Math.round(n * 1000);
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number") return epochToMs(value);
  if (typeof value !== "string" || value.length > 64) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return epochToMs(Number(value));
  const clf = parseClfTime(value);
  if (clf !== null) return clf;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function parseStatus(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

function parseBytes(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", v: "\v", f: "\f", b: "\b" };

const UTF8 = new TextDecoder();

/** Escaped bytes (one character each, 0 to 255) as the UTF-8 text they encode; text with wider characters is left as is. */
function utf8FromBytes(text: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) return text;
    bytes[i] = c;
  }
  return UTF8.decode(bytes);
}

/**
 * Reads a quoted field starting at `start` (the opening quote). Apache escapes `"` and `\` with a
 * backslash and other bytes as \xhh; nginx escapes all three as \xXX. Both escape every byte of a
 * non-ASCII character, so escaped bytes are decoded as UTF-8. Returns the unescaped value and the
 * index after the closing quote, or null when the quote never closes.
 */
function readQuoted(line: string, start: number): { value: string; end: number } | null {
  let value = "";
  let from = start + 1;
  let highBytes = false;
  for (let i = from; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 34) {
      value += line.slice(from, i);
      return { value: highBytes ? utf8FromBytes(value) : value, end: i + 1 };
    }
    if (c !== 92) continue;
    value += line.slice(from, i);
    const next = line[i + 1];
    if (next === "x" && /^[0-9a-fA-F]{2}$/.test(line.slice(i + 2, i + 4))) {
      const byte = parseInt(line.slice(i + 2, i + 4), 16);
      value += String.fromCharCode(byte);
      highBytes ||= byte > 0x7f;
      i += 3;
    } else if (next !== undefined) {
      value += ESCAPES[next] ?? next;
      i += 1;
    }
    from = i + 1;
  }
  return null;
}

/** "GET /path HTTP/1.1" to method and target; anything else (TLS bytes, "-") gives nulls. */
function splitRequestLine(request: string): { method: string | null; target: string | null } {
  const first = request.indexOf(" ");
  const second = request.indexOf(" ", first + 1);
  const end = second === -1 ? request.length : second;
  const method = request.slice(0, first);
  if (first < 1 || end === first + 1 || request.includes(" ", end + 1) || !/^[A-Z]{1,20}$/.test(method)) return { method: null, target: null };
  return { method, target: request.slice(first + 1, end) };
}

function nextSpace(line: string, from: number): number {
  const i = line.indexOf(" ", from);
  return i === -1 ? line.length : i;
}

/** NCSA Common (`%h %l %u %t "%r" %>s %b`) or Combined (plus `"%{Referer}i" "%{User-agent}i"`). Extra fields after them are ignored. */
function parseNcsa(line: string, format: "auto" | "combined" | "common"): LogEntry | null {
  const hostEnd = nextSpace(line, 0);
  const ip = line.slice(0, hostEnd);
  // %l and %u: "-" in practice. The time is the next "[...]" field.
  const open = line.indexOf(" [", hostEnd);
  if (hostEnd === 0 || open === -1) return null;
  const close = line.indexOf("] ", open);
  if (close === -1 || close - open > 40) return null;
  const time = parseClfTime(line.slice(open + 2, close));
  if (time === null || line[close + 2] !== '"') return null;
  const request = readQuoted(line, close + 2);
  if (!request || line[request.end] !== " ") return null;

  const statusEnd = nextSpace(line, request.end + 1);
  const status = parseStatus(line.slice(request.end + 1, statusEnd));
  const bytesEnd = nextSpace(line, statusEnd + 1);
  const bytesText = line.slice(statusEnd + 1, bytesEnd);
  const bytes = bytesText === "-" ? 0 : parseBytes(bytesText);
  if (status === null || bytes === null) return null;

  let userAgent: string | null = null;
  if (format !== "common") {
    const referer = line[bytesEnd + 1] === '"' ? readQuoted(line, bytesEnd + 1) : null;
    const ua = referer && line[referer.end] === " " && line[referer.end + 1] === '"' ? readQuoted(line, referer.end + 1) : null;
    if (ua) userAgent = ua.value === "-" ? null : ua.value;
    else if (format === "combined") return null;
  }
  return { ip: ip === "-" ? null : ip, time, ...splitRequestLine(request.value), status, bytes, userAgent };
}

/** The value at a dotted path such as "request.client_ip", or undefined. */
function field(record: Record<string, unknown>, path: string): unknown {
  let value: unknown = record;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function first(record: Record<string, unknown>, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = field(record, path);
    if (value !== undefined && value !== null && value !== "" && value !== "-") return value;
  }
  return undefined;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

// Field names, in order of preference. Cloudflare Logpush http_requests fields; Caddy's
// structured access log; nginx variables written with their own names into a JSON log_format.
const JSON_FIELDS = {
  ip: ["ClientIP", "request.client_ip", "request.remote_ip", "remote_addr"],
  time: ["EdgeStartTimestamp", "ts", "time_iso8601", "time_local", "msec"],
  method: ["ClientRequestMethod", "request.method", "request_method"],
  target: ["ClientRequestURI", "ClientRequestPath", "request.uri", "request_uri", "uri"],
  status: ["EdgeResponseStatus", "status"],
  bytes: ["EdgeResponseBytes", "size", "body_bytes_sent", "bytes_sent"],
  userAgent: ["ClientRequestUserAgent", "http_user_agent"],
} as const;

function parseJson(line: string): LogEntry | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  const r = record as Record<string, unknown>;

  let method = text(first(r, JSON_FIELDS.method));
  let target = text(first(r, JSON_FIELDS.target));
  // nginx's $request is the whole request line, as in Combined.
  const request = text(field(r, "request"));
  if (request !== null && (method === null || target === null)) {
    const split = splitRequestLine(request);
    method ??= split.method;
    target ??= split.target;
  }
  const status = parseStatus(first(r, JSON_FIELDS.status));
  if (target === null && status === null) return null;

  // Caddy logs request headers as arrays of values.
  const caddyUa = field(r, "request.headers.User-Agent");
  const userAgent = text(first(r, JSON_FIELDS.userAgent)) ?? (Array.isArray(caddyUa) ? text(caddyUa[0]) : null);
  return {
    ip: text(first(r, JSON_FIELDS.ip)),
    time: parseTime(first(r, JSON_FIELDS.time)),
    method,
    target,
    status,
    bytes: parseBytes(first(r, JSON_FIELDS.bytes)),
    userAgent,
  };
}

/** Reads one access log line, or returns null when it isn't one in `format`. Never throws. */
export function parseLogLine(line: string, format: LogFormat = "auto"): LogEntry | null {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (trimmed === "") return null;
  if (format === "json" || (format === "auto" && trimmed[0] === "{")) return parseJson(trimmed);
  return parseNcsa(trimmed, format);
}
