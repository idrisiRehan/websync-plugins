#!/usr/bin/env node
// Command-line front end: read a product export (file or stdin), build the feed with
// buildProductFeed(), write it to -o or stdout, and report skipped rows, notes and lint
// findings on stderr, so stdout stays a clean feed.

import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { buildProductFeed, FORMATS, type BuildResult, type Condition, type FeedFormat, type Target } from "./build.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  product-feed-build <export.csv | -> --target <name> --store-url <url> --currency <code> [options]

  Turns a Shopify or WooCommerce product export into a Google Merchant Center
  feed or an OpenAI product feed (ChatGPT shopping), and lints it.

Required:
  --target <name>             google or openai
  --store-url <url>           Your storefront, like https://shop.example.com
  --currency <code>           ISO 4217 code of the export's prices, like USD

Options:
  -o, --output <file>         Write the feed to a file (default: stdout)
  --format <name>             google: xml or tsv; openai: jsonl, csv or tsv
                              (default: from the -o extension, else xml or jsonl)
  --platform <name>           shopify or woocommerce (default: detected)
  --brand <name>              Brand for products with an empty Vendor or Brands
  --condition <value>         new, refurbished or used (default: new)
  --availability-date <date>  google: availability_date for backordered items,
                              ISO 8601 like 2026-12-15T09:00-0800
  --link-template <url>       Product links from {handle} (Shopify) or {id} and
                              {sku} (WooCommerce), like https://shop.example.com/product/{sku}/
  --seller-name <name>        openai (required): seller_name
  --store-country <code>      openai (required): store_country, like US
  --target-countries <list>   openai: comma-separated (default: the store country)
  --json                      Print the summary on stderr as JSON
  --max-warnings <n>          Exit with code 1 when there are more than n warnings
  -h, --help                  Show this help
  -v, --version               Show the version

The feed is written even when it has lint errors. The summary goes to stderr.

Exit codes: 0 no lint errors, 1 lint errors (or too many warnings), 2 usage or input error.`;

/** Largest export read, well above Shopify's 15 MB import limit (same cap as product-csv-lint). */
const MAX_BYTES = 50 * 1024 * 1024;
const TOO_LARGE = `The file is larger than ${MAX_BYTES / (1024 * 1024)} MB, so it was not read.`;

const EXTENSIONS: Record<string, FeedFormat> = { ".xml": "xml", ".tsv": "tsv", ".txt": "tsv", ".jsonl": "jsonl", ".csv": "csv" };

class UsageError extends Error {}

function parseMaxWarnings(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError("--max-warnings must be a whole number of 0 or more.");
  return n;
}

/** Reads a stream but stops once it passes MAX_BYTES, so a huge or endless input can't exhaust memory. */
async function readCapped(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new Error(TOO_LARGE); // leaving the loop cancels the stream
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

const LABEL = { error: "ERROR", warning: "WARN " } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatText(label: string, output: string, result: BuildResult, availabilityDate: boolean): string {
  const { lint } = result;
  const unit = result.format === "tsv" || result.format === "csv" ? "row" : "line";
  const lines = [`${label}: ${result.platform}, ${plural(result.itemCount, "item")} written to ${output} (${result.target}, ${result.format}), ${result.skipped.length} skipped`];
  for (const s of result.skipped) lines.push(`SKIP   row ${s.row}`, `       ${s.reason}`);
  for (const n of result.notes) lines.push(`NOTE   row ${n.row}${n.itemId !== null ? `, item ${n.itemId}` : ""}`, `       ${n.message}`);
  for (const f of lint.findings) {
    const where = [f.line !== null ? `feed ${unit} ${f.line}` : "", f.itemId !== null ? `item ${f.itemId}` : "", f.attribute ?? ""].filter(Boolean).join(", ");
    lines.push(`${LABEL[f.severity]}  ${f.rule}${where ? ` (${where})` : ""}`, `       ${f.message}`);
  }
  if (!availabilityDate && lint.findings.some((f) => f.rule === "attribute-missing" && f.attribute === "availability_date")) {
    lines.push("HINT   Google needs the date backordered items ship. Pass --availability-date, like 2026-12-15T09:00-0800,", "       or stop selling those variants when they are out of stock.");
  }
  lines.push("", lint.findings.length ? `Lint: ${plural(lint.errorCount, "error")}, ${plural(lint.warningCount, "warning")}` : "Lint: no problems found.");
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string" },
      "store-url": { type: "string" },
      currency: { type: "string" },
      output: { type: "string", short: "o" },
      format: { type: "string" },
      platform: { type: "string" },
      brand: { type: "string" },
      condition: { type: "string" },
      "availability-date": { type: "string" },
      "link-template": { type: "string" },
      "seller-name": { type: "string" },
      "store-country": { type: "string" },
      "target-countries": { type: "string" },
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

  const maxWarnings = parseMaxWarnings(values["max-warnings"]);
  const target = values.target as Target | undefined;
  if (target !== "google" && target !== "openai") throw new UsageError(target === undefined ? "--target is required: google or openai." : "--target must be google or openai.");
  if (values["store-url"] === undefined) throw new UsageError("--store-url is required, like https://shop.example.com.");
  if (values.currency === undefined) throw new UsageError("--currency is required: the ISO 4217 code of the export's prices, like USD.");
  if (positionals.length !== 1) throw new UsageError("Give exactly one export file, or - for stdin.");

  const output = values.output;
  const fromExtension = output === undefined ? undefined : EXTENSIONS[extname(output).toLowerCase()];
  // An -o extension the target can't take (feed.csv for google) is a mistake, not a hint to ignore.
  if (values.format === undefined && fromExtension && !FORMATS[target].includes(fromExtension)) {
    throw new UsageError(`${extname(output!)} can't hold a ${target} feed. Use ${FORMATS[target].map((f) => `.${f === "tsv" ? "tsv or .txt" : f}`).join(" or ")}, or pass --format.`);
  }
  const format = (values.format as FeedFormat | undefined) ?? fromExtension;

  const path = positionals[0];
  const label = path === "-" ? "stdin" : path;
  const bytes = await readCapped(path === "-" ? process.stdin : createReadStream(path));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8. Save it as "CSV UTF-8" and try again.`);
  }

  let result: BuildResult;
  try {
    result = buildProductFeed(bytes, {
      target,
      format,
      storeUrl: values["store-url"],
      currency: values.currency,
      platform: values.platform as "shopify" | "woocommerce" | undefined,
      brand: values.brand,
      condition: values.condition as Condition | undefined,
      availabilityDate: values["availability-date"],
      linkTemplate: values["link-template"],
      sellerName: values["seller-name"],
      storeCountry: values["store-country"],
      targetCountries: values["target-countries"]?.split(",").map((c) => c.trim()),
    });
  } catch (error) {
    // Invalid options surface as TypeErrors; name the flag, not the option.
    if (error instanceof TypeError) throw new UsageError(error.message.replace(/options\.(\w+)/g, (_, name: string) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`));
    throw error;
  }

  if (output === undefined) process.stdout.write(result.feed);
  else {
    try {
      writeFileSync(output, result.feed);
    } catch (error) {
      throw new Error(`Couldn't write the feed: ${(error as Error).message}`);
    }
  }

  const { feed: _feed, ...summary } = result;
  console.error(values.json ? JSON.stringify({ source: label, output: output ?? "stdout", ...summary }, null, 2) : formatText(label, output ?? "stdout", result, values["availability-date"] !== undefined));
  const tooManyWarnings = maxWarnings !== undefined && result.lint.warningCount > maxWarnings;
  return result.lint.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  const help = 'Run "product-feed-build --help" for usage.';
  if (error instanceof UsageError) return `${error.message} ${help}`;
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message} ${help}`;
  if (code === "ENOENT") return "File not found.";
  if (code === "EISDIR") return "That is a directory, not a file.";
  return error.message;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // One line, so the message reads cleanly in CI logs.
    console.error(`product-feed-build: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
