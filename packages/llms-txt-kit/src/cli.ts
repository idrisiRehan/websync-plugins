#!/usr/bin/env node
// Command-line front end. `lint` reads an llms.txt from a file, stdin or URL and prints the
// lintLlmsTxt() findings; `build` renders a JSON document with buildLlmsTxt(). Rules live in lint.ts.

import { createReadStream, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { lintLlmsTxt, type LlmsTxtDoc, type LlmsTxtResult } from "./lint.ts";
import { buildLlmsTxt } from "./build.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

// An llms.txt is meant to fit in a context window, so anything this big is not one. The cap
// only stops a huge or endless response from exhausting memory.
const MAX_BYTES = 5 * 1024 * 1024;

const USAGE = `Usage:
  llms-txt-kit lint <file | url | -> [options]
  llms-txt-kit build <spec.json | ->

Commands:
  lint    Check an llms.txt against the llmstxt.org proposal. A URL with no
          path (https://example.com) fetches /llms.txt from that origin.
  build   Write llms.txt markdown to stdout from a JSON document shaped like
          { title, summary, details, sections: [{ title, links: [{ title, url, notes }] }] }

Options:
  --json               Print the lint result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage, input or network error.`;

class UsageError extends Error {}

const TOO_LARGE = `The input is larger than ${MAX_BYTES / (1024 * 1024)} MB, so it was not linted.`;

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
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

interface Source {
  label: string;
  text: string;
  /** Where a fetched file was served, after redirects, for resolving relative links. */
  url?: string;
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

/** A bare origin means "that site's llms.txt"; any other URL is fetched as given. */
function llmsTxtUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.pathname === "/" && !url.search && !url.hash) url.pathname = "/llms.txt";
  return url;
}

async function readUrl(url: URL, timeoutMs: number): Promise<Source> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": `llms-txt-kit/${version} (+https://github.com/idrisiRehan/websync-plugins)`, accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`${response.url} answered HTTP ${response.status}.`);
  }
  const bytes = await readCapped(response.body);
  return { label: `${response.url} (HTTP ${response.status})`, text: decode(bytes, response.url), url: response.url };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatText(label: string, result: LlmsTxtResult): string {
  const { doc } = result;
  const links = doc.sections.reduce((n, s) => n + s.links.length, 0);
  const lines = [`${label}: ${doc.title ? `"${doc.title}"` : "no H1"}, ${plural(doc.sections.length, "section")}, ${plural(links, "link")}`];
  for (const f of result.findings) {
    lines.push(`${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${f.line !== null ? ` (line ${f.line})` : ""}`, `       ${f.message}`);
  }
  lines.push("", result.findings.length ? `${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}` : "No problems found.");
  return lines.join("\n");
}

async function lint(target: string, json: boolean, maxWarnings: number | undefined, timeout: number): Promise<number> {
  const source = /^https?:\/\//i.test(target) ? await readUrl(llmsTxtUrl(target), timeout) : await readLocal(target);
  const result = lintLlmsTxt(source.text, { url: source.url });
  console.log(json ? JSON.stringify({ source: source.label, ...result }, null, 2) : formatText(source.label, result));
  const tooManyWarnings = maxWarnings !== undefined && result.warningCount > maxWarnings;
  return result.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

async function build(target: string): Promise<number> {
  const { label, text } = await readLocal(target);
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
  }
  const markdown = buildLlmsTxt(spec as LlmsTxtDoc);
  process.stdout.write(markdown);
  // The file is written either way; the findings point out what a reader would trip on.
  for (const f of lintLlmsTxt(markdown).findings) {
    console.error(`llms-txt-kit: ${f.severity} ${f.rule}${f.line !== null ? ` (line ${f.line})` : ""}: ${f.message}`);
  }
  return 0;
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

  const [command, target, ...extra] = positionals;
  if (command !== "lint" && command !== "build") throw new UsageError(command ? `Unknown command "${command}".` : "Give a command: lint or build.");
  if (target === undefined || extra.length) throw new UsageError(`${command} takes exactly one ${command === "lint" ? "file, URL" : "JSON file"} or - for stdin.`);

  if (command === "build") {
    if (values.json || values["max-warnings"] !== undefined || values.timeout !== undefined) throw new UsageError("build takes no options.");
    return build(target);
  }
  const maxWarnings = parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER);
  const timeout = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 15_000;
  return lint(target, values.json, maxWarnings, timeout);
}

function errorMessage(error: unknown): string {
  const help = 'Run "llms-txt-kit --help" for usage.';
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
    console.error(`llms-txt-kit: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
