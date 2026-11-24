import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readProducts } from "../src/index.ts";

const script = (json: string) => `<script type="application/ld+json">${json}</script>`;
const page = (...blocks: string[]) => `<!doctype html>\n<html><head>\n${blocks.map(script).join("\n")}\n</head><body></body></html>`;

describe("readProducts", () => {
  test("reads a Product with one Offer: identifiers, price, currency, availability, lines and paths", () => {
    const html = page(`{
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "#product",
  "name": "Blue mug",
  "sku": "MUG-1",
  "gtin13": "4006381333931",
  "mpn": "M1",
  "url": "https://shop.example/mug",
  "offers": {
    "@type": "Offer",
    "price": "12.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "priceValidUntil": "2027-01-01"
  }
}`);
    const result = readProducts(html);
    assert.deepEqual([result.format, result.blockCount, result.unreadableBlockCount, result.otherSyntax], ["html", 1, 0, false]);
    const [p] = result.products;
    assert.deepEqual(
      { types: p.types, id: p.id, name: p.name, sku: p.sku, gtins: p.gtins, mpn: p.mpn, url: p.url, group: p.group, line: p.line, path: p.path },
      { types: ["Product"], id: "#product", name: "Blue mug", sku: "MUG-1", gtins: ["4006381333931"], mpn: "M1", url: "https://shop.example/mug", group: null, line: 3, path: "$" },
    );
    const [o] = p.offers;
    assert.deepEqual([o.types, o.price, o.priceCurrency, o.availability, o.priceValidUntil, o.line, o.path], [["Offer"], "12.00", "USD", "InStock", "2027-01-01", 12, "$.offers"]);
  });

  test("numbers are given in their shortest decimal form; enum values may be references or short names", () => {
    const [p] = readProducts(`{"@type":"Product","offers":[{"@type":"Offer","price":18.00,"availability":{"@id":"http://schema.org/OutOfStock"}},{"@type":"Offer","price":0.1,"availability":"PreOrder"}]}`).products;
    assert.deepEqual(p.offers.map((o) => [o.price, o.availability]), [["18", "OutOfStock"], ["0.1", "PreOrder"]]);
  });

  test("AggregateOffer ranges, and its own offers after it", () => {
    const [p] = readProducts(`{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":"10","highPrice":"20","priceCurrency":"EUR","offers":[{"@type":"Offer","price":"10","sku":"A"},{"@type":"Offer","price":"20","sku":"B"}]}}`).products;
    assert.deepEqual(p.offers.map((o) => [o.types[0], o.lowPrice, o.highPrice, o.price, o.sku]), [
      ["AggregateOffer", "10", "20", null, null],
      ["Offer", null, null, "10", "A"],
      ["Offer", null, null, "20", "B"],
    ]);
  });

  test("priceSpecification entries with priceType and validity", () => {
    const [p] = readProducts(`{"@type":"Product","offers":{"@type":"Offer","priceSpecification":[
      {"@type":"UnitPriceSpecification","price":15,"priceCurrency":"USD","validThrough":"2026-12-31"},
      {"@type":"UnitPriceSpecification","price":20,"priceCurrency":"USD","priceType":"https://schema.org/StrikethroughPrice"},
      {"@type":"UnitPriceSpecification","price":12,"priceCurrency":"USD","validForMemberTier":{"@id":"#gold"}}]}}`).products;
    assert.deepEqual(p.offers[0].priceSpecifications.map((s) => [s.price, s.priceCurrency, s.priceType, s.memberPrice, s.validThrough]), [
      ["15", "USD", null, false, "2026-12-31"],
      ["20", "USD", "StrikethroughPrice", false, null],
      ["12", "USD", null, true, null],
    ]);
  });

  test("ProductGroup with hasVariant: each variant is a product that knows its group", () => {
    const [group, small, large] = readProducts(`{"@context":"https://schema.org","@type":"ProductGroup","productGroupID":"TEE","hasVariant":[
      {"@type":"Product","sku":"TEE-S","offers":{"@type":"Offer","price":"10"}},
      {"@type":"Product","sku":"TEE-L","inProductGroupWithID":"TEE","offers":{"@type":"Offer","price":"12"}}]}`).products;
    assert.deepEqual([group.types, group.productGroupID, group.group, group.offers], [["ProductGroup"], "TEE", null, []]);
    assert.deepEqual([small.sku, small.productGroupID, small.group?.productGroupID, small.group?.line, small.offers[0].price], ["TEE-S", "TEE", "TEE", 1, "10"]);
    assert.deepEqual([large.sku, large.productGroupID], ["TEE-L", "TEE"]);
  });

  test("@graph, @id references across blocks, and isVariantOf", () => {
    const html = page(
      `{"@context":"https://schema.org","@graph":[{"@type":"ProductGroup","@id":"#g","productGroupID":"G","hasVariant":[{"@id":"#v1"}]},{"@type":"Product","@id":"#v1","sku":"V1","offers":{"@id":"#o1"}}]}`,
      `{"@context":"https://schema.org","@type":"Offer","@id":"#o1","price":"5","priceCurrency":"USD"}`,
      `{"@context":"https://schema.org","@type":"Product","sku":"V2","isVariantOf":{"@id":"#g"}}`,
    );
    const products = readProducts(html).products;
    assert.deepEqual(products.map((p) => [p.sku, p.group?.id ?? null, p.offers.map((o) => o.price)]), [
      [null, null, []],
      ["V1", "#g", ["5"]],
      ["V2", "#g", []],
    ]);
  });

  test("a product described twice with one @id is read once; related products are not this page's", () => {
    const products = readProducts(page(
      `{"@context":"https://schema.org","@type":"Product","@id":"#p","sku":"A","isRelatedTo":{"@type":"Product","sku":"R"},"offers":{"@type":"Offer","price":"1","itemOffered":{"@type":"Product","sku":"X"}}}`,
      `{"@context":"https://schema.org","@type":"Product","@id":"#p","name":"A"}`,
      `{"@context":"https://schema.org","@type":"WebPage","mainEntity":{"@type":"Product","sku":"M"}}`,
    )).products;
    assert.deepEqual(products.map((p) => [p.sku, p.name]), [["A", "A"], ["M", null]]);
  });

  test("counts unreadable blocks and notes Microdata; never throws", () => {
    const result = readProducts(`<div itemscope itemtype="https://schema.org/Product"></div>${script("{bad")}${script("")}`);
    assert.deepEqual([result.products.length, result.blockCount, result.unreadableBlockCount, result.otherSyntax], [0, 2, 2, true]);
    const pieces = ['{"@type":"Product"', ',"offers":', "[", "]", "{", "}", '"price":', "1", '"x"', ",", '{"@id":"#a"}', '"@id":"#a"', '"hasVariant":', '"@graph":', "<script type=application/ld+json>", "</script>", "null"];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 3000; i++) {
      let s = "";
      for (let j = 0; j < 25; j++) s += pieces[next() % pieces.length];
      readProducts(s);
      readProducts(`<p>${s}`);
    }
  });

  test("linear time when many nodes share one @id", () => {
    const run = (n: number) => {
      const offers = Array.from({ length: n }, (_, i) => `{"@id":"#o","@type":"Offer","sku":"S${i}"}`).join(",");
      const start = performance.now();
      assert.equal(readProducts(`{"@type":"Product","offers":[${offers}]}`).products[0].offers.length, n);
      return performance.now() - start;
    };
    run(500); // warm up
    // A floor under the small run, so timer noise on a fast machine can't fail the test.
    const ratio = run(5_000) / Math.max(run(500), 20);
    assert.ok(ratio < 30, `10x the nodes took ${ratio.toFixed(1)}x as long`);
  });
});
