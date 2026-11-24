// Builders for feeds and product pages. Feed rows are joined with "\t" so no test file holds a
// literal tab.

import { checkFeedAgainstPages, type CheckOptions, type FeedPageResult, type ItemResult } from "../src/index.ts";

export type Row = Record<string, string>;

export const BASE = "https://shop.example";

export function tsv(rows: Row[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))].map((cells) => cells.join("\t")).join("\n") + "\n";
}

export function jsonl(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** A Google feed row for one item; `link` defaults to BASE/p/<id>. */
export function item(id: string, rest: Row = {}): Row {
  return { id, link: `${BASE}/p/${id}`, price: "18.00 USD", availability: "in_stock", ...rest };
}

export const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data, null, 2)}</script>`;

/** An HTML page with each argument as one JSON-LD script. */
export function html(...data: unknown[]): string {
  return `<!doctype html>\n<html><head><title>Product</title>\n${data.map(ld).join("\n")}\n</head><body><h1>Product</h1></body></html>`;
}

export function offer(rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { "@type": "Offer", price: "18.00", priceCurrency: "USD", availability: "https://schema.org/InStock", ...rest };
}

export function product(rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { "@context": "https://schema.org", "@type": "Product", name: "Blue mug", offers: offer(), ...rest };
}

/** Checks a one-item Google feed against one page at the item's link. */
export function check1(row: Row, pageHtml: string, options?: CheckOptions): ItemResult {
  const result = checkFeedAgainstPages(tsv([row]), [{ url: row.link, html: pageHtml }], options);
  assertCounts(result);
  return result.items[0];
}

export const rules = (item: ItemResult) => item.findings.map((f) => f.rule);

export function assertCounts(result: FeedPageResult): void {
  const all = result.items.flatMap((i) => i.findings);
  if (result.errorCount !== all.filter((f) => f.severity === "error").length || result.warningCount !== all.length - result.errorCount) {
    throw new Error("errorCount and warningCount don't add up");
  }
}
