// robots.txt rules from RFC 9309 (https://www.rfc-editor.org/rfc/rfc9309.html) and Google's reading
// of it (https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt), both
// checked 2026-11-24, plus the leniencies of Google's open-source parser where noted
// (https://github.com/google/robotstxt/blob/master/robots.cc). One pass over the lines parses the
// groups and reports line-level findings; checks across groups run on the parsed result. Pure and
// offline.

import { decide, matchesEverything, normalize, productToken, selectGroups } from "./match.ts";

export type Severity = "error" | "warning";

export type RuleId =
  | "file-html"
  | "file-too-large"
  | "location-invalid"
  | "line-invalid"
  | "colon-missing"
  | "directive-misspelled"
  | "directive-unsupported"
  | "rule-outside-group"
  | "user-agent-invalid"
  | "path-invalid"
  | "sitemap-invalid"
  | "group-duplicate"
  | "rule-conflict"
  | "disallow-all"
  | "resources-blocked";

export interface RobotsRule {
  type: "allow" | "disallow";
  /** The path pattern as written. An empty pattern matches nothing. */
  pattern: string;
  /** 1-based line. */
  line: number;
}

export interface RobotsGroup {
  /**
   * The user-agent values, as written. Matching reads the product token from each the way Google's
   * parser does, so "Googlebot/2.1" matches Googlebot. "*" is the group for every other crawler.
   */
  agents: string[];
  /** 1-based line of the group's first user-agent line. */
  line: number;
  rules: RobotsRule[];
}

export interface RobotsSitemap {
  /** As written. Only absolute http and https URLs are listed. */
  url: string;
  line: number;
}

export interface RobotsTxtFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based line in the file, when the finding belongs to one place. */
  line: number | null;
}

export interface RobotsTxtResult {
  /** True when there are no errors. Warnings don't make a file invalid. */
  valid: boolean;
  errorCount: number;
  warningCount: number;
  /** Sorted by line. */
  findings: RobotsTxtFinding[];
  /** In file order. Groups that name the same agent are listed separately; matching merges them. */
  groups: RobotsGroup[];
  sitemaps: RobotsSitemap[];
}

export interface LintOptions {
  /** The URL crawlers request the file from. It is checked to be /robots.txt at the root of a host. */
  url?: string;
}

type Field = "user-agent" | "allow" | "disallow" | "sitemap";
type Report = (rule: RuleId, severity: Severity, message: string, line: number | null) => void;

const NAMES: Record<Field, string> = { "user-agent": "User-agent", allow: "Allow", disallow: "Disallow", sitemap: "Sitemap" };

// Google's parser takes any field name that starts with one of these, ignoring case, in this
// order. The spellings after the first of each field are typos it accepts on purpose
// (robots.cc, KeyIsUserAgent and the three functions after it). "allow" has none.
const GOOGLE_FIELDS: readonly (readonly [string, Field])[] = [
  ["user-agent", "user-agent"],
  ["useragent", "user-agent"],
  ["user agent", "user-agent"],
  ["allow", "allow"],
  ["disallow", "disallow"],
  ["dissallow", "disallow"],
  ["dissalow", "disallow"],
  ["disalow", "disallow"],
  ["diasllow", "disallow"],
  ["disallaw", "disallow"],
  ["sitemap", "sitemap"],
  ["site-map", "sitemap"],
];

// Google: "Google enforces a robots.txt file size limit of 500 kibibytes (KiB)."
const GOOGLE_LIMIT = 500 * 1024;
const HTML_START = /^\s*<(?:!doctype\s+html|html|head|body)[\s>]/i;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const CSS_JS = /\.(?:css|js)(?:$|[$*?])/;
// resources-blocked tests one URL per matching rule against the whole group. The cap keeps a
// file with thousands of such rules linear.
const MAX_RESOURCE_PROBES = 100;

function googleField(key: string): Field | null {
  const lower = key.toLowerCase();
  for (const [prefix, field] of GOOGLE_FIELDS) if (lower.startsWith(prefix)) return field;
  return null;
}

/** Optimal string alignment distance, enough to catch typos like "Dsallow" or "User-agnet". */
function editDistance(a: string, b: string): number {
  // Three rolling rows of the distance table: two rows back, the previous row and the current one.
  let before = new Uint8Array(b.length + 1);
  let previous = Uint8Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Uint8Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], before[j - 2] + 1);
    }
    [before, previous, current] = [previous, current, before];
  }
  return previous[b.length];
}

/** A field name close to a known one that no parser we know of accepts. One edit for "allow", two for the longer names. */
function nearMiss(key: string): Field | null {
  const lower = key.toLowerCase();
  for (const field of Object.keys(NAMES) as Field[]) {
    const max = field.length <= 5 ? 1 : 2;
    // The length check skips the distance table for names that can't be close.
    if (Math.abs(lower.length - field.length) <= max && editDistance(lower, field) <= max) return field;
  }
  return null;
}

/** Quotes a value for a message, shortened so a long one doesn't bury the explanation. */
function quote(value: string): string {
  return `"${value.length > 80 ? `${value.slice(0, 77)}...` : value}"`;
}

function unsupportedMessage(key: string): string {
  const lower = key.toLowerCase();
  const reads = "it reads only user-agent, allow, disallow and sitemap lines";
  if (lower === "crawl-delay") {
    return `Google ignores Crawl-delay (${reads}). Bing honours it, so it only slows Bing and other crawlers that document it.`;
  }
  if (lower === "noindex" || lower === "nofollow") {
    return `Google ignores ${key} in robots.txt: it retired its code for unpublished rules such as noindex on 1 September 2019. To keep a page out of search results, use noindex in a robots meta tag or X-Robots-Tag header, and leave the page crawlable.`;
  }
  return `${quote(key)} is not part of RFC 9309, and Google ignores it (${reads}). Keep it only if a crawler you care about documents it.`;
}

/** True for a user-agent value that Google's crawlers read: "*" or a name containing "google". */
function readByGoogle(agent: string): boolean {
  return productToken(agent) === "*" || agent.toLowerCase().includes("google");
}

/**
 * The name two user-agent values must share to be the same agent for every parser: the value up
 * to a "/", "*" or space, so "Googlebot/2.1" is "googlebot". Google's parser reads only the
 * product token, but "AI2Bot" and "Ai2Bot-Dolma" are different crawlers, not both "Ai".
 */
function agentName(agent: string): string {
  return productToken(agent) === "*" ? "*" : (/^[^\s/*]*/.exec(agent)?.[0] ?? "").toLowerCase();
}

/**
 * Flags the user-agent values that RFC 9309 s2.2.1 and Google's documentation say read
 * differently from how they look. Other characters outside the token grammar, as in "MJ12bot",
 * aren't flagged: Google's parser reads less of them, but the crawler they name may match itself.
 */
function checkUserAgent(value: string, line: number, report: Report): void {
  const token = productToken(value);
  if (value === "") {
    report("user-agent-invalid", "error", 'The User-agent line is empty, so it matches no crawler. Write "User-agent: *" for all crawlers, or a crawler\'s product token.', line);
  } else if (token === "" && value[0] === "*") {
    report("user-agent-invalid", "error", `${quote(value)} matches no crawler: the only wildcard in a User-agent line is a lone "*" (RFC 9309 s2.2.1).`, line);
  } else if (token === "*" && value !== "*") {
    report("user-agent-invalid", "warning", `Google's parser reads ${quote(value)} as "*", but other parsers may not. Write "User-agent: *".`, line);
  } else if (value[token.length] === "/") {
    // Google: "both googlebot/1.2 and googlebot* are equivalent to googlebot".
    report("user-agent-invalid", "warning", `Google reads ${quote(value)} as "${token}" and ignores the rest, but other parsers may not match it: a product token has only letters, "-" and "_" (RFC 9309 s2.2.1). Write "User-agent: ${token}".`, line);
  } else if (value[token.length] === "*") {
    report("user-agent-invalid", "warning", `Wildcards don't work in a product token. Google reads ${quote(value)} as "${token}" and matches only that crawler; other parsers may not match it at all. Write "User-agent: ${token}", plus a line for each other crawler you meant.`, line);
  }
}

function pathMessage(field: Field, value: string): string {
  let path: string | null = null;
  if (URL_LIKE.test(value)) {
    try {
      const url = new URL(value);
      path = url.pathname + url.search;
    } catch {
      // Not a URL after all; fall through to the general advice.
    }
  }
  const fix = path !== null ? `${quote(value)} is a full URL; a rule takes the path` : `${quote(value)} doesn't start with "/" or "*"`;
  return `${fix}. Crawlers compare a rule with the URL path from its first character (RFC 9309 s2.2.2), so this never matches. Write "${NAMES[field]}: ${path ?? `/${value}`}".`;
}

/** UTF-8 size of the text, and the line where Google's 500 KiB limit falls (0 when it isn't reached). */
function utf8Size(text: string): { bytes: number; cutoffLine: number } {
  let bytes = 0;
  let line = 1;
  let cutoffLine = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Each half of a surrogate pair counts 2, so a pair counts its 4 bytes.
    bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
    if (bytes > GOOGLE_LIMIT && cutoffLine === 0) cutoffLine = line;
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) line++;
  }
  return { bytes, cutoffLine };
}

/** Lints a robots.txt file and parses its groups and sitemaps. */
export function lintRobotsTxt(text: string, options: LintOptions = {}): RobotsTxtResult {
  if (typeof text !== "string") throw new TypeError("text must be a string.");
  let location: URL | null = null;
  if (options.url !== undefined) {
    try {
      location = new URL(options.url);
    } catch {
      throw new TypeError(`options.url must be an absolute URL, got "${options.url}".`);
    }
  }

  const findings: RobotsTxtFinding[] = [];
  const report: Report = (rule, severity, message, line) => findings.push({ rule, severity, message, line });
  const groups: RobotsGroup[] = [];
  const sitemaps: RobotsSitemap[] = [];
  const finish = (): RobotsTxtResult => {
    findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const errorCount = findings.filter((f) => f.severity === "error").length;
    return { valid: errorCount === 0, errorCount, warningCount: findings.length - errorCount, findings, groups, sitemaps };
  };

  if (location && location.pathname !== "/robots.txt") {
    report("location-invalid", "error", `Crawlers only read the file at /robots.txt (all lowercase) at the root of a host (RFC 9309 s2.3), so they never read it at ${location.pathname}.`, null);
  }
  const size = utf8Size(text);
  if (size.cutoffLine) {
    report("file-too-large", "error", `The file is ${size.bytes} bytes. Google reads only the first 500 KiB (${GOOGLE_LIMIT} bytes) and ignores the rest, from this line on; RFC 9309 s2.5 requires crawlers to read only that much. Make it smaller, for example by grouping blocked pages under one directory.`, size.cutoffLine);
  }

  // Google ignores a byte-order mark at the start. Lines end with CR, LF or CRLF.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/);
  const firstContent = lines.findIndex((l) => l.trim() !== "");
  if (firstContent !== -1 && HTML_START.test(lines[firstContent])) {
    report("file-html", "error", "This is an HTML page, not a robots.txt file, so crawlers find no rules in it, which allows everything. A server often sends its 404 page or app shell when /robots.txt is missing.", firstContent + 1);
    return finish();
  }

  let group: RobotsGroup | null = null;
  // Whether Google reads the current group: true before any group and while it has no agents.
  // Kept as agents are added, so a long run of unknown lines doesn't rescan them.
  let googleReads = true;
  // agentName() to the line of the first group naming it.
  const firstGroupOf = new Map<string, number>();
  // Rules of the current group by normalised pattern, to spot an allow and a disallow for the same path.
  let byPattern = new Map<string, Partial<Record<RobotsRule["type"], RobotsRule>>>();

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i];
    const hash = raw.indexOf("#");
    const content = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!content) continue;

    let key: string;
    let value: string;
    const colon = content.indexOf(":");
    if (colon !== -1) {
      key = content.slice(0, colon).trim();
      value = content.slice(colon + 1).trim();
    } else {
      // Google's parser accepts whitespace in place of the colon when the line is exactly two words.
      const words = content.split(/\s+/);
      if (words.length !== 2 || googleField(words[0]) === null) {
        report("line-invalid", "error", `Crawlers ignore this line: a robots.txt line is a field, a colon and a value, as in "Disallow: /private/". Start a note with "#".`, line);
        continue;
      }
      [key, value] = words;
      report("colon-missing", "warning", `There is no colon after "${key}". Google's parser accepts a space instead, but RFC 9309 s2.2 requires the colon and other crawlers may skip the line. Write "${key}: ${value}".`, line);
    }
    if (!key) {
      report("line-invalid", "error", 'Crawlers ignore this line: there is nothing before the colon. A robots.txt line is a field, a colon and a value, as in "Disallow: /private/".', line);
      continue;
    }

    const field = googleField(key);
    if (field === null) {
      const near = nearMiss(key);
      if (near) {
        report("directive-misspelled", "error", `${quote(key)} looks like a misspelling of ${NAMES[near]}. Crawlers skip fields they don't know, so this line has no effect. Write "${NAMES[near]}:".`, line);
      } else if (googleReads) {
        report("directive-unsupported", "warning", unsupportedMessage(key), line);
      }
      continue;
    }
    if (key.toLowerCase() !== field) {
      report("directive-misspelled", "warning", `Google's parser reads ${quote(key)} as ${NAMES[field]}, but RFC 9309 parsers and other crawlers may skip the line. Write "${NAMES[field]}:".`, line);
    }

    if (field === "user-agent") {
      // A user-agent line after a rule starts a new group (RFC 9309 s2.2). Sitemap and unknown
      // lines don't end a group (s2.2.4).
      if (group === null || group.rules.length > 0) {
        group = { agents: [], line, rules: [] };
        groups.push(group);
        byPattern = new Map();
        googleReads = true;
      }
      checkUserAgent(value, line, report);
      if (value === "") continue;
      googleReads = (group.agents.length > 0 && googleReads) || readByGoogle(value);
      group.agents.push(value);
      const name = agentName(value);
      if (!productToken(value)) continue;
      const first = firstGroupOf.get(name);
      if (first === undefined) {
        firstGroupOf.set(name, group.line);
      } else if (first !== group.line) {
        report("group-duplicate", "warning", `${quote(value)} already has a group on line ${first}. Crawlers merge groups for the same agent (RFC 9309 s2.2.1), so the rules of both apply; combine them into one group to make that visible.`, line);
      }
    } else if (field === "sitemap") {
      let url: URL | null = null;
      try {
        url = new URL(value);
      } catch {
        // Reported below.
      }
      if (url && (url.protocol === "http:" || url.protocol === "https:")) {
        sitemaps.push({ url: value, line });
      } else {
        const what = value === "" ? "The Sitemap line has no URL" : `${quote(value)} is not a full http or https URL`;
        report("sitemap-invalid", "error", `${what}. Google needs the complete URL, including the protocol and host, as in "Sitemap: https://example.com/sitemap.xml".`, line);
      }
    } else if (group === null) {
      report("rule-outside-group", "error", `This ${NAMES[field]} line comes before any User-agent line, so crawlers ignore it (RFC 9309 s2.2.2). Put "User-agent: *" or a crawler's product token above it.`, line);
    } else {
      const rule: RobotsRule = { type: field, pattern: value, line };
      group.rules.push(rule);
      // An empty pattern is the usual way to write "allow everything", so it is fine.
      if (value === "") continue;
      if (value[0] !== "/" && value[0] !== "*") {
        report("path-invalid", "error", pathMessage(field, value), line);
        continue;
      }
      const normalized = normalize(value, true);
      const seen = byPattern.get(normalized) ?? {};
      const other = seen[field === "allow" ? "disallow" : "allow"];
      if (other && !seen[field]) {
        report("rule-conflict", "warning", `${NAMES[other.type]} on line ${other.line} has the same path, ${quote(value)}. Allow wins a tie (RFC 9309 s2.2.2), so the Disallow has no effect; remove the rule you don't mean.`, line);
      }
      seen[field] ??= rule;
      byPattern.set(normalized, seen);
    }
  }

  const globalRules = selectGroups(groups, "*").groups.flatMap((g) => g.rules);
  // With an Allow rule beside it, the site isn't wholly blocked, and the message says so.
  const opened = globalRules.some((r) => r.type === "allow" && r.pattern);
  for (const rule of globalRules) {
    if (rule.type === "disallow" && rule.pattern && matchesEverything(normalize(rule.pattern, true))) {
      const what = opened ? "every path that no Allow rule there opens," : "the whole site";
      const effect = opened ? "can crawl only the paths those Allow rules open" : "can't crawl any page";
      report("disallow-all", "warning", `"Disallow: ${rule.pattern}" for "*" blocks ${what} for every crawler without a group of its own. That suits a staging site; on a live site, search engines that honour robots.txt ${effect}.`, rule.line);
    }
  }

  let probes = 0;
  for (const g of selectGroups(groups, "googlebot").groups) {
    for (const rule of g.rules) {
      if (rule.type !== "disallow" || !CSS_JS.test(rule.pattern) || probes++ >= MAX_RESOURCE_PROBES) continue;
      // A URL this rule matches, tested against the whole group so that an Allow rule can win.
      const probe = rule.pattern.replace(/\$$/, "").replaceAll("*", "x");
      if (decide(groups, "googlebot", normalize(probe.startsWith("/") ? probe : `/${probe}`, false)).rule === rule) {
        report("resources-blocked", "warning", `This blocks Googlebot from CSS or JavaScript files. Google needs them to render pages and won't render JavaScript from blocked files. Allow them unless no page uses them.`, rule.line);
      }
    }
  }

  return finish();
}
