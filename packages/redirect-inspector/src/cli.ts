#!/usr/bin/env node
// Command-line front end: inspect each URL (or each line of a redirect map) with
// inspectRedirects(), compare final URLs with what was expected, print the results.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inspectRedirects, DEFAULT_MAX_HOPS, DEFAULT_TIMEOUT_MS, REDIRECT_STATUSES, type RedirectResult } from "./inspect.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  redirect-inspector <url...> [options]
  redirect-inspector --map <file> [options]

Options:
  --json               Print the results as a JSON array
  --expect <url>       Exit with code 1 unless the chain ends at this URL (one URL only)
  --map <file>         Check a redirect map: one "from-url target-url" pair per line
  --max-hops <n>       Redirects to follow before stopping (default ${DEFAULT_MAX_HOPS})
  --timeout <ms>       Timeout for each request in milliseconds (default ${DEFAULT_TIMEOUT_MS})
  --method <method>    GET (default, the body is never read) or HEAD
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors or a final URL that doesn't match, 2 usage, input or network error.`;

// Map lines are checked a few at a time, so a long map finishes quickly without flooding a server.
const CONCURRENCY = 4;

class UsageError extends Error {}

interface Entry {
  url: string;
  expected?: string;
}

interface Checked extends RedirectResult {
  expected?: string;
  matches?: boolean;
}

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function httpUrl(input: string, base?: string): string {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`Only http and https URLs can be inspected: ${input}`);
  return url.href;
}

/** Reads "from-url target-url" lines. A target may be a path, resolved against its from-url. */
function readMap(file: string): Entry[] {
  const entries: Entry[] = [];
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      const fields = line.split(/\s+/);
      try {
        if (fields.length !== 2) throw new UsageError(`expected "from-url target-url", found ${fields.length} fields.`);
        const url = httpUrl(fields[0]);
        entries.push({ url, expected: httpUrl(fields[1], url) });
      } catch (error) {
        throw new UsageError(`${file} line ${i + 1}: ${(error as Error).message}`);
      }
    });
  if (entries.length === 0) throw new UsageError(`${file} has no redirects to check.`);
  return entries;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Where the chain ended, or null when it never reached a final response (a failed request,
// a loop, too many hops, a redirect with no usable Location). Only then can it match.
function endedAt(r: RedirectResult): string | null {
  return r.finalStatus === null || REDIRECT_STATUSES.has(r.finalStatus) ? null : r.finalUrl;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatText(r: Checked): string {
  const lines = [r.url];
  for (const hop of r.hops) lines.push(`  ${hop.status}  ${String(hop.durationMs).padStart(5)} ms  ${hop.url}`);
  for (const f of r.findings) {
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${f.hop !== null ? ` (hop ${f.hop})` : ""}`, `       ${f.message}`);
  }
  if (r.finalStatus !== null) lines.push(`Final: ${r.finalStatus} ${r.finalUrl} after ${plural(r.hops.length - 1, "redirect")}`);
  if (r.expected !== undefined) {
    const ended = endedAt(r);
    const outcome = ended === null ? "but the chain never reached a final response" : `ended at ${ended}`;
    lines.push(r.matches ? `OK  ends at the expected ${r.expected}` : `MISMATCH  expected ${r.expected}, ${outcome}`);
  }
  lines.push(r.findings.length ? `${plural(r.errorCount, "error")}, ${plural(r.warningCount, "warning")}` : "No problems found.");
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      expect: { type: "string" },
      map: { type: "string" },
      "max-hops": { type: "string" },
      timeout: { type: "string" },
      method: { type: "string" },
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

  const maxHops = parseIntOption(values["max-hops"], "max-hops", 0, 50);
  const timeoutMs = parseIntOption(values.timeout, "timeout", 1, 120_000);
  const method = (values.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new UsageError("--method must be GET or HEAD.");

  let entries: Entry[];
  if (values.map !== undefined) {
    if (positionals.length || values.expect !== undefined) throw new UsageError("--map can't be combined with URLs or --expect.");
    entries = readMap(values.map);
  } else {
    if (positionals.length === 0) throw new UsageError("Give at least one URL, or --map <file>.");
    if (values.expect !== undefined && positionals.length !== 1) throw new UsageError("--expect works with exactly one URL.");
    entries = positionals.map((url) => ({ url: httpUrl(url) }));
    if (values.expect !== undefined) entries[0].expected = httpUrl(values.expect);
  }

  const userAgent = `redirect-inspector/${version} (+https://github.com/idrisiRehan/websync-plugins)`;
  const results = await mapLimit(entries, CONCURRENCY, async ({ url, expected }): Promise<Checked> => {
    const result = await inspectRedirects(url, { maxHops, timeoutMs, method, userAgent });
    return expected === undefined ? result : { ...result, expected, matches: endedAt(result) === expected };
  });

  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(results.map(formatText).join("\n\n"));
    if (results.length > 1) {
      const failing = results.filter((r) => !r.valid).length;
      const mismatches = results.filter((r) => r.matches === false).length;
      const expectations = values.map !== undefined ? `, ${mismatches} not at the expected URL` : "";
      console.log(`\n${plural(results.length, "URL")} checked: ${failing} with errors${expectations}.`);
    }
  }

  const failedRequests = results.filter((r) => r.findings.some((f) => f.rule === "request-failed")).length;
  if (failedRequests) {
    console.error(`redirect-inspector: ${plural(failedRequests, "request")} failed.`);
    return 2;
  }
  return results.some((r) => !r.valid || r.matches === false) ? 1 : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${USAGE}`;
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message}\n\n${USAGE}`;
  if (code === "ENOENT") return "File not found.";
  return error.message;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`redirect-inspector: ${errorMessage(error)}`);
    process.exitCode = 2;
  },
);
