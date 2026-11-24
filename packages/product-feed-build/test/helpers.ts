// Export builders and feed readers for the tests. No test file holds a literal tab: TAB is built
// from its character code.

import { parseCsv } from "product-csv-lint";
import { buildProductFeed, type BuildOptions, type BuildResult } from "../src/index.ts";

export const TAB = String.fromCharCode(9);
export const STORE = "https://shop.example.com";

export type Row = Record<string, string>;
export type FeedRecord = Record<string, unknown>;

/** A CSV from rows of { header: value }, with the header made of every key used. */
export function csv(rows: Row[]): string {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))].map((cells) => cells.map(cell).join(",")).join("\n") + "\n";
}

/** A Shopify product's first row (current column names), with sensible values. */
export const shop = (extra: Row = {}): Row => ({
  Title: "Blue mug",
  "URL handle": "blue-mug",
  Description: "<p>A blue stoneware mug.</p>",
  Vendor: "Acme",
  Status: "active",
  SKU: "MUG-1",
  Barcode: "4006381333931",
  Price: "12.00",
  "Inventory tracker": "shopify",
  "Inventory quantity": "5",
  "Continue selling when out of stock": "deny",
  "Product image URL": "https://cdn.example.com/mug.jpg",
  ...extra,
});

/** A WooCommerce simple product row, as the exporter writes it. */
export const wooRow = (extra: Row = {}): Row => ({
  ID: "1",
  Type: "simple",
  SKU: "MUG-1",
  Name: "Blue mug",
  Published: "1",
  "Visibility in catalog": "visible",
  Description: "A blue stoneware mug.",
  "In stock?": "1",
  "Regular price": "12",
  Images: "https://cdn.example.com/mug.jpg",
  Brands: "Acme",
  ...extra,
});

const DEFAULTS = { storeUrl: STORE, currency: "USD", sellerName: "Acme Store", storeCountry: "US" };

export function build(input: string | Row[], options: Partial<BuildOptions> = {}): BuildResult {
  return buildProductFeed(typeof input === "string" ? input : csv(input), { target: "google", ...DEFAULTS, ...options } as BuildOptions);
}

const unescapeXml = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** The items of a feed as records: repeated XML elements become arrays, delimited cells stay text. */
export function records(result: BuildResult): FeedRecord[] {
  const { feed, format } = result;
  if (format === "jsonl") return feed.split("\n").filter(Boolean).map((line) => JSON.parse(line) as FeedRecord);
  if (format === "xml") {
    return feed.split("<item>").slice(1).map((chunk) => {
      const record: FeedRecord = {};
      for (const [, name, value] of chunk.matchAll(/<g:(\w+)>([\s\S]*?)<\/g:\1>/g)) {
        const text = unescapeXml(value);
        const seen = record[name];
        record[name] = seen === undefined ? text : Array.isArray(seen) ? [...seen, text] : [seen, text];
      }
      return record;
    });
  }
  const [header, ...rows] = parseCsv(feed, format === "tsv" ? "\t" : ",").records;
  return rows.map((row) => Object.fromEntries(header.cells.map((name, i) => [name, row.cells[i]]).filter(([, v]) => v !== "")));
}

/** Builds and returns the single item, failing when there isn't exactly one. */
export function one(input: string | Row[], options: Partial<BuildOptions> = {}): FeedRecord {
  const list = records(build(input, options));
  if (list.length !== 1) throw new Error(`expected one item, got ${list.length}`);
  return list[0];
}

export const openai = { target: "openai", format: "jsonl" } as const;
