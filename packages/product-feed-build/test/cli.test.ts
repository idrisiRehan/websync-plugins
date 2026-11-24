// End-to-end tests: run the real CLI as a child process against temp files and stdin.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductFeed } from "../src/index.ts";
import { csv, shop } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
const SHOPIFY = join(EXAMPLES, "shopify-products.csv");
const REQUIRED = ["--target", "google", "--store-url", "https://shop.example.com", "--currency", "USD"];
const OPENAI = ["--target", "openai", "--store-url", "https://shop.example.com", "--currency", "USD", "--seller-name", "Northline Outdoor", "--store-country", "US"];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin: string | Buffer = ""): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {}); // EPIPE when the CLI stops reading early
    child.stdin.end(stdin);
  });
}

let dir = "";
const file = (name: string) => join(dir, name);

before(() => {
  dir = mkdtempSync(join(tmpdir(), "product-feed-build-"));
  // Out of stock but sold on: a backorder, which Google requires an availability_date for.
  writeFileSync(file("backorder.csv"), csv([shop({ "Inventory quantity": "0", "Continue selling when out of stock": "continue" })]));
  writeFileSync(file("warning.csv"), csv([shop({ Description: "" })]));
  writeFileSync(file("latin1.csv"), Buffer.from([0x54, 0x69, 0x74, 0x6c, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]));
  writeFileSync(file("unknown.csv"), "name,price\nMug,5\n");
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("output", () => {
  test("the feed goes to stdout, untouched; the summary to stderr", async () => {
    const r = await run([SHOPIFY, ...REQUIRED]);
    assert.equal(r.code, 0);
    const expected = buildProductFeed(readFileSync(SHOPIFY), { target: "google", storeUrl: "https://shop.example.com", currency: "USD" }).feed;
    assert.equal(r.stdout, expected);
    assert.match(r.stderr, /^.*shopify-products\.csv: shopify, 7 items written to stdout \(google, xml\), 2 skipped\n/);
    assert.match(r.stderr, /SKIP {3}row 10\n {7}Draft: not ready to be sold\./);
    assert.match(r.stderr, /Lint: no problems found\.$/m);
  });

  test("-o writes the file, stdout stays empty, and the format follows the extension", async () => {
    const out = file("feed.tsv");
    const r = await run([SHOPIFY, ...REQUIRED, "-o", out]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /written to .*feed\.tsv \(google, tsv\)/);
    assert.ok(readFileSync(out, "utf8").startsWith("id\ttitle\tdescription"));
  });

  test("an extension the target can't take is a usage error; --format wins over the extension", async () => {
    const wrong = await run([SHOPIFY, ...REQUIRED, "-o", file("feed.csv")]);
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /\.csv can't hold a google feed\. Use \.xml or \.tsv or \.txt, or pass --format\./);
    const csvFeed = await run([SHOPIFY, ...OPENAI, "-o", file("feed.csv")]);
    assert.match(csvFeed.stderr, /\(openai, csv\)/);
    const forced = await run([SHOPIFY, ...OPENAI, "--format", "tsv", "-o", file("feed2.csv")]);
    assert.match(forced.stderr, /\(openai, tsv\)/);
  });

  test("OpenAI JSONL from stdin, with notes on stderr", async () => {
    const r = await run(["-", ...OPENAI], readFileSync(join(EXAMPLES, "woocommerce-products.csv")));
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trimEnd().split("\n").length, 5);
    assert.ok(r.stdout.split("\n").filter(Boolean).every((line) => JSON.parse(line).seller_name === "Northline Outdoor"));
    assert.match(r.stderr, /^stdin: woocommerce, 5 items/);
    assert.match(r.stderr, /NOTE {3}row 6, item HOODIE-GRY-M\n {7}The sale is scheduled/);
  });

  test("--json prints the summary on stderr as JSON, without the feed", async () => {
    const r = await run([SHOPIFY, ...REQUIRED, "--json", "-o", file("feed.xml")]);
    assert.equal(r.code, 0);
    const summary = JSON.parse(r.stderr);
    assert.equal(summary.source.endsWith("shopify-products.csv"), true);
    assert.equal(summary.output, file("feed.xml"));
    assert.deepEqual([summary.platform, summary.target, summary.format, summary.itemCount], ["shopify", "google", "xml", 7]);
    assert.equal(summary.skipped.length, 2);
    assert.deepEqual(summary.notes, []);
    assert.equal(summary.lint.valid, true);
    assert.equal(summary.feed, undefined);
  });
});

describe("exit codes", () => {
  test("1 when the feed has lint errors, which is still written", async () => {
    const out = file("backorder.xml");
    const r = await run([file("backorder.csv"), ...REQUIRED, "-o", out]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ERROR {2}attribute-missing \(feed line \d+, item MUG-1, availability_date\)/);
    assert.match(r.stderr, /Lint: 1 error, 0 warnings/);
    assert.match(readFileSync(out, "utf8"), /<g:availability>backorder<\/g:availability>/);
  });

  test("a backorder without --availability-date gets a hint; with it the feed is clean", async () => {
    const hinted = await run([file("backorder.csv"), ...REQUIRED]);
    assert.match(hinted.stderr, /HINT {3}Google needs the date backordered items ship\. Pass --availability-date/);
    const dated = await run([file("backorder.csv"), ...REQUIRED, "--availability-date", "2026-12-15T09:00-0800"]);
    assert.equal(dated.code, 0);
    assert.match(dated.stdout, /<g:availability_date>2026-12-15T09:00-0800<\/g:availability_date>/);
    assert.doesNotMatch(dated.stderr, /HINT/);
  });

  test("--link-template builds the links", async () => {
    const r = await run([SHOPIFY, ...REQUIRED, "--link-template", "https://shop.example.com/item/{handle}"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /<g:link>https:\/\/shop\.example\.com\/item\/trail-running-shoes<\/g:link>/);
  });

  test("warnings pass unless --max-warnings is exceeded", async () => {
    assert.equal((await run([file("warning.csv"), ...REQUIRED])).code, 0);
    assert.equal((await run([file("warning.csv"), ...REQUIRED, "--max-warnings", "1"])).code, 0);
    assert.equal((await run([file("warning.csv"), ...REQUIRED, "--max-warnings", "0"])).code, 1);
  });

  test("--help and --version exit 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage:/);
    const version = await run(["-v"]);
    assert.equal(version.code, 0);
    assert.equal(version.stdout.trim(), JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  });

  const usage: [string, string[], RegExp][] = [
    ["no target", [SHOPIFY, "--store-url", "https://shop.example.com", "--currency", "USD"], /--target is required/],
    ["an unknown target", [SHOPIFY, ...REQUIRED.slice(2), "--target", "bing"], /--target must be google or openai/],
    ["no store URL", [SHOPIFY, "--target", "google", "--currency", "USD"], /--store-url is required/],
    ["no currency", [SHOPIFY, "--target", "google", "--store-url", "https://shop.example.com"], /--currency is required/],
    ["an http store URL", [SHOPIFY, "--target", "google", "--store-url", "http://shop.example.com", "--currency", "USD"], /--store-url must be an absolute https URL/],
    ["a bad currency", [SHOPIFY, "--target", "google", "--store-url", "https://shop.example.com", "--currency", "dollars"], /--currency must be an ISO 4217/],
    ["a format the target can't take", [SHOPIFY, ...REQUIRED, "--format", "jsonl"], /--format for google must be one of: xml, tsv/],
    ["openai without a seller name", [SHOPIFY, "--target", "openai", "--store-url", "https://shop.example.com", "--currency", "USD", "--store-country", "US"], /--seller-name is required/],
    ["openai without a store country", [SHOPIFY, "--target", "openai", "--store-url", "https://shop.example.com", "--currency", "USD", "--seller-name", "A"], /--store-country must be/],
    ["a bad target country", [SHOPIFY, ...OPENAI, "--target-countries", "US,Canada"], /--target-countries entries must be/],
    ["a bad condition", [SHOPIFY, ...REQUIRED, "--condition", "mint"], /--condition must be one of/],
    ["a bad platform", [SHOPIFY, ...REQUIRED, "--platform", "magento"], /--platform must be/],
    ["a bad availability date", [SHOPIFY, ...REQUIRED, "--availability-date", "soon"], /--availability-date must be an ISO 8601/],
    ["a link template without a placeholder", [SHOPIFY, ...REQUIRED, "--link-template", "https://shop.example.com/"], /--link-template must use \{handle\}/],
    ["a link template on another host", [SHOPIFY, ...REQUIRED, "--link-template", "https://other.example.com/{handle}"], /--link-template must be an absolute https URL on shop\.example\.com/],
    ["a bad --max-warnings", [SHOPIFY, ...REQUIRED, "--max-warnings=-1"], /--max-warnings must be a whole number/],
    ["an unknown option", [SHOPIFY, ...REQUIRED, "--colour"], /Unknown option/],
    ["two files", [SHOPIFY, SHOPIFY, ...REQUIRED], /exactly one export file/],
    ["no file", [...REQUIRED], /exactly one export file/],
  ];
  for (const [name, args, message] of usage) {
    test(`2 for ${name}, with a one-line message`, async () => {
      const r = await run(args);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, message);
      assert.match(r.stderr, /^product-feed-build: [^\n]*\n$/);
    });
  }

  test("2 for input it can't use: a missing file, invalid UTF-8, an unknown header row", async () => {
    const missing = await run([file("nope.csv"), ...REQUIRED]);
    assert.equal(missing.code, 2);
    assert.equal(missing.stderr, "product-feed-build: File not found.\n");
    const latin1 = await run([file("latin1.csv"), ...REQUIRED]);
    assert.equal(latin1.code, 2);
    assert.match(latin1.stderr, /is not valid UTF-8/);
    const unknown = await run([file("unknown.csv"), ...REQUIRED]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /matches neither a Shopify nor a WooCommerce export\. Set --platform\./);
    assert.equal((await run([file("unknown.csv"), ...REQUIRED, "--platform", "shopify"])).code, 1);
  });

  test("2 when -o can't be written", async () => {
    const r = await run([SHOPIFY, ...REQUIRED, "-o", join(dir, "missing-dir", "feed.xml")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^product-feed-build: Couldn't write the feed:/);
  });

  test("2 for stdin over 50 MB, without reading it all", async () => {
    const r = await run(["-", ...REQUIRED], "a".repeat(50 * 1024 * 1024 + 1));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 50 MB/);
    assert.equal(r.stdout, "");
  });
});
