// Bad input never throws, and large exports build in linear time.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildProductFeed, type BuildOptions } from "../src/index.ts";
import { csv, shop, wooRow, type Row } from "./helpers.ts";

const OPTIONS = { storeUrl: "https://shop.example.com", currency: "USD", sellerName: "Acme Store", storeCountry: "US" };
const TARGETS = [
  { target: "google", format: "xml" },
  { target: "google", format: "tsv" },
  { target: "openai", format: "jsonl" },
  { target: "openai", format: "csv" },
] as const;

// A small deterministic generator, so a failure can be replayed.
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 2 ** 32;
  };
}

const HEADERS = [
  "Title", "URL handle", "Handle", "Description", "Body (HTML)", "Vendor", "Status", "Published", "SKU", "Barcode", "Option1 name", "Option1 value", "Option2 name",
  "Option2 value", "Price", "Compare-at price", "Variant Price", "Inventory tracker", "Inventory quantity", "Continue selling when out of stock", "Product image URL",
  "Image position", "Variant image URL", "Gift card", "Google Shopping / Custom product", "ID", "Type", "Name", "Parent", "Regular price", "Sale price", "In stock?",
  "Stock", "Images", "Attribute 1 name", "Attribute 1 value(s)", "Date sale price starts", "Date sale price ends", "Categories", "Brands",
];
const PIECES = [
  "", "", "a", "tee", "1", "0", "-3", "12.50", "99", "$5", "1e3", "variable", "variation", "simple", "grouped", "id:1", "TRUE", "false", "draft", "active", "continue",
  "shopify", "4006381333931", "2000000000015", "123", "Default Title", "Title", "Color", "Size", "Blue, Grey", "https://cdn.example.com/a.jpg", "https://x/a,b.jpg",
  '"', '""', ",", ";", "\n", "\r", "<p>", "</p>", "<script>", "&amp;", "&#0;", "\\n", "\\,", "'=1", "2026-12-01 0:00:00", "x".repeat(300), String.fromCharCode(0),
  String.fromCharCode(9), "\u{1F375}", "\ud800",
];

function fuzzCsv(next: () => number): string {
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const headers = Array.from({ length: 2 + Math.floor(next() * 12) }, () => pick(HEADERS));
  const rows = Array.from({ length: Math.floor(next() * 8) }, () => headers.map(() => Array.from({ length: Math.floor(next() * 3) }, () => pick(PIECES)).join("")));
  return [headers, ...rows].map((cells) => cells.join(pick([",", ",", ";"]))).join(pick(["\n", "\r\n"]));
}

describe("fuzz", () => {
  test("random exports never throw, for both platforms, every target and format", () => {
    const next = random(20261124);
    for (let i = 0; i < 400; i++) {
      const input = fuzzCsv(next);
      for (const platform of ["shopify", "woocommerce"] as const) {
        const { target, format } = TARGETS[i % TARGETS.length];
        try {
          const r = buildProductFeed(input, { target, format, platform, ...OPTIONS });
          assert.equal(typeof r.feed, "string");
          assert.equal(r.lint.target, target);
        } catch (error) {
          assert.fail(`threw on case ${i} (${platform}, ${target} ${format}): ${(error as Error).stack}\n${JSON.stringify(input)}`);
        }
      }
    }
  });

  test("random bytes never throw", () => {
    const next = random(7);
    for (let i = 0; i < 200; i++) {
      const bytes = new Uint8Array(Math.floor(next() * 400)).map(() => Math.floor(next() * 256));
      for (const platform of ["shopify", "woocommerce"] as const) {
        assert.doesNotThrow(() => buildProductFeed(bytes, { target: "google", platform, ...OPTIONS }));
      }
    }
  });
});

describe("large exports", () => {
  const time = (input: string, options: Partial<BuildOptions>) => {
    const start = performance.now();
    const r = buildProductFeed(input, { ...OPTIONS, ...options } as BuildOptions);
    return { ms: performance.now() - start, r };
  };

  function shopifyExport(products: number): string {
    const rows: Row[] = [];
    for (let p = 0; p < products; p++) {
      const handle = `product-${p}`;
      rows.push(shop({ Title: `Product ${p}`, "URL handle": handle, SKU: `P${p}-S`, "Option1 name": "Size", "Option1 value": "S", "Product image URL": `https://cdn.example.com/${p}-1.jpg`, "Image position": "1" }));
      for (const size of ["M", "L", "XL"]) rows.push({ "URL handle": handle, SKU: `P${p}-${size}`, "Option1 value": size, Price: "12.00", "Inventory tracker": "shopify", "Inventory quantity": "3", Barcode: "" });
    }
    return csv(rows);
  }

  function wooExport(products: number): string {
    const rows: Row[] = [];
    for (let p = 0; p < products; p++) {
      rows.push(wooRow({ ID: String(p * 10), Type: "variable", SKU: `P${p}`, Name: `Product ${p}`, "Attribute 1 name": "Size", "Attribute 1 value(s)": "S, M, L" }));
      for (const [i, size] of ["S", "M", "L"].entries()) {
        rows.push(wooRow({ ID: String(p * 10 + i + 1), Type: "variation", SKU: `P${p}-${size}`, Name: "", Parent: `P${p}`, "Attribute 1 name": "Size", "Attribute 1 value(s)": size }));
      }
    }
    return csv(rows);
  }

  test("20,000 Shopify rows build and lint quickly, and twice the rows take about twice as long", () => {
    const half = time(shopifyExport(2500), { target: "google", format: "tsv" });
    const full = time(shopifyExport(5000), { target: "google", format: "tsv" });
    assert.equal(full.r.itemCount, 20000);
    assert.equal(full.r.lint.errorCount, 0);
    assert.ok(full.ms < 20000, `took ${full.ms} ms`);
    assert.ok(full.ms < half.ms * 4, `${half.ms} ms for 10,000 rows, ${full.ms} ms for 20,000`);
  });

  test("one product with thousands of variants, each with its own image, stays linear", () => {
    const variants = (n: number, platform: "shopify" | "woocommerce") => {
      const rows: Row[] = [platform === "shopify" ? shop({ SKU: "V0", "Option1 name": "Size", "Option1 value": "0" }) : wooRow({ Type: "variable", SKU: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "0" })];
      for (let i = 1; i <= n; i++) {
        const image = `https://cdn.example.com/v${i}.jpg`;
        rows.push(platform === "shopify"
          ? { "URL handle": "blue-mug", SKU: `V${i}`, "Option1 value": String(i), Price: "12.00", "Product image URL": image, "Variant image URL": image }
          : wooRow({ ID: String(i + 1), Type: "variation", SKU: `V${i}`, Name: "", Parent: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": String(i), Images: image }));
      }
      return csv(rows);
    };
    for (const platform of ["shopify", "woocommerce"] as const) {
      const half = time(variants(4000, platform), { target: "openai", format: "jsonl" });
      const full = time(variants(8000, platform), { target: "openai", format: "jsonl" });
      assert.ok(full.r.itemCount >= 8000, platform);
      assert.ok(full.ms < half.ms * 3, `${platform}: ${half.ms} ms for 4,000 variants, ${full.ms} ms for 8,000`);
    }
  });

  test("20,000 WooCommerce rows build and lint quickly", () => {
    const { ms, r } = time(wooExport(5000), { target: "openai", format: "jsonl" });
    assert.equal(r.itemCount, 15000);
    assert.equal(r.lint.errorCount, 0);
    assert.ok(ms < 20000, `took ${ms} ms`);
  });
});
