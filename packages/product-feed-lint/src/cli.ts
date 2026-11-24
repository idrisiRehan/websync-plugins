#!/usr/bin/env node
// Command-line front end: read a product feed from a file, stdin or URL, lint it with
// lintProductFeed(), print the findings. All rules live in the library.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { lintProductFeed, TARGETS, type ProductFeedResult } from "./lint.ts";
import type { FeedFormat, TargetName } from "./spec.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// Google accepts feed files up to 4 GB, but the whole feed is held in memory as text plus parsed
// rows or an element tree, so the cap is what one process can lint comfortably (several
// hundred thousand products), not a format limit.
const MAX_BYTES = 100 * 1024 * 1024;
const TOO_LARGE = `The feed is larger than ${MAX_BYTES / (1024 * 1024)} MB, so it was not linted. Split it into smaller files.`;


const USAGE = `Usage:
  product-feed-lint <file | url | -> [options]

  Checks a product feed before you upload it: Google Merchant Center
  (tab-separated text, RSS 2.0 or Atom 1.0 XML) or OpenAI's product feed
  for ChatGPT shopping (JSONL, CSV or TSV).

Options:
  --target <name>      google or openai (default: google)
  --format <name>      google: tsv or xml; openai: jsonl, csv or tsv
                       (default: detected from the content)
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.`;

class UsageError extends Error {}

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Reads at most MAX_BYTES, so an endless stdin or response stops at the cap. */
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

async function readSource(target: string, timeoutMs: number): Promise<{ label: string; text: string }> {
  if (!/^https?:\/\//i.test(target)) {
    const label = target === "-" ? "stdin" : target;
    return { label, text: decode(await readCapped(target === "-" ? process.stdin : createReadStream(target)), label) };
  }
  if (!URL.canParse(target)) throw new UsageError(`Not a valid URL: ${target}`);
  const response = await fetch(target, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `product-feed-lint/${version} (+https://github.com/idrisiRehan/websync-plugins)` },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${response.url} answered HTTP ${response.status}.`);
  }
  const bytes = await readCapped(response.body);
  return { label: `${response.url} (HTTP ${response.status})`, text: decode(bytes, response.url) };
}

const LABEL = { error: "ERROR", warning: "WARN " } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatText(label: string, result: ProductFeedResult): string {
  const unit = result.format === "tsv" || result.format === "csv" ? "row" : "line";
  const lines = [`${label}: ${result.target}, ${result.format ?? "empty"}, ${plural(result.itemCount, "item")}`];
  for (const f of result.findings) {
    const where = [f.line !== null ? `${unit} ${f.line}` : "", f.itemId !== null ? `item ${f.itemId}` : "", f.attribute ?? ""].filter(Boolean).join(", ");
    lines.push(`${LABEL[f.severity]}  ${f.rule}${where ? ` (${where})` : ""}`, `       ${f.message}`);
  }
  lines.push("", result.findings.length ? `${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}` : "No problems found.");
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      format: { type: "string" },
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

  const target = (values.target ?? "google") as TargetName;
  if (!Object.hasOwn(TARGETS, target)) throw new UsageError(`--target must be one of: ${Object.keys(TARGETS).join(", ")}.`);
  const formats = TARGETS[target].formats;
  const format = values.format as FeedFormat | undefined;
  if (format !== undefined && !formats.includes(format)) throw new UsageError(`--format for ${target} must be one of: ${formats.join(", ")}.`);
  const maxWarnings = parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER);
  const timeout = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 15_000;
  if (positionals.length !== 1) throw new UsageError("Give exactly one file, URL, or - for stdin.");

  const source = await readSource(positionals[0], timeout);
  const result = lintProductFeed(source.text, { target, format });
  console.log(values.json ? JSON.stringify({ source: source.label, ...result }, null, 2) : formatText(source.label, result));
  const tooManyWarnings = maxWarnings !== undefined && result.warningCount > maxWarnings;
  return result.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  const help = 'Run "product-feed-lint --help" for usage.';
  if (error instanceof UsageError) return `${error.message} ${help}`;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "The request timed out.";
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
    console.error(`product-feed-lint: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
