#!/usr/bin/env node
// Command-line front end: read HTML or JSON-LD (file, stdin or URL), check it with
// validateStructuredData(), print the findings. All rules live in validate.ts.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { validateStructuredData, type StructuredDataResult } from "./validate.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

/** Largest input read from a file, stdin or a URL, well above the size of typical pages. */
const MAX_BYTES = 10 * 1024 * 1024;

const USAGE = `Usage:
  schemaview <file | url | -> [options]

  Checks the JSON-LD structured data in an HTML page or a JSON-LD file, read from a file,
  an http(s) URL, or stdin (-).

Options:
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.`;

class UsageError extends Error {}

const TOO_LARGE = `The input is larger than ${MAX_BYTES / (1024 * 1024)} MB, so it was not checked.`;

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
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
  return new TextDecoder().decode(await readCapped(path === "-" ? process.stdin : createReadStream(path)));
}

async function readUrl(url: string, timeoutMs: number): Promise<{ label: string; url: string; text: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": `schemaview/${version} (+https://github.com/idrisiRehan/websync-plugins/tree/main/packages/schemaview)`,
      accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${response.url} answered HTTP ${response.status}.`);
  }
  const bytes = await readCapped(response.body);
  return { label: `${response.url} (HTTP ${response.status})`, url: response.url, text: new TextDecoder().decode(bytes) };
}

function formatText(label: string, result: StructuredDataResult): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const source = result.format === "html" ? `HTML, ${plural(result.blockCount, "JSON-LD block")}` : "JSON-LD";
  const lines = [`${label}: ${source}, ${plural(result.entities.length, "typed node")}`];
  for (const e of result.entities) {
    if (e.richResults.length) lines.push(`  ${e.types.join(", ")} (line ${e.line}): ${e.richResults.join(", ")}`);
  }
  for (const f of result.findings) {
    const where = [f.line !== null ? `line ${f.line}` : "", f.path ?? ""].filter(Boolean).join(", ");
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${where ? ` (${where})` : ""}`, `       ${f.message}`);
  }
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
  const source = /^https?:\/\//i.test(target) ? await readUrl(target, timeout) : { label: target === "-" ? "stdin" : target, url: undefined, text: await readLocal(target) };
  // Usually a failed fetch upstream (curl -s ... | schemaview -), which must not pass a CI step.
  if (!source.text.trim()) throw new Error("The input is empty, so there was nothing to check.");
  const result = validateStructuredData(source.text, { url: source.url });

  console.log(values.json ? JSON.stringify({ source: source.label, ...result }, null, 2) : formatText(source.label, result));
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
    console.error(`schemaview: ${errorMessage(error)}`);
    process.exitCode = 2;
  },
);
