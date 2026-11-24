#!/usr/bin/env node
// Command-line front end: read a feed, fetch the pages of its first --limit items, compare each
// item with its page (check.ts) and print the report. Every page request goes through one
// fetcher (redirect-inspector's createFetcher), which counts it against the run's request
// budget, puts a timeout on it, follows redirects one hop at a time (so each hop is counted),
// reads bodies only up to a byte cap while they stream, and cancels the bodies it doesn't need.
// Each URL is requested at most once per run: hops are cached, so two links that redirect to
// the same page share it.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readFeedItems, type FeedFinding, type FeedFormat, type TargetName } from "product-feed-lint";
import { checkItem, countFindings, feedValues, linkOf, parsePage, type Finding, type ItemResult, type ParsedPage } from "./check.ts";
import { createFetcher, type FetchRecord } from "redirect-inspector";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// The same cap as product-feed-lint's CLI: the whole feed is held in memory.
const MAX_FEED_BYTES = 100 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 10_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
/** The request budget per checked item: the page and two redirects, on average. */
const REQUESTS_PER_ITEM = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Well above the size of typical product pages; the same cap as store-check and schemaview. */
const PAGE_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT_HTML = "text/html, application/xhtml+xml;q=0.9, */*;q=0.1";

const USAGE = `Usage:
  feed-page-check <feed | url | -> [options]

Fetches the product page of each item in a Google Merchant Center or OpenAI
product feed and compares the feed's price, sale price, currency and
availability with the page's Product structured data (JSON-LD).

Options:
  --target <name>       google or openai (default: google)
  --format <name>       google: tsv or xml; openai: jsonl, csv or tsv
                        (default: detected from the content)
  --limit <n>           Check the first n items (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT})
  --concurrency <n>     Pages fetched at the same time (default ${DEFAULT_CONCURRENCY}, at most ${MAX_CONCURRENCY})
  --timeout <ms>        Timeout for each request in milliseconds (default ${DEFAULT_TIMEOUT_MS})
  --json                Print the report as JSON
  --max-warnings <n>    Exit with code 1 when there are more than n warnings
  -h, --help            Show this help
  -v, --version         Show the version

At most ${REQUESTS_PER_ITEM} requests per checked item, redirects included; each URL is
requested once. Exit codes: 0 no errors, 1 errors (or too many warnings),
2 usage error, unreadable feed, or no page could be fetched.`;

class UsageError extends Error {}

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Reads at most MAX_FEED_BYTES, so an endless stdin or response stops at the cap. */
async function readCapped(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > MAX_FEED_BYTES) throw new Error(`The feed is larger than ${MAX_FEED_BYTES / (1024 * 1024)} MB, so it was not read.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/** UTF-8, or UTF-16 with a byte order mark: the encodings Merchant Center accepts. */
function decode(bytes: Uint8Array, label: string): string {
  if ((bytes[0] === 0x1f && bytes[1] === 0x8b) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error(`${label} is compressed (gzip or zip). Decompress it first.`);
  }
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  try {
    return new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid ${utf16 ? "UTF-16" : "UTF-8"}.`);
  }
}

/** Decodes a page with the charset the server names when the platform knows it, else as UTF-8. */
function decodePage(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

async function readFeed(target: string, timeoutMs: number, userAgent: string): Promise<{ label: string; text: string }> {
  if (!/^https?:\/\//i.test(target)) {
    const label = target === "-" ? "stdin" : target;
    return { label, text: decode(await readCapped(target === "-" ? process.stdin : createReadStream(target)), label) };
  }
  if (!URL.canParse(target)) throw new UsageError(`Not a valid URL: ${target}`);
  const response = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": userAgent } });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${response.url} answered HTTP ${response.status}.`);
  }
  return { label: `${response.url} (HTTP ${response.status})`, text: decode(await readCapped(response.body), response.url) };
}

/** Runs `fn` on every entry, at most `limit` at a time. */
async function eachConcurrently<T>(list: readonly T[], limit: number, fn: (entry: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < list.length) await fn(list[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

interface CliItem extends ItemResult {
  /** The fetch of the item's link, or null when it has none that can be fetched. */
  fetch: FetchRecord | null;
}

interface Report {
  source: string;
  target: TargetName;
  format: FeedFormat | null;
  /** ISO 8601 time the check started. */
  checkedAt: string;
  itemCount: number;
  /** Items looked at: the first --limit. */
  selectedCount: number;
  /** Items compared with a page. */
  checkedCount: number;
  errorCount: number;
  warningCount: number;
  /** HTTP requests made for pages, redirects included. */
  requestCount: number;
  items: CliItem[];
  feedFindings: FeedFinding[];
}

const LABEL = { error: "ERROR", warning: "WARN " } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describeFetch(record: FetchRecord): string {
  const status = record.status === null ? "no response" : `HTTP ${record.status}`;
  const redirects = record.redirects ? `, ${plural(record.redirects, "redirect")} to ${record.finalUrl}` : "";
  return `${status}${redirects}`;
}

function unavailableHint(status: number | null): string {
  if (status === 404 || status === 410) return " Check that the link is the product's current URL.";
  if (status === null || status === 401 || status === 403 || status === 429 || status === 503) {
    return " Bot protection, rate limits and geo blocking can refuse this tool and still let Google's crawler in, so this isn't necessarily what Google sees.";
  }
  return "";
}

function formatText(report: Report): string {
  const unit = report.format === "tsv" || report.format === "csv" ? "row" : "line";
  const lines = [`${report.source}: ${report.target}, ${report.format}, ${plural(report.itemCount, "item")}`];
  if (report.feedFindings.length) {
    lines.push(`The feed has ${plural(report.feedFindings.length, "reading problem")}; run product-feed-lint on it for details.`);
  }
  let clean = 0;
  for (const item of report.items) {
    if (!item.findings.length) {
      clean++;
      continue;
    }
    const { feed, page } = item;
    lines.push("", `${item.id ?? "(no id)"} (${unit} ${item.line})`);
    if (item.link) lines.push(`  link  ${item.link}${item.fetch ? ` (${describeFetch(item.fetch)})` : ""}`);
    const sale = feed.salePrice ? `, sale_price ${feed.salePrice}${feed.saleActive ? " (current)" : " (not current)"}` : "";
    lines.push(`  feed  price ${feed.price ?? "none"}${sale}, availability ${feed.availability ?? "none"}`);
    if (page) {
      const price = page.price ?? (page.lowPrice !== null || page.highPrice !== null ? `${page.lowPrice ?? "?"} to ${page.highPrice ?? "?"}` : "none");
      const original = page.originalPrice ? ` (was ${page.originalPrice})` : "";
      lines.push(`  page  price ${price}${page.currency ? ` ${page.currency}` : ""}${original}, availability ${page.availability ?? "none"}; line ${page.line}, matched: ${page.matchedBy}`);
    }
    for (const f of item.findings) {
      lines.push(`  ${LABEL[f.severity]}  ${f.rule}${f.line !== null ? ` (page line ${f.line})` : ""}`, `         ${f.message}`);
    }
  }
  if (clean) lines.push("", `${plural(clean, "item")} ${clean === 1 ? "matches its page" : "match their pages"}.`);
  const skipped = report.itemCount - report.selectedCount;
  const scope = `${report.checkedCount} of ${plural(report.itemCount, "item")} compared with their pages${skipped ? ` (the first ${report.selectedCount}; raise --limit for more)` : ""}`;
  lines.push("", `${plural(report.errorCount, "error")}, ${plural(report.warningCount, "warning")}. ${scope}. ${plural(report.requestCount, "request")}.`);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      format: { type: "string" },
      limit: { type: "string" },
      concurrency: { type: "string" },
      timeout: { type: "string" },
      json: { type: "boolean", default: false },
      "max-warnings": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(version);
    return 0;
  }

  const target = (values.target ?? "google") as TargetName;
  const format = values.format as FeedFormat | undefined;
  try {
    // Reading an empty feed checks the options the same way product-feed-lint does, before any input is read.
    readFeedItems("", { target, format });
  } catch (error) {
    throw new UsageError((error as Error).message.replaceAll("options.", "--"));
  }
  const limit = parseIntOption(values.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const concurrency = parseIntOption(values.concurrency, "concurrency", 1, MAX_CONCURRENCY) ?? DEFAULT_CONCURRENCY;
  const timeoutMs = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? DEFAULT_TIMEOUT_MS;
  const maxWarnings = parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER);
  if (positionals.length !== 1) throw new UsageError("Give exactly one feed file, URL, or - for stdin.");
  const userAgent = `feed-page-check/${version} (+https://github.com/idrisiRehan/websync-plugins)`;

  const checkedAt = new Date();
  const source = await readFeed(positionals[0], timeoutMs, userAgent);
  const feed = readFeedItems(source.text, { target, format });
  if (!feed.items.length) {
    const problem = feed.findings.find((f) => f.severity === "error");
    throw new Error(`${source.label}: ${problem ? problem.message : "The feed has no items."} Run product-feed-lint on it for details.`);
  }

  const now = checkedAt.getTime();
  const selected = feed.items.slice(0, limit);
  const fetcher = createFetcher({ timeoutMs, userAgent, maxRequests: selected.length * REQUESTS_PER_ITEM });
  const pageOptions = {
    accept: ACCEPT_HTML,
    maxBytes: PAGE_MAX_BYTES,
    tooLargeError: `the page is larger than ${PAGE_MAX_BYTES / (1024 * 1024)} MiB, so feed-page-check stopped reading it`,
    cacheHops: true,
    // Each page is parsed once, so only its values are kept, not its body.
    read: (bytes: Uint8Array, headers: Headers, url: string) => parsePage(url, decodePage(bytes, headers.get("content-type")), now),
  };
  const links = [...new Set(selected.map((item) => linkOf(item, target)).filter((link): link is string => link !== null))];
  const pages = new Map<string, { record: FetchRecord; value: ParsedPage | null }>();
  await eachConcurrently(links, concurrency, async (link) => {
    const { record, body } = await fetcher.get(link, pageOptions);
    // Here a status other than 2xx is a failure too.
    if (!record.error && !body) record.error = `HTTP ${record.status}`;
    pages.set(link, { record, value: body });
  });

  let checkedCount = 0;
  const items = selected.map((item): CliItem => {
    const link = linkOf(item, target);
    const fetched = link === null ? undefined : pages.get(link);
    if (fetched?.value) {
      checkedCount++;
      return { ...checkItem(item, target, fetched.value, now), fetch: fetched.record };
    }
    const written = item.attributes[target === "google" ? "link" : "url"]?.[0] ?? null;
    const finding: Finding = fetched
      ? { rule: "page-unavailable", severity: "warning", message: `The page couldn't be fetched (${fetched.record.error ?? describeFetch(fetched.record)}), so it wasn't compared.${unavailableHint(fetched.record.status)}`, line: null }
      : { rule: "link-unusable", severity: "warning", message: written === null ? `The item has no ${target === "google" ? "link" : "url"}, so there is no page to compare.` : `The link "${written}" isn't an absolute http or https URL, so its page wasn't fetched.`, line: null };
    return { id: item.id, line: item.line, link: written, feed: feedValues(item, target, now), page: null, findings: [finding], fetch: fetched?.record ?? null };
  });

  if (checkedCount === 0) {
    if (!links.length) throw new Error(`No item has an http or https ${target === "google" ? "link" : "url"} to fetch.`);
    const first = pages.get(links[0])!.record;
    const why = first.error ?? describeFetch(first);
    throw new Error(links.length === 1 ? `The page ${first.url} couldn't be fetched: ${why}.` : `None of the ${links.length} pages could be fetched. The first, ${first.url}, failed: ${why}.`);
  }
  const report: Report = { source: source.label, target, format: feed.format, checkedAt: checkedAt.toISOString(), itemCount: feed.items.length, selectedCount: selected.length, checkedCount, ...countFindings(items), requestCount: fetcher.used, items, feedFindings: feed.findings };
  console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report));
  const tooManyWarnings = maxWarnings !== undefined && report.warningCount > maxWarnings;
  return report.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  const help = 'Run "feed-page-check --help" for usage.';
  if (error instanceof UsageError) return `${error.message} ${help}`;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "The request for the feed timed out.";
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message} ${help}`;
  if (code === "ENOENT") return "File not found.";
  if (code === "EISDIR") return "That is a directory, not a file.";
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // One line, so the message reads cleanly in CI logs.
    console.error(`feed-page-check: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
