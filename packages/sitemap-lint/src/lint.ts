// Sitemap rules from the sitemaps.org protocol 0.9 (https://www.sitemaps.org/protocol.html).
// Pure and offline: it checks the file it is given and never fetches the URLs listed in it.

import { parseXml, type XmlElement } from "./xml.ts";

export const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
/** Protocol limits: entries per file, uncompressed bytes per file, characters per <loc>. */
export const MAX_ENTRIES = 50_000;
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_LOC_LENGTH = 2048;

const CHANGEFREQ_VALUES = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
const URL_FIELDS = ["loc", "lastmod", "changefreq", "priority"];
const INDEX_FIELDS = ["loc", "lastmod"];
// W3C Datetime (https://www.w3.org/TR/NOTE-datetime): YYYY, YYYY-MM, YYYY-MM-DD,
// YYYY-MM-DDThh:mmTZD, YYYY-MM-DDThh:mm:ssTZD or YYYY-MM-DDThh:mm:ss.sTZD.
const W3C_DATETIME = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2})))?)?)?$/;
// RFC 3986 s2: characters that must be percent-encoded in a URL. Non-ASCII included, since
// the protocol requires <loc> to be URL-escaped.
const NEEDS_ESCAPING = /[ \t\r\n<>"{}|\\^`\u0080-￿]/;

export type Severity = "error" | "warning";

export type RuleId =
  | "file-too-large"
  | "encoding-invalid"
  | "encoding-declared"
  | "xml-malformed"
  | "xml-doctype"
  | "root-unknown"
  | "root-namespace"
  | "entries-empty"
  | "entries-too-many"
  | "entry-wrong-type"
  | "element-unknown"
  | "element-repeated"
  | "loc-missing"
  | "loc-empty"
  | "loc-too-long"
  | "loc-invalid"
  | "loc-scheme"
  | "loc-unescaped"
  | "loc-duplicate"
  | "hosts-multiple"
  | "lastmod-invalid"
  | "changefreq-invalid"
  | "priority-invalid";

export interface SitemapFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based line in the file, when the finding belongs to one place. */
  line: number | null;
  /** 1-based position of the <url> or <sitemap> entry, when the finding belongs to one. */
  entry: number | null;
}

export interface SitemapResult {
  /** True when there are no errors. Warnings don't make a sitemap invalid. */
  valid: boolean;
  kind: "urlset" | "sitemapindex" | null;
  entryCount: number;
  /** Every <loc> that is a valid http(s) URL, in file order. */
  locs: string[];
  findings: SitemapFinding[];
  errorCount: number;
  warningCount: number;
}

type Report = (rule: RuleId, severity: Severity, message: string, line?: number | null, entry?: number | null) => void;

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Why a lastmod value is wrong, or null when it is valid W3C Datetime. */
function lastmodProblem(value: string): string | null {
  const m = W3C_DATETIME.exec(value);
  if (!m) return "isn't W3C Datetime (for example 2026-11-24 or 2026-11-24T09:30:00+00:00)";
  const [, y, mo, d, h, mi, s, tzh, tzm] = m.map((part) => (part === undefined ? undefined : Number(part)));
  const year = y as number;
  if (mo !== undefined && (mo < 1 || mo > 12)) return "has a month outside 01-12";
  if (d !== undefined && mo !== undefined && (d < 1 || d > daysInMonth(year, mo))) return "is not a real calendar date";
  if (h !== undefined && (h > 23 || (mi as number) > 59 || (s ?? 0) > 59)) return "has a time outside 00:00:00-23:59:59";
  if (tzh !== undefined && (tzh > 23 || (tzm as number) > 59)) return "has an impossible time zone offset";
  return null;
}

function checkLoc(el: XmlElement | undefined, entryLine: number, entry: number, report: Report, seen: Map<string, { line: number; entry: number }>, hosts: Set<string>, locs: string[]): void {
  if (!el) {
    report("loc-missing", "error", "Missing <loc>. Every entry needs one.", entryLine, entry);
    return;
  }
  const loc = el.text.trim();
  if (!loc) {
    report("loc-empty", "error", "<loc> is empty.", el.line, entry);
    return;
  }
  if (loc.length >= MAX_LOC_LENGTH) {
    report("loc-too-long", "error", `<loc> is ${loc.length} characters. The protocol requires fewer than ${MAX_LOC_LENGTH}.`, el.line, entry);
  }
  let url: URL;
  try {
    url = new URL(loc);
  } catch {
    report("loc-invalid", "error", `<loc> "${loc}" is not a valid absolute URL.`, el.line, entry);
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    report("loc-scheme", "error", `<loc> "${loc}" uses ${url.protocol}. Sitemap URLs must be http or https.`, el.line, entry);
    return;
  }
  if (NEEDS_ESCAPING.test(loc)) {
    report("loc-unescaped", "warning", `<loc> "${loc}" contains characters that must be percent-encoded (a space as %20, non-ASCII as UTF-8 bytes).`, el.line, entry);
  }
  const first = seen.get(loc);
  if (first) {
    report("loc-duplicate", "warning", `<loc> "${loc}" is already listed in entry ${first.entry} (line ${first.line}).`, el.line, entry);
  } else {
    seen.set(loc, { line: el.line, entry });
  }
  hosts.add(url.host);
  locs.push(loc);
}

function checkEntry(entry: XmlElement, index: number, fields: string[], ns: string | null, report: Report, state: { seen: Map<string, { line: number; entry: number }>; hosts: Set<string>; locs: string[] }): void {
  const found = new Map<string, XmlElement>();
  for (const child of entry.children) {
    if (child.namespace !== ns) continue; // extensions (image:, video:, news:, xhtml:) are not checked
    if (!fields.includes(child.localName)) {
      report("element-unknown", "warning", `<${child.name}> is not a sitemap element inside <${entry.name}>. Allowed: ${fields.map((f) => `<${f}>`).join(", ")}.`, child.line, index);
    } else if (found.has(child.localName)) {
      report("element-repeated", "warning", `<${child.name}> appears more than once. Only the first is used.`, child.line, index);
    } else {
      found.set(child.localName, child);
    }
  }

  checkLoc(found.get("loc"), entry.line, index, report, state.seen, state.hosts, state.locs);

  const lastmod = found.get("lastmod");
  const lastmodValue = lastmod?.text.trim();
  const problem = lastmodValue ? lastmodProblem(lastmodValue) : null;
  if (lastmod && problem) report("lastmod-invalid", "warning", `<lastmod> "${lastmodValue}" ${problem}.`, lastmod.line, index);

  const changefreq = found.get("changefreq");
  const changefreqValue = changefreq?.text.trim() ?? "";
  if (changefreq && !CHANGEFREQ_VALUES.includes(changefreqValue.toLowerCase())) {
    report("changefreq-invalid", "warning", `<changefreq> "${changefreqValue}" isn't one of: ${CHANGEFREQ_VALUES.join(", ")}.`, changefreq.line, index);
  }

  const priority = found.get("priority");
  const priorityValue = priority?.text.trim() ?? "";
  if (priority && (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(priorityValue) || Number(priorityValue) > 1)) {
    report("priority-invalid", "warning", `<priority> "${priorityValue}" should be a number from 0.0 to 1.0.`, priority.line, index);
  }
}

/** Lints a sitemap or sitemap index. Pass bytes to have UTF-8 validity checked too. */
export function lintSitemap(input: string | Uint8Array): SitemapResult {
  const findings: SitemapFinding[] = [];
  const report: Report = (rule, severity, message, line = null, entry = null) => findings.push({ rule, severity, message, line, entry });
  const finish = (kind: SitemapResult["kind"], entryCount: number, locs: string[]): SitemapResult => {
    const errorCount = findings.filter((f) => f.severity === "error").length;
    return { valid: errorCount === 0, kind, entryCount, locs, findings, errorCount, warningCount: findings.length - errorCount };
  };

  const bytes = typeof input === "string" ? utf8Length(input) : input.byteLength;
  if (bytes > MAX_BYTES) {
    report("file-too-large", "error", `The file is ${(bytes / (1024 * 1024)).toFixed(1)} MB uncompressed. The protocol limit is 50 MB: split it and list the parts in a sitemap index.`);
  }

  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      report("encoding-invalid", "error", "The file is not valid UTF-8. The protocol requires UTF-8.");
      return finish(null, 0, []);
    }
  }

  const parsed = parseXml(text);
  if (!parsed.ok) {
    report("xml-malformed", "error", `Not well-formed XML: ${parsed.error}`, parsed.line);
    return finish(null, 0, []);
  }
  const { root } = parsed;
  if (parsed.doctype) report("xml-doctype", "warning", "The file has a DOCTYPE. Sitemaps don't use one, and it was ignored.", 1);
  if (parsed.declaredEncoding && parsed.declaredEncoding.toLowerCase() !== "utf-8") {
    report("encoding-declared", "warning", `The XML declaration says encoding="${parsed.declaredEncoding}". The protocol requires UTF-8.`, 1);
  }

  if (root.localName !== "urlset" && root.localName !== "sitemapindex") {
    report("root-unknown", "error", `The root element is <${root.name}>. Expected <urlset> (a sitemap) or <sitemapindex> (a sitemap index).`, root.line);
    return finish(null, 0, []);
  }
  const kind = root.localName;
  if (root.namespace !== SITEMAP_NAMESPACE) {
    report("root-namespace", "warning", `<${root.name}> is in namespace "${root.namespace ?? "(none)"}". Search engines expect xmlns="${SITEMAP_NAMESPACE}".`, root.line);
  }

  const entryTag = kind === "urlset" ? "url" : "sitemap";
  const wrongTag = kind === "urlset" ? "sitemap" : "url";
  const ns = root.namespace;
  const entries: XmlElement[] = [];
  for (const child of root.children) {
    if (child.namespace !== ns) continue;
    if (child.localName === entryTag) entries.push(child);
    else if (child.localName === wrongTag) {
      report("entry-wrong-type", "error", `<${child.name}> belongs in a ${wrongTag === "url" ? "<urlset>" : "<sitemapindex>"}, not in <${root.name}>.`, child.line);
    } else {
      report("element-unknown", "warning", `<${child.name}> is not allowed directly inside <${root.name}>.`, child.line);
    }
  }

  if (entries.length === 0) {
    report("entries-empty", "error", `<${root.name}> has no <${entryTag}> entries.`, root.line);
    return finish(kind, 0, []);
  }
  if (entries.length > MAX_ENTRIES) {
    report("entries-too-many", "error", `${entries.length} <${entryTag}> entries. The protocol limit is ${MAX_ENTRIES} per file: split it and list the parts in a sitemap index.`, root.line);
  }

  const state = { seen: new Map<string, { line: number; entry: number }>(), hosts: new Set<string>(), locs: [] as string[] };
  const fields = kind === "urlset" ? URL_FIELDS : INDEX_FIELDS;
  entries.forEach((entry, i) => checkEntry(entry, i + 1, fields, ns, report, state));

  if (state.hosts.size > 1) {
    const list = [...state.hosts].slice(0, 5).join(", ");
    report("hosts-multiple", "warning", `Entries span ${state.hosts.size} hosts (${list}${state.hosts.size > 5 ? ", ..." : ""}). A sitemap normally lists URLs from the host it is served on.`);
  }

  return finish(kind, entries.length, state.locs);
}
