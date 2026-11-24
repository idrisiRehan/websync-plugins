import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintProductCsv, detectPlatform } from "../src/lint.ts";
import type { ProductCsvResult, RuleId } from "../src/core.ts";

const lint = (csv: string) => lintProductCsv(csv, "shopify");
const rules = (r: ProductCsvResult) => r.findings.map((f) => f.rule);
const only = (r: ProductCsvResult, rule: RuleId) => {
  const found = r.findings.filter((f) => f.rule === rule);
  assert.ok(found.length > 0, `expected ${rule}, got ${JSON.stringify(r.findings)}`);
  return found;
};

// Current Shopify format: a product with two variants and an extra image row.
const CURRENT = [
  "Title,URL handle,Option1 name,Option1 value,SKU,Price,Compare-at price,Barcode,Product image URL,Image position,Status",
  "Tee,tee,Size,S,TEE-S,20.00,25.00,4006381333931,https://cdn.example.com/tee-1.jpg,1,active",
  ",tee,Size,M,TEE-M,20.00,,,,,",
  ",tee,,,,,,,https://cdn.example.com/tee-2.jpg,2,",
  ",tee,,,,,,,https://cdn.example.com/tee-3.jpg,3,",
].join("\n");

// The older export format with "Handle", "Variant SKU" and so on.
const LEGACY = [
  "Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Compare At Price,Variant Barcode,Image Src,Image Position,Variant Weight Unit,Published",
  "mug,Mug,Title,Default Title,MUG-1,12.50,,036000291452,https://cdn.example.com/mug.jpg,1,kg,TRUE",
].join("\n");

describe("clean files", () => {
  test("current format: no findings, image-only rows aren't counted as variants", () => {
    const r = lint(CURRENT);
    assert.deepEqual(r.findings, []);
    assert.equal(r.productCount, 1);
    assert.equal(r.variantCount, 2);
    assert.equal(r.rowCount, 4);
  });

  test("legacy format: no findings", () => {
    assert.deepEqual(lint(LEGACY).findings, []);
  });

  test("header names match case-insensitively", () => {
    assert.deepEqual(lint(LEGACY.replace("Variant Price", "variant price")).findings, []);
  });

  test("metafield, market and Google Shopping columns are known", () => {
    const csv = "Title,URL handle,Price / International,Included / International,Google Shopping / MPN,Fabric (product.metafields.custom.fabric)\nTee,tee,10,true,M1,cotton";
    assert.deepEqual(lint(csv).findings, []);
  });
});

describe("file and structure", () => {
  test("empty file", () => assert.deepEqual(rules(lint("  \n")), ["file-empty"]));
  test("header only", () => assert.deepEqual(rules(lint("Title,URL handle")), ["rows-none"]));

  test("semicolons are an error for Shopify", () => {
    const r = lint("Title;URL handle\nTee;tee");
    assert.equal(only(r, "delimiter-semicolon")[0].severity, "error");
    assert.equal(r.productCount, 1);
  });

  test("a BOM is info only", () => {
    const r = lint(`﻿${LEGACY}`);
    assert.deepEqual(rules(r), ["bom"]);
    assert.equal(r.valid, true);
  });

  test("invalid UTF-8 bytes", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("Title\nCaf"), 0xe9]);
    assert.deepEqual(rules(lintProductCsv(bytes, "shopify")), ["encoding-invalid"]);
  });

  test("valid UTF-8 bytes with a BOM", () => {
    assert.deepEqual(rules(lintProductCsv(new TextEncoder().encode(`﻿${LEGACY}`), "shopify")), ["bom"]);
  });

  test("mojibake is info", () => {
    assert.deepEqual(rules(lint("Title,URL handle\nCafÃ© mug,mug")), ["encoding-mojibake"]);
  });

  test("an unescaped inch mark gets a specific fix", () => {
    const r = lint('Title,URL handle\n12" pizza stone,stone');
    const f = only(r, "quote-unexpected")[0];
    assert.equal(f.row, 2);
    assert.match(f.message, /"12"" pizza"/);
  });

  test("an unclosed quote", () => {
    assert.equal(only(lint('Title,URL handle\n"Tee,tee\nMug,mug'), "quote-unterminated")[0].row, 2);
  });

  test("a ragged row reports its own width", () => {
    const f = only(lint("Title,URL handle,Price\nTee,tee"), "row-width")[0];
    assert.match(f.message, /Row has 2 cells, the header has 3/);
  });
});

describe("headers", () => {
  test("Title is required; URL handle is recommended", () => {
    assert.deepEqual(rules(lint("URL handle\ntee")), ["header-missing"]);
    assert.deepEqual(rules(lint("Title\nTee")), ["header-recommended"]);
  });

  test("unknown, blank and duplicate headers", () => {
    const r = lint("Title,URL handle,Colour,,title\nTee,tee,red,,Tee");
    assert.deepEqual(rules(r).sort(), ["header-blank", "header-duplicate", "header-unknown"]);
    assert.equal(only(r, "header-unknown")[0].severity, "info");
  });
});

describe("values", () => {
  const one = (header: string, value: string) => rules(lint(`Title,URL handle,${header}\nTee,tee,${value}`));

  test("prices must be plain numbers", () => {
    assert.deepEqual(one("Price", "$20"), ["value-decimal"]);
    assert.deepEqual(one("Price", "1,200.00"), ["row-width"]);
    assert.deepEqual(one("Variant Price", "20.5"), []);
  });

  test("inventory quantity must be a whole number", () => {
    assert.deepEqual(one("Inventory quantity", "4.5"), ["value-integer"]);
    assert.deepEqual(one("Inventory quantity", "-3"), []);
  });

  test("booleans must be TRUE or FALSE", () => {
    assert.deepEqual(one("Published on online store", "yes"), ["value-boolean"]);
    assert.deepEqual(one("Charge tax", "false"), []);
  });

  test("Status, inventory policy and weight unit value sets", () => {
    assert.deepEqual(one("Status", "live"), ["value-enum"]);
    assert.deepEqual(one("Status", "Draft"), []);
    assert.deepEqual(one("Continue selling when out of stock", "yes"), ["value-enum"]);
    assert.deepEqual(one("Variant Weight Unit", "kgs"), ["value-enum"]);
  });

  test("image URLs must be absolute http(s) URLs", () => {
    assert.deepEqual(one("Product image URL", "tee.jpg"), ["value-url"]);
    assert.deepEqual(one("Product image URL", "https://cdn.example.com/a b.jpg"), ["value-url"]);
  });

  test("an invalid barcode is a warning naming the expected check digit", () => {
    const r = lint("Title,URL handle,Barcode\nTee,tee,4006381333930");
    const f = only(r, "value-barcode")[0];
    assert.equal(f.severity, "warning");
    assert.match(f.message, /check digit for the rest is 1/);
  });

  test("ISBN-10 barcodes are accepted", () => {
    assert.deepEqual(one("Barcode", "080442957X"), []);
  });

  test("compare-at price below price", () => {
    assert.deepEqual(rules(lint("Title,URL handle,Price,Compare-at price\nTee,tee,30,25")), ["compare-at-below-price"]);
    assert.deepEqual(rules(lint("Title,URL handle,Price,Compare-at price\nTee,tee,30,0")), []);
  });
});

describe("products and variants", () => {
  test("duplicate SKUs are flagged on every row", () => {
    const r = lint("Title,URL handle,SKU,Option1 name,Option1 value\nTee,tee,X,Size,S\n,tee,X,Size,M");
    assert.deepEqual(only(r, "sku-duplicate").map((f) => f.row), [2, 3]);
  });

  test("a row without a handle", () => {
    assert.deepEqual(rules(lint("Title,URL handle\nTee,")), ["handle-missing"]);
  });

  test("a repeated Title on a following row", () => {
    assert.deepEqual(rules(lint("Title,URL handle,Option1 name,Option1 value\nTee,tee,Size,S\nTee,tee,Size,M")), ["title-repeated"]);
  });

  test("inconsistent option names within a product", () => {
    const r = lint("Title,URL handle,Option1 name,Option1 value\nTee,tee,Size,S\n,tee,Colour,Red");
    assert.equal(only(r, "option-name-inconsistent").length, 2);
  });

  test("duplicate variants", () => {
    const r = lint("Title,URL handle,Option1 name,Option1 value,SKU\nTee,tee,Size,S,A\n,tee,Size,S,B");
    assert.deepEqual(only(r, "variant-duplicate").map((f) => f.row), [2, 3]);
  });

  test("option values are compared field by field, not concatenated", () => {
    const csv = "Title,URL handle,Option1 name,Option1 value,Option2 name,Option2 value\nTee,tee,A,x,B,yz\n,tee,A,xy,B,z";
    assert.deepEqual(rules(lint(csv)), []);
  });

  test("extra image rows are not duplicate variants", () => {
    assert.deepEqual(rules(lint(CURRENT)), []);
  });

  test("duplicate and non-numeric image positions", () => {
    const r = lint("Title,URL handle,Product image URL,Image position\nTee,tee,https://e.com/1.jpg,1\n,tee,https://e.com/2.jpg,1\n,tee,https://e.com/3.jpg,first");
    assert.deepEqual(rules(r).sort(), ["image-position-duplicate", "image-position-duplicate", "value-integer"]);
  });

  test("without a handle column every row is its own product", () => {
    const r = lint("Title,Price\nTee,10\nMug,5");
    assert.equal(r.productCount, 2);
    assert.equal(r.variantCount, 2);
  });

  test("findings are sorted by row, whole-file findings first", () => {
    const r = lint("Title;URL handle;Price\nTee;tee;$1");
    assert.deepEqual(r.findings.map((f) => f.row), [null, 2]);
  });
});

describe("detectPlatform", () => {
  test("recognises current and legacy Shopify headers", () => {
    assert.equal(detectPlatform(CURRENT), "shopify");
    assert.equal(detectPlatform(LEGACY), "shopify");
    assert.equal(detectPlatform(new TextEncoder().encode(`﻿${LEGACY}`)), "shopify");
  });

  test("returns null for an unrelated file", () => {
    assert.equal(detectPlatform("name,email\na,b"), null);
  });
});
