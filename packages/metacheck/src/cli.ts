#!/usr/bin/env node
// Command-line front end: read a page (file, stdin or URL), lint it with lintMetadata(), print
// the findings. All rules live in lint.ts.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { lintMetadata, type MetadataResult } from "./lint.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

/** Read cap for any input. Real HTML pages are far smaller; this stops runaway responses. */
const MAX_BYTES = 10 * 1024 * 1024;

const USAGE = `Usage:
  metacheck <file | url | -> [options]

  Reads an HTML page from a file, an http(s) URL, or stdin (-) and checks its SEO and
  sharing metadata.

Options:
  --json               Print the result as JSON
  --url <page-url>     The page's own URL, for file or stdin input (resolves relative URLs)
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.`;

class UsageError extends Error {}

const TOO_LARGE = `The page is larger than ${MAX_BYTES / (1024 * 1024)} MB, so it was not linted.`;

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function decode(bytes: Uint8Array): string {
  // Keep a byte order mark: it declares the encoding, which the charset rule needs to know.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

/** Reads a stream but stops once it passes MAX_BYTES, so a huge or endless input can't exhaust memory. */
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

async function readLocal(path: string): Promise<string> {
  return decode(await readCapped(path === "-" ? process.stdin : createReadStream(path)));
}

async function readUrl(url: string, timeoutMs: number): Promise<{ label: string; url: string; html: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `metacheck/${version} (+https://websync.in/tools/seo-analyzer/)`, accept: "text/html,application/xhtml+xml" },
  });
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.ok || !response.body || (type && type !== "text/html" && type !== "application/xhtml+xml")) {
    await response.body?.cancel();
    throw new Error(response.ok ? `${response.url} is ${type}, not HTML.` : `${response.url} answered HTTP ${response.status}.`);
  }
  const bytes = await readCapped(response.body);
  return { label: `${response.url} (HTTP ${response.status})`, url: response.url, html: decode(bytes) };
}

function formatText(label: string, result: MetadataResult): string {
  const { title } = result.metadata;
  const lines = [`${label}: ${title ? JSON.stringify(title) : "no title"}`];
  for (const f of result.findings) {
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${f.line !== null ? ` (line ${f.line})` : ""}`, `       ${f.message}`);
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push("", result.findings.length ? `${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}` : "No problems found.");
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      url: { type: "string" },
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

  const maxWarnings = parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER);
  const timeout = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 15_000;
  if (positionals.length !== 1) throw new UsageError("Give exactly one file, URL or - for stdin.");

  const target = positionals[0];
  const isUrl = /^https?:\/\//i.test(target);
  if (values.url !== undefined) {
    if (isUrl) throw new UsageError("--url is for file or stdin input. A fetched page uses its final URL.");
    if (!/^https?:\/\//i.test(values.url) || !URL.canParse(values.url)) throw new UsageError("--url must be an absolute http(s) URL.");
  }
  const page = isUrl ? await readUrl(target, timeout) : { label: target === "-" ? "stdin" : target, url: values.url, html: await readLocal(target) };
  const result = lintMetadata(page.html, { url: page.url });

  console.log(values.json ? JSON.stringify({ source: page.label, ...result }, null, 2) : formatText(page.label, result));
  const tooManyWarnings = maxWarnings !== undefined && result.warningCount > maxWarnings;
  return result.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${USAGE}`;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "The request timed out.";
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message}\n\n${USAGE}`;
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
    console.error(`metacheck: ${errorMessage(error)}`);
    process.exitCode = 2;
  },
);
