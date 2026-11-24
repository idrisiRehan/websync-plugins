// Turns access log lines into per-crawler statistics in one pass with bounded memory: counts are
// numbers, and the only per-key state is in fixed-size TopCounters, so a log with billions of
// lines and millions of distinct URLs needs the same memory as a small one.

import type { AiCrawlerPurpose } from "robots-txt-lint";
import { CRAWLERS, matchCrawler, type Crawler } from "./crawlers.ts";
import { IpRangeSet, networkOf, parseIp } from "./ip.ts";
import { LOG_FORMATS, parseLogLine, type LogFormat } from "./parse.ts";
import { detach, TopCounter } from "./top.ts";

/** Shopify product URLs contain /products/, WooCommerce's (by default) /product/. */
export const DEFAULT_PRODUCT_PATTERNS: readonly string[] = ["/products/", "/product/"];

/** Slots per top-paths counter. With m slots, any path with more than 1/m of the requests a counter sees always keeps a slot. */
export const TOP_SLOTS = 1000;
const NETWORK_SLOTS = 100;
/** Longer paths are cut to this many characters before counting, so one key stays small. */
const MAX_PATH = 1024;
/** User agents remembered with their crawler; the cache is emptied when it fills. */
const UA_CACHE = 10_000;
/** Longer user agents (real ones are a few hundred characters) are matched every time, never cached. */
const MAX_CACHED_UA = 1000;

export interface LogAnalyzerOptions {
  /** How to read lines (default "auto"). */
  format?: LogFormat;
  /** Paths that mark a product page (default DEFAULT_PRODUCT_PATTERNS); see the README for the syntax. */
  productPatterns?: readonly string[];
  /**
   * Published IP ranges keyed by the crawler table's `ipRanges` URL: an IpRangeSet or CIDR strings.
   * Crawlers whose list is missing here are counted as unverified.
   */
  ranges?: Readonly<Record<string, IpRangeSet | readonly string[]>>;
  /** Entries in each top list, 1 to 100 (default 20). */
  top?: number;
  /** Count the /24 or /48 networks that spoofed requests came from (default false). */
  networks?: boolean;
}

/**
 * checked: the operator's IP list was given, so requests are verified or spoofed.
 * unverifiable: the operator publishes no IP list.
 * unchecked: the operator publishes one, but it wasn't given.
 */
export type Verification = "checked" | "unverifiable" | "unchecked";

export interface PathCount {
  path: string;
  /** An upper bound; exact when `overcount` is 0 (see TOP_SLOTS). */
  requests: number;
  overcount: number;
}

export interface NetworkCount {
  network: string;
  requests: number;
  overcount: number;
}

export interface StatusClasses {
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
}

export interface CrawlerStats {
  token: string;
  operator: string;
  kind: "ai" | "search";
  purpose: AiCrawlerPurpose | null;
  ipRanges: string | null;
  verification: Verification;
  /** Every request whose User-Agent names the crawler. */
  requests: number;
  /** From an address in the operator's list. */
  verified: number;
  /** From an address outside the operator's list. */
  spoofed: number;
  /** Not checked: no list (see `verification`), or the logged client isn't an IP address. */
  unverified: number;
  // The fields below describe the requests that weren't spoofed (verified plus unverified).
  status: StatusClasses;
  /** Response bytes, or null when no line logged a size. */
  bytes: number | null;
  /** ISO 8601 times of the first and last request, or null when no line had a readable time. */
  firstSeen: string | null;
  lastSeen: string | null;
  productPages: number;
  robotsTxt: number;
  /** Requests for /llms.txt or /llms-full.txt. */
  llmsTxt: number;
  /** Requests for an .xml or .xml.gz file with "sitemap" in its name. */
  sitemaps: number;
  topPaths: PathCount[];
  topProducts: PathCount[];
  /** Paths that answered 4xx or 5xx, by how often they did. */
  topErrors: PathCount[];
  /** Networks that spoofed requests came from, or null unless `networks` was set. */
  spoofedNetworks: NetworkCount[] | null;
}

export interface LogReport {
  /** Non-blank lines read. */
  lines: number;
  parsed: number;
  unparsed: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** AI crawlers, then the search engine baseline, in table order, including those never seen. */
  crawlers: CrawlerStats[];
  /** Requests from everything else, including lines with no User-Agent. */
  other: { requests: number; bytes: number | null };
}

export interface LogAnalyzer {
  /** Reads one log line. Blank lines are skipped; lines that can't be read are counted. */
  add(line: string): void;
  /** The statistics so far. Can be called at any time, and adding can continue afterwards. */
  result(): LogReport;
}

class TimeSpan {
  first = Infinity;
  last = -Infinity;
  add(time: number | null): void {
    if (time === null) return;
    if (time < this.first) this.first = time;
    if (time > this.last) this.last = time;
  }
  get start(): string | null {
    return Number.isFinite(this.first) ? new Date(this.first).toISOString() : null;
  }
  get end(): string | null {
    return Number.isFinite(this.last) ? new Date(this.last).toISOString() : null;
  }
}

class Bytes {
  total = 0;
  seen = false;
  add(bytes: number | null): void {
    if (bytes === null) return;
    this.total += bytes;
    this.seen = true;
  }
  get value(): number | null {
    return this.seen ? this.total : null;
  }
}

interface State {
  crawler: Crawler;
  ranges: IpRangeSet | null;
  requests: number;
  verified: number;
  spoofed: number;
  unverified: number;
  status: StatusClasses;
  bytes: Bytes;
  span: TimeSpan;
  productPages: number;
  robotsTxt: number;
  llmsTxt: number;
  sitemaps: number;
  paths: TopCounter;
  products: TopCounter;
  errors: TopCounter;
  networks: TopCounter | null;
}

/** The path of a request target, without query or fragment, or null for "*" and unreadable targets. */
function pathOf(target: string | null): string | null {
  if (target === null) return null;
  let path = target;
  if (!path.startsWith("/")) {
    // Absolute form, as sent to proxies: http://host/path.
    const m = /^https?:\/\/[^/?#]*/i.exec(path);
    if (!m) return null;
    path = path.slice(m[0].length) || "/";
    if (!path.startsWith("/")) path = `/${path}`;
  }
  const end = path.search(/[?#]/);
  if (end !== -1) path = path.slice(0, end);
  return path.length > MAX_PATH ? path.slice(0, MAX_PATH) : path;
}

const SITEMAP_FILE = /\/[^/]*sitemap[^/]*\.xml(?:\.gz)?$/i;

/**
 * A product pattern is a path fragment that may contain "*" for any run of characters. It matches
 * a path that contains it anywhere and continues past it, so "/products/" matches
 * "/en-gb/products/wool-runner" but not "/products/" itself.
 */
function compilePattern(pattern: string): (path: string) => boolean {
  if (typeof pattern !== "string" || !pattern.startsWith("/") || pattern.length > 200 || /\s/.test(pattern)) {
    throw new TypeError(`A product pattern is a path fragment starting with "/", such as "/products/", got ${JSON.stringify(pattern)}.`);
  }
  const pieces = pattern.split("*").filter(Boolean);
  return (path) => {
    let at = 0;
    for (const piece of pieces) {
      const found = path.indexOf(piece, at);
      if (found === -1) return false;
      at = found + piece.length;
    }
    return at < path.length;
  };
}

function rangeSets(ranges: LogAnalyzerOptions["ranges"]): Map<string, IpRangeSet> {
  const sets = new Map<string, IpRangeSet>();
  if (ranges === undefined) return sets;
  if (ranges === null || typeof ranges !== "object") throw new TypeError("ranges must be an object keyed by IP list URL.");
  for (const [url, value] of Object.entries(ranges)) {
    if (value instanceof IpRangeSet) sets.set(url, value);
    else if (Array.isArray(value)) sets.set(url, new IpRangeSet(value));
    else throw new TypeError(`ranges["${url}"] must be an IpRangeSet or an array of CIDR strings.`);
  }
  return sets;
}

const toPathCounts = (counter: TopCounter, n: number): PathCount[] => counter.top(n).map(({ key, count, overcount }) => ({ path: key, requests: count, overcount }));

/** Creates an analyzer. Throws a TypeError for invalid options. */
export function createLogAnalyzer(options: LogAnalyzerOptions = {}): LogAnalyzer {
  const format = options.format ?? "auto";
  if (!LOG_FORMATS.includes(format)) throw new TypeError(`format must be one of ${LOG_FORMATS.join(", ")}, got ${JSON.stringify(format)}.`);
  const top = options.top ?? 20;
  if (!Number.isInteger(top) || top < 1 || top > 100) throw new TypeError(`top must be a whole number from 1 to 100, got ${top}.`);
  const productPatterns = options.productPatterns ?? DEFAULT_PRODUCT_PATTERNS;
  if (!Array.isArray(productPatterns)) throw new TypeError("productPatterns must be an array of path fragments.");
  const matchers = productPatterns.map(compilePattern);
  const isProduct = (path: string) => matchers.some((m) => m(path));
  const sets = rangeSets(options.ranges);

  const states = new Map<Crawler, State>(
    CRAWLERS.map((crawler) => [
      crawler,
      {
        crawler,
        ranges: (crawler.ipRanges && sets.get(crawler.ipRanges)) || null,
        requests: 0,
        verified: 0,
        spoofed: 0,
        unverified: 0,
        status: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
        bytes: new Bytes(),
        span: new TimeSpan(),
        productPages: 0,
        robotsTxt: 0,
        llmsTxt: 0,
        sitemaps: 0,
        paths: new TopCounter(TOP_SLOTS),
        products: new TopCounter(TOP_SLOTS),
        errors: new TopCounter(TOP_SLOTS),
        networks: options.networks ? new TopCounter(NETWORK_SLOTS) : null,
      },
    ]),
  );

  let lines = 0;
  let parsed = 0;
  const span = new TimeSpan();
  let otherRequests = 0;
  const otherBytes = new Bytes();
  const uaCache = new Map<string, Crawler | null>();

  function crawlerFor(userAgent: string | null): Crawler | null {
    if (userAgent === null) return null;
    let crawler = uaCache.get(userAgent);
    if (crawler === undefined) {
      crawler = matchCrawler(userAgent);
      if (userAgent.length <= MAX_CACHED_UA) {
        if (uaCache.size >= UA_CACHE) uaCache.clear();
        uaCache.set(detach(userAgent), crawler);
      }
    }
    return crawler;
  }

  function add(line: string): void {
    if (typeof line !== "string" || line.trim() === "") return;
    lines++;
    const entry = parseLogLine(line, format);
    if (!entry) return;
    parsed++;
    span.add(entry.time);

    const crawler = crawlerFor(entry.userAgent);
    if (!crawler) {
      otherRequests++;
      otherBytes.add(entry.bytes);
      return;
    }
    const s = states.get(crawler)!;
    s.requests++;
    const address = s.ranges && entry.ip !== null ? parseIp(entry.ip) : null;
    if (!s.ranges || !address) {
      s.unverified++;
    } else if (s.ranges.has(address)) {
      s.verified++;
    } else {
      s.spoofed++;
      s.networks?.add(networkOf(address));
      return;
    }

    s.span.add(entry.time);
    s.bytes.add(entry.bytes);
    const status = entry.status;
    if (status !== null && status >= 200) s.status[`${Math.floor(status / 100)}xx` as keyof StatusClasses]++;

    const path = pathOf(entry.target);
    if (path === null) return;
    s.paths.add(path);
    if (status !== null && status >= 400) s.errors.add(path);
    if (isProduct(path)) {
      s.productPages++;
      s.products.add(path);
    }
    if (path === "/robots.txt") s.robotsTxt++;
    else if (path === "/llms.txt" || path === "/llms-full.txt") s.llmsTxt++;
    else if (SITEMAP_FILE.test(path)) s.sitemaps++;
  }

  function result(): LogReport {
    const crawlers = [...states.values()].map((s): CrawlerStats => {
      const { token, operator, kind, purpose, ipRanges } = s.crawler;
      return {
        token,
        operator,
        kind,
        purpose,
        ipRanges,
        verification: s.ranges ? "checked" : ipRanges ? "unchecked" : "unverifiable",
        requests: s.requests,
        verified: s.verified,
        spoofed: s.spoofed,
        unverified: s.unverified,
        status: { ...s.status },
        bytes: s.bytes.value,
        firstSeen: s.span.start,
        lastSeen: s.span.end,
        productPages: s.productPages,
        robotsTxt: s.robotsTxt,
        llmsTxt: s.llmsTxt,
        sitemaps: s.sitemaps,
        topPaths: toPathCounts(s.paths, top),
        topProducts: toPathCounts(s.products, top),
        topErrors: toPathCounts(s.errors, top),
        spoofedNetworks: s.networks ? s.networks.top(top).map(({ key, count, overcount }) => ({ network: key, requests: count, overcount })) : null,
      };
    });
    return {
      lines,
      parsed,
      unparsed: lines - parsed,
      firstSeen: span.start,
      lastSeen: span.end,
      crawlers,
      other: { requests: otherRequests, bytes: otherBytes.value },
    };
  }

  return { add, result };
}
