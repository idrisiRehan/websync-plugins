#!/usr/bin/env node
// Command-line front end: get headers (from a URL, a file or stdin), grade them with
// analyzeHeaders(), print the result. All grading logic lives in analyze.ts.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { analyzeHeaders, type HeaderAuditResult } from "./analyze.ts";
import { normalizeHeaders, parseRawHeaders, type NormalizedHeaders } from "./headers.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  security-header-audit <url> [options]
  security-header-audit --raw <file> [options]    (use - to read stdin, e.g. curl -sI <url> | ...)

Options:
  --raw <file>       Grade a raw HTTP header block instead of fetching a URL
  --json             Print the result as JSON
  --min-score <n>    Exit with code 1 when the score is below n (0-100)
  --timeout <ms>     Request timeout in milliseconds (default 10000)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes: 0 graded, 1 score below --min-score, 2 usage or network error.`;

const STATUS_LABEL = { passed: "PASS", warning: "WARN", failed: "FAIL" } as const;

class UsageError extends Error {}

interface Source {
  label: string;
  headers: NormalizedHeaders;
}

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function toUrl(input: string): URL {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError("Only http and https URLs can be fetched.");
  return url;
}

async function fetchHeaders(url: URL, timeoutMs: number): Promise<Source> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `security-header-audit/${version} (+https://websync.in/tools/security-header-checker/)` },
  });
  // Only the headers are graded, so the body is never downloaded.
  await response.body?.cancel();
  return { label: `${response.url} (HTTP ${response.status})`, headers: normalizeHeaders(response.headers) };
}

function readRaw(file: string): Source {
  const text = readFileSync(file === "-" ? 0 : file, "utf8");
  const headers = parseRawHeaders(text);
  if (Object.keys(headers).length === 0) throw new UsageError("No headers found in the input.");
  return { label: file === "-" ? "stdin" : file, headers };
}

function formatText(source: Source, result: HeaderAuditResult): string {
  const lines = [source.label, `Score ${result.score}/100 (${result.rating})`, ""];
  for (const rule of result.rules) {
    const impact = rule.scoreImpact ? ` (-${rule.scoreImpact})` : "";
    lines.push(`${STATUS_LABEL[rule.status]}  ${rule.name}${impact}`, `      ${rule.message}`);
  }
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      raw: { type: "string" },
      json: { type: "boolean", default: false },
      "min-score": { type: "string" },
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

  const minScore = parseIntOption(values["min-score"], "min-score", 0, 100);
  const timeout = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 10_000;
  const hasUrl = positionals.length === 1;
  const hasRaw = values.raw !== undefined;
  if (hasUrl === hasRaw || positionals.length > 1) {
    throw new UsageError("Give exactly one URL, or --raw <file>.");
  }

  const source = hasRaw ? readRaw(values.raw as string) : await fetchHeaders(toUrl(positionals[0]), timeout);
  const result = analyzeHeaders(source.headers);

  console.log(values.json ? JSON.stringify({ source: source.label, ...result }, null, 2) : formatText(source, result));
  return minScore !== undefined && result.score < minScore ? 1 : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${USAGE}`;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "The request timed out.";
  if ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) return `${error.message}\n\n${USAGE}`;
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`security-header-audit: ${errorMessage(error)}`);
    process.exitCode = 2;
  },
);
