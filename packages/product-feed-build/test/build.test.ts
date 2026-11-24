import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildProductFeed, type BuildOptions } from "../src/index.ts";
import { build, csv, one, openai, records, shop, STORE, wooRow, type Row } from "./helpers.ts";

const rules = (r: ReturnType<typeof build>) => r.lint.findings.map((f) => `${f.rule} ${f.attribute ?? ""}`.trim());
const notes = (r: ReturnType<typeof build>) => r.notes.map((n) => n.message);

describe("options", () => {
  const base: BuildOptions = { target: "google", storeUrl: STORE, currency: "USD" };
  const throws = (options: Partial<BuildOptions> | null, message: RegExp, input: unknown = csv([shop()])) =>
    assert.throws(() => buildProductFeed(input as string, (options === null ? null : { ...base, ...options }) as BuildOptions), (e: unknown) => e instanceof TypeError && message.test(e.message));

  test("invalid options throw a TypeError naming the option", () => {
    throws(null, /options must be an object/);
    throws({}, /csv must be a string or a Uint8Array/, 42);
    throws({ target: "bing" as "google" }, /options.target/);
    throws({ format: "jsonl" }, /options.format for google must be one of: xml, tsv/);
    throws({ target: "openai", sellerName: "A", storeCountry: "US", format: "xml" }, /options.format for openai must be one of: jsonl, csv, tsv/);
    for (const storeUrl of ["http://shop.example.com", "shop.example.com", "/shop", "https://shop.example.com/?ref=1", "https://shop.example.com/#top", "https://user:pw@shop.example.com"]) {
      throws({ storeUrl }, /options.storeUrl/);
    }
    for (const currency of ["", "US", "DOLLAR", "XYZ", "$"]) throws({ currency }, /options.currency/);
    throws({ platform: "magento" as "shopify" }, /options.platform/);
    throws({ condition: "mint" as "new" }, /options.condition/);
    throws({ brand: " " }, /options.brand/);
    throws({ brand: `Acme ${String.fromCharCode(0xd800)}` }, /options.brand contains an unpaired surrogate/);
    throws({ target: "openai", storeCountry: "US" }, /options.sellerName is required/);
    throws({ target: "openai", sellerName: "A" }, /options.storeCountry/);
    throws({ target: "openai", sellerName: "A", storeCountry: "USA" }, /options.storeCountry/);
    throws({ target: "openai", sellerName: "A", storeCountry: "US", targetCountries: [] }, /options.targetCountries/);
    throws({ target: "openai", sellerName: "A", storeCountry: "US", targetCountries: ["U1"] }, /options.targetCountries/);
  });

  test("a header that matches neither platform needs options.platform", () => {
    throws({}, /Set options.platform/, "name,price\nMug,5");
    assert.equal(build("Title,Price\nMug,5", { platform: "shopify" }).platform, "shopify");
  });

  test("defaults: xml for google, jsonl for openai, platform detected, currency upper-cased", () => {
    const g = build([shop()]);
    assert.deepEqual([g.target, g.format, g.platform], ["google", "xml", "shopify"]);
    const o = build([wooRow()], { target: "openai", currency: "eur" });
    assert.deepEqual([o.target, o.format, o.platform], ["openai", "jsonl", "woocommerce"]);
    assert.equal(records(o)[0].price, "12.00 EUR");
  });

  test("bytes are accepted as well as text", () => {
    assert.equal(buildProductFeed(new TextEncoder().encode(csv([shop()])), { target: "google", storeUrl: STORE, currency: "USD" }).itemCount, 1);
  });
});

describe("items and ids", () => {
  const tee = [
    shop({ Title: "Tee", "URL handle": "tee", SKU: "", Barcode: "", "Option1 name": "Size", "Option1 value": "S" }),
    { "URL handle": "tee", "Option1 value": "M", Price: "12.00", "Inventory tracker": "shopify", "Inventory quantity": "2" },
  ];

  test("one item per variant, grouped by the Shopify handle", () => {
    const items = records(build([shop({ "Option1 name": "Size", "Option1 value": "S", SKU: "MUG-S" }), { "URL handle": "blue-mug", "Option1 value": "L", SKU: "MUG-L", Price: "14.00" }]));
    assert.deepEqual(items.map((i) => [i.id, i.item_group_id, i.item_group_title, i.title]), [
      ["MUG-S", "blue-mug", "Blue mug", "Blue mug, S"],
      ["MUG-L", "blue-mug", "Blue mug", "Blue mug, L"],
    ]);
  });

  test("without a SKU: the handle for a single product, handle-position for variants", () => {
    assert.equal(one([shop({ SKU: "" })]).id, "blue-mug");
    assert.deepEqual(records(build(tee)).map((i) => i.id), ["tee-1", "tee-2"]);
  });

  test("a single product with options isn't a group and keeps its title", () => {
    const item = one([shop({ "Option1 name": "Size", "Option1 value": "One size" })]);
    assert.equal(item.item_group_id, undefined);
    assert.equal(item.title, "Blue mug");
    assert.equal(item.size, "One size");
  });

  test("WooCommerce: SKU, else ID; group by parent SKU, else parent ID", () => {
    const parent = wooRow({ ID: "10", Type: "variable", SKU: "", "Regular price": "", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S, M" });
    const v = (id: string, sku: string, size: string) => wooRow({ ID: id, Type: "variation", SKU: sku, Name: "", Parent: "id:10", Brands: "", Images: "", "Attribute 1 name": "Size", "Attribute 1 value(s)": size });
    const items = records(build([parent, v("11", "TEE-S", "S"), v("12", "", "M")]));
    assert.deepEqual(items.map((i) => [i.id, i.item_group_id, i.title, i.brand]), [
      ["TEE-S", "10", "Blue mug, S", "Acme"],
      ["12", "10", "Blue mug, M", "Acme"],
    ]);
  });

  test("a variation with neither SKU nor ID is skipped", () => {
    const r = build([wooRow({ Type: "variable", SKU: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" }), wooRow({ ID: "", Type: "variation", SKU: "", Parent: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" })]);
    assert.deepEqual(r.skipped, [{ row: 3, reason: "No SKU or ID, so the item has no stable id." }]);
  });

  test("Google: an id or group id over 50 characters is shortened, stable and distinct; OpenAI keeps it", () => {
    const long = "A".repeat(60);
    const r = build([shop({ SKU: `${long}-1`, "Option1 name": "Size", "Option1 value": "S", "URL handle": "h".repeat(55) }), { "URL handle": "h".repeat(55), SKU: `${long}-2`, "Option1 value": "M", Price: "5" }]);
    const ids = records(r).map((i) => i.id as string);
    assert.ok(ids.every((id) => id.length === 50 && /^A{41}-[0-9a-f]{8}$/.test(id)), ids.join());
    assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(ids, records(build(csv([shop({ SKU: `${long}-1`, "Option1 name": "Size", "Option1 value": "S", "URL handle": "h".repeat(55) }), { "URL handle": "h".repeat(55), SKU: `${long}-2`, "Option1 value": "M", Price: "5" }]))).map((i) => i.id));
    assert.equal((records(r)[0].item_group_id as string).length, 50);
    assert.equal(r.lint.errorCount, 0);
    assert.match(notes(r).join("\n"), /longer than 50 characters, so the id is/);
    assert.match(notes(r).join("\n"), /Item group "h+" is longer than 50 characters/);
    assert.equal(one([shop({ SKU: long })], openai).item_id, long);
  });
});

describe("titles and descriptions", () => {
  test("Google: a title over 150 characters is cut at a word boundary, with a note; OpenAI keeps it and lint warns", () => {
    const title = "Hand thrown stoneware mug ".repeat(8).trim();
    const r = build([shop({ Title: title })]);
    const cut = records(r)[0].title as string;
    assert.ok(cut.length <= 150 && title.startsWith(cut) && !cut.endsWith(" ") && title[cut.length] === " ", cut);
    assert.match(notes(r)[0], /longer than 150 characters/);
    const o = build([shop({ Title: title })], openai);
    assert.equal(records(o)[0].title, title);
    assert.deepEqual(rules(o), ["value-too-long title"]);
  });

  test("Google: a description over 5,000 characters is cut; OpenAI keeps it", () => {
    const description = `<p>${"word ".repeat(1200)}</p>`;
    const g = build([shop({ Description: description })]);
    assert.ok((records(g)[0].description as string).length <= 5000);
    assert.equal(g.lint.findings.length, 0);
    assert.equal((one([shop({ Description: description })], openai).description as string).length, 5999);
  });

  test("HTML becomes plain text: entities decoded, scripts dropped, blocks on their own lines", () => {
    const html = "<h2>Mug</h2><p>Glazed &amp; fired<br>twice.</p><script>track()</script><style>p{}</style><ul><li>350&nbsp;ml</li><li>Dishwasher safe</li></ul><table><tr><td>Size</td><td>M</td></tr></table>";
    assert.equal(one([shop({ Description: html })], openai).description, "Mug\nGlazed & fired\ntwice.\n350 ml\nDishwasher safe\nSize M");
    assert.equal(one([shop({ Description: html })], { format: "tsv" }).description, "Mug Glazed & fired twice. 350 ml Dishwasher safe Size M");
  });

  test("plain-text descriptions keep their line breaks", () => {
    assert.equal(one([wooRow({ Description: "Line one\\nLine two" })], openai).description, "Line one\nLine two");
  });

  test("fallbacks: Shopify SEO description, WooCommerce short description; a variation's own description wins", () => {
    assert.equal(one([shop({ Description: "", "SEO description": "Seo text." })], openai).description, "Seo text.");
    assert.equal(one([wooRow({ Description: "", "Short description": "<p>Short.</p>" })], openai).description, "Short.");
    const items = records(build([wooRow({ Type: "variable", SKU: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S, M" }), wooRow({ ID: "2", Type: "variation", SKU: "V", Parent: "P", Description: "Own text.", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" })], openai));
    assert.equal(items[0].description, "Own text.");
  });

  test("a missing description is left for the linter: a warning for Google, an error for OpenAI", () => {
    assert.deepEqual(rules(build([shop({ Description: "" })])), ["attribute-missing description"]);
    assert.equal(build([shop({ Description: "" })]).lint.errorCount, 0);
    assert.deepEqual(rules(build([shop({ Description: "" })], openai)), ["attribute-missing description"]);
    assert.equal(build([shop({ Description: "" })], openai).lint.errorCount, 1);
  });
});

describe("links and images", () => {
  test("Shopify links are /products/{handle} on the store URL, which may have a path", () => {
    assert.equal(one([shop()]).link, `${STORE}/products/blue-mug`);
    assert.equal(one([shop()], { storeUrl: "https://shop.example.com/en-ca" }).link, "https://shop.example.com/en-ca/products/blue-mug");
    assert.equal(one([shop({ "URL handle": "tasse-été" })], openai).url, `${STORE}/products/tasse-%C3%A9t%C3%A9`);
  });

  test("WooCommerce links use the product ID, the parent's for a variation", () => {
    assert.equal(one([wooRow({ ID: "42" })]).link, `${STORE}/?post_type=product&p=42`);
    const items = records(build([wooRow({ ID: "7", Type: "variable", SKU: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" }), wooRow({ ID: "8", Type: "variation", SKU: "V", Parent: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" })], openai));
    assert.equal(items[0].url, `${STORE}/?post_type=product&p=7`);
  });

  test("the variant's image leads; other variants' own images are left out", () => {
    const rows: Row[] = [
      shop({ SKU: "B", "Option1 name": "Color", "Option1 value": "Black", "Product image URL": "https://cdn.example.com/black.jpg", "Image position": "1", "Variant image URL": "https://cdn.example.com/black.jpg" }),
      { "URL handle": "blue-mug", SKU: "G", "Option1 value": "Grey", Price: "12.00", "Product image URL": "https://cdn.example.com/grey.jpg", "Image position": "2", "Variant image URL": "https://cdn.example.com/grey.jpg" },
      { "URL handle": "blue-mug", "Product image URL": "https://cdn.example.com/side.jpg", "Image position": "3" },
    ];
    const [black, grey] = records(build(rows, openai));
    assert.deepEqual([black.image_url, black.additional_image_urls], ["https://cdn.example.com/black.jpg", ["https://cdn.example.com/side.jpg"]]);
    assert.deepEqual([grey.image_url, grey.additional_image_urls], ["https://cdn.example.com/grey.jpg", ["https://cdn.example.com/side.jpg"]]);
  });

  test("Google takes 10 additional images, OpenAI all; commas in URLs are encoded", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://cdn.example.com/${i},x.jpg`);
    const item = one([wooRow({ Images: urls.map((u) => u.replace(",", "\\,")).join(", ") })]);
    assert.equal(item.image_link, urls[0]);
    assert.equal((item.additional_image_link as string[]).length, 10);
    assert.equal((item.additional_image_link as string[])[0], "https://cdn.example.com/1%2Cx.jpg");
    assert.equal((one([wooRow({ Images: urls.map((u) => u.replace(",", "\\,")).join(", ") })], openai).additional_image_urls as string[]).length, 11);
  });

  test("no image is left for the linter to report", () => {
    assert.deepEqual(rules(build([shop({ "Product image URL": "" })])), ["attribute-missing image_link"]);
  });
});

describe("availability", () => {
  const stock = (extra: Row, options = {}) => one([shop(extra)], options).availability;

  test("Shopify: untracked is in stock; tracked follows quantity and the out-of-stock policy", () => {
    assert.equal(stock({ "Inventory tracker": "", "Inventory quantity": "0" }), "in_stock");
    assert.equal(stock({ "Inventory quantity": "3" }), "in_stock");
    assert.equal(stock({ "Inventory quantity": "0" }), "out_of_stock");
    assert.equal(stock({ "Inventory quantity": "-2" }), "out_of_stock");
    assert.equal(stock({ "Inventory quantity": "0", "Continue selling when out of stock": "continue" }), "backorder");
    assert.equal(stock({ "Inventory quantity": "0", "Continue selling when out of stock": "continue" }, openai), "backorder");
  });

  test("Google's backorder needs an availability_date the export doesn't have, so the linter reports it", () => {
    assert.deepEqual(rules(build([shop({ "Inventory quantity": "0", "Continue selling when out of stock": "continue" })])), ["attribute-missing availability_date"]);
  });

  test("no stock level: left out for Google with a note, unknown for OpenAI", () => {
    const g = build([shop({ "Inventory quantity": "" })]);
    assert.equal(records(g)[0].availability, undefined);
    assert.match(notes(g)[0], /no stock level/);
    assert.deepEqual(rules(g), ["attribute-missing availability"]);
    assert.equal(stock({ "Inventory quantity": "" }, openai), "unknown");
  });

  test("WooCommerce: the exported stock status, including backorder", () => {
    const woo = (extra: Row) => one([wooRow(extra)], openai).availability;
    assert.equal(woo({ "In stock?": "1" }), "in_stock");
    assert.equal(woo({ "In stock?": "0" }), "out_of_stock");
    assert.equal(woo({ "In stock?": "backorder" }), "backorder");
    assert.equal(woo({ "In stock?": "", Stock: "" }), "in_stock");
    assert.equal(woo({ "In stock?": "", Stock: "4" }), "in_stock");
  });
});

describe("availabilityDate", () => {
  const backorder = shop({ "Inventory quantity": "0", "Continue selling when out of stock": "continue" });

  test("Google: the date goes on backordered items only, which then lint clean", () => {
    const r = build([backorder, shop({ "URL handle": "other", SKU: "MUG-2" })], { availabilityDate: "2026-12-15T09:00-0800" });
    const [late, inStock] = records(r);
    assert.deepEqual([late.availability, late.availability_date], ["backorder", "2026-12-15T09:00-0800"]);
    assert.equal(inStock.availability_date, undefined);
    assert.equal(r.lint.errorCount, 0);
    assert.ok(r.feed.indexOf("<g:availability>") < r.feed.indexOf("<g:availability_date>"));
  });

  test("OpenAI has no date field, so it is not written there", () => {
    const item = one([backorder], { ...openai, availabilityDate: "2026-12-15" });
    assert.deepEqual([item.availability, item.availability_date], ["backorder", undefined]);
  });

  test("ISO 8601 per Google: a date, or a date and time with an optional zone, up to 25 characters", () => {
    for (const date of ["2026-12-15", "2026-12-15T09:00", "2026-12-15T09:00Z", "2026-12-15T09:00-0800", "2026-12-15T09:00:30+05:30", "2028-02-29"]) {
      assert.equal(one([backorder], { availabilityDate: date }).availability_date, date);
    }
    for (const date of ["next week", "15/12/2026", "2026-13-01", "2026-02-30", "2027-02-29", "2026-12-15T25:00", "2026-12-15T09:60", "2026-12-15 09:00", "2026-12-15T09:00:00.000+05:30", "2026-12-15T09:00+99:99", "2026-12-15T09:00-1260"]) {
      assert.throws(() => build([backorder], { availabilityDate: date }), /options.availabilityDate must be an ISO 8601/, date);
    }
  });
});

describe("linkTemplate", () => {
  test("WooCommerce: {sku} and {id} fill in, encoded; a variation links to its parent", () => {
    assert.equal(one([wooRow({ SKU: "MUG 1/A" })], { linkTemplate: `${STORE}/product/{sku}/` }).link, `${STORE}/product/MUG%201%2FA/`);
    assert.equal(one([wooRow({ ID: "42" })], { linkTemplate: `${STORE}/p/{id}-{sku}` }).link, `${STORE}/p/42-MUG-1`);
    const rows = [wooRow({ ID: "7", Type: "variable", SKU: "TEE", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" }), wooRow({ ID: "8", Type: "variation", SKU: "TEE-S", Parent: "TEE", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" })];
    assert.equal(one(rows, { ...openai, linkTemplate: `${STORE}/product/{sku}/` }).url, `${STORE}/product/TEE/`);
  });

  test("Shopify: {handle}, for a storefront on another path", () => {
    assert.equal(one([shop()], { linkTemplate: `${STORE}/shop/item/{handle}?ref=feed` }).link, `${STORE}/shop/item/blue-mug?ref=feed`);
  });

  test("a product without the value the template needs is skipped", () => {
    assert.deepEqual(build([wooRow({ SKU: "" })], { linkTemplate: `${STORE}/product/{sku}/` }).skipped, [{ row: 2, reason: "No SKU, so the product page URL can't be built." }]);
    // With {sku}, a product without an ID still has a link.
    assert.equal(build([wooRow({ ID: "" })], { linkTemplate: `${STORE}/product/{sku}/` }).itemCount, 1);
  });

  test("the template must use this platform's placeholders and stay on the store's https host", () => {
    const bad = (linkTemplate: string, message: RegExp, rows: Row[] = [wooRow()]) => assert.throws(() => build(rows, { linkTemplate }), message, linkTemplate);
    bad(`${STORE}/product/`, /must use \{id\} or \{sku\} for a woocommerce export/);
    bad(`${STORE}/product/{handle}`, /must use \{id\} or \{sku\}/);
    bad(`${STORE}/product/{}`, /must use \{id\} or \{sku\}/);
    bad(`${STORE}/products/{sku}`, /must use \{handle\} for a shopify export/, [shop()]);
    bad("https://other.example.com/product/{sku}", /absolute https URL on shop.example.com/);
    bad("http://shop.example.com/product/{sku}", /absolute https URL/);
    bad("/product/{sku}", /absolute https URL/);
    bad(" ", /options.linkTemplate must be a non-empty string/);
  });
});

describe("prices", () => {
  const price = (value: string, currency = "USD", options = {}) => one([shop({ Price: value })], { currency, ...options }).price;

  test("formatted with the currency's decimals and code", () => {
    assert.equal(price("12"), "12.00 USD");
    assert.equal(price("012.5"), "12.50 USD");
    assert.equal(price("12.500"), "12.50 USD");
    assert.equal(price("1500", "JPY"), "1500 JPY");
    assert.equal(price("1500.00", "JPY"), "1500 JPY");
    assert.equal(price("1.5", "KWD"), "1.500 KWD");
  });

  test("more decimals than the currency has are kept as written, for the linter to report", () => {
    assert.equal(price("12.999"), "12.999 USD");
    assert.deepEqual(rules(build([shop({ Price: "12.999" })], openai)), ["price-invalid price"]);
  });

  test("a price that isn't a plain number is left out with a note", () => {
    const r = build([shop({ Price: "$12" })]);
    assert.equal(records(r)[0].price, undefined);
    assert.match(notes(r)[0], /Price "\$12" isn't a plain number/);
    assert.deepEqual(rules(r), ["attribute-missing price"]);
  });

  test("Shopify: a compare-at price above Price is the regular price, and Price the sale price", () => {
    const item = one([shop({ Price: "15.00", "Compare-at price": "20.00" })]);
    assert.deepEqual([item.price, item.sale_price], ["20.00 USD", "15.00 USD"]);
    const same = one([shop({ Price: "15.00", "Compare-at price": "15.00" })]);
    assert.deepEqual([same.price, same.sale_price], ["15.00 USD", undefined]);
  });

  test("WooCommerce: a sale price below the regular price; one that isn't is left out with a note", () => {
    const item = one([wooRow({ "Regular price": "20", "Sale price": "15" })], openai);
    assert.deepEqual([item.price, item.sale_price], ["20.00 USD", "15.00 USD"]);
    const r = build([wooRow({ "Regular price": "20", "Sale price": "25" })]);
    assert.equal(records(r)[0].sale_price, undefined);
    assert.match(notes(r)[0], /isn't a number below the regular price/);
  });

  test("a scheduled WooCommerce sale: Google gets the dates, OpenAI gets no sale price", () => {
    const row = wooRow({ "Regular price": "20", "Sale price": "15", "Date sale price starts": "2026-12-01 0:00:00", "Date sale price ends": "2026-12-31 23:59:59" });
    const g = one([row]);
    assert.deepEqual([g.sale_price, g.sale_price_effective_date], ["15.00 USD", "2026-12-01T00:00/2026-12-31T23:59"]);
    assert.equal(one([{ ...row, "Date sale price starts": "2026-12-01", "Date sale price ends": "2026-12-31" }]).sale_price_effective_date, "2026-12-01T00:00/2026-12-31T23:59");
    const o = build([row], openai);
    assert.equal(records(o)[0].sale_price, undefined);
    assert.match(notes(o)[0], /OpenAI's feed has no sale dates/);
    const half = build([{ ...row, "Date sale price ends": "" }]);
    assert.equal(records(half)[0].sale_price, undefined);
    assert.match(notes(half)[0], /Google needs both/);
  });
});

describe("identifiers", () => {
  const gtin = (barcode: string, options = {}) => build([shop({ Barcode: barcode })], options);

  test("a barcode with a valid check digit becomes the gtin; an invalid one is left out with a note", () => {
    assert.equal(records(gtin("4006381333931"))[0].gtin, "4006381333931");
    const bad = gtin("4006381333930");
    assert.equal(records(bad)[0].gtin, undefined);
    assert.match(notes(bad)[0], /Barcode "4006381333930" isn't a valid GTIN/);
  });

  test("Google: restricted and coupon ranges are left out; GTIN-8 is exempt; OpenAI keeps them", () => {
    for (const code of ["2000000000015", "0400000000008", "9900000000004"]) {
      const r = gtin(code);
      assert.equal(records(r)[0].gtin, undefined, code);
      assert.match(notes(r)[0], /restricted or coupon GTIN range/);
      assert.equal(r.lint.errorCount, 0);
    }
    assert.equal(records(gtin("20000004"))[0].gtin, "20000004");
    assert.equal(records(gtin("2000000000015", openai))[0].gtin, "2000000000015");
  });

  test("MPN from the Google Shopping column (Shopify) or the MPN column (WooCommerce)", () => {
    assert.equal(one([shop({ "Google Shopping / MPN": "AC-1" })]).mpn, "AC-1");
    assert.equal(one([shop({ "Google Shopping / Manufacturer part number (MPN)": "AC-3" })]).mpn, "AC-3");
    assert.equal(one([wooRow({ MPN: "AC-2" })], openai).mpn, "AC-2");
  });

  test("a Shopify MPN belongs to its variant row, never copied to the product's other variants", () => {
    const rows = [
      shop({ SKU: "S", "Option1 name": "Size", "Option1 value": "S", "Google Shopping / MPN": "AC-S" }),
      { "URL handle": "blue-mug", SKU: "M", "Option1 value": "M", Price: "12.00" },
    ];
    assert.deepEqual(records(build(rows)).map((r) => r.mpn), ["AC-S", undefined]);
  });

  test("Shopify's sample file: Variant Barcodes list and per-variant MPNs", () => {
    const row = shop({ "Variant Barcodes": "ean:4006381333931; upc:036000291452", "Google Shopping / Manufacturer part number (MPN)": "TSH-1" });
    delete row.Barcode;
    const r = build([row]);
    assert.deepEqual([records(r)[0].gtin, records(r)[0].mpn], ["4006381333931", "TSH-1"]);
  });

  test("identifier_exists is no only for a custom product without identifiers", () => {
    const custom = { "Google Shopping / Custom product": "TRUE" };
    assert.equal(one([shop({ ...custom, Barcode: "" })]).identifier_exists, "no");
    assert.equal(one([shop({ ...custom })]).identifier_exists, undefined);
    assert.equal(one([shop({ ...custom, Barcode: "", "Google Shopping / MPN": "AC-1" })]).identifier_exists, undefined);
    assert.equal(one([shop({ Barcode: "" })]).identifier_exists, undefined);
    assert.equal(one([shop({ ...custom, Barcode: "" })], openai).identifier_exists, undefined);
  });

  test("brand: Vendor or Brands, else the brand option; missing is an OpenAI error", () => {
    assert.equal(one([shop()], { brand: "House" }).brand, "Acme");
    assert.equal(one([shop({ Vendor: "" })], { brand: "House" }).brand, "House");
    assert.equal(one([wooRow({ Brands: "Acme\\, Inc, Other" })]).brand, "Acme, Inc");
    assert.deepEqual(rules(build([shop({ Vendor: "" })], openai)), ["attribute-missing brand"]);
  });
});

describe("product details", () => {
  test("condition: the option (default new), unless Shopify's Google Shopping column gives a valid one", () => {
    assert.equal(one([shop()]).condition, "new");
    assert.equal(one([shop()], { condition: "used" }).condition, "used");
    assert.equal(one([shop({ "Google Shopping / Condition": "Refurbished" })]).condition, "refurbished");
    assert.equal(one([shop({ "Google Shopping / Condition": "mint" })], { condition: "used" }).condition, "used");
  });

  test("options named color, colour, size, material and pattern fill those attributes", () => {
    const row = shop({ "Option1 name": "Colour", "Option1 value": "Blue", "Option2 name": "Size", "Option2 value": "M", "Option3 name": "Pattern", "Option3 value": "Striped" });
    const g = one([row]);
    assert.deepEqual([g.color, g.size, g.pattern], ["Blue", "M", "Striped"]);
    const o = one([row], openai);
    assert.deepEqual([o.color, o.size, o.pattern], ["Blue", "M", undefined]);
    assert.equal(one([wooRow({ "Attribute 1 name": "Material", "Attribute 1 value(s)": "Stoneware" })]).material, "Stoneware");
    assert.equal(one([wooRow({ "Attribute 1 name": "Color", "Attribute 1 value(s)": "Red, Blue" })]).color, undefined);
  });

  test("categories: product_type and google_product_category for Google, product_category for OpenAI", () => {
    const row = shop({ Type: "Mugs", "Product category": "Home > Kitchen > Mugs", "Google Shopping / Google product category": "2169" });
    const g = one([row]);
    assert.deepEqual([g.product_type, g.google_product_category], ["Mugs", "2169"]);
    assert.equal(one([shop({ "Product category": "Home > Kitchen > Mugs" })]).product_type, "Home > Kitchen > Mugs");
    assert.equal(one([row], openai).product_category, "Home > Kitchen > Mugs");
    assert.equal(one([shop({ Type: "Mugs" })], openai).product_category, "Mugs");
    assert.deepEqual(one([wooRow({ Categories: "Kitchen > Mugs, Gifts" })]).product_type, ["Kitchen > Mugs", "Gifts"]);
    assert.equal(one([wooRow({ Categories: "Kitchen > Mugs, Gifts" })], openai).product_category, "Kitchen > Mugs");
  });

  test("gender, age group and custom labels from Shopify's Google Shopping columns", () => {
    const item = one([shop({ "Google Shopping / Gender": "Female", "Google Shopping / Age group": "Kids", "Google Shopping / Custom label 0": "Summer", "Google Shopping / Custom Label 4": "Clearance" })]);
    assert.deepEqual([item.gender, item.age_group, item.custom_label_0, item.custom_label_4], ["female", "kids", "Summer", "Clearance"]);
    assert.equal(one([shop({ "Google Shopping / Custom label 0": "Summer" })], openai).custom_label_0, undefined);
  });

  test("Shopify's admin labels for age group are read as the value: Adult (13+ years old) is adult", () => {
    const item = one([shop({ "Google Shopping / Age group": "Adult (13+ years old)", "Google Shopping / Gender": "Unisex", "Google Shopping / Condition": "New" })]);
    assert.deepEqual([item.age_group, item.gender, item.condition], ["adult", "unisex", "new"]);
    assert.equal(one([shop({ "Google Shopping / Age group": "Kids (5-13 years old)" })], openai).age_group, "kids");
  });
});

describe("OpenAI fields", () => {
  test("seller and country fields on every row; target countries default to the store country", () => {
    const item = one([shop()], openai);
    assert.deepEqual([item.seller_name, item.seller_url, item.store_country, item.target_countries], ["Acme Store", `${STORE}/`, "US", ["US"]]);
    assert.deepEqual(one([shop()], { ...openai, storeCountry: "ca", targetCountries: ["us", "CA", "US"] }).target_countries, ["US", "CA"]);
  });

  test("variants share group_id, set listing_has_variations and carry variant_dict", () => {
    const rows = [shop({ SKU: "S", "Option1 name": "Size", "Option1 value": "S" }), { "URL handle": "blue-mug", SKU: "M", "Option1 value": "M", Price: "12.00" }];
    const items = records(build(rows, openai));
    assert.deepEqual(items.map((i) => [i.item_id, i.group_id, i.listing_has_variations, i.variant_dict]), [
      ["S", "blue-mug", true, { Size: "S" }],
      ["M", "blue-mug", true, { Size: "M" }],
    ]);
    const single = one([shop()], openai);
    assert.deepEqual([single.group_id, single.listing_has_variations, single.variant_dict], [undefined, undefined, undefined]);
  });
});

describe("skipped rows", () => {
  const reasons = (rows: Row[]) => build(rows).skipped.map((s) => s.reason);

  test("Shopify: drafts, archived, unpublished and gift cards", () => {
    assert.deepEqual(reasons([shop({ Status: "draft" })]), ["Draft: not ready to be sold."]);
    assert.deepEqual(reasons([shop({ Status: "archived" })]), ["Archived: no longer for sale."]);
    assert.deepEqual(reasons([shop({ Status: "unlisted" })]), ['Status is "unlisted", not active.']);
    assert.deepEqual(reasons([shop({ "Published on online store": "false" })]), ["Not published on the online store, so it has no public product page."]);
    assert.match(reasons([shop({ "Gift card": "true" })])[0], /^Gift card: store credit/);
  });

  test("WooCommerce: private, pending, hidden, grouped, external, plugin types, empty variable products and disabled variations", () => {
    assert.deepEqual(reasons([wooRow({ Published: "0" })]), ["Private: only store managers can see it."]);
    assert.deepEqual(reasons([wooRow({ Published: "2" })]), ["Pending review: not published yet."]);
    assert.deepEqual(reasons([wooRow({ "Visibility in catalog": "hidden" })]), ["Catalog visibility is hidden, so shoppers can't find it in the store."]);
    assert.match(reasons([wooRow({ Type: "grouped" })])[0], /^Grouped product/);
    assert.match(reasons([wooRow({ Type: "external" })])[0], /^External product/);
    assert.match(reasons([wooRow({ Type: "subscription" })])[0], /plugin's product type/);
    assert.match(reasons([wooRow({ Type: "variable" })])[0], /^Variable product with no variations/);
    assert.deepEqual(reasons([wooRow({ ID: "" })]), ["No ID, so the product page URL can't be built."]);
    const parent = wooRow({ Type: "variable", SKU: "P", "Attribute 1 name": "Size", "Attribute 1 value(s)": "S, M" });
    const variation = (id: string, published: string) => wooRow({ ID: id, Type: "variation", SKU: `V${id}`, Parent: "P", Published: published, "Attribute 1 name": "Size", "Attribute 1 value(s)": "S" });
    const r = build([parent, variation("2", "1"), variation("3", "0")]);
    assert.equal(r.itemCount, 1);
    assert.deepEqual(r.skipped, [{ row: 4, reason: "Disabled variation: not published." }]);
  });

  test("rows that belong to no product are skipped, and the list is sorted by row", () => {
    const r = build([shop({ Status: "draft" }), { "URL handle": "", SKU: "X", Price: "1" }, shop({ "URL handle": "other", Title: "Other", SKU: "O" })]);
    assert.deepEqual(r.skipped.map((s) => s.row), [2, 3]);
    assert.equal(r.itemCount, 1);
    const orphan = build([wooRow({ Type: "variation", Parent: "NOPE" })]);
    assert.deepEqual(orphan.skipped, [{ row: 2, reason: 'This variation has Parent "NOPE", which isn\'t a product in this file.' }]);
  });

  test("a Shopify file without handles can't link its products", () => {
    const row = shop();
    delete row["URL handle"];
    assert.deepEqual(reasons([row]), ["No URL handle, so the product page URL can't be built."]);
  });
});

describe("result", () => {
  test("carries the feed, counts, skipped rows, notes and the lint result", () => {
    const r = build([shop(), shop({ "URL handle": "draft", Status: "draft" })], { format: "tsv" });
    assert.equal(r.itemCount, 1);
    assert.equal(r.lint.itemCount, 1);
    assert.equal(r.lint.format, "tsv");
    assert.equal(r.lint.valid, true);
    assert.deepEqual(r.notes, []);
    assert.ok(r.feed.endsWith("\n"));
  });

  test("notes name the row and item", () => {
    const r = build([shop({ Barcode: "123" })]);
    assert.deepEqual(r.notes, [{ row: 2, itemId: "MUG-1", message: 'Barcode "123" isn\'t a valid GTIN (length or check digit), so gtin is left out.' }]);
  });
});
