#!/usr/bin/env node
// Command-line front end: run checkStore() on one store and print the report. All checks live
// in the linters; check.ts decides what is fetched.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkStore, DEFAULT_TIMEOUT_MS, MAX_REQUESTS } from "./check.ts";
import { formatReport } from "./format.ts";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const USAGE = `Usage:
  store-check <url> [options]

Shows what search engines and AI agents see on a store: redirects and HTTPS,
robots.txt and crawler access, the sitemap, llms.txt, home and product page
metadata, structured data and security headers. Only the URL's origin is used,
and https:// is assumed when the scheme is left out. At most ${MAX_REQUESTS} requests.

Options:
  --product <url>      Product page to check (default: one picked from the sitemap)
  --json               Print the full report as JSON
  --timeout <ms>       Timeout for each request in milliseconds (default ${DEFAULT_TIMEOUT_MS})
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  -h, --help           Show this help
  -v, --version        Show the version

Exit codes: 0 no errors, 1 errors (or too many warnings), 2 usage error or the site unreachable.`;

class UsageError extends Error {}

function parseIntOption(value: string | undefined, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function storeUrl(input: string): string {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UsageError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`Only http and https URLs can be checked: ${input}`);
  return url.href;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      product: { type: "string" },
      json: { type: "boolean", default: false },
      timeout: { type: "string" },
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
  if (positionals.length !== 1) throw new UsageError("Give exactly one store URL.");

  const maxWarnings = parseIntOption(values["max-warnings"], "max-warnings", 0, Number.MAX_SAFE_INTEGER);
  const timeoutMs = parseIntOption(values.timeout, "timeout", 1, 120_000);
  const url = storeUrl(positionals[0]);
  const userAgent = `store-check/${version} (+https://github.com/idrisiRehan/websync-plugins)`;

  const report = await checkStore(url, { productUrl: values.product, timeoutMs, userAgent }).catch((error: unknown) => {
    // checkStore() throws only for bad input: here, the --product URL.
    throw error instanceof TypeError ? new UsageError(error.message.replace("productUrl", "--product")) : error;
  });

  if (!report.reachable) {
    console.error(`store-check: The site could not be reached. ${report.requests[0].error ?? ""}`.trim());
    return 2;
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
  const tooManyWarnings = maxWarnings !== undefined && report.warningCount > maxWarnings;
  return report.errorCount > 0 || tooManyWarnings ? 1 : 0;
}

function errorMessage(error: unknown): string {
  const help = 'Run "store-check --help" for usage.';
  // Each message ends a sentence before the help hint, even when it ends with a URL.
  const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);
  if (error instanceof UsageError) return `${sentence(error.message)} ${help}`;
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  if (code?.startsWith("ERR_PARSE_ARGS")) return `${sentence(error.message)} ${help}`;
  return error.message;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // One line, so the message reads cleanly in CI logs.
    console.error(`store-check: ${errorMessage(error).replace(/\s*\n\s*/g, " ")}`);
    process.exitCode = 2;
  },
);
