import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintProductCsv, detectPlatform } from "../src/lint.ts";
import type { ProductCsvResult, RuleId } from "../src/core.ts";

const lint = (csv: string) => lintProductCsv(csv, "woocommerce");
const rules = (r: ProductCsvResult) => r.findings.map((f) => f.rule);
const only = (r: ProductCsvResult, rule: RuleId) => {
  const found = r.findings.filter((f) => f.rule === rule);
  assert.ok(found.length > 0, `expected ${rule}, got ${JSON.stringify(r.findings)}`);
  return found;
};
const HEAD = "ID,Type,SKU,Name,Parent,Regular price,Sale price,Attribute 1 name,Attribute 1 value(s),Images";

// A variable product with two variations, plus a simple product.
const CLEAN = [
  HEAD,
  '10,variable,TEE,Tee,,,,Size,"S, M",https://cdn.example.com/tee.jpg',
  "11,variation,TEE-S,,TEE,20,15,Size,S,",
  "12,variation,TEE-M,,id:10,20,,Size,M,",
  '13,simple,MUG,Mug,,12.50,,,,"https://cdn.example.com/mug-1.jpg, https://cdn.example.com/mug-2.jpg"',
].join("\n");

describe("clean file", () => {
  test("no findings, products and variations counted", () => {
    const r = lint(CLEAN);
    assert.deepEqual(r.findings, []);
    assert.equal(r.productCount, 2);
    assert.equal(r.variantCount, 2);
  });

  test("locale and unit header variants are known", () => {
    const csv = "Type,SKU,Name,Regular price,Visibility in catalogue,Weight (lbs),Meta: _custom,Download 1 URL\nsimple,A,Mug,5,visible,1,x,https://e.com/a.zip";
    assert.deepEqual(lint(csv).findings, []);
  });
});

describe("headers", () => {
  test("Type and Name are required; SKU and Regular price are recommended", () => {
    const r = lint("ID\n1");
    assert.deepEqual(rules(r).sort(), ["header-missing", "header-missing", "header-recommended", "header-recommended"]);
  });

  test("attribute columns come in name/value pairs", () => {
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price,Attribute 1 name\nsimple,A,Mug,5,Size")), ["attribute-pair-missing"]);
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price,Attribute 2 value(s)\nsimple,A,Mug,5,S")), ["attribute-pair-missing"]);
  });

  test("semicolons are only a warning for WooCommerce", () => {
    const r = lint("Type;SKU;Name;Regular price\nsimple;A;Mug;5");
    assert.deepEqual(rules(r), ["delimiter-semicolon"]);
    assert.equal(r.findings[0].severity, "warning");
  });
});

describe("values", () => {
  const one = (header: string, value: string) => rules(lint(`Type,SKU,Name,Regular price,${header}\nsimple,A,Mug,5,${value}`));

  test("flags, enums and integers", () => {
    assert.deepEqual(one("In stock?", "maybe"), ["value-flag"]);
    assert.deepEqual(one("In stock?", "Yes"), []);
    assert.deepEqual(one("Published", "2"), ["value-enum"]);
    assert.deepEqual(one("Tax status", "exempt"), ["value-enum"]);
    assert.deepEqual(one("Stock", "ten"), ["value-integer"]);
  });

  test("the GTIN column is checked as a barcode", () => {
    assert.deepEqual(one('"GTIN, UPC, EAN, or ISBN"', "123"), ["value-barcode"]);
    assert.deepEqual(one('"GTIN, UPC, EAN, or ISBN"', "036000291452"), []);
  });

  test("image list problems", () => {
    const r = (v: string) => rules(lint(`Type,SKU,Name,Regular price,Images\nsimple,A,Mug,5,"${v}"`));
    assert.deepEqual(r("https://e.com/a.jpg|https://e.com/b.jpg"), ["images-pipe"]);
    assert.deepEqual(r("https://e.com/a.jpg, "), ["images-empty-entry"]);
    assert.deepEqual(r("https://e.com/my image.jpg"), ["images-url-space"]);
    assert.deepEqual(r("https://[bad/a.jpg"), ["images-url-invalid"]);
    assert.deepEqual(r("www.e.com/a.jpg"), ["images-no-scheme"]);
    assert.deepEqual(r("mug.jpg"), []);
  });

  test("sale price must be below the regular price", () => {
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price,Sale price\nsimple,A,Mug,5,5")), ["sale-not-below-regular"]);
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price,Sale price\nsimple,A,Mug,£5,4")), ["value-decimal"]);
  });
});

describe("products", () => {
  test("missing and unknown types", () => {
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price\n,A,Mug,5")), ["type-missing"]);
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price\nbundle,A,Mug,5")), ["type-unknown"]);
  });

  test("a product without a name, but not a variation", () => {
    assert.deepEqual(rules(lint("Type,SKU,Name,Regular price\nsimple,A,,5")), ["name-missing"]);
  });

  test("duplicate SKUs and IDs", () => {
    const r = lint("ID,Type,SKU,Name,Regular price\n1,simple,A,Mug,5\n1,simple,A,Cup,5");
    assert.equal(only(r, "sku-duplicate").length, 2);
    assert.equal(only(r, "id-duplicate").length, 2);
  });
});

describe("variations", () => {
  test("a variation needs a parent", () => {
    assert.deepEqual(rules(lint(CLEAN.replace("11,variation,TEE-S,,TEE,", "11,variation,TEE-S,,,"))), ["parent-missing"]);
  });

  test("a parent outside the file is a warning", () => {
    assert.deepEqual(rules(lint(CLEAN.replace("11,variation,TEE-S,,TEE,", "11,variation,TEE-S,,OTHER,"))), ["parent-not-found"]);
  });

  test("a parent that isn't variable is an error", () => {
    const csv = `${HEAD}\n13,simple,MUG,Mug,,5,,,,\n14,variation,MUG-1,,MUG,5,,,,`;
    assert.deepEqual(rules(lint(csv)), ["parent-not-variable"]);
  });

  test("id: references resolve against the ID column", () => {
    assert.deepEqual(rules(lint(CLEAN.replace("id:10", "id:99"))), ["parent-not-found"]);
  });

  test("a variation with a list of attribute values", () => {
    assert.deepEqual(rules(lint(CLEAN.replace("TEE,20,15,Size,S,", 'TEE,20,15,Size,"S, M",'))), ["variation-attribute-list"]);
  });

  test("a variation attribute the parent doesn't declare", () => {
    assert.deepEqual(rules(lint(CLEAN.replace("TEE,20,15,Size,S,", "TEE,20,15,Colour,Red,"))), ["variation-attribute-unknown"]);
  });

  test("a variable product with no variations", () => {
    const csv = `${HEAD}\n10,variable,TEE,Tee,,,,Size,"S, M",`;
    assert.deepEqual(rules(lint(csv)), ["variable-without-variations"]);
  });
});

describe("detectPlatform", () => {
  test("recognises a WooCommerce export", () => {
    assert.equal(detectPlatform(CLEAN), "woocommerce");
  });
});
