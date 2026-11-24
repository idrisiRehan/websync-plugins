#!/usr/bin/env node
// Command-line front end: read a sitemap (file, stdin or URL, gzip or plain), lint it with
// lintSitemap(), print the findings. All rules live in lint.ts.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { lintSitemap, MAX_BYTES, type SitemapResult } from "./lint.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  sitemap-lint <file | url | -> [options]

  Reads a sitemap or sitemap index from a file, an http(s) URL, or stdin (-).
  Gzipped input (.xml.gz) is decompressed automatically.

Options:
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.`;

class UsageError extends Error {}

const TOO_LARGE = `The sitemap is larger than the protocol's 50 MB limit (uncompressed), so it was not linted.`;

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function gunzipIfNeeded(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_BYTES });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error(TOO_LARGE);
    throw new Error("The input looks gzipped but could not be decompressed.");
  }
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

async function readLocal(path: string): Promise<Uint8Array> {
  return await readCapped(path === "-" ? process.stdin : createReadStream(path));
}

async function readUrl(url: string, timeoutMs: number): Promise<{ label: string; bytes: Uint8Array }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `sitemap-lint/${version} (+https://websync.in/tools/sitemap-validator/)` },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${response.url} answered HTTP ${response.status}.`);
  }
  const bytes = await readCapped(response.body);
  return { label: `${response.url} (HTTP ${response.status})`, bytes };
}

function formatText(label: string, result: SitemapResult): string {
  const kind = result.kind ?? (result.findings.some((f) => f.rule === "root-unknown") ? "not a sitemap" : "unreadable");
  const lines = [`${label}: ${kind}, ${result.entryCount} ${result.entryCount === 1 ? "entry" : "entries"}`];
  for (const f of result.findings) {
    const where = [f.line !== null ? `line ${f.line}` : "", f.entry !== null ? `entry ${f.entry}` : ""].filter(Boolean).join(", ");
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${where ? ` (${where})` : ""}`, `       ${f.message}`);
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
  const { label, bytes } = isUrl ? await readUrl(target, timeout) : { label: target === "-" ? "stdin" : target, bytes: await readLocal(target) };
  const result = lintSitemap(gunzipIfNeeded(bytes));

  console.log(values.json ? JSON.stringify({ source: label, ...result }, null, 2) : formatText(label, result));
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
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`sitemap-lint: ${errorMessage(error)}`);
    process.exitCode = 2;
  },
);
