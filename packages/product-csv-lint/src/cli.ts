#!/usr/bin/env node
// Command-line front end: read a product CSV (file or stdin), lint it with lintProductCsv(),
// print the findings. All rules live in core.ts and the platform modules.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { ProductCsvResult } from "./core.ts";
import { detectPlatform, lintProductCsv, type Platform } from "./lint.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  product-csv-lint <file | -> [options]

  Checks a Shopify or WooCommerce product CSV before you import it.

Options:
  --platform <name>    shopify or woocommerce (default: detected from the header row)
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage or input error.`;

const LABEL = { error: "ERROR", warning: "WARN ", info: "INFO " } as const;
const PLATFORMS: Platform[] = ["shopify", "woocommerce"];

class UsageError extends Error {}

function parseMaxWarnings(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError("--max-warnings must be a whole number of 0 or more.");
  return n;
}

function formatText(label: string, result: ProductCsvResult): string {
  const lines = [`${label}: ${result.platform}, ${result.rowCount} rows, ${result.productCount} products, ${result.variantCount} variants`];
  for (const f of result.findings) {
    const where = [f.row !== null ? `row ${f.row}` : "", f.column ?? ""].filter(Boolean).join(", ");
    lines.push(`${LABEL[f.severity]}  ${f.rule}${where ? ` (${where})` : ""}`, `       ${f.message}`);
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push("", result.findings.length ? `${plural(result.errorCount, "error")}, ${plural(result.warningCount, "warning")}, ${result.infoCount} info` : "No problems found.");
  return lines.join("\n");
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      platform: { type: "string" },
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
  if (values.platform !== undefined && !PLATFORMS.includes(values.platform as Platform)) {
    throw new UsageError(`--platform must be one of: ${PLATFORMS.join(", ")}.`);
  }
  if (positionals.length !== 1) throw new UsageError("Give exactly one file, or - for stdin.");

  const path = positionals[0];
  const bytes = readFileSync(path === "-" ? 0 : path);
  const platform = (values.platform as Platform | undefined) ?? detectPlatform(bytes);
  if (!platform) throw new UsageError("Couldn't tell from the header row whether this is a Shopify or WooCommerce file. Pass --platform.");

  const result = lintProductCsv(bytes, platform);
  const label = path === "-" ? "stdin" : path;
  console.log(values.json ? JSON.stringify({ source: label, ...result }, null, 2) : formatText(label, result));
  const tooManyWarnings = maxWarnings !== undefined && result.warningCount > maxWarnings;
  return result.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${USAGE}`;
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${error.message}\n\n${USAGE}`;
  if (code === "ENOENT") return "File not found.";
  return error.message;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`product-csv-lint: ${errorMessage(error)}`);
  process.exitCode = 2;
}
