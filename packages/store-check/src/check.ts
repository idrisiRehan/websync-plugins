// checkStore(): fetches a fixed, small set of a store's files and pages, runs the
// repository's linters on them and collects the results into one report. Every check is the
// linters' own; this module only decides what to fetch and turns each result into a section.

import { gunzipSync } from "node:zlib";
import { createFetcher, inspectRedirects, type FetchRecord as BaseRecord, type RedirectResult } from "redirect-inspector";
import { aiCrawlerReport, isAllowed, lintRobotsTxt, type AiCrawlerAccess, type RobotsTxtResult } from "robots-txt-lint";
import { lintSitemap, MAX_BYTES as SITEMAP_MAX_BYTES, type SitemapResult } from "sitemap-lint";
import { lintLlmsTxt } from "llms-txt-kit";
import { lintMetadata } from "metacheck";
import { validateStructuredData, type StructuredDataResult } from "schemaview";
import { analyzeHeaders, normalizeHeaders } from "security-header-audit";
import { pickChildSitemap, pickProductUrl } from "./product.ts";

// Every request of a run goes through one fetcher (redirect-inspector's createFetcher), which
// counts it against the request budget, puts a timeout on it, follows redirects one hop at a
// time (so each hop is counted too), reads bodies only up to a byte cap while they stream, and
// cancels the bodies it doesn't need.
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_USER_AGENT = "store-check (+https://github.com/idrisiRehan/websync-plugins)";
/** Redirects followed per fetch. RFC 9309 s2.3.1.2 asks crawlers to follow at least five for robots.txt. */
export const MAX_REDIRECTS = 5;
/** HTTP requests per run, redirects included. The README's request budget explains the number. */
export const MAX_REQUESTS = 20;

// Body caps, the same as each linter's own CLI uses.
/** robots-txt-lint: Google reads 500 KiB, and 1 MiB is enough to report a file over that. */
const ROBOTS_MAX_BYTES = 1024 * 1024;
/** llms-txt-kit: an llms.txt is meant to fit in a context window. */
const LLMS_MAX_BYTES = 5 * 1024 * 1024;
/** metacheck and schemaview: well above the size of typical pages. */
const HTML_MAX_BYTES = 10 * 1024 * 1024;

const ACCEPT_TEXT = "text/plain, */*;q=0.1";
const ACCEPT_MARKDOWN = "text/markdown, text/plain;q=0.9, */*;q=0.1";
const ACCEPT_XML = "application/xml, text/xml;q=0.9, */*;q=0.1";
const ACCEPT_HTML = "text/html, application/xhtml+xml;q=0.9, */*;q=0.1";

export interface FetchRecord extends BaseRecord {
  /** What the fetch was for, such as "robots.txt" or "product page". */
  purpose: string;
}

interface Fetched {
  record: FetchRecord;
  /** Headers of the last response, or null when none arrived. */
  headers: Headers | null;
  /** The whole body of a 2xx response, or null when it wasn't read or the fetch failed. */
  body: Uint8Array | null;
}

export type Severity = "error" | "warning";
export type SectionId = "redirects" | "robots-txt" | "crawlers" | "sitemap" | "llms-txt" | "home-page" | "product-page" | "structured-data" | "security-headers";
/** pass, warnings and errors come from the findings; skipped and unavailable mean nothing was checked. */
export type SectionStatus = "pass" | "warnings" | "errors" | "skipped" | "unavailable";

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** The file or page the finding is about. */
  url: string;
  /** Where in it, such as "line 4", "hop 2" or "line 25, $.offers.price"; null for the whole file. */
  where: string | null;
  /** The package whose check produced the finding, or "store-check" for the report's own rules. */
  source: string;
}

export interface Section {
  id: SectionId;
  title: string;
  status: SectionStatus;
  /** What was found, in short sentences, such as "Googlebot: home page allowed, product page allowed." */
  facts: string[];
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

export interface AiCrawlerPageAccess extends AiCrawlerAccess {
  /** Whether robots.txt lets this crawler fetch the home page. */
  home: boolean;
  /** Whether robots.txt lets this crawler fetch the product page, or null when there is none. */
  product: boolean | null;
}

export interface CrawlerAccess {
  googlebot: { home: boolean; product: boolean | null };
  ai: AiCrawlerPageAccess[];
}

export interface StoreReport {
  /** The start URL: the origin of the URL given. */
  url: string;
  /** The origin every later check ran on: where the start URL's redirects end. */
  site: string;
  /** ISO 8601 time the check started. */
  checkedAt: string;
  /** False when the start URL got no response at all; every other section is then unavailable. */
  reachable: boolean;
  product: { url: string; source: "option" | "sitemap" } | null;
  sections: Section[];
  /** robots.txt verdicts for the home and product pages; null when robots.txt couldn't be read. */
  crawlers: CrawlerAccess | null;
  /** Every fetch, in order. Redirect checks count each hop as a request. */
  requests: FetchRecord[];
  /** HTTP requests made, redirects included. Never more than MAX_REQUESTS. */
  requestCount: number;
  errorCount: number;
  warningCount: number;
}

export interface CheckOptions {
  /** A product page to check instead of one picked from the sitemap. Must be on the store's host. */
  productUrl?: string;
  /** Timeout for each request in milliseconds (default 10000). */
  timeoutMs?: number;
  userAgent?: string;
  /** A fetch implementation, for tests or a custom agent. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

const TITLES: Record<SectionId, string> = {
  redirects: "Redirects and HTTPS",
  "robots-txt": "robots.txt",
  crawlers: "Crawler access",
  sitemap: "Sitemap",
  "llms-txt": "llms.txt",
  "home-page": "Home page metadata",
  "product-page": "Product page metadata",
  "structured-data": "Structured data",
  "security-headers": "Security headers",
};

/** The fields the linters' findings share, plus the location fields some of them add. */
interface LinterFinding {
  rule: string;
  severity: Severity;
  message: string;
  line?: number | null;
  entry?: number | null;
  hop?: number | null;
  path?: string | null;
}

function findingsFrom(source: string, url: string, list: readonly LinterFinding[]): Finding[] {
  return list.map((f) => {
    const where = [f.hop != null ? `hop ${f.hop}` : "", f.entry != null ? `entry ${f.entry}` : "", f.line != null ? `line ${f.line}` : "", f.path ?? ""].filter(Boolean).join(", ");
    return { rule: f.rule, severity: f.severity, message: f.message, url, where: where || null, source };
  });
}

function own(rule: string, severity: Severity, message: string, url: string, source = "store-check"): Finding {
  return { rule, severity, message, url, where: null, source };
}

/** A section whose status follows from its findings, or is `idle` when there are none. */
function section(id: SectionId, facts: string[], findings: Finding[], idle: "pass" | "skipped" | "unavailable" = "pass"): Section {
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.length - errorCount;
  const status = errorCount ? "errors" : warningCount ? "warnings" : idle;
  return { id, title: TITLES[id], status, facts, findings, errorCount, warningCount };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isSuccess = (status: number | null) => status !== null && status >= 200 && status < 300;
/** 404 and 410 say a file doesn't exist; other 4xx (401, 403) often come from bot protection. */
const isGone = (status: number | null) => status === 404 || status === 410;
/** How robots-txt-lint and llms-txt-kit recognise an HTML page served in place of a text file. */
const HTML_START = /^\s*<(?:!doctype\s+html|html|head|body)[\s>]/i;

function httpUrl(input: string, name: string): URL {
  let url: URL | null = null;
  try {
    url = new URL(input);
  } catch {
    // Reported below.
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) throw new TypeError(`${name} must be an absolute http or https URL, got "${input}".`);
  return url;
}

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${n / (1024 * 1024)} MiB` : `${n / 1024} KiB`);

/** The fact for a fetch that failed or stopped early (record.error is set). */
const couldntRead = (record: FetchRecord) => `Couldn't read ${record.url}: ${record.error}.`;

/** Text for linters that require UTF-8, with an encoding-invalid error when the bytes aren't. */
function utf8Text(body: Uint8Array, url: string, findings: Finding[], why: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    findings.push(own("encoding-invalid", "error", `The file is not valid UTF-8. ${why}`, url));
    return new TextDecoder().decode(body);
  }
}

// ---------------------------------------------------------------------------------------------
// Redirects

function chainRecord(purpose: string, chain: RedirectResult): FetchRecord {
  const failed = chain.findings.find((f) => f.rule === "request-failed");
  return {
    purpose,
    url: chain.url,
    finalUrl: chain.finalUrl,
    status: chain.finalStatus,
    redirects: chain.finalStatus === null ? chain.hops.length : Math.max(0, chain.hops.length - 1),
    durationMs: chain.hops.reduce((sum, h) => sum + h.durationMs, 0),
    bytes: null,
    error: failed ? failed.message : null,
  };
}

function chainFact(chain: RedirectResult): string {
  if (chain.finalStatus === null) return `${chain.url}: no response from ${chain.finalUrl}.`;
  const redirects = chain.hops.slice(0, -1).map((h) => h.status);
  if (!redirects.length) return `${chain.url} answers ${chain.finalStatus} without redirecting.`;
  return `${chain.url} -> ${chain.finalUrl} (${redirects.join(", ")}, then ${chain.finalStatus}).`;
}

function redirectsSection(start: RedirectResult, http: RedirectResult | null): Section {
  const facts = [chainFact(start)];
  if (start.finalStatus === 403 || start.finalStatus === 429) {
    facts.push(`A ${start.finalStatus} often comes from bot protection or rate limiting, which may answer search engine crawlers differently.`);
  }
  const findings = findingsFrom("redirect-inspector", start.url, start.findings);
  if (http) {
    facts.push(chainFact(http));
    findings.push(...findingsFrom("redirect-inspector", http.url, http.findings));
    if (isSuccess(start.finalStatus) && isSuccess(http.finalStatus) && start.finalUrl !== http.finalUrl) {
      facts.push(`http:// and https:// end at different URLs (${http.finalUrl} and ${start.finalUrl}).`);
    }
  }
  return section("redirects", facts, findings);
}

// ---------------------------------------------------------------------------------------------
// robots.txt and crawler access

interface Robots {
  section: Section;
  /** The rules crawlers apply: the file's, or none for a 4xx. Null when they can't be known. */
  result: RobotsTxtResult | null;
  /** Why result is null. */
  problem: string | null;
}

function readRobots(f: Fetched): Robots {
  const url = f.record.finalUrl;
  const status = f.record.status;
  if (f.record.error) {
    const problem = couldntRead(f.record);
    return { section: section("robots-txt", [problem], [], "unavailable"), result: null, problem };
  }
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    // RFC 9309 s2.3.1.3: a 4xx means the file is unavailable and crawlers may crawl everything.
    // Only a 404 or 410 says there is no file; a 401 or 403 is often bot protection answering store-check.
    const fact = isGone(status)
      ? `No robots.txt (HTTP ${status} at ${url}). Crawlers treat that as no rules and may crawl everything (RFC 9309 s2.3.1.3).`
      : `${url} answered HTTP ${status}. Crawlers that get the same answer treat it as no rules and may crawl everything (RFC 9309 s2.3.1.3), but bot protection may answer them differently.`;
    return { section: section("robots-txt", [fact], []), result: lintRobotsTxt(""), problem: null };
  }
  if (!f.body && (status === 429 || (status as number) >= 500)) {
    // Google leaves 429 out of the 4xx rule and treats it like a server error.
    const problem = `${url} answered HTTP ${status}, so crawlers assume the whole site is disallowed until it answers (RFC 9309 s2.3.1.4).`;
    return { section: section("robots-txt", [], [own("robots-unreachable", "error", problem, url)]), result: null, problem };
  }
  if (!f.body) {
    const problem = `${url} answered HTTP ${status}.`;
    return { section: section("robots-txt", [problem], [], "unavailable"), result: null, problem };
  }
  const findings: Finding[] = [];
  const text = utf8Text(f.body, url, findings, "RFC 9309 s2.3 requires UTF-8, so crawlers may misread non-ASCII rules.");
  // lintRobotsTxt checks the requested location: crawlers apply the file to the host they asked.
  const result = lintRobotsTxt(text, { url: f.record.url });
  findings.push(...findingsFrom("robots-txt-lint", url, result.findings));
  const rules = result.groups.reduce((n, g) => n + g.rules.length, 0);
  const fact = `${url}: ${plural(result.groups.length, "group")}, ${plural(rules, "rule")}, ${plural(result.sitemaps.length, "sitemap")}.`;
  return { section: section("robots-txt", [fact], findings), result, problem: null };
}

function verdict(robots: RobotsTxtResult, token: string, url: string): { allowed: boolean; text: string } {
  const d = isAllowed(robots, token, url);
  if (d.allowed) return { allowed: true, text: "allowed" };
  return { allowed: false, text: `blocked by line ${d.rule?.line} ("Disallow: ${d.rule?.pattern}")` };
}

function tokens(list: readonly AiCrawlerPageAccess[]): string {
  return list.map((c) => c.token).join(", ");
}

function crawlersSection(robots: Robots, homeUrl: string, productUrl: string | null): { section: Section; access: CrawlerAccess | null } {
  const rules = robots.result;
  if (!rules) return { section: section("crawlers", [`Unknown, because robots.txt couldn't be read. ${robots.problem}`], [], "unavailable"), access: null };

  const facts: string[] = [];
  const findings: Finding[] = [];
  const pages: [string, string][] = productUrl ? [["home page", homeUrl], ["product page", productUrl]] : [["home page", homeUrl]];
  const google = pages.map(([label, url]) => ({ label, url, ...verdict(rules, "Googlebot", url) }));
  facts.push(`Googlebot: ${google.map((g) => `${g.label} ${g.text}`).join(", ")}.`);
  for (const g of google.filter((g) => !g.allowed)) {
    findings.push(own("googlebot-blocked", "error", `robots.txt blocks Googlebot from the ${g.label} (${g.url}), so Google can't crawl it: the page can't show its title, description or rich results in Search.`, g.url));
  }

  const ai: AiCrawlerPageAccess[] = aiCrawlerReport(rules).map((c) => ({
    ...c,
    home: isAllowed(rules, c.token, homeUrl).allowed,
    product: productUrl ? isAllowed(rules, c.token, productUrl).allowed : null,
  }));
  const blocked = ai.filter((c) => c.access === "blocked");
  const partial = ai.filter((c) => c.access === "partial").length;
  let wholeSite = `${blocked.length} blocked from the whole site (${tokens(blocked)})`;
  if (!blocked.length) wholeSite = "none blocked from the whole site";
  else if (blocked.length === ai.length) wholeSite = `all ${ai.length} blocked from the whole site`;
  facts.push(`AI crawlers (robots-txt-lint lists ${ai.length}): ${wholeSite}, ${partial} blocked from some paths, ${ai.length - blocked.length - partial} with no Disallow rule.`);
  const pageFact = (label: string, off: AiCrawlerPageAccess[]) => {
    if (!off.length) return `Every listed AI crawler may fetch ${label}.`;
    return off.length === ai.length ? `No listed AI crawler may fetch ${label}.` : `AI crawlers blocked from ${label}: ${tokens(off)}.`;
  };
  const offHome = ai.filter((c) => !c.home);
  const offProduct = ai.filter((c) => c.product === false);
  if (!productUrl) facts.push(pageFact("the home page", offHome));
  else if (tokens(offHome) === tokens(offProduct)) facts.push(pageFact("the home page and the product page", offHome));
  else facts.push(pageFact("the home page", offHome), pageFact("the product page", offProduct));

  const googlebot = { home: google[0].allowed, product: productUrl ? google[1].allowed : null };
  return { section: section("crawlers", facts, findings), access: { googlebot, ai } };
}

// ---------------------------------------------------------------------------------------------
// Sitemap

interface SitemapRead {
  result: SitemapResult | null;
  /** True when the file is an HTML page, such as a 404 page sent with 200. */
  html: boolean;
  /** Why result is null, as a fact or a finding. */
  fact: string | null;
  finding: Finding | null;
}

/** Decompresses gzip the way sitemap-lint's CLI does: by the magic bytes, capped at the protocol's 50 MB. */
function gunzipIfNeeded(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  try {
    return gunzipSync(bytes, { maxOutputLength: SITEMAP_MAX_BYTES });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error("it decompresses to more than the protocol's 50 MB limit");
    throw new Error("it looks gzipped but could not be decompressed");
  }
}

type Get = (url: string, purpose: string, accept: string, maxBytes: number) => Promise<Fetched>;

/** `notFound` turns a status other than 2xx into a finding, or into null to report it as a fact. */
async function readSitemap(get: Get, url: string, purpose: string, notFound: (status: number) => Finding | null): Promise<SitemapRead> {
  const f = await get(url, purpose, ACCEPT_XML, SITEMAP_MAX_BYTES);
  if (f.record.error) return { result: null, html: false, fact: couldntRead(f.record), finding: null };
  if (!f.body) {
    const finding = notFound(f.record.status as number);
    return { result: null, html: false, fact: finding ? null : `${url} answered HTTP ${f.record.status}.`, finding };
  }
  try {
    const bytes = gunzipIfNeeded(f.body);
    const html = HTML_START.test(new TextDecoder().decode(bytes.subarray(0, 1024)));
    return { result: lintSitemap(bytes), html, fact: null, finding: null };
  } catch (error) {
    return { result: null, html: false, fact: `Couldn't read ${url}: ${(error as Error).message}.`, finding: null };
  }
}

function sitemapFact(url: string, result: SitemapResult): string {
  if (result.kind === "sitemapindex") return `${url}: sitemap index, ${plural(result.entryCount, "sitemap")}.`;
  if (result.kind === "urlset") return `${url}: ${plural(result.entryCount, "URL")}.`;
  return `${url}: not a readable sitemap.`;
}

async function checkSitemap(get: Get, robots: RobotsTxtResult | null, site: string, siteHosts: string[]): Promise<{ section: Section; locs: string[] }> {
  const declared = robots?.sitemaps.map((s) => s.url) ?? [];
  const onSite = (u: string) => siteHosts.includes(new URL(u).host);
  const url = declared.find(onSite) ?? declared[0] ?? `${site}/sitemap.xml`;
  const facts: string[] = [];
  const findings: Finding[] = [];

  if (declared.length) facts.push(`Listed in robots.txt${declared.length > 1 ? ` (${declared.length} Sitemap lines; store-check reads one)` : ""}.`);
  else facts.push(robots ? "robots.txt has no Sitemap line, so store-check tried /sitemap.xml." : "robots.txt couldn't be read, so store-check tried /sitemap.xml.");
  if (!onSite(url)) facts.push(`The sitemap is on another host (${new URL(url).host}); it was fetched because robots.txt points to it.`);

  // The sitemap is missing only when robots.txt was read and names none, and /sitemap.xml isn't
  // there (404, 410 or an HTML page). A 401 or 403 is often bot protection, so it is only a fact.
  const missing = (answer: string) =>
    own("sitemap-missing", "warning", `No sitemap found: ${url} answered ${answer}, and robots.txt names no other. A sitemap helps search engines find every product.`, url);
  const top = await readSitemap(get, url, "sitemap", (status) => {
    if (declared.length || status >= 500 || status === 429) return own("sitemap-unreachable", "error", `${url} answered HTTP ${status}${declared.length ? ", although robots.txt lists it" : ""}.`, url);
    return robots && isGone(status) ? missing(`HTTP ${status}`) : null;
  });
  if (top.fact) facts.push(top.fact);
  if (top.finding) findings.push(top.finding);
  if (!top.result) return { section: section("sitemap", facts, findings, "unavailable"), locs: [] };
  if (!declared.length && top.html && top.result.kind === null) {
    // A 404 page sent with 200 (or an app shell) at a URL store-check guessed.
    if (robots) findings.push(missing("with an HTML page, not a sitemap"));
    else facts.push(`${url} answered with an HTML page, not a sitemap.`);
    return { section: section("sitemap", facts, findings, "unavailable"), locs: [] };
  }
  facts.push(sitemapFact(url, top.result));
  findings.push(...findingsFrom("sitemap-lint", url, top.result.findings));
  if (top.result.kind !== "sitemapindex") return { section: section("sitemap", facts, findings), locs: top.result.locs };

  // A sitemap index: read one child on the site's or the index's host, preferably the product sitemap.
  const reachable = top.result.locs.filter((loc) => onSite(loc) || new URL(loc).host === new URL(url).host);
  const child = pickChildSitemap(reachable);
  if (!child) {
    if (top.result.locs.length) facts.push(`Its child sitemaps are all on other hosts (such as ${new URL(top.result.locs[0]).host}), so none was fetched.`);
    return { section: section("sitemap", facts, findings), locs: [] };
  }
  const read = await readSitemap(get, child, "child sitemap", (status) => own("sitemap-unreachable", "error", `${child} answered HTTP ${status}, although the sitemap index lists it.`, child));
  if (read.fact) facts.push(read.fact);
  if (read.finding) findings.push(read.finding);
  if (read.result) {
    facts.push(`${sitemapFact(child, read.result)} (The one child sitemap store-check reads.)`);
    findings.push(...findingsFrom("sitemap-lint", child, read.result.findings));
  }
  return { section: section("sitemap", facts, findings), locs: read.result?.kind === "urlset" ? read.result.locs : [] };
}

// ---------------------------------------------------------------------------------------------
// llms.txt

function llmsSection(f: Fetched): Section {
  const url = f.record.finalUrl;
  if (f.record.error) return section("llms-txt", [couldntRead(f.record)], [], "unavailable");
  const status = f.record.status as number;
  const optional = "It's an optional proposal (https://llmstxt.org/), so this is not a problem.";
  if (!f.body && isGone(status)) return section("llms-txt", [`No llms.txt (HTTP ${status} at ${url}). ${optional}`], [], "skipped");
  if (!f.body) return section("llms-txt", [`${url} answered HTTP ${status}.`], [], "unavailable");
  const findings: Finding[] = [];
  const text = utf8Text(f.body, url, findings, "Readers decode llms.txt as UTF-8 markdown.");
  const result = lintLlmsTxt(text, { url });
  // An HTML page (a 404 page sent with 200, or an app shell) means there is no llms.txt.
  if (result.findings.some((x) => x.rule === "file-html")) {
    return section("llms-txt", [`No llms.txt: ${url} answered HTTP ${status} with an HTML page. ${optional}`], [], "skipped");
  }
  findings.push(...findingsFrom("llms-txt-kit", url, result.findings));
  const { doc } = result;
  const links = doc.sections.reduce((n, s) => n + s.links.length, 0);
  return section("llms-txt", [`${url}: ${doc.title ? `"${doc.title}"` : "no H1"}, ${plural(doc.sections.length, "section")}, ${plural(links, "link")}.`], findings);
}

// ---------------------------------------------------------------------------------------------
// Pages

interface Page {
  label: "home page" | "product page";
  fetched: Fetched;
  /** The HTML of a 2xx page. */
  html: string | null;
  /** Why html is null, as a fact or a finding. */
  fact: string | null;
  finding: Finding | null;
}

function readPage(label: Page["label"], fetched: Fetched): Page {
  const { record, body } = fetched;
  if (record.error) return { label, fetched, html: null, fact: couldntRead(record), finding: null };
  if (!body) return { label, fetched, html: null, fact: null, finding: own("page-status", "error", `The ${label} ${record.finalUrl} answered HTTP ${record.status}.`, record.finalUrl) };
  // Pages in another charset are decoded with replacement characters; metacheck reports the charset.
  return { label, fetched, html: new TextDecoder().decode(body), fact: null, finding: null };
}

const shorten = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** `origin` says where the URL came from, such as ", picked from the sitemap". */
function metadataSection(id: "home-page" | "product-page", page: Page, origin = ""): Section {
  if (!page.html) return section(id, page.fact ? [page.fact] : [], page.finding ? [page.finding] : [], "unavailable");
  const url = page.fetched.record.finalUrl;
  const result = lintMetadata(page.html, { url });
  const m = result.metadata;
  const facts = [`${url} (HTTP ${page.fetched.record.status})${origin}.`];
  facts.push(m.title === null ? "No title." : `Title: "${shorten(m.title)}" (${m.title.length} characters).`);
  if (m.canonical !== null) facts.push(`Canonical: ${m.canonical}${m.canonical === url ? " (itself)" : ""}.`);
  return section(id, facts, findingsFrom("metacheck", url, result.findings));
}

/** Google's product structured data types: a Product, or a ProductGroup of variants. */
const PRODUCT_TYPES = new Set(["Product", "ProductGroup"]);
/** A Microdata itemtype or RDFa typeof naming Product or ProductGroup, which schemaview doesn't read. */
const OTHER_SYNTAX_PRODUCT = /\b(?:itemtype\s*=\s*["']?[^"'>]*schema\.org\/|typeof\s*=\s*["']?(?:[^"'>]*\s)?(?:schema:)?)Product(?:Group)?\b/i;

function typesFact(label: string, result: StructuredDataResult): string {
  const features = [...new Set(result.entities.flatMap((e) => e.richResults))];
  if (!result.blockCount) return `The ${label} has no JSON-LD.`;
  return `The ${label}: ${plural(result.blockCount, "JSON-LD block")}, ${features.length ? `rich results checked: ${features.join(", ")}` : "no rich result types"}.`;
}

function structuredDataSection(home: Page | null, product: Page | null): Section {
  const facts: string[] = [];
  const findings: Finding[] = [];
  let checked = false;
  for (const page of [home, product]) {
    if (!page?.html) continue;
    checked = true;
    const url = page.fetched.record.finalUrl;
    const result = validateStructuredData(page.html, { url });
    facts.push(typesFact(page.label, result));
    findings.push(...findingsFrom("schemaview", url, result.findings));
    if (page !== product) continue;
    const products = result.entities.filter((e) => e.types.some((t) => PRODUCT_TYPES.has(t)));
    const features = [...new Set(products.flatMap((e) => e.richResults))];
    if (!features.length && products.length) {
      // A ProductGroup (Shopify's variants markup), or a Product nested in another node: Google reads them, schemaview doesn't check them.
      facts.push("Product rich result: not checked. The product page's Product markup is a ProductGroup (product variants) or a nested Product, which schemaview doesn't check against Google's rules.");
    } else if (!features.length && OTHER_SYNTAX_PRODUCT.test(page.html)) {
      facts.push("Product rich result: not checked. The product page marks up its Product with Microdata or RDFa, which schemaview doesn't read.");
    } else if (!features.length) {
      facts.push("Product rich result: none, because the product page has no Product markup.");
      findings.push(own("product-markup-missing", "warning", "The product page has no Product structured data, so it can't get Product snippet or Merchant listing rich results.", url));
    } else if (result.errorCount === 0) {
      facts.push(`Product rich result: ${features.join(" and ")} valid.`);
    } else {
      facts.push(`Product rich result: ${features.join(" and ")} checked, but the product page's structured data has ${plural(result.errorCount, "error")}.`);
    }
  }
  if (!checked) facts.push("No page could be read.");
  return section("structured-data", facts, findings, checked ? "pass" : "unavailable");
}

function headersSection(home: Page | null): Section {
  const headers = home?.fetched.headers;
  if (!home || !headers) return section("security-headers", ["The home page couldn't be fetched, so there were no headers to grade."], [], "unavailable");
  const url = home.fetched.record.finalUrl;
  const result = analyzeHeaders(normalizeHeaders(headers));
  const findings = result.rules
    .filter((r) => r.status !== "passed")
    .map((r) => own(r.id, r.status === "failed" ? "error" : "warning", `${r.name}: ${r.message}`, url, "security-header-audit"));
  return section("security-headers", [`Headers of ${url} (HTTP ${home.fetched.record.status}): ${result.score}/100, ${result.rating} (security-header-audit's score).`], findings);
}

// ---------------------------------------------------------------------------------------------

function totals(sections: Section[]) {
  return {
    errorCount: sections.reduce((n, s) => n + s.errorCount, 0),
    warningCount: sections.reduce((n, s) => n + s.warningCount, 0),
  };
}

/**
 * Checks what search engines and AI agents see on a store. Throws only for a bad start URL or bad
 * options; everything the site does wrong, and every request that fails, is part of the report.
 */
export async function checkStore(url: string, options: CheckOptions = {}): Promise<StoreReport> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_USER_AGENT } = options;
  const start = new URL("/", httpUrl(url, "url"));
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a whole number, 1 or more.");
  if (typeof userAgent !== "string" || !userAgent.trim()) throw new TypeError("userAgent must be a non-empty string.");
  if (options.fetch !== undefined && typeof options.fetch !== "function") throw new TypeError("fetch must be a function.");
  const productOption = options.productUrl === undefined ? null : httpUrl(options.productUrl, "productUrl");
  const bare = (host: string) => host.replace(/^www\./i, "");
  if (productOption && bare(productOption.host) !== bare(start.host)) {
    throw new TypeError(`productUrl must be on the store's host (${start.host}), got ${productOption.host}.`);
  }

  const checkedAt = new Date().toISOString();
  const net = createFetcher({
    fetch: options.fetch,
    timeoutMs,
    userAgent,
    maxRequests: MAX_REQUESTS,
    maxRedirects: MAX_REDIRECTS,
    budgetError: `not requested: store-check's limit of ${MAX_REQUESTS} requests per run was reached`,
  });
  // Two chains of at most MAX_REDIRECTS + 1 requests each fit in MAX_REQUESTS, so these
  // never run into the budget; the fetches after them stop when it runs out.
  const chainOptions = { maxHops: MAX_REDIRECTS, timeoutMs, userAgent, fetch: net.fetch };
  const startChain = await inspectRedirects(start.href, chainOptions);
  const requests = [chainRecord("start URL", startChain)];

  if (!startChain.hops.length) {
    const sections = (Object.keys(TITLES) as SectionId[]).map((id) =>
      id === "redirects" ? redirectsSection(startChain, null) : section(id, ["Not checked, because the site couldn't be reached."], [], "unavailable"),
    );
    return { url: start.href, site: start.origin, checkedAt, reachable: false, product: null, sections, crawlers: null, requests, requestCount: net.used, ...totals(sections) };
  }

  const httpChain = start.protocol === "https:" ? await inspectRedirects(`http://${start.hostname}/`, chainOptions) : null;
  if (httpChain) requests.push(chainRecord("http:// variant", httpChain));

  // Later checks run where the start URL ends up, which is the site search engines index.
  const siteUrl = startChain.finalStatus !== null ? new URL(startChain.finalUrl) : start;
  const site = siteUrl.origin;
  const siteHosts = [...new Set([start.host, siteUrl.host])];
  const get: Get = async (target, purpose, accept, maxBytes) => {
    const tooLargeError = `the body is larger than ${formatBytes(maxBytes)}, so store-check stopped reading it`;
    const { record, headers, body } = await net.get(target, { accept, maxBytes, tooLargeError });
    const fetched = { record: { purpose, ...record }, headers, body };
    requests.push(fetched.record);
    return fetched;
  };

  const robots = readRobots(await get(`${site}/robots.txt`, "robots.txt", ACCEPT_TEXT, ROBOTS_MAX_BYTES));
  const home = isSuccess(startChain.finalStatus) ? readPage("home page", await get(startChain.finalUrl, "home page", ACCEPT_HTML, HTML_MAX_BYTES)) : null;
  const sitemap = await checkSitemap(get, robots.result, site, siteHosts);

  const picked = pickProductUrl(sitemap.locs, siteHosts);
  const product: StoreReport["product"] = productOption ? { url: productOption.href, source: "option" } : picked ? { url: picked, source: "sitemap" } : null;
  const productPage = product ? readPage("product page", await get(product.url, "product page", ACCEPT_HTML, HTML_MAX_BYTES)) : null;

  const llms = llmsSection(await get(`${site}/llms.txt`, "llms.txt", ACCEPT_MARKDOWN, LLMS_MAX_BYTES));

  const homeSection = home
    ? metadataSection("home-page", home)
    : section("home-page", [`Not fetched, because ${start.href} didn't end at a 2xx page (see Redirects and HTTPS).`], [], "unavailable");
  let productSection: Section;
  if (productPage && product) {
    productSection = metadataSection("product-page", productPage, product.source === "option" ? ", given as productUrl" : ", picked from the sitemap");
  } else {
    const why = sitemap.locs.length
      ? "No product URL found in the sitemap (store-check looks for /products/<handle> and /product/<slug> paths)."
      : "No product URL found, because no sitemap with page URLs could be read.";
    productSection = section("product-page", [`${why} Pass one with productUrl (--product on the command line).`], [], "skipped");
  }
  const crawlers = crawlersSection(robots, home?.fetched.record.finalUrl ?? startChain.finalUrl, product?.url ?? null);

  const sections = [
    redirectsSection(startChain, httpChain),
    robots.section,
    crawlers.section,
    sitemap.section,
    llms,
    homeSection,
    productSection,
    structuredDataSection(home, productPage),
    headersSection(home),
  ];
  return { url: start.href, site, checkedAt, reachable: true, product, sections, crawlers: crawlers.access, requests, requestCount: net.used, ...totals(sections) };
}
