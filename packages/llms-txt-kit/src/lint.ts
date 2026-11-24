// llms.txt rules from the llmstxt.org proposal, v2 (https://llmstxt.org/, checked 2026-11-24).
// One line-based pass parses the file and reports findings as it goes, so the parsed document and
// the findings always agree. Pure and offline: the linked URLs are never fetched.

export type Severity = "error" | "warning";

export type RuleId =
  | "file-empty"
  | "file-html"
  | "h1-missing"
  | "h1-empty"
  | "h1-not-first"
  | "h1-multiple"
  | "heading-level"
  | "heading-space"
  | "summary-misplaced"
  | "section-empty"
  | "section-content"
  | "section-duplicate"
  | "optional-misspelled"
  | "link-malformed"
  | "link-notes"
  | "url-invalid"
  | "url-duplicate";

export interface LlmsTxtLink {
  title: string;
  /** As written in the file. Relative URLs are kept relative. */
  url: string;
  /** The text after "[name](url): ", or null. Always set by lintLlmsTxt(). */
  notes?: string | null;
  /** 1-based line. Set by lintLlmsTxt(); buildLlmsTxt() ignores it. */
  line?: number;
}

export interface LlmsTxtSection {
  /** The H2 text. */
  title: string;
  /** True when the title is exactly "Optional". Set by lintLlmsTxt(); buildLlmsTxt() ignores it. */
  optional?: boolean;
  /** 1-based line of the H2. Set by lintLlmsTxt(); buildLlmsTxt() ignores it. */
  line?: number;
  links: LlmsTxtLink[];
}

/** The structure lintLlmsTxt() returns and buildLlmsTxt() renders. */
export interface LlmsTxtDoc {
  /** The H1 text, or null when there is no H1. buildLlmsTxt() requires it. */
  title: string | null;
  /** The blockquote directly after the H1, without the "> " markers. Always set by lintLlmsTxt(). */
  summary?: string | null;
  /** Markdown between the summary and the first H2, as written. Always set by lintLlmsTxt(). */
  details?: string | null;
  sections: LlmsTxtSection[];
}

export interface LlmsTxtFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based line in the file, when the finding belongs to one place. */
  line: number | null;
}

export interface LlmsTxtResult {
  /** True when there are no errors. Warnings don't make a file invalid. */
  valid: boolean;
  errorCount: number;
  warningCount: number;
  /** Sorted by line. */
  findings: LlmsTxtFinding[];
  doc: LlmsTxtDoc;
}

export interface LintOptions {
  /** Where the file is served. Relative link URLs are resolved against it. */
  url?: string;
}

type Line =
  | { kind: "blank" | "text" | "quote" | "code" | "no-space"; raw: string }
  | { kind: "heading"; raw: string; level: number; text: string }
  | { kind: "item"; raw: string; text: string };

type Report = (rule: RuleId, severity: Severity, message: string, line: number | null) => void;

// The "s" flags let "." match U+2028 and U+2029, which end a line in JavaScript but not in markdown.
// CommonMark ATX heading: up to 3 spaces, 1-6 "#", then a space or the end of the line.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/s;
// Runs on trimmed heading text. A single [ \t], so a long run of spaces can't make it backtrack.
const HEADING_CLOSE = /(?:^|[ \t])#+$/;
const HEADING_NO_SPACE = /^ {0,3}#{1,6}[^#\s]/;
// A backtick fence's info string can't hold a backtick, so "```npm test``` runs it" is inline code.
const FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/s;
// [name](url) plus whatever follows. The URL may hold one level of balanced parentheses, as in
// Wikipedia links, but no whitespace.
const LINK = /^\[([^\]]*)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)(.*)$/s;
const HTML_START = /^\s*<(?:!doctype\s+html|html|head|body)[\s>]/i;
// Lets relative URLs be checked when the caller doesn't say where the file is served.
const PLACEHOLDER_BASE = "https://llms-txt.invalid/";
const PLACEHOLDER_ORIGIN = new URL(PLACEHOLDER_BASE).origin;
const OPTIONAL = "Optional";

function classify(lines: string[]): Line[] {
  let fence: string | null = null;
  return lines.map((raw): Line => {
    const fenceMatch = FENCE.exec(raw);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && raw.trim() === fenceMatch[1]) fence = null;
      return { kind: "code", raw };
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      return { kind: "code", raw };
    }
    if (raw.trim() === "") return { kind: "blank", raw };
    const heading = HEADING.exec(raw);
    if (heading) return { kind: "heading", raw, level: heading[1].length, text: heading[2].trim().replace(HEADING_CLOSE, "").trim() };
    if (HEADING_NO_SPACE.test(raw)) return { kind: "no-space", raw };
    if (QUOTE.test(raw)) return { kind: "quote", raw };
    const item = LIST_ITEM.exec(raw);
    if (item) return { kind: "item", raw, text: (item[1] ?? "").trim() };
    return { kind: "text", raw };
  });
}

/** Optimal string alignment distance, enough to catch one-key typos like "Optinal" or "Opitonal". */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function looksLikeOptional(title: string): boolean {
  if (title === OPTIONAL) return false;
  const lower = title.toLowerCase();
  // The length check skips the distance table for long titles that can't be one edit away.
  return lower.startsWith("optional") || (Math.abs(lower.length - OPTIONAL.length) <= 1 && editDistance(lower, "optional") <= 1);
}

function joinTrimmed(lines: Line[]): string | null {
  const first = lines.findIndex((l) => l.kind !== "blank");
  if (first === -1) return null;
  let last = lines.length - 1;
  while (lines[last].kind === "blank") last--;
  return lines
    .slice(first, last + 1)
    .map((l) => l.raw)
    .join("\n");
}

/** Quotes a line for a message, shortened so a long line doesn't bury the explanation. */
function excerpt(raw: string): string {
  const text = raw.trim();
  return `"${text.length > 80 ? `${text.slice(0, 77)}...` : text}"`;
}

function headingSpaceMessage(raw: string): string {
  const trimmed = raw.trim();
  return `"${trimmed}" is not a heading: markdown needs a space after the #, as in "${trimmed.replace(/^(#+)/, "$1 ")}".`;
}

function checkUrl(url: string, line: number, base: string, seen: Map<string, number>, report: Report): void {
  if (!url) {
    report("url-invalid", "warning", "The link has no URL.", line);
    return;
  }
  let resolved: URL;
  try {
    resolved = new URL(url, base);
  } catch {
    report("url-invalid", "warning", `"${url}" is not a valid URL.`, line);
    return;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    report("url-invalid", "warning", `"${url}" is a ${resolved.protocol.slice(0, -1)} link. Agents can only follow http and https links.`, line);
    return;
  }
  // Without the file's URL, relative links are compared as written: "a.md" and "/a.md" are the
  // same page only when the file sits at the root.
  const key = base === PLACEHOLDER_BASE && resolved.origin === PLACEHOLDER_ORIGIN ? url : resolved.href;
  const first = seen.get(key);
  if (first !== undefined) report("url-duplicate", "warning", `"${url}" is already listed on line ${first}.`, line);
  else seen.set(key, line);
}

function parseLink(item: Extract<Line, { kind: "item" }>, line: number, base: string, seen: Map<string, number>, report: Report): LlmsTxtLink | null {
  const m = LINK.exec(item.text);
  if (!m) {
    report("link-malformed", "warning", `${excerpt(item.raw)} doesn't start with a markdown link. Each list item in a section needs one, as in "- [Name](https://example.com/page.md): notes".`, line);
    return null;
  }
  const [, rawTitle, url, rest] = m;
  const title = rawTitle.trim();
  if (!title) {
    report("link-malformed", "warning", `${excerpt(item.raw)} has a link with an empty name. The name tells an agent what is behind the link.`, line);
    return null;
  }
  let notes: string | null = null;
  if (/^\s*:/.test(rest)) notes = rest.replace(/^\s*:\s*/, "").trimEnd() || null;
  else if (rest.trim()) {
    report("link-notes", "warning", `The text after the "${title}" link doesn't start with ":". Write "- [Name](https://example.com/page.md): notes"; parsers that follow the spec drop the text otherwise.`, line);
  }
  checkUrl(url, line, base, seen, report);
  return { title, url, notes, line };
}

/** Lints an llms.txt file and parses it into an LlmsTxtDoc. */
export function lintLlmsTxt(text: string, options: LintOptions = {}): LlmsTxtResult {
  let base = PLACEHOLDER_BASE;
  if (options.url !== undefined) {
    try {
      base = new URL(options.url).href;
    } catch {
      throw new TypeError(`options.url must be an absolute URL, got "${options.url}".`);
    }
  }

  const findings: LlmsTxtFinding[] = [];
  const report: Report = (rule, severity, message, line) => findings.push({ rule, severity, message, line });
  const doc: LlmsTxtDoc = { title: null, summary: null, details: null, sections: [] };
  const finish = (): LlmsTxtResult => {
    findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    const errorCount = findings.filter((f) => f.severity === "error").length;
    return { valid: errorCount === 0, errorCount, warningCount: findings.length - errorCount, findings, doc };
  };

  // The spec allows a byte-order mark before the H1.
  const lines = classify(text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/));
  const firstContent = lines.findIndex((l) => l.kind !== "blank");
  if (firstContent === -1) {
    report("file-empty", "error", "The file is empty. An llms.txt needs at least an H1 with the site or project name.", null);
    return finish();
  }
  if (HTML_START.test(lines[firstContent].raw)) {
    report("file-html", "error", "This is HTML, not markdown. A server often sends an HTML 404 page or app shell when /llms.txt is missing.", firstContent + 1);
    return finish();
  }

  const isHeading = (l: Line, level: number) => l.kind === "heading" && l.level === level;
  const h1 = lines.findIndex((l) => isHeading(l, 1));
  if (h1 === -1) {
    report("h1-missing", "error", "There is no H1. An H1 with the site or project name is the only required part of an llms.txt.", null);
  } else {
    const title = (lines[h1] as Extract<Line, { kind: "heading" }>).text;
    doc.title = title;
    if (!title) report("h1-empty", "error", "The H1 is empty. It should hold the site or project name.", h1 + 1);
    if (firstContent < h1) {
      report("h1-not-first", "warning", `The H1 (line ${h1 + 1}) must come first; only a byte-order mark may precede it. Content above it is ignored.`, firstContent + 1);
    }
  }

  const start = h1 + 1; // 0 when there is no H1, so the whole file is read
  const h2Found = lines.findIndex((l, i) => i >= start && isHeading(l, 2));
  const h2 = h2Found === -1 ? lines.length : h2Found;
  const lineNo = (i: number) => i + 1;

  // Summary: a blockquote as the first thing after the H1.
  let i = start;
  while (i < h2 && lines[i].kind === "blank") i++;
  const summaryStart = i;
  while (i < h2 && lines[i].kind === "quote") i++;
  if (i > summaryStart) {
    doc.summary = lines
      .slice(summaryStart, i)
      .map((l) => l.raw.replace(/^ {0,3}> ?/, ""))
      .join("\n")
      .trim() || null;
  }

  // Details: anything but headings, up to the first H2.
  let quoteReported = false;
  for (let j = i; j < h2; j++) {
    const l = lines[j];
    if (l.kind === "heading" && l.level === 1) {
      report("h1-multiple", "warning", `A second H1 ("${l.text}"). An llms.txt has one H1, the site or project name; use H2 for sections.`, lineNo(j));
    } else if (l.kind === "heading") {
      report("heading-level", "warning", `${excerpt(l.raw)} is a heading in the details before the first H2, where the spec allows none. Use bold text, or make it an H2 section.`, lineNo(j));
    } else if (l.kind === "no-space") {
      report("heading-space", "warning", headingSpaceMessage(l.raw), lineNo(j));
    } else if (l.kind === "quote" && doc.summary === null && !quoteReported) {
      quoteReported = true;
      report("summary-misplaced", "warning", "This blockquote looks like the summary, but the summary must come directly after the H1. Here it is read as details.", lineNo(j));
    }
  }
  doc.details = joinTrimmed(lines.slice(i, h2));

  // Sections: an H2 followed by a list of links.
  const seenUrls = new Map<string, number>();
  const seenSections = new Map<string, number>();
  let section: LlmsTxtSection | null = null;
  let contentReported = false;
  // Sections with any content; the rules for that content explain a section without links.
  const nonEmpty = new Set<LlmsTxtSection>();
  for (let j = h2; j < lines.length; j++) {
    const l = lines[j];
    if (l.kind === "heading" && l.level === 2) {
      section = { title: l.text, optional: l.text === OPTIONAL, line: lineNo(j), links: [] };
      doc.sections.push(section);
      contentReported = false;
      const key = l.text.toLowerCase();
      const first = seenSections.get(key);
      if (first !== undefined) report("section-duplicate", "warning", `Section "${l.text}" already appears on line ${first}. Merge the two lists.`, lineNo(j));
      else seenSections.set(key, lineNo(j));
      if (looksLikeOptional(l.text)) {
        report("optional-misspelled", "warning", `Section "${l.text}" looks like the Optional section. By convention it is titled exactly "Optional".`, lineNo(j));
      }
      continue;
    }
    if (section === null || l.kind === "blank") continue;
    nonEmpty.add(section);
    if (l.kind === "heading" && l.level === 1) {
      report("h1-multiple", "warning", `A second H1 ("${l.text}"). An llms.txt has one H1, the site or project name; use H2 for sections.`, lineNo(j));
    } else if (l.kind === "heading") {
      report("heading-level", "warning", `${excerpt(l.raw)} is inside section "${section.title}". Sections are flat link lists under an H2; use another H2 instead.`, lineNo(j));
    } else if (l.kind === "no-space") {
      report("heading-space", "warning", headingSpaceMessage(l.raw), lineNo(j));
    } else if (l.kind === "item") {
      const link = parseLink(l, lineNo(j), base, seenUrls, report);
      if (link) section.links.push(link);
    } else if (!contentReported) {
      contentReported = true;
      report("section-content", "warning", `Section "${section.title}" has content that isn't a list item. Sections hold link lists, and parsers that follow the spec skip anything else; move it to the details or into link notes.`, lineNo(j));
    }
  }
  for (const s of doc.sections) {
    if (!nonEmpty.has(s)) report("section-empty", "warning", `Section "${s.title}" is empty. Each H2 section holds a list of markdown links.`, s.line ?? null);
  }

  return finish();
}
