import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCsv } from "product-csv-lint";
import { lintProductFeed } from "product-feed-lint";
import { buildProductFeed, type BuildOptions, type FeedFormat, type Target } from "../src/index.ts";
import { build, records, shop, TAB, wooRow } from "./helpers.ts";

const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
const example = (name: string) => readFileSync(EXAMPLES + name);
const COMBINATIONS: [Target, FeedFormat][] = [["google", "xml"], ["google", "tsv"], ["openai", "jsonl"], ["openai", "csv"], ["openai", "tsv"]];
// The options the example feeds were generated with (README, "Examples").
const EXAMPLE_OPTIONS = { storeUrl: "https://shop.example.com", currency: "USD", sellerName: "Northline Outdoor", storeCountry: "US" };

describe("round trip", () => {
  for (const file of ["shopify-products.csv", "shopify-legacy-products.csv", "woocommerce-products.csv"]) {
    for (const [target, format] of COMBINATIONS) {
      test(`${file} as ${target} ${format} passes product-feed-lint with no findings`, () => {
        const r = buildProductFeed(example(file), { target, format, ...EXAMPLE_OPTIONS });
        assert.ok(r.itemCount > 0);
        assert.deepEqual(r.lint.findings, []);
        // Linting the text on its own, with the format detected, agrees.
        const again = lintProductFeed(r.feed, { target });
        assert.equal(again.itemCount, r.itemCount);
        assert.equal(again.errorCount, 0);
      });
    }
  }

  test("every format carries the same items", () => {
    const keys = (format: FeedFormat, target: Target) => records(buildProductFeed(example("shopify-products.csv"), { target, format, ...EXAMPLE_OPTIONS })).map((r) => [r.id ?? r.item_id, r.title, r.price, r.availability]);
    assert.deepEqual(keys("tsv", "google"), keys("xml", "google"));
    assert.deepEqual(keys("csv", "openai"), keys("jsonl", "openai"));
    assert.deepEqual(keys("tsv", "openai"), keys("jsonl", "openai"));
  });

  test("the example feeds are what the current code generates", () => {
    const cases: [string, string, Partial<BuildOptions>][] = [
      ["shopify-products.csv", "shopify-google.xml", { target: "google" }],
      ["shopify-products.csv", "shopify-openai.jsonl", { target: "openai" }],
      ["shopify-legacy-products.csv", "shopify-legacy-google.tsv", { target: "google", format: "tsv" }],
      ["woocommerce-products.csv", "woocommerce-google.xml", { target: "google" }],
      ["woocommerce-products.csv", "woocommerce-openai.jsonl", { target: "openai" }],
    ];
    for (const [input, output, options] of cases) {
      const { feed } = buildProductFeed(example(input), { ...EXAMPLE_OPTIONS, ...options } as BuildOptions);
      assert.equal(feed, readFileSync(EXAMPLES + output, "utf8"), output);
    }
  });
});

describe("tab-separated text", () => {
  test("one line per item, one cell per column, tabs and line breaks in values made spaces", () => {
    const r = build([shop({ Title: `Blue${TAB}mug`, Description: "<p>One</p><p>Two</p>" })], { format: "tsv" });
    const lines = r.feed.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    const width = lines[0].split(TAB).length;
    assert.ok(lines.every((line) => line.split(TAB).length === width));
    assert.ok(!lines.some((line) => line.endsWith(TAB)));
    assert.deepEqual([records(r)[0].title, records(r)[0].description], ["Blue mug", "One Two"]);
  });

  test("a value starting with a quote is quoted, and reads back unchanged", () => {
    const r = build([shop({ Title: '"Best" mug, 12" wide' })], { format: "tsv" });
    assert.ok(r.feed.includes(`${TAB}"""Best"" mug, 12"" wide"${TAB}`));
    assert.equal(records(r)[0].title, '"Best" mug, 12" wide');
    assert.equal(r.lint.errorCount, 0);
  });

  test("a quote inside a value is left alone", () => {
    const r = build([shop({ Title: 'Mug, 12" wide' })], { format: "tsv" });
    assert.ok(r.feed.includes(`${TAB}Mug, 12" wide${TAB}`));
  });

  test("list values are comma-separated, with an entry holding a comma quoted", () => {
    const r = build([wooRow({ Categories: "Kitchen > Mugs, Pots\\, pans", Images: "https://cdn.example.com/a.jpg, https://cdn.example.com/b.jpg, https://cdn.example.com/c.jpg" })], { format: "tsv" });
    assert.ok(r.feed.includes(`${TAB}https://cdn.example.com/b.jpg,https://cdn.example.com/c.jpg${TAB}`));
    assert.ok(r.feed.includes(`${TAB}Kitchen > Mugs,"Pots, pans"`));
    assert.equal(r.lint.errorCount, 0);
  });

  test("the header always names the required attributes", () => {
    const r = build([shop({ "Product image URL": "", Description: "" })], { format: "tsv" });
    assert.deepEqual(r.feed.split("\n")[0].split(TAB).slice(0, 7), ["id", "title", "description", "link", "image_link", "availability", "price"]);
    // Reported on the item's row, not as a missing column.
    assert.deepEqual(r.lint.findings.map((f) => [f.rule, f.line]), [["attribute-missing", 2], ["attribute-missing", 2]]);
  });

  test("OpenAI TSV writes booleans, lists and objects as text", () => {
    const rows = [shop({ SKU: "S", "Option1 name": "Size", "Option1 value": "S" }), { "URL handle": "blue-mug", SKU: "M", "Option1 value": "M", Price: "12.00" }];
    const r = build(rows, { target: "openai", format: "tsv", targetCountries: ["US", "CA"] });
    const [item] = records(r);
    assert.deepEqual([item.listing_has_variations, item.variant_dict, item.target_countries], ["true", '{"Size":"S"}', "US,CA"]);
    assert.equal(r.lint.errorCount, 0);
  });
});

describe("OpenAI CSV", () => {
  test("RFC 4180 quoting: commas, quotes and line breaks", () => {
    const r = build([shop({ Title: 'Mug, 12" wide', Description: "<p>One</p><p>Two</p>" })], { target: "openai", format: "csv" });
    assert.ok(r.feed.includes(',"Mug, 12"" wide","One\nTwo",'));
    const [header, row] = parseCsv(r.feed, ",").records;
    assert.equal(row.cells[header.cells.indexOf("title")], 'Mug, 12" wide');
    assert.equal(r.lint.errorCount, 0);
  });

  test("lists in one quoted cell, objects as JSON", () => {
    const rows = [shop({ SKU: "S", "Option1 name": "Size", "Option1 value": "S" }), { "URL handle": "blue-mug", SKU: "M", "Option1 value": "M", Price: "12.00" }];
    const r = build(rows, { target: "openai", format: "csv", targetCountries: ["US", "CA"] });
    assert.ok(r.feed.includes(',"{""Size"":""S""}",'));
    assert.ok(r.feed.includes(',"US,CA"\n'));
    assert.equal(r.lint.errorCount, 0);
  });
});

describe("XML and JSONL", () => {
  test("XML is RSS 2.0 with the g: namespace, escaped text and repeated list elements", () => {
    const r = build([shop({ Title: "Mug <large> & co" })], { sellerName: "Acme & Sons" });
    assert.ok(r.feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">'));
    assert.ok(r.feed.includes("<title>Acme &amp; Sons</title>"));
    assert.ok(r.feed.includes("<g:title>Mug &lt;large&gt; &amp; co</g:title>"));
    assert.equal(r.lint.errorCount, 0);
    const host = build([shop()], { sellerName: undefined });
    assert.ok(host.feed.includes("<title>shop.example.com</title>"));
    const images = build([wooRow({ Images: "https://cdn.example.com/a.jpg, https://cdn.example.com/b.jpg, https://cdn.example.com/c.jpg" })]);
    assert.equal(images.feed.match(/<g:additional_image_link>/g)?.length, 2);
  });

  test("control characters never reach the feed", () => {
    const bell = String.fromCharCode(7);
    const r = build([shop({ Title: `Mug${bell}`, Description: `<p>A${String.fromCharCode(0)}B</p>` })]);
    assert.ok(!/[\x00-\x08]/.test(r.feed));
    assert.equal(r.lint.errorCount, 0);
  });

  test("characters XML 1.0 forbids are dropped from ids and URLs too, and every format writes the same id", () => {
    const [soh, nonchar] = [String.fromCharCode(1), String.fromCharCode(0xfffe)];
    const row = shop({ SKU: `MUG${soh}${TAB}1`, Title: `Mug${nonchar}`, Description: "<p>A&#1;B&#xFFFF;C</p>", "Product image URL": `https://cdn.example.com/mug${soh}.jpg` });
    const xml = build([row]);
    assert.ok(![soh, nonchar, String.fromCharCode(0xffff)].some((c) => xml.feed.includes(c)));
    assert.equal(xml.lint.errorCount, 0, JSON.stringify(xml.lint.findings));
    const ids = COMBINATIONS.map(([target, format]) => {
      const r = build([row], { target, format });
      const record = records(r)[0];
      return [record.id ?? record.item_id, record.title];
    });
    assert.deepEqual(new Set(ids.map((pair) => JSON.stringify(pair))).size, 1, JSON.stringify(ids));
    assert.deepEqual(ids[0], ["MUG 1", "Mug"]);
  });

  test("JSONL has one object per line with JSON booleans, arrays and objects", () => {
    const rows = [shop({ SKU: "S", "Option1 name": "Size", "Option1 value": "S" }), { "URL handle": "blue-mug", SKU: "M", "Option1 value": "M", Price: "12.00" }];
    const lines = build(rows, { target: "openai" }).feed.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "");
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(first.listing_has_variations, true);
    assert.deepEqual(first.target_countries, ["US"]);
    assert.deepEqual(first.variant_dict, { Size: "S" });
    assert.deepEqual(Object.keys(first).slice(0, 4), ["item_id", "title", "description", "url"]);
  });

  test("a feed with no items: header only, or empty, and the linter says so", () => {
    const draft = [shop({ Status: "draft" })];
    const tsv = build(draft, { format: "tsv" });
    assert.equal(tsv.feed.split("\n").length, 2);
    assert.equal(tsv.lint.findings[0].rule, "feed-empty");
    const jsonl = build(draft, { target: "openai" });
    assert.equal(jsonl.feed, "");
    assert.equal(jsonl.lint.findings[0].rule, "feed-empty");
    assert.equal(build(draft).lint.findings[0].rule, "feed-empty");
  });
});
