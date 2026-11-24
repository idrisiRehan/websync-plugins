// Serializes feed items as Google Merchant Center RSS 2.0 XML or tab-separated text, or as an
// OpenAI product feed in JSONL, CSV or TSV. Attribute order is fixed per target, so feeds diff
// cleanly between runs.

import type { FeedFormat, Target } from "./build.ts";
import { oneLine, withoutControls } from "./text.ts";

export type Value = string | string[] | boolean | Record<string, string>;
export type FeedItem = Map<string, Value>;

const ORDER: Record<Target, readonly string[]> = {
  google: [
    "id", "title", "description", "link", "image_link", "additional_image_link", "availability", "availability_date", "price", "sale_price",
    "sale_price_effective_date", "condition", "brand", "gtin", "mpn", "identifier_exists", "item_group_id", "item_group_title",
    "product_type", "google_product_category", "color", "size", "material", "pattern", "gender", "age_group",
    "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4",
  ],
  openai: [
    "item_id", "title", "description", "url", "image_url", "additional_image_urls", "availability", "price", "sale_price",
    "condition", "brand", "gtin", "mpn", "group_id", "listing_has_variations", "variant_dict", "product_category", "color",
    "size", "material", "gender", "age_group", "seller_name", "seller_url", "store_country", "target_countries",
  ],
};

// A text header always names the required attributes, so an item without one is reported on
// its own row rather than once for a missing column.
const REQUIRED: Record<Target, ReadonlySet<string>> = {
  google: new Set(["id", "title", "description", "link", "image_link", "availability", "price"]),
  openai: new Set(["item_id", "title", "description", "url", "image_url", "availability", "price", "brand", "seller_name", "target_countries", "store_country"]),
};

const GOOGLE_NAMESPACE = "http://base.google.com/ns/1.0";

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
// Characters XML 1.0 doesn't allow are dropped from every value, including ids and URLs taken
// from the export as written.
const escapeXml = (value: string) => withoutControls(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A scalar as text: booleans as true/false, objects as JSON, as both specs write them in text files. */
function scalar(value: Exclude<Value, string[]>): string {
  return typeof value === "string" ? value : typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

// RFC 4180, which OpenAI's CSV follows: quote a cell holding a comma, quote or line break.
function csvCell(value: Value): string {
  const text = Array.isArray(value) ? value.join(",") : scalar(value);
  return /[",\r\n]/.test(text) ? quote(text) : text;
}

// Tab-separated text can't hold tabs or line breaks in a value (Google answer 160569), so they
// become spaces. Quotes wrap a value only where a reader would otherwise misread it: one that
// starts with a quote, or a list entry holding a comma (Google answer 14998273).
function tsvCell(value: Value): string {
  if (Array.isArray(value)) return value.map((v) => (/[",]/.test(v) ? quote(oneLine(v)) : oneLine(v))).join(",");
  const text = oneLine(scalar(value));
  return text.startsWith('"') ? quote(text) : text;
}

function delimited(items: readonly FeedItem[], target: Target, delimiter: "," | "\t"): string {
  const used = new Set(REQUIRED[target]);
  for (const item of items) for (const name of item.keys()) used.add(name);
  const columns = ORDER[target].filter((name) => used.has(name));
  const cell = delimiter === "," ? csvCell : tsvCell;
  const rows = [columns.join(delimiter), ...items.map((item) => columns.map((name) => (item.has(name) ? cell(item.get(name)!) : "")).join(delimiter))];
  return `${rows.join("\n")}\n`;
}

// RSS 2.0 with Google's namespace; a list attribute repeats its element (Google answer 160589).
function xml(items: readonly FeedItem[], channel: { title: string; link: string }): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:g="${GOOGLE_NAMESPACE}">`,
    "  <channel>",
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    "    <description>Product feed for Google Merchant Center</description>",
  ];
  for (const item of items) {
    lines.push("    <item>");
    for (const name of ORDER.google) {
      const value = item.get(name);
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [scalar(value)]) lines.push(`      <g:${name}>${escapeXml(v)}</g:${name}>`);
    }
    lines.push("    </item>");
  }
  lines.push("  </channel>", "</rss>", "");
  return lines.join("\n");
}

function jsonl(items: readonly FeedItem[]): string {
  return items.map((item) => `${JSON.stringify(Object.fromEntries(ORDER.openai.filter((name) => item.has(name)).map((name) => [name, item.get(name)])))}\n`).join("");
}

export function writeFeed(items: readonly FeedItem[], target: Target, format: FeedFormat, channel: { title: string; link: string }): string {
  switch (format) {
    case "xml":
      return xml(items, channel);
    case "jsonl":
      return jsonl(items);
    case "csv":
      return delimited(items, target, ",");
    case "tsv":
      return delimited(items, target, "\t");
  }
}
