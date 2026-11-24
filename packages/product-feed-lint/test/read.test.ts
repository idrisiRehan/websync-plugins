// Reading and structure: format detection, text and XML structure rules, options, robustness.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectFormat, lintProductFeed, readFeedItems } from "../src/index.ts";
import { GOOGLE_ITEM, OPENAI_ITEM, csv, jsonl, lint, rss, rules, tsv } from "./helpers.ts";

const G = "http://base.google.com/ns/1.0";
const values = Object.values(GOOGLE_ITEM);
const header = Object.keys(GOOGLE_ITEM);

describe("format detection", () => {
  test("detectFormat", () => {
    assert.equal(detectFormat("id\ttitle\nA\tB\n"), "tsv");
    assert.equal(detectFormat("id,title\nA,B\n"), "csv");
    assert.equal(detectFormat("id\ttitle,x\n"), "tsv");
    assert.equal(detectFormat("id\n"), "tsv");
    assert.equal(detectFormat("\n  <?xml version=\"1.0\"?><rss/>"), "xml");
    assert.equal(detectFormat('{"item_id":"A"}\n'), "jsonl");
    assert.equal(detectFormat("   \n"), null);
  });

  test("the result names the format read", () => {
    assert.equal(lint(tsv([GOOGLE_ITEM])).format, "tsv");
    assert.equal(lint(rss([GOOGLE_ITEM])).format, "xml");
  });

  test("a byte order mark is ignored", () => {
    assert.deepEqual(lint(`\uFEFF${tsv([GOOGLE_ITEM])}`).findings, []);
    assert.deepEqual(lint(`\uFEFF${rss([GOOGLE_ITEM])}`).findings, []);
  });

  test("CRLF line endings", () => {
    assert.deepEqual(lint(tsv([GOOGLE_ITEM]).replaceAll("\n", "\r\n")).findings, []);
  });
});

describe("options", () => {
  test("format overrides detection", () => {
    const result = lint(rss([GOOGLE_ITEM]), { format: "tsv" });
    assert.equal(result.format, "tsv");
    assert.equal(result.valid, false);
  });

  test("delimiter-wrong when a comma-separated file is given to Google", () => {
    const result = lint(tsv([GOOGLE_ITEM]).replaceAll("\t", ","));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.line]), [["delimiter-wrong", 1]]);
    assert.match(result.findings[0].message, /tab-separated/);
    assert.equal(result.format, "csv");
  });

  test("delimiter-wrong when the forced delimiter isn't the one used", () => {
    assert.deepEqual(rules(lint(tsv([GOOGLE_ITEM]).replaceAll("\t", ","), { format: "tsv" })), ["delimiter-wrong"]);
    assert.deepEqual(rules(lint(tsv([OPENAI_ITEM]), { target: "openai", format: "csv" })), ["delimiter-wrong"]);
  });

  test("format-unsupported when the detected format isn't the target's", () => {
    assert.deepEqual(rules(lint(jsonl([OPENAI_ITEM]))), ["format-unsupported"]);
    assert.deepEqual(rules(lint(rss([GOOGLE_ITEM]), { target: "openai" })), ["format-unsupported"]);
  });

  test("bad options throw a TypeError", () => {
    assert.throws(() => lintProductFeed("", { target: "bing" as "google" }), TypeError);
    assert.throws(() => lintProductFeed("", { target: "toString" as "google" }), TypeError);
    assert.throws(() => lintProductFeed("", { target: "openai", format: "xml" }), TypeError);
    assert.throws(() => lintProductFeed("", { format: "csv" }), TypeError);
    assert.throws(() => lintProductFeed("", null as unknown as object), TypeError);
    assert.throws(() => lintProductFeed(42 as unknown as string), TypeError);
  });
});

describe("empty feeds", () => {
  test("feed-empty", () => {
    for (const text of ["", "  \n\n", header.join("\t") + "\n", rss([])]) {
      const result = lint(text);
      assert.deepEqual(rules(result), ["feed-empty"], JSON.stringify(text));
      assert.equal(result.itemCount, 0);
      assert.equal(result.valid, false);
    }
    assert.equal(lint("").format, null);
  });
});

describe("tab-separated structure", () => {
  const row = (cells: string[]) => cells.join("\t");

  test("quote-unterminated", () => {
    const text = [row(header), row(values.map((v, i) => (i === 2 ? `"${v}` : v)))].join("\n");
    const result = lint(text);
    assert.ok(rules(result).includes("quote-unterminated"));
    assert.equal(result.findings.find((f) => f.rule === "quote-unterminated")?.line, 2);
  });

  test("quotes inside a Google cell are allowed: they may wrap one value of several", () => {
    for (const title of [`A 12" mug`, `Range:"10:20 inches"`, `"Blue, glazed","Green"`]) {
      assert.deepEqual(lint([row(header), row(values.map((v, i) => (i === 1 ? title : v)))].join("\n")).findings, [], title);
    }
  });

  test("quote-unexpected is a warning in CSV", () => {
    const text = [Object.keys(OPENAI_ITEM), Object.values(OPENAI_ITEM).map((v, i) => (i === 1 ? `A 12" mug` : v))].map((r) => r.join(",")).join("\n");
    const result = lint(text, { target: "openai" });
    assert.deepEqual(result.findings.map((f) => [f.rule, f.severity, f.line]), [["quote-unexpected", "warning", 2]]);
  });

  test("a quoted value may hold a comma", () => {
    assert.deepEqual(lint([row(header), row(values.map((v, i) => (i === 2 ? '"Blue, glazed"' : v)))].join("\n")).findings, []);
  });

  test("row-width", () => {
    const result = lint([row(header), row(values.slice(1))].join("\n"));
    assert.ok(rules(result).includes("row-width"));
    assert.equal(result.findings.find((f) => f.rule === "row-width")?.severity, "error");
  });

  test("row-trailing-tab on the header and on rows", () => {
    const result = lint([row([...header, ""]), row([...values, ""]), row(values.map((v, i) => (i === 0 ? "MUG-2" : v)))].join("\n"));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.line]), [["row-trailing-tab", 1], ["row-trailing-tab", 2]]);
  });

  test("Google: a repeated column adds values to the attribute", () => {
    const result = lint([row([...header, "additional_image_link", "additional_image_link"]), row([...values, "https://shop.example/a.jpg", "a.jpg"])].join("\n"));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute, f.line]), [["url-invalid", "additional_image_link", 2]]);
  });

  test("OpenAI: header-duplicate reads the first column only", () => {
    const result = lint([row([...Object.keys(OPENAI_ITEM), "price"]), row([...Object.values(OPENAI_ITEM), "$5"])].join("\n"), { target: "openai" });
    assert.deepEqual(rules(result), ["header-duplicate"]);
  });

  test("a blank header cell", () => {
    const result = lint([row([...header.slice(0, 3), "", ...header.slice(3)]), row([...values.slice(0, 3), "x", ...values.slice(3)])].join("\n"));
    assert.deepEqual(rules(result), ["attribute-unknown"]);
    assert.match(result.findings[0].message, /Column 4 has no name/);
  });

  test("CSV for OpenAI reads quoted commas and JSON in cells", () => {
    const result = lint(csv([{ ...OPENAI_ITEM, title: 'Mug, "large"', variant_dict: '{"size":"L"}' }]), { target: "openai" });
    assert.deepEqual(result.findings, []);
  });
});

describe("XML structure", () => {
  test("feed-unreadable for malformed XML, with the line", () => {
    const text = rss([GOOGLE_ITEM]).replace("<g:price>12.00 USD</g:price>", "<g:price>12.00 USD</g:pirce>");
    const result = lint(text);
    assert.deepEqual(rules(result), ["feed-unreadable"]);
    assert.equal(result.findings[0].line, 12);
    assert.match(result.findings[0].message, /Expected <\/g:price>/);
  });

  test("feed-unreadable for an unescaped ampersand", () => {
    const result = lint(rss([GOOGLE_ITEM]).replace("https://shop.example/mug<", "https://shop.example/mug?a=1&b=2<"));
    assert.deepEqual(rules(result), ["feed-unreadable"]);
    assert.match(result.findings[0].message, /&amp;/);
  });

  test("a DOCTYPE with entities is never expanded", () => {
    const text = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss version="2.0" xmlns:g="${G}"><channel><item><g:id>&x;</g:id></item></channel></rss>`;
    const result = lint(text);
    assert.deepEqual(rules(result), ["feed-unreadable"]);
    assert.match(result.findings[0].message, /Undefined entity/);
  });

  test("feed-unreadable for a root that isn't rss or an Atom feed", () => {
    assert.deepEqual(rules(lint(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>`)), ["feed-unreadable"]);
    assert.deepEqual(rules(lint(`<feed><entry/></feed>`)), ["feed-unreadable"], "feed without the Atom namespace");
    assert.deepEqual(rules(lint(`<rss version="2.0"><item/></rss>`)), ["feed-unreadable"], "rss without channel");
  });

  test("RSS items may use the RSS title, link and description elements", () => {
    const text = rss([GOOGLE_ITEM])
      .replace("<g:title>Blue mug</g:title>", "<title>Blue mug</title>")
      .replace("<g:link>https://shop.example/mug</g:link>", "<link>https://shop.example/mug</link>")
      .replace("<g:description>A blue ceramic mug.</g:description>", "<description>A blue ceramic mug.</description>");
    assert.deepEqual(lint(text).findings, []);
  });

  test("namespace-wrong for an attribute without the g: prefix, reported once", () => {
    const text = rss([GOOGLE_ITEM, { ...GOOGLE_ITEM, id: "MUG-2" }]).replaceAll("<g:brand>Acme</g:brand>", "<brand>Acme</brand>");
    const result = lint(text);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.severity, f.attribute, f.line]), [["namespace-wrong", "warning", "brand", 13]]);
  });

  test("namespace-wrong when the g: prefix is bound to another namespace", () => {
    const text = rss([GOOGLE_ITEM]).replace(`xmlns:g="${G}"`, `xmlns:g="${G}/"`);
    const result = lint(text);
    assert.ok(rules(result).includes("namespace-wrong"));
    assert.match(result.findings.find((f) => f.rule === "namespace-wrong")!.message, /bound to/);
  });

  test("other namespaces and RSS elements are ignored", () => {
    const text = rss([GOOGLE_ITEM])
      .replace("<rss ", '<rss xmlns:c="http://base.google.com/cns/1.0" xmlns:media="http://search.yahoo.com/mrss/" ')
      .replace("</item>", "<c:warehouse>B7</c:warehouse><media:title>x</media:title><guid>MUG-1</guid><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate></item>");
    assert.deepEqual(lint(text).findings, []);
  });

  test("an empty element is treated as absent", () => {
    const result = lint(rss([GOOGLE_ITEM]).replace("<g:price>12.00 USD</g:price>", "<g:price></g:price>"));
    assert.deepEqual(rules(result), ["attribute-missing"]);
  });
});

describe("Atom 1.0", () => {
  const atom = (entry: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="${G}">
  <title>Shop</title>
  <link href="https://shop.example"/>
  <updated>2026-11-24T10:00:00Z</updated>
  <entry>
${entry}
  </entry>
</feed>`;
  const entry = `    <title>Blue mug</title>
    <id>MUG-1</id>
    <link href="https://shop.example/mug"/>
    <summary>A blue ceramic mug.</summary>
    <updated>2026-11-24T10:00:00Z</updated>
    <g:image_link>https://shop.example/mug.jpg</g:image_link>
    <g:availability>in_stock</g:availability>
    <g:price>12.00 USD</g:price>
    <g:brand>Acme</g:brand>
    <g:gtin>4006381333931</g:gtin>`;

  test("Atom elements map to title, id, link and description", () => {
    const result = lint(atom(entry));
    assert.deepEqual(result.findings, []);
    assert.equal(result.itemCount, 1);
    assert.equal(result.format, "xml");
  });

  test("findings name the Atom id", () => {
    const result = lint(atom(entry.replace("12.00 USD", "$12")));
    assert.equal(result.findings[0].itemId, "MUG-1");
    assert.equal(result.findings[0].line, 14);
  });

  test("an entry without updated is attribute-missing", () => {
    const result = lint(atom(entry.replace("    <updated>2026-11-24T10:00:00Z</updated>\n", "")));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "updated"]]);
  });

  test("a missing summary is a missing description", () => {
    const result = lint(atom(entry.replace("    <summary>A blue ceramic mug.</summary>\n", "")));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "description"]]);
  });

  test("g: versions of the Atom elements also count", () => {
    const text = atom(entry.replace("<summary>A blue ceramic mug.</summary>", "<g:description>A blue ceramic mug.</g:description>"));
    assert.deepEqual(lint(text).findings, []);
  });
});

describe("readFeedItems", () => {
  const plain = (attributes: Record<string, string[]>) => ({ ...attributes });

  test("reads each item's id, line and attribute values, the same way in every Google format", () => {
    for (const text of [tsv([GOOGLE_ITEM, { ...GOOGLE_ITEM, id: "MUG-2" }]), rss([GOOGLE_ITEM, { ...GOOGLE_ITEM, id: "MUG-2" }])]) {
      const result = readFeedItems(text);
      assert.equal(result.target, "google");
      assert.deepEqual(result.findings, []);
      assert.deepEqual(result.items.map((i) => i.id), ["MUG-1", "MUG-2"]);
      assert.deepEqual(plain(result.items[0].attributes), Object.fromEntries(Object.entries(GOOGLE_ITEM).map(([k, v]) => [k, [v]])));
    }
    assert.deepEqual(readFeedItems(tsv([GOOGLE_ITEM])).items[0].line, 2);
    assert.equal(readFeedItems(rss([GOOGLE_ITEM])).format, "xml");
  });

  test("resolves aliases and spellings like the linter, and reports the alias once", () => {
    const google = readFeedItems(`ID\tPrice\tAvailability\nA\t12.00 USD\tin stock\n`);
    assert.deepEqual(plain(google.items[0].attributes), { id: ["A"], price: ["12.00 USD"], availability: ["in stock"] });
    const openai = readFeedItems(jsonl([{ ...OPENAI_ITEM, item_id: undefined, id: "X", item_group_id: "G" }]), { target: "openai" });
    assert.equal(openai.items[0].id, "X");
    assert.deepEqual(openai.items[0].attributes.group_id, ["G"]);
    const both = readFeedItems(jsonl([{ ...OPENAI_ITEM, id: "X" }]), { target: "openai" });
    assert.equal(both.items[0].id, "MUG-1");
    assert.deepEqual(both.findings.map((f) => f.rule), ["attribute-alias"]);
  });

  test("repeated elements and columns add values; empty values are left out", () => {
    const repeated = readFeedItems(`id\tgtin\tgtin\tcolor\nA\t4006381333931\t5901234123457\t\n`);
    assert.deepEqual(plain(repeated.items[0].attributes), { id: ["A"], gtin: ["4006381333931", "5901234123457"] });
  });

  test("reading problems are findings; value problems are not", () => {
    assert.deepEqual(readFeedItems(tsv([{ ...GOOGLE_ITEM, price: "$1" }])).findings, []);
    assert.deepEqual(readFeedItems("").findings.map((f) => f.rule), ["feed-empty"]);
    const broken = readFeedItems("<rss><channel><item>");
    assert.deepEqual([broken.format, broken.items.length, broken.findings[0].rule], ["xml", 0, "feed-unreadable"]);
    assert.deepEqual(readFeedItems("id,price\nA,1 USD\n").findings.map((f) => f.rule), ["delimiter-wrong"]);
  });

  test("attribute names can't reach Object.prototype", () => {
    const { attributes } = readFeedItems(`id\t__proto__\tconstructor\nA\tx\ty\n`).items[0];
    assert.equal(Object.getPrototypeOf(attributes), null);
    assert.deepEqual(attributes.constructor, ["y"]);
    assert.equal(attributes.toString, undefined);
  });

  test("throws a TypeError for invalid options, like lintProductFeed()", () => {
    assert.throws(() => readFeedItems("x", { target: "bing" as never }), TypeError);
    assert.throws(() => readFeedItems("x", { format: "jsonl" }), TypeError);
  });
});

describe("robustness", () => {
  test("findings are sorted by line", () => {
    const text = tsv([{ ...GOOGLE_ITEM, price: "$1" }, { ...GOOGLE_ITEM, id: "B", link: "x" }, { ...GOOGLE_ITEM, colour: "x", id: "C" }]);
    const lines = lint(text).findings.map((f) => f.line ?? 0);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  });

  test("never throws on arbitrary input, for every target and format", () => {
    const pieces = ["<", ">", "/", "rss", "item", "g:id", "entry", "\t", ",", "\n", "\r", '"', "{", "}", "[", "]", ":", "id", "price", "12 USD", "&", "&amp;", " ", "item_id", "null", "xmlns:g=\"http://base.google.com/ns/1.0\""];
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 3000; i++) {
      let s = "";
      for (let j = 0; j < 30; j++) s += pieces[next() % pieces.length];
      for (const target of ["google", "openai"] as const) {
        const result = lintProductFeed(s, { target });
        assert.equal(result.errorCount + result.warningCount, result.findings.length);
      }
      lintProductFeed(s, { format: "xml" });
      lintProductFeed(s, { target: "openai", format: "jsonl" });
    }
  });

  test("large feeds lint in linear time", () => {
    const n = 20_000;
    const rows = Array.from({ length: n }, (_, i) => ({ ...GOOGLE_ITEM, id: `SKU-${i}`, item_group_id: `G-${i % 1000}`, price: i % 100 === 0 ? "$1" : "12.00 USD" }));
    const time = (fn: () => unknown) => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };
    const small = tsv(rows.slice(0, n / 10));
    const large = tsv(rows);
    time(() => lint(small)); // warm up
    const ratio = time(() => lint(large)) / Math.max(time(() => lint(small)), 1);
    assert.ok(ratio < 30, `10x the items took ${ratio.toFixed(1)}x as long`);

    for (const [text, options] of [[large, {}], [rss(rows), {}], [jsonl(rows.map((r) => ({ ...OPENAI_ITEM, item_id: r.id }))), { target: "openai" }]] as const) {
      const start = performance.now();
      const result = lint(text, options);
      assert.equal(result.itemCount, n);
      assert.ok(performance.now() - start < 5000, "took over 5 seconds");
    }
  });
});
