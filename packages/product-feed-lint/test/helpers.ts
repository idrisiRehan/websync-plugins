// Feed builders for the tests. Rows are joined with "\t" so no test file holds a literal tab.

import { lintProductFeed, type LintOptions, type ProductFeedResult } from "../src/index.ts";

export type Row = Record<string, string>;

export const GOOGLE_ITEM: Row = {
  id: "MUG-1",
  title: "Blue mug",
  description: "A blue ceramic mug.",
  link: "https://shop.example/mug",
  image_link: "https://shop.example/mug.jpg",
  availability: "in_stock",
  price: "12.00 USD",
  brand: "Acme",
  gtin: "4006381333931",
};

export const OPENAI_ITEM: Row = {
  item_id: "MUG-1",
  title: "Blue mug",
  description: "A blue ceramic mug.",
  url: "https://shop.example/mug",
  brand: "Acme",
  seller_name: "Acme Store",
  image_url: "https://shop.example/mug.jpg",
  availability: "in_stock",
  price: "12.00 USD",
  target_countries: "US",
  store_country: "US",
};

/** A delimited file with a header made of every key used, and "" for keys a row lacks. */
export function delimited(rows: Row[], delimiter = "\t"): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))].map((cells) => cells.join(delimiter)).join("\n") + "\n";
}

export const tsv = (rows: Row[]) => delimited(rows, "\t");
export const csv = (rows: Row[]) => delimited(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v]))), ",");

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** An RSS 2.0 feed with one <item> per row and a g: element per non-empty value. */
export function rss(rows: Row[]): string {
  const items = rows.map((r) => {
    const elements = Object.entries(r).filter(([, v]) => v !== "").map(([k, v]) => `      <g:${k}>${escape(v)}</g:${k}>`);
    return `    <item>\n${elements.join("\n")}\n    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>Shop</title>\n${items.join("\n")}\n  </channel>\n</rss>\n`;
}

/** JSONL with one record per row; values that look like JSON arrays or objects are embedded as JSON. */
export function jsonl(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

export function lint(text: string, options?: LintOptions): ProductFeedResult {
  return lintProductFeed(text, options);
}

export const rules = (result: ProductFeedResult) => result.findings.map((f) => f.rule);

/** The Google feed for these rows in the given format. */
export const googleFeed = (format: "tsv" | "xml", rows: Row[]) => (format === "tsv" ? tsv(rows) : rss(rows));
