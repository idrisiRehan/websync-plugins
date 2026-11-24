#!/usr/bin/env node
// Command-line front end. Reads a robots.txt from a file, stdin or URL, prints the
// lintRobotsTxt() findings, and optionally tests one URL or reports AI crawler access. Rules live
// in lint.ts.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { lintRobotsTxt, type RobotsTxtResult } from "./lint.ts";
import { aiCrawlerReport, isAllowed, type AiCrawlerAccess } from "./access.ts";
import type { AccessDecision } from "./match.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// Google reads the first 500 KiB. Reading up to 1 MiB lets the linter report a file over that
// limit; the cap only stops a huge or endless response from exhausting memory.
const MAX_BYTES = 1024 * 1024;

const USAGE = `Usage:
  robots-txt-lint <file | url | -> [options]

Lints a robots.txt against RFC 9309 and Google's documented behaviour. A URL
whose path is empty or "/" (https://example.com) fetches /robots.txt from that
origin; any other URL is fetched as given.

Options:
  --test <url-or-path>   Say whether a crawler may fetch this URL, and which rule decides
  --user-agent <token>   Product token for --test, such as Googlebot (default *)
  --ai                   Show which AI crawlers may crawl the site
  --json                 Print the result as JSON
  --max-warnings <n>     Exit with code 1 when there are more than n warnings
  --timeout <ms>         Request timeout for URLs in milliseconds (default 15000)
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.
A /robots.txt URL that answers 4xx (except 429) exits 0: crawlers may then crawl
everything.`;

class UsageError extends Error {}

const TOO_LARGE = `The input is larger than ${MAX_BYTES / (1024 * 1024)} MiB, so it was not linted. Google reads only the first 500 KiB of a robots.txt.`;

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function decode(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8, which RFC 9309 s2.3 requires.`);
  }
}

interface Source {
  label: string;
  text: string;
  /** The URL that was requested, before redirects: crawlers apply the rules to its host. */
  url?: string;
  /** HTTP status, for URLs. */
  status?: number;
}

/** Reads at most MAX_BYTES, so an endless stdin (curl from a bad server) or /dev/zero stops at the cap. */
async function readCapped(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new Error(TOO_LARGE); // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function readLocal(path: string): Promise<Source> {
  const label = path === "-" ? "stdin" : path;
  const bytes = await readCapped(path === "-" ? process.stdin : createReadStream(path));
  return { label, text: decode(bytes, label) };
}

/** A bare origin means "that site's robots.txt"; any other URL is fetched as given. */
function robotsTxtUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.pathname === "/" && !url.search && !url.hash) url.pathname = "/robots.txt";
  return url;
}

async function readUrl(url: URL, timeoutMs: number): Promise<Source> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `robots-txt-lint/${version} (+https://github.com/idrisiRehan/websync-plugins)`, accept: "text/plain, */*;q=0.1" },
  });
  const { status } = response;
  const label = `${response.url} (HTTP ${status})`;
  if (!response.ok) {
    await response.body?.cancel();
    // RFC 9309 s2.3.1.3: a 4xx means the file is unavailable and crawlers may crawl everything,
    // which is the same as an empty file. Google makes an exception of 429.
    if (status >= 400 && status < 500 && status !== 429) return { label, text: "", url: url.href, status };
    const unreachable = status >= 500 ? " RFC 9309 s2.3.1.4 tells crawlers to assume a complete disallow while the file is unreachable." : "";
    throw new Error(`${response.url} answered HTTP ${status}.${unreachable}`);
  }
  // A 2xx without a body (204) is an empty file.
  const bytes = response.body ? await readCapped(response.body) : new Uint8Array();
  return { label, text: decode(bytes, response.url), url: url.href, status };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatFindings(source: Source, result: RobotsTxtResult): string[] {
  // A 4xx at a URL other than /robots.txt says nothing about the site, so location-invalid shows.
  if (source.status !== undefined && source.status >= 400 && !result.findings.length) {
    return [`${source.label}: no robots.txt. Crawlers treat a 4xx as no file and may crawl everything (RFC 9309 s2.3.1.3).`];
  }
  const rules = result.groups.reduce((n, g) => n + g.rules.length, 0);
  const lines = [`${source.label}: ${plural(result.groups.length, "group")}, ${plural(rules, "rule")}, ${plural(result.sitemaps.length, "sitemap")}`];
  for (const f of result.findings) {
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${f.line !== null ? ` (line ${f.line})` : ""}`, `       ${f.message}`);
  }
  lines.push("", result.findings.length ? `${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}` : "No problems found.");
  return lines;
}

function groupText(group: AccessDecision["group"], lines: number[], userAgent: string): string {
  if (group === null) return "no group";
  const at = `line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`;
  return group === "*" ? `the * group, ${at}` : `the ${userAgent} group, ${at}`;
}

function formatTest(userAgent: string, d: AccessDecision): string[] {
  const verdict = d.allowed ? "ALLOWED" : "BLOCKED";
  let reason: string;
  if (d.rule) reason = `by line ${d.rule.line}, "${d.rule.type === "allow" ? "Allow" : "Disallow"}: ${d.rule.pattern}"`;
  else if (d.path === "/robots.txt") reason = "because /robots.txt is always allowed";
  else if (d.group === null) reason = `because no group applies to ${userAgent}`;
  else reason = "because no rule matches";
  return ["", `Test: ${d.path} as ${userAgent}`, `${verdict} ${reason} (${groupText(d.group, d.groupLines, userAgent)})`];
}

function formatAi(report: AiCrawlerAccess[]): string[] {
  const rows = report.map((c) => [c.token, c.operator, c.purpose, c.access, c.group === null ? "no group" : `${c.group === "*" ? "*" : "own"} (line ${c.groupLines.join(", ")})`]);
  const head = ["Token", "Operator", "Purpose", "Access", "Group"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const row = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ");
  const notes = report.filter((c) => c.note).map((c) => `  ${c.token}: ${c.note}`);
  const checked = report.map((c) => c.checked).sort()[0];
  return ["", `AI crawlers, by the rules that apply to each (list checked ${checked}):`, row(head), ...rows.map(row), "", "Notes from the operators:", ...notes];
}

interface Options {
  json: boolean;
  maxWarnings: number | undefined;
  timeout: number;
  test: string | undefined;
  userAgent: string;
  ai: boolean;
}

async function run(target: string, options: Options): Promise<number> {
  const source = /^https?:\/\//i.test(target) ? await readUrl(robotsTxtUrl(target), options.timeout) : await readLocal(target);
  const result = lintRobotsTxt(source.text, { url: source.url });
  const test = options.test === undefined ? undefined : isAllowed(result, options.userAgent, options.test);
  const ai = options.ai ? aiCrawlerReport(result) : undefined;

  if (options.json) {
    const testJson = test && { userAgent: options.userAgent, url: options.test, ...test };
    console.log(JSON.stringify({ source: source.label, status: source.status, ...result, test: testJson, ai }, null, 2));
  } else {
    const lines = formatFindings(source, result);
    if (test) lines.push(...formatTest(options.userAgent, test));
    if (ai) lines.push(...formatAi(ai));
    console.log(lines.join("\n"));
  }
  const tooManyWarnings = options.maxWarnings !== undefined && result.warningCount > options.maxWarnings;
  return result.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      test: { type: "string" },
      "user-agent": { type: "string" },
      ai: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "max-warnings": { type: "string" },
      timeout: { type: "string" },
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
  if (positionals.length !== 1) throw new UsageError("Give exactly one file, URL, or - for stdin.");
  if (values["user-agent"] !== undefined && values.test === undefined) throw new UsageError("--user-agent goes with --test.");

  const options: Options = {
    json: values.json,
    maxWarnings: parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER),
    timeout: parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 15_000,
    test: values.test,
    userAgent: values["user-agent"] ?? "*",
    ai: values.ai,
  };
  if (options.test !== undefined) {
    // Checks the token and URL before anything is fetched; an empty file has no rules to apply.
    try {
      isAllowed("", options.userAgent, options.test);
    } catch (error) {
      throw new UsageError(`--test and --user-agent: ${(error as Error).message}`);
    }
  }
  return run(positionals[0], options);
}

function errorMessage(error: unknown): string {
  const help = 'Run "robots-txt-lint --help" for usage.';
  if (error instanceof UsageError) return `${error.message} ${help}`;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "The request timed out.";
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message} ${help}`;
  if (code === "ENOENT") return "File not found.";
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // One line, so the message reads cleanly in CI logs.
    console.error(`robots-txt-lint: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
