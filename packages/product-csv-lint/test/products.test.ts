import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readProducts, type Product } from "../src/index.ts";

/** A CSV from rows of { header: value }, with the header made of every key used. */
function csv(rows: Record<string, string>[]): string {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))].map((cells) => cells.map(cell).join(",")).join("\n");
}

const shopify = (rows: Record<string, string>[]) => readProducts(csv(rows), "shopify");
const woo = (rows: Record<string, string>[]) => readProducts(csv(rows), "woocommerce");
const only = (products: Product[]) => {
  assert.equal(products.length, 1);
  return products[0];
};

describe("Shopify, current format", () => {
  const rows: Record<string, string>[] = [
    {
      Title: "Tee", "URL handle": "tee", Description: "<p>Soft</p>", Vendor: "Acme", "Product category": "Apparel > Shirts", Type: "Shirts", Tags: "cotton, summer",
      "Published on online store": "true", Status: "active", SKU: "TEE-S", Barcode: "4006381333931", "Option1 name": "Size", "Option1 value": "S", Price: "20.00", "Compare-at price": "25.00",
      "Inventory tracker": "shopify", "Inventory quantity": "3", "Continue selling when out of stock": "deny", "Product image URL": "https://cdn.example.com/b.jpg", "Image position": "2",
      "Variant image URL": "https://cdn.example.com/s.jpg", "Gift card": "false", "SEO description": "A soft tee.", "Google Shopping / Gender": "Unisex", "Google Shopping / MPN": "T-1",
    },
    { "URL handle": "tee", SKU: "TEE-M", "Option1 value": "M", Price: "20.00", "Compare-at price": "15.00", "Inventory tracker": "shopify", "Inventory quantity": "0", "Continue selling when out of stock": "continue", "Product image URL": "https://cdn.example.com/a.jpg", "Image position": "1" },
    { "URL handle": "tee", "Product image URL": "https://cdn.example.com/c.jpg", "Image position": "3" },
  ];

  test("product fields come from the first row of a handle", () => {
    const p = only(shopify(rows).products);
    assert.equal(p.platform, "shopify");
    assert.equal(p.row, 2);
    assert.equal(p.handle, "tee");
    assert.equal(p.title, "Tee");
    assert.equal(p.description, "<p>Soft</p>");
    assert.equal(p.summary, "A soft tee.");
    assert.equal(p.brand, "Acme");
    assert.equal(p.productType, "Shirts");
    assert.deepEqual(p.categories, ["Apparel > Shirts"]);
    assert.deepEqual(p.tags, ["cotton", "summer"]);
    assert.equal(p.status, "active");
    assert.equal(p.visible, true);
    assert.equal(p.giftCard, false);
    assert.deepEqual(p.google, { gender: "Unisex", mpn: "T-1" });
  });

  test("variant rows become variants, image-only rows don't, and images follow their positions", () => {
    const p = only(shopify(rows).products);
    assert.deepEqual(p.variants.map((v) => [v.row, v.sku]), [[2, "TEE-S"], [3, "TEE-M"]]);
    assert.deepEqual(p.images, ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg", "https://cdn.example.com/c.jpg"]);
    assert.equal(p.variants[0].image, "https://cdn.example.com/s.jpg");
    assert.deepEqual(p.options, [{ name: "Size", values: ["S", "M"] }]);
    assert.deepEqual(p.variants[1].options, [{ name: "Size", value: "M" }]);
  });

  test("a compare-at price above Price makes Price the sale price; a lower one is ignored", () => {
    const [s, m] = only(shopify(rows).products).variants;
    assert.deepEqual([s.price, s.salePrice], ["25.00", "20.00"]);
    assert.deepEqual([m.price, m.salePrice], ["20.00", ""]);
  });

  test("inventory: tracker, quantity and policy", () => {
    const [s, m] = only(shopify(rows).products).variants;
    assert.deepEqual(s.inventory, { tracked: true, quantity: 3, continueSelling: false, status: null });
    assert.deepEqual(m.inventory, { tracked: true, quantity: 0, continueSelling: true, status: null });
    const untracked = only(shopify([{ Title: "Mug", "URL handle": "mug", Price: "5", "Inventory tracker": "", "Inventory quantity": "0" }]).products);
    assert.equal(untracked.variants[0].inventory.tracked, false);
    const unknown = only(shopify([{ Title: "Mug", "URL handle": "mug", Price: "5" }]).products);
    assert.deepEqual(unknown.variants[0].inventory, { tracked: null, quantity: null, continueSelling: null, status: null });
  });

  test("the barcode becomes a GTIN only with a valid check digit; typed, semicolon-separated lists are read", () => {
    const [s] = only(shopify(rows).products).variants;
    assert.equal(s.gtin, "4006381333931");
    const read = (barcode: string) => only(shopify([{ Title: "Mug", "URL handle": "mug", Price: "5", Barcodes: barcode }]).products).variants[0];
    assert.equal(read("4006381333930").gtin, null);
    assert.equal(read("4006381333930").barcode, "4006381333930");
    assert.equal(read("sku:ABC;upc:036000291452").gtin, "036000291452");
    assert.equal(read("4006 3813 3393 1").gtin, "4006381333931");
    assert.equal(read("0306406152").gtin, null); // an ISBN-10 isn't a GTIN
  });

  test("Barcodes lists: GTIN types first, then untyped (Custom); ASIN and NS-PID never; escapes undone", () => {
    const gtin = (barcode: string, header = "Barcodes") => only(shopify([{ Title: "Mug", "URL handle": "mug", Price: "5", [header]: barcode }]).products).variants[0].gtin;
    // Shopify's own sample file names the column Variant Barcodes, with an ISBN written with hyphens.
    assert.equal(gtin("ean:4006381333931; upc:036000291452", "Variant Barcodes"), "4006381333931");
    assert.equal(gtin("isbn:978-1-4028-9462-6", "Variant Barcodes"), "9781402894626");
    assert.equal(gtin("4006381333931;upc:036000291452"), "036000291452");
    assert.equal(gtin("ns-pid:4006381333931;asin:B07XYZ1234"), null);
    assert.equal(gtin("INTERNAL\\;4006381333931"), null); // one Custom barcode, "INTERNAL;4006381333931"
  });

  test("the Google Shopping MPN is each variant's own, under its current or older name", () => {
    for (const header of ["Google Shopping / Manufacturer part number (MPN)", "Google Shopping / MPN"]) {
      const p = only(shopify([
        { Title: "Tee", "URL handle": "tee", "Option1 name": "Size", "Option1 value": "S", Price: "5", [header]: "TEE-S" },
        { "URL handle": "tee", "Option1 value": "M", Price: "5" },
      ]).products);
      assert.deepEqual(p.variants.map((v) => v.mpn), ["TEE-S", ""], header);
    }
  });

  test("Shopify's single Default Title variant has no options", () => {
    const p = only(shopify([{ Title: "Mug", "URL handle": "mug", "Option1 name": "Title", "Option1 value": "Default Title", Price: "5" }]).products);
    assert.deepEqual(p.variants[0].options, []);
    assert.deepEqual(p.options, []);
  });

  test("status, publishing and gift cards, with Shopify's defaults", () => {
    const one = (extra: Record<string, string>) => only(shopify([{ Title: "X", "URL handle": "x", Price: "5", ...extra }]).products);
    assert.equal(one({}).status, "active");
    assert.equal(one({}).visible, true);
    assert.equal(one({ Status: "Draft" }).status, "draft");
    assert.equal(one({ Status: "archived" }).status, "archived");
    assert.equal(one({ "Published on online store": "FALSE" }).visible, false);
    assert.equal(one({ "Gift card": "TRUE" }).giftCard, true);
  });

  test("a row without a handle belongs to no product", () => {
    const r = shopify([{ Title: "Tee", "URL handle": "tee", Price: "5" }, { "URL handle": "", SKU: "LOST", Price: "5" }]);
    assert.equal(r.products.length, 1);
    assert.deepEqual(r.unread, [{ row: 3, reason: "No URL handle, so the row belongs to no product." }]);
    assert.equal(r.rowCount, 2);
  });

  test("without a handle column every row is its own product", () => {
    const r = shopify([{ Title: "A", Price: "1" }, { Title: "B", Price: "2" }]);
    assert.deepEqual(r.products.map((p) => [p.title, p.handle]), [["A", ""], ["B", ""]]);
  });
});

describe("Shopify, legacy format", () => {
  test("the older column names are read the same way", () => {
    const r = shopify([
      {
        Handle: "socks", Title: "Socks", "Body (HTML)": "<p>Warm</p>", Vendor: "Acme", Type: "Socks", Published: "TRUE", "Option1 Name": "Size", "Option1 Value": "S", "Variant SKU": "SOCK-S",
        "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "4", "Variant Inventory Policy": "deny", "Variant Price": "16.00", "Variant Compare At Price": "18.00",
        "Variant Barcode": "036000291452", "Image Src": "https://cdn.example.com/socks.jpg", "Image Position": "1", "Gift Card": "FALSE", "Variant Image": "https://cdn.example.com/s.jpg",
        "SEO Description": "Warm socks.", "Google Shopping / Age Group": "Adult", Status: "active",
      },
      // Legacy exports name the options on the first row only.
      { Handle: "socks", "Option1 Value": "M", "Variant SKU": "SOCK-M", "Variant Inventory Tracker": "shopify", "Variant Inventory Qty": "0", "Variant Inventory Policy": "continue", "Variant Price": "16.00" },
    ]);
    const p = only(r.products);
    assert.equal(p.description, "<p>Warm</p>");
    assert.equal(p.summary, "Warm socks.");
    assert.deepEqual(p.images, ["https://cdn.example.com/socks.jpg"]);
    assert.deepEqual(p.google, { "age group": "Adult" });
    const [s, m] = p.variants;
    assert.deepEqual([s.sku, s.price, s.salePrice, s.gtin, s.image], ["SOCK-S", "18.00", "16.00", "036000291452", "https://cdn.example.com/s.jpg"]);
    assert.deepEqual(s.inventory, { tracked: true, quantity: 4, continueSelling: false, status: null });
    assert.deepEqual(m.options, [{ name: "Size", value: "M" }]);
    assert.equal(m.inventory.continueSelling, true);
  });
});

describe("WooCommerce", () => {
  const parent = {
    ID: "10", Type: "variable", SKU: "TEE", Name: "Tee", Published: "1", "Visibility in catalog": "visible", "Short description": "Soft tee.", Description: "<p>One</p>\\n<p>Two</p>",
    "In stock?": "1", "Regular price": "", "Sale price": "", Categories: "Clothing > Tees, Featured", Tags: "cotton", Images: "https://cdn.example.com/a.jpg, https://cdn.example.com/b.jpg",
    Parent: "", Brands: "Acme, Other", "Attribute 1 name": "Color", "Attribute 1 value(s)": "Blue, Grey", "Attribute 2 name": "Size", "Attribute 2 value(s)": "S, M",
  };
  const variation = (id: string, sku: string, parentRef: string, color: string, size: string, extra: Record<string, string> = {}) => ({
    ID: id, Type: "variation", SKU: sku, Name: "", Published: "1", "In stock?": "1", Stock: "5", "Regular price": "20", Parent: parentRef,
    "Attribute 1 name": "Color", "Attribute 1 value(s)": color, "Attribute 2 name": "Size", "Attribute 2 value(s)": size, ...extra,
  });

  test("a variable product collects its variations, by parent SKU or id:ID", () => {
    const r = woo([parent, variation("11", "TEE-BS", "TEE", "Blue", "S", { "Sale price": "15", Images: "https://cdn.example.com/blue.jpg" }), variation("12", "TEE-GM", "id:10", "Grey", "M")]);
    const p = only(r.products);
    assert.deepEqual([p.id, p.sku, p.type, p.title, p.summary, p.brand], ["10", "TEE", "variable", "Tee", "Soft tee.", "Acme"]);
    assert.equal(p.description, "<p>One</p>\n<p>Two</p>");
    assert.deepEqual(p.categories, ["Clothing > Tees", "Featured"]);
    assert.deepEqual(p.images, ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]);
    assert.deepEqual(p.options, [{ name: "Color", values: ["Blue", "Grey"] }, { name: "Size", values: ["S", "M"] }]);
    assert.deepEqual(p.variants.map((v) => [v.row, v.id, v.sku]), [[3, "11", "TEE-BS"], [4, "12", "TEE-GM"]]);
    const [blue, grey] = p.variants;
    assert.deepEqual(blue.options, [{ name: "Color", value: "Blue" }, { name: "Size", value: "S" }]);
    assert.deepEqual([blue.price, blue.salePrice, blue.image], ["20", "15", "https://cdn.example.com/blue.jpg"]);
    assert.deepEqual(grey.inventory, { tracked: true, quantity: 5, continueSelling: null, status: "in_stock" });
    assert.deepEqual(r.unread, []);
  });

  test("a blank variation attribute means any value and is left out; a blank name falls back to the parent's", () => {
    const p = only(woo([parent, variation("11", "TEE-B", "TEE", "Blue", ""), { ...variation("12", "TEE-G", "TEE", "Grey", "M"), "Attribute 1 name": "" }]).products);
    assert.deepEqual(p.variants[0].options, [{ name: "Color", value: "Blue" }]);
    assert.deepEqual(p.variants[1].options, [{ name: "Color", value: "Grey" }, { name: "Size", value: "M" }]);
  });

  test("a simple product is its own single variant", () => {
    const p = only(woo([{ ID: "5", Type: "simple", SKU: "MUG", Name: "Mug", "Regular price": "12.50", "Sale price": "10", "GTIN, UPC, EAN, or ISBN": "036000291452", MPN: "M-1", "In stock?": "0", Stock: "", "Backorders allowed?": "notify", Images: "https://cdn.example.com/m.jpg", "Attribute 1 name": "Color", "Attribute 1 value(s)": "Green" }]).products);
    assert.equal(p.type, "simple");
    const [v] = p.variants;
    assert.deepEqual([v.row, v.id, v.sku, v.price, v.salePrice, v.gtin, v.mpn, v.image], [2, "5", "MUG", "12.50", "10", "036000291452", "M-1", ""]);
    assert.deepEqual(v.options, []);
    assert.deepEqual(p.options, [{ name: "Color", values: ["Green"] }]);
    assert.deepEqual(v.inventory, { tracked: false, quantity: null, continueSelling: true, status: "out_of_stock" });
  });

  test("types: the downloadable and virtual flags are dropped, a blank type is simple, plugin types are kept", () => {
    const type = (t: string) => only(woo([{ ID: "1", Type: t, SKU: "A", Name: "A" }]).products).type;
    assert.equal(type("simple, downloadable, virtual"), "simple");
    assert.equal(type(""), "simple");
    assert.equal(type("Grouped"), "grouped");
    assert.equal(type("subscription, virtual"), "subscription");
  });

  test("a downloadable or virtual variation is still a variation of its parent", () => {
    const r = woo([parent, variation("11", "TEE-BS", "TEE", "Blue", "S", { Type: "variation, downloadable, virtual" })]);
    assert.deepEqual(only(r.products).variants.map((v) => v.sku), ["TEE-BS"]);
  });

  test("Published and visibility map to status and visible", () => {
    const one = (extra: Record<string, string>) => only(woo([{ ID: "1", Type: "simple", SKU: "A", Name: "A", ...extra }]).products);
    assert.equal(one({ Published: "1" }).status, "active");
    assert.equal(one({ Published: "0" }).status, "private");
    assert.equal(one({ Published: "-1" }).status, "draft");
    assert.equal(one({ Published: "2" }).status, "pending");
    assert.equal(one({ Published: "constructor" }).status, "constructor");
    assert.equal(one({ "Visibility in catalog": "hidden" }).visible, false);
    assert.equal(one({ "Visibility in catalogue": "search" }).visible, true);
  });

  test("stock status, the backorder value and the sale schedule", () => {
    const v = (extra: Record<string, string>) => only(woo([{ ID: "1", Type: "simple", SKU: "A", Name: "A", ...extra }]).products).variants[0];
    assert.equal(v({ "In stock?": "backorder" }).inventory.status, "backorder");
    assert.equal(v({ "In stock?": "yes" }).inventory.status, "in_stock");
    assert.equal(v({ "In stock?": "" }).inventory.status, null);
    assert.equal(v({ Stock: "parent" }).inventory.tracked, true);
    assert.equal(v({ Stock: "parent" }).inventory.quantity, null);
    const sale = v({ "Date sale price starts": "2026-12-01 0:00:00", "Date sale price ends": "2026-12-31 23:59:59" });
    assert.deepEqual([sale.saleStarts, sale.saleEnds], ["2026-12-01 0:00:00", "2026-12-31 23:59:59"]);
  });

  test("the exporter's escapes are undone: \\, in lists, \\n in descriptions, ' before a formula character", () => {
    const p = only(woo([{ ID: "1", Type: "simple", SKU: "'-A", Name: "'=Mug", Description: "Line\\nnext \\\\n literal", Categories: "Pots\\, pans, Mugs", "Attribute 1 name": "Size", "Attribute 1 value(s)": "1\\,5 l, 2 l" }]).products);
    assert.equal(p.sku, "-A");
    assert.equal(p.title, "=Mug");
    assert.equal(p.description, "Line\nnext \\n literal");
    assert.deepEqual(p.categories, ["Pots, pans", "Mugs"]);
    assert.deepEqual(p.options, [{ name: "Size", values: ["1,5 l", "2 l"] }]);
  });

  test("disabled variations are marked, not dropped", () => {
    const p = only(woo([parent, variation("11", "TEE-B", "TEE", "Blue", "S", { Published: "0" })]).products);
    assert.equal(p.variants[0].enabled, false);
  });

  test("variations without a usable parent are unread, with the reason", () => {
    const r = woo([
      { ID: "5", Type: "simple", SKU: "MUG", Name: "Mug", "Regular price": "5" },
      variation("11", "A", "", "Blue", "S"),
      variation("12", "B", "NOPE", "Blue", "S"),
      variation("13", "C", "MUG", "Blue", "S"),
    ]);
    assert.deepEqual(r.unread, [
      { row: 3, reason: "This variation has no Parent." },
      { row: 4, reason: 'This variation has Parent "NOPE", which isn\'t a product in this file.' },
      { row: 5, reason: 'This variation has Parent "MUG", a simple product, not a variable one.' },
    ]);
    assert.equal(r.products[0].variants.length, 1);
  });

  test("a variable product without variations has no variants", () => {
    assert.deepEqual(only(woo([parent]).products).variants, []);
  });
});

describe("input", () => {
  test("bytes are decoded as UTF-8, with or without a BOM", () => {
    const text = csv([{ Title: "Café", "URL handle": "cafe", Price: "5" }]);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    assert.equal(only(readProducts(bom, "shopify").products).title, "Café");
    assert.equal(only(readProducts(String.fromCharCode(0xfeff) + text, "shopify").products).title, "Café");
  });

  test("empty, header-only and broken input never throws", () => {
    for (const input of ["", "\n\n", "Title,URL handle", '"unterminated,x\n1,2', new Uint8Array([0xff, 0xfe, 0x00]), "a;b;c\n1;2;3"]) {
      for (const platform of ["shopify", "woocommerce"] as const) {
        const r = readProducts(input, platform);
        assert.ok(Array.isArray(r.products) && Array.isArray(r.unread));
      }
    }
    assert.deepEqual(readProducts("", "shopify"), { platform: "shopify", rowCount: 0, products: [], unread: [] });
  });

  test("semicolon-separated files are read too", () => {
    assert.equal(only(readProducts("Title;URL handle;Price\nMug;mug;5", "shopify").products).handle, "mug");
  });
});
