import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OPENAI_ITEM, csv, jsonl, lint, rules, tsv, type Row } from "./helpers.ts";

const FORMATS = ["jsonl", "csv", "tsv"] as const;
type Format = (typeof FORMATS)[number];
const item = (overrides: Row = {}): Row => ({ ...OPENAI_ITEM, ...overrides });

/** JSONL gets real JSON values: arrays, objects, booleans and numbers where a cell holds them as text. */
function toJson(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === "") continue;
    if (k === "target_countries") out[k] = v.split(",");
    else if (/^[[{]/.test(v) || v === "true" || v === "false") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

const feed = (format: Format, rows: Row[]) => (format === "jsonl" ? jsonl(rows.map(toJson)) : format === "csv" ? csv(rows) : tsv(rows));
const openai = (text: string) => lint(text, { target: "openai" });

function each(name: string, check: (run: (rows: Row[]) => ReturnType<typeof lint>, format: Format) => void) {
  for (const format of FORMATS) test(`${name} (${format})`, () => check((rows) => openai(feed(format, rows)), format));
}

describe("a clean feed", () => {
  each("has no findings", (run, format) => {
    const result = run([item(), item({ item_id: "MUG-2", gtin: "4006381333931", condition: "new" })]);
    assert.deepEqual(result.findings, []);
    assert.equal(result.target, "openai");
    assert.equal(result.format, format);
    assert.equal(result.itemCount, 2);
  });

  test("the example record from OpenAI's schema", () => {
    const record = '{"item_id":"MUG-350-BLUE","title":"Blue ceramic mug, 350 mL","description":"Dishwasher-safe glazed ceramic mug with a handle.","url":"https://example.com/products/mug-blue","brand":"Northline","seller_name":"Northline Home","image_url":"https://example.com/images/mug-blue.jpg","price":"18.00 USD","availability":"in_stock","target_countries":["US"],"store_country":"US"}';
    assert.deepEqual(openai(record).findings, []);
  });
});

describe("required fields for discovery", () => {
  const required = ["item_id", "title", "description", "url", "brand", "seller_name", "image_url", "availability", "price", "target_countries", "store_country"];
  for (const name of required) {
    each(`${name} empty is attribute-missing`, (run) => {
      const result = run([item({ [name]: "" }), item({ item_id: "MUG-2" })]);
      assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute, f.severity]), [["attribute-missing", name, "error"]]);
    });
  }

  test("a missing column is reported once on the header row", () => {
    const { seller_name: _, ...rest } = OPENAI_ITEM;
    const result = openai(csv([rest, { ...rest, item_id: "MUG-2" }]));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.line, f.attribute]), [["attribute-missing", 1, "seller_name"]]);
  });
});

describe("values", () => {
  each("availability is exact: unknown is allowed, other spellings are rejected", (run) => {
    for (const availability of ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"]) assert.deepEqual(rules(run([item({ availability })])), [], availability);
    for (const availability of ["In Stock", "in stock", "preorder", "IN_STOCK"]) assert.deepEqual(rules(run([item({ availability })])), ["value-enum"], availability);
  });

  each("price must be amount CURRENCY with an uppercase code", (run) => {
    for (const price of ["79.99", "79.99 usd", "79.99USD", "$79.99", "1,079.99 USD", "7.999e1 USD", "79.999 USD", "10.5 JPY"]) {
      assert.deepEqual(rules(run([item({ price })])), ["price-invalid"], price);
    }
    for (const price of ["79.99 USD", "1000 JPY", "12.345 KWD"]) assert.deepEqual(rules(run([item({ price })])), [], price);
  });

  each("price must be positive", (run) => {
    const result = run([item({ price: "0.00 USD" })]);
    assert.deepEqual(rules(result), ["price-invalid"]);
    assert.match(result.findings[0].message, /positive/);
  });

  each("sale-price-invalid: not lower, not positive, or another currency", (run) => {
    for (const sale_price of ["12.00 USD", "15.00 USD", "0.00 USD", "9.00 EUR"]) {
      const result = run([item({ sale_price })]);
      assert.deepEqual(result.findings.map((f) => [f.rule, f.severity]), [["sale-price-invalid", "warning"]], sale_price);
    }
    assert.deepEqual(rules(run([item({ sale_price: "9.99 USD" })])), []);
  });

  each("shipping_price must be in the price currency", (run) => {
    assert.deepEqual(rules(run([item({ shipping_price: "5.00 EUR" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ shipping_price: "0.00 USD" })])), []);
  });

  each("gtin takes digits only", (run) => {
    assert.deepEqual(rules(run([item({ gtin: "4006 3813 3393 1" })])), ["gtin-invalid"]);
    assert.deepEqual(rules(run([item({ gtin: "4006381333930" })])), ["gtin-invalid"]);
    assert.deepEqual(rules(run([item({ gtin: "09506000134352" })])), []);
    // Indicator 9 is valid here: the bulk indicator rule is Google's.
    assert.deepEqual(rules(run([item({ gtin: "90856435001708" })])), []);
  });

  each("booleans are the lowercase strings true and false", (run) => {
    assert.deepEqual(rules(run([item({ is_eligible_search: "TRUE" })])), ["value-enum"]);
    assert.deepEqual(rules(run([item({ is_eligible_search: "yes" })])), ["value-enum"]);
    assert.deepEqual(rules(run([item({ is_eligible_search: "false", accepts_returns: "true" })])), []);
  });

  each("target_countries and store_country are uppercase ISO 3166-1 codes", (run) => {
    assert.deepEqual(rules(run([item({ target_countries: "us" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ store_country: "USA" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ target_countries: "US,CA" })])), []);
  });

  test("target_countries may be a JSON array in a cell", () => {
    assert.deepEqual(openai(csv([item({ target_countries: '["US","CA"]' })])).findings, []);
    assert.deepEqual(rules(openai(csv([item({ target_countries: '["US","usa"]' })]))), ["value-invalid"]);
  });

  each("enums for condition, gender and age_group; unrecognized gender is only a warning", (run) => {
    assert.deepEqual(run([item({ condition: "used2" })]).findings.map((f) => [f.rule, f.severity]), [["value-enum", "error"]]);
    assert.deepEqual(run([item({ gender: "men" })]).findings.map((f) => [f.rule, f.severity]), [["value-enum", "warning"]]);
    assert.deepEqual(run([item({ age_group: "adults" })]).findings.map((f) => [f.rule, f.severity]), [["value-enum", "warning"]]);
  });

  each("url-invalid for required URLs is an error, for optional ones a warning", (run) => {
    assert.deepEqual(run([item({ url: "shop.example/mug" })]).findings.map((f) => [f.rule, f.severity]), [["url-invalid", "error"]]);
    assert.deepEqual(run([item({ seller_url: "not a url" })]).findings.map((f) => [f.rule, f.severity]), [["url-invalid", "warning"]]);
    assert.deepEqual(run([item({ additional_image_urls: "https://shop.example/1.jpg,ftp://x" })]).findings.map((f) => [f.rule, f.severity]), [["url-invalid", "warning"]]);
  });

  each("numbers: review counts, ratings and return windows", (run) => {
    assert.deepEqual(rules(run([item({ review_count: "-1" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ review_count: "12", star_rating: "5.5" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ review_count: "12", star_rating: "4.50" })])), []);
    assert.deepEqual(rules(run([item({ accepts_returns: "true", return_deadline_in_days: "0" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ accepts_returns: "true", return_deadline_in_days: "30" })])), []);
  });

  each("value-too-long for title is a warning", (run) => {
    assert.deepEqual(run([item({ title: "t".repeat(151) })]).findings.map((f) => [f.rule, f.severity]), [["value-too-long", "warning"]]);
  });

  each("value-placeholder, except where the value is listed", (run) => {
    for (const brand of ["N/A", "null", "Unknown"]) assert.deepEqual(rules(run([item({ brand })])), ["value-placeholder"], brand);
    assert.deepEqual(rules(run([item({ availability: "unknown" })])), []);
  });
});

describe("conditional requirements", () => {
  each("dimension and weight units", (run) => {
    assert.deepEqual(run([item({ length: "30", width: "20" })]).findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "dimensions_unit"]]);
    assert.deepEqual(rules(run([item({ length: "30", width: "20", dimensions_unit: "cm" })])), []);
    assert.deepEqual(run([item({ weight: "0.75" })]).findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "item_weight_unit"]]);
    assert.deepEqual(rules(run([item({ weight: "0", item_weight_unit: "kg" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ weight: "0.75", item_weight_unit: "kilo" })])), ["value-enum"]);
  });

  each("checkout needs seller_privacy_policy and seller_tos", (run) => {
    const result = run([item({ is_eligible_checkout: "true" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "seller_privacy_policy"], ["attribute-missing", "seller_tos"]]);
    assert.match(result.findings[0].message, /required for checkout/);
    const ready = { is_eligible_checkout: "true", seller_privacy_policy: "https://shop.example/privacy", seller_tos: "https://shop.example/terms" };
    assert.deepEqual(rules(run([item(ready)])), []);
    assert.deepEqual(rules(run([item({ ...ready, is_eligible_search: "false" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ is_eligible_checkout: "false" })])), [], "not opted in");
  });

  each("a return window without accepts_returns, and a rating without reviews", (run) => {
    assert.deepEqual(rules(run([item({ return_deadline_in_days: "30" })])), ["value-invalid"]);
    assert.deepEqual(rules(run([item({ star_rating: "4.5" })])), ["value-invalid"]);
  });
});

describe("dimensions and maps", () => {
  each("dimensions", (run) => {
    const ok = ['{"length":"30","width":"20","height":"12","unit":"cm"}', '{"length":"30","width":"20","unit":"in"}'];
    for (const dimensions of ok) assert.deepEqual(rules(run([item({ dimensions })])), [], dimensions);
    const bad = ['{"length":"30","unit":"cm"}', '{"length":"30","width":"20"}', '{"length":"30","width":"20","unit":"yd"}', '{"length":"30","width":"-2","unit":"cm"}', '{"length":"30","width":"20","depth":"5","unit":"cm"}', "{}", "30x20x12"];
    for (const dimensions of bad) assert.deepEqual(rules(run([item({ dimensions })])), ["value-invalid"], dimensions);
  });

  each("variant_dict must map nonempty strings to strings", (run) => {
    for (const variant_dict of ['{"size":""}', '{"size":10}', "size=10", "[1]"]) {
      assert.deepEqual(rules(run([item({ variant_dict })])), ["value-invalid"], variant_dict);
    }
  });
});

describe("identity and variants", () => {
  each("id-duplicate for item_id and offer_id", (run) => {
    assert.deepEqual(rules(run([item(), item()])), ["id-duplicate"]);
    assert.deepEqual(rules(run([item({ offer_id: "O1" }), item({ item_id: "MUG-2", offer_id: "O1" })])), ["id-duplicate"]);
  });

  each("ids aren't compared ignoring case", (run) => {
    assert.deepEqual(rules(run([item(), item({ item_id: "mug-1" })])), []);
  });

  const variant = (id: string, dict: string, more: Row = {}) => item({ item_id: id, group_id: "TRAIL", listing_has_variations: "true", variant_dict: dict, ...more });

  each("a clean variant group", (run) => {
    assert.deepEqual(rules(run([variant("T-10", '{"size":"10"}'), variant("T-11", '{"size":"11"}')])), []);
  });

  each("variant-inconsistent: duplicate option combinations", (run) => {
    const result = run([variant("T-10", '{"size":"10"}'), variant("T-10B", '{"size":"10"}')]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.itemId]), [["variant-inconsistent", "T-10B"]]);
  });

  each("variant-inconsistent: different option names", (run) => {
    assert.deepEqual(rules(run([variant("T-10", '{"size":"10"}'), variant("T-11", '{"shoe size":"11"}')])), ["variant-inconsistent"]);
  });

  each("variant-inconsistent: a variant without listing_has_variations", (run) => {
    const result = run([variant("T-10", '{"size":"10"}'), variant("T-11", '{"size":"11"}', { listing_has_variations: "" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["variant-inconsistent", "listing_has_variations"]]);
  });

  each("variant-inconsistent: group_id equal to item_id", (run) => {
    const result = run([variant("TRAIL", '{"size":"10"}')]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["variant-inconsistent", "group_id"]]);
  });
});

describe("names and aliases", () => {
  each("legacy aliases are accepted", (run) => {
    const { item_id: _, ...rest } = OPENAI_ITEM;
    const result = run([{ ...rest, id: "MUG-1", enable_search: "true", return_window: "30", accepts_returns: "true", item_group_id: "MUG" }]);
    assert.deepEqual(result.findings, []);
    assert.equal(openai(jsonl([toJson({ ...rest, sku: "SKU-9" })])).findings.length, 0);
  });

  test("findings use the id from an alias", () => {
    const { item_id: _, ...rest } = OPENAI_ITEM;
    assert.equal(openai(csv([{ ...rest, id: "MUG-1", price: "1" }])).findings[0].itemId, "MUG-1");
  });

  each("attribute-alias when both names are sent, reported once", (run) => {
    const result = run([item({ id: "OLD-1" }), item({ item_id: "MUG-2", id: "OLD-2" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["attribute-alias", "id"]]);
    assert.equal(result.findings[0].itemId, null);
  });

  each("enable_ flags and return_window win over the newer names, as OpenAI states", (run) => {
    const result = run([item({ is_eligible_search: "true", enable_search: "yes", accepts_returns: "true", return_deadline_in_days: "30", return_window: "0" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]).sort(), [
      ["attribute-alias", "enable_search"],
      ["attribute-alias", "return_window"],
      ["value-enum", "is_eligible_search"],
      ["value-invalid", "return_deadline_in_days"],
    ]);
    assert.match(result.findings.find((f) => f.attribute === "enable_search")!.message, /enable_search is the one used/);
    const checkout = run([item({ is_eligible_checkout: "false", enable_checkout: "true" })]);
    assert.deepEqual(rules(checkout).sort(), ["attribute-alias", "attribute-missing", "attribute-missing"]);
  });

  test("a placeholder in a required field isn't advised to be left out", () => {
    const result = openai(jsonl([toJson(item({ brand: "n/a" }))]));
    assert.deepEqual(rules(result), ["value-placeholder"]);
    assert.doesNotMatch(result.findings[0].message, /leave it out/);
  });

  each("legacy variant columns are known", (run) => {
    assert.deepEqual(rules(run([item({ Custom_variant1_category: "Size", Custom_variant1_option: "10" })])), []);
  });

  each("unknown names are case-sensitive and get a suggestion", (run) => {
    const result = run([item({ Shipping_Price: "5.00 USD" })]);
    assert.deepEqual(rules(result), ["attribute-unknown"]);
    assert.match(result.findings[0].message, /Did you mean shipping_price\?/);
  });

  test("Google attribute names get a hint when close", () => {
    const result = openai(jsonl([toJson(item({ image_link: "https://shop.example/a.jpg" }))]));
    assert.deepEqual(rules(result), ["attribute-unknown"]);
  });
});

describe("JSONL", () => {
  test("a line that isn't a JSON object is feed-unreadable, and the rest is still checked", () => {
    const good = JSON.stringify(toJson(item()));
    const text = [good, "{not json", "[1,2]", JSON.stringify(toJson(item({ item_id: "MUG-2", price: "$1" })))].join("\n");
    const result = openai(text);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.line]), [["feed-unreadable", 2], ["feed-unreadable", 3], ["price-invalid", 4]]);
    assert.equal(result.itemCount, 2);
  });

  test("a JSON array is feed-unreadable", () => {
    const result = openai(`[${JSON.stringify(toJson(item()))}]`);
    assert.deepEqual(rules(result), ["feed-unreadable"]);
    assert.match(result.findings[0].message, /JSON array/);
  });

  test("null values and empty arrays count as absent", () => {
    const record = { ...toJson(item()), gtin: null, additional_image_urls: [] };
    assert.deepEqual(openai(jsonl([record])).findings, []);
    assert.deepEqual(rules(openai(jsonl([{ ...record, target_countries: [] }]))), ["attribute-missing"]);
  });

  test("JSON booleans and numbers", () => {
    const record = { ...toJson(item()), is_eligible_search: true, review_count: 12, star_rating: 4.5 };
    assert.deepEqual(openai(jsonl([record])).findings, []);
  });
});
