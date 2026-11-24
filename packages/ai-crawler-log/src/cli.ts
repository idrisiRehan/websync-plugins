#!/usr/bin/env node
// Command-line front end: streams access logs (files or stdin, plain or gzipped) line by line
// into createLogAnalyzer() and prints the report. Memory stays flat however large the logs are.
// The operators' IP lists are fetched by ranges.ts or read from a --dump-ranges file.

import { createReadStream, readFileSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import { createLogAnalyzer, DEFAULT_PRODUCT_PATTERNS } from "./analyze.ts";
import { formatReport, type TextOptions } from "./format.ts";
import { reportHighlights } from "./highlights.ts";
import { LOG_FORMATS, type LogFormat } from "./parse.ts";
import { dumpLists, fetchLists, readLists, type RangeList } from "./ranges.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  ai-crawler-log <file...|-> [options]
  ai-crawler-log --dump-ranges > ranges.json

  Reads access logs (plain or gzipped, any size; - for stdin) and shows which
  AI crawlers read the site, what they fetched, the errors they got, and which
  requests only claimed to be a crawler. Client IPs are never printed.

Options:
  --format <name>      auto (default), combined, common or json
  --product <pattern>  Path fragment that marks a product page, * for any text;
                       repeat for more (default ${DEFAULT_PRODUCT_PATTERNS.join(" and ")})
  --ranges <file>      Read the operators' IP lists from a --dump-ranges file
                       instead of fetching them
  --no-verify          Don't load IP lists, so nothing is verified or spoofed
  --dump-ranges        Fetch the operators' IP lists and print them as JSON
  --show-networks      Also list the /24 or /48 networks spoofed requests came from
  --json               Print the report as JSON
  --top <n>            Paths listed per crawler, 1 to 100 (default 3)
  --timeout <ms>       Timeout for each IP list request (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 report printed, 1 report printed and spoofed requests found,
2 usage error, unreadable input, or no line read as an access log.`;

class UsageError extends Error {}

/** Longer lines are counted as unreadable without being kept, so memory stays bounded. */
const MAX_LINE_BYTES = 64 * 1024;
/** A --dump-ranges file is about 200 KB today. */
const MAX_RANGES_FILE_BYTES = 16 * 1024 * 1024;

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Passes the bytes through gunzip when they start with the gzip magic number, whatever the file is called. */
async function* gunzipIfNeeded(input: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  const iterator = input[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  let ended = false;
  while (head.length < 2 && !ended) {
    const next = await iterator.next();
    if (next.done) ended = true;
    else head = Buffer.concat([head, next.value]);
  }
  async function* all(): AsyncGenerator<Buffer> {
    if (head.length) yield head;
    while (!ended) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  if (head[0] !== 0x1f || head[1] !== 0x8b) return yield* all();
  const gunzip = createGunzip();
  // An error on either side destroys gunzip, which ends the loop below with that error.
  pipeline(Readable.from(all()), gunzip).catch(() => {});
  try {
    yield* gunzip;
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith("Z_")) throw new Error("looks gzipped but could not be decompressed");
    throw error;
  }
}

/** What a line longer than MAX_LINE_BYTES is passed on as: a line no format reads, so it is counted as unreadable. */
const TOO_LONG = "-";

/** Calls onLine for each line, without the newline, or with TOO_LONG for a line over MAX_LINE_BYTES. */
async function forEachLine(chunks: AsyncIterable<Buffer>, onLine: (line: string) => void): Promise<void> {
  let carry: Buffer[] = [];
  let carried = 0;
  let tooLong = false;
  const keep = (part: Buffer) => {
    const room = MAX_LINE_BYTES - carried;
    if (part.length > room) tooLong = true;
    if (tooLong) return;
    const kept = Buffer.from(part);
    carry.push(kept);
    carried += kept.length;
  };
  const flush = () => {
    onLine(tooLong ? TOO_LONG : Buffer.concat(carry, carried).toString("utf8"));
    carry = [];
    carried = 0;
    tooLong = false;
  };
  for await (const chunk of chunks) {
    let start = 0;
    for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, start)) {
      if (carry.length === 0 && !tooLong) {
        onLine(nl - start > MAX_LINE_BYTES ? TOO_LONG : chunk.toString("utf8", start, nl));
      } else {
        keep(chunk.subarray(start, nl));
        flush();
      }
      start = nl + 1;
    }
    if (start < chunk.length) keep(chunk.subarray(start));
  }
  if (carry.length || tooLong) flush();
}

function checkFile(path: string): void {
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") throw new Error(`File not found: ${path}`);
    throw new Error(`Can't read ${path}: ${(error as Error).message}`);
  }
  if (!stats.isFile()) throw new Error(`Not a file: ${path}`);
}

function readRangesFile(path: string): RangeList[] {
  checkFile(path);
  if (statSync(path).size > MAX_RANGES_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_RANGES_FILE_BYTES / (1024 * 1024)} MiB, so it is not a --dump-ranges file.`);
  return readLists(readFileSync(path, "utf8"));
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      format: { type: "string" },
      product: { type: "string", multiple: true },
      ranges: { type: "string" },
      "no-verify": { type: "boolean", default: false },
      "dump-ranges": { type: "boolean", default: false },
      "show-networks": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      top: { type: "string" },
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

  const timeoutMs = parseIntOption(values.timeout, "timeout", 1, 120_000) ?? 15_000;
  const userAgent = `ai-crawler-log/${version} (+https://github.com/idrisiRehan/websync-plugins)`;

  if (values["dump-ranges"]) {
    if (positionals.length || values.ranges !== undefined || values["no-verify"]) throw new UsageError("--dump-ranges takes no files, --ranges or --no-verify.");
    const lists = await fetchLists({ timeoutMs, userAgent });
    const failed = lists.filter((l) => l.error);
    for (const l of failed) console.error(`ai-crawler-log: couldn't fetch ${l.url} (${l.error}).`);
    if (failed.length === lists.length) return 2;
    console.log(dumpLists(lists));
    return failed.length ? 1 : 0;
  }

  if (!positionals.length) throw new UsageError("Give one or more log files, or - for stdin.");
  if (positionals.filter((p) => p === "-").length > 1) throw new UsageError("Stdin (-) can be read only once.");
  if (values.ranges !== undefined && values["no-verify"]) throw new UsageError("Use --ranges or --no-verify, not both.");
  const format = (values.format ?? "auto") as LogFormat;
  if (!LOG_FORMATS.includes(format)) throw new UsageError(`--format must be one of ${LOG_FORMATS.join(", ")}.`);
  const top = parseIntOption(values.top, "top", 1, 100) ?? 3;
  for (const p of positionals) if (p !== "-") checkFile(p);

  let lists: TextOptions["lists"];
  if (values["no-verify"]) {
    lists = { from: "off", loaded: [], failed: [] };
  } else {
    const all = values.ranges !== undefined ? readRangesFile(values.ranges) : await fetchLists({ timeoutMs, userAgent });
    lists = { from: values.ranges !== undefined ? "file" : "fetched", file: values.ranges, loaded: all.filter((l) => !l.error), failed: all.filter((l) => l.error) };
  }

  const options = { format, productPatterns: values.product, ranges: Object.fromEntries(lists.loaded.map((l) => [l.url, l.prefixes])), top, networks: values["show-networks"] };
  // Only the --product patterns can be invalid by now.
  const analyzer = (() => {
    try {
      return createLogAnalyzer(options);
    } catch (error) {
      throw error instanceof TypeError ? new UsageError(error.message) : error;
    }
  })();

  for (const source of positionals) {
    const label = source === "-" ? "stdin" : source;
    try {
      await forEachLine(gunzipIfNeeded(source === "-" ? process.stdin : createReadStream(source)), analyzer.add);
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
  }

  const report = analyzer.result();
  if (report.lines > 0 && report.parsed === 0) {
    throw new Error(`None of the ${report.lines.toLocaleString("en-US")} lines could be read as an access log${format === "auto" ? "" : ` in the ${format} format`}.`);
  }
  const sources = positionals.map((p) => (p === "-" ? "stdin" : p));
  const highlights = reportHighlights(report);
  if (values.json) {
    const ipLists = {
      from: lists.from,
      loaded: lists.loaded.map(({ url, creationTime, prefixes }) => ({ url, creationTime, prefixes: prefixes.length })),
      failed: lists.failed.map(({ url, error }) => ({ url, error })),
    };
    console.log(JSON.stringify({ sources, ipLists, ...report, highlights }, null, 2));
  } else {
    console.log(formatReport(report, { sources, lists, highlights, top }));
  }
  return report.crawlers.some((c) => c.spoofed > 0) ? 1 : 0;
}

function errorMessage(error: unknown): string {
  const help = 'Run "ai-crawler-log --help" for usage.';
  if (error instanceof UsageError) return `${error.message} ${help}`;
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message} ${help}`;
  return error.message;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // One line, so the message reads cleanly in CI logs.
    console.error(`ai-crawler-log: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
