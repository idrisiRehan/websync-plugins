import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gtinCheckDigit } from "websync-validators";
import { GOOGLE_ITEM, googleFeed, lint, rss, rules, tsv, type Row } from "./helpers.ts";

const FORMATS = ["tsv", "xml"] as const;
const item = (overrides: Row = {}): Row => ({ ...GOOGLE_ITEM, ...overrides });
const withGtin = (payload: string) => payload + gtinCheckDigit(payload);

/** Runs `check` for the same rows as TSV and as RSS XML. */
function both(name: string, check: (lintRows: (rows: Row[]) => ReturnType<typeof lint>, format: "tsv" | "xml") => void) {
  for (const format of FORMATS) test(`${name} (${format})`, () => check((rows) => lint(googleFeed(format, rows)), format));
}


describe("a clean feed", () => {
  both("has no findings", (run, format) => {
    const result = run([item(), item({ id: "MUG-2", gtin: "5012345678900" })]);
    assert.deepEqual(result.findings, []);
    assert.equal(result.valid, true);
    assert.equal(result.format, format);
    assert.equal(result.target, "google");
    assert.equal(result.itemCount, 2);
  });
});

describe("required attributes", () => {
  for (const name of ["id", "title", "description", "link", "image_link", "availability", "price"]) {
    both(`${name} empty is attribute-missing`, (run) => {
      const result = run([item({ [name]: "" }), item({ id: "MUG-2" })]);
      const missing = result.findings.filter((f) => f.rule === "attribute-missing");
      assert.equal(missing.length, 1);
      assert.equal(missing[0].attribute, name);
      assert.equal(missing[0].severity, name === "description" ? "warning" : "error");
    });
  }

  both("structured_title and structured_description meet the requirement", (run) => {
    const { title: _t, description: _d, ...rest } = GOOGLE_ITEM;
    const structured = { ...rest, structured_title: "trained_algorithmic_media:Blue mug", structured_description: "trained_algorithmic_media:A blue mug." };
    assert.deepEqual(run([structured]).findings, []);
  });

  test("a missing description is a warning: Google warns and may limit performance", () => {
    const { description: _, ...rest } = GOOGLE_ITEM;
    const result = lint(tsv([rest]));
    assert.deepEqual(result.findings.map((f) => [f.rule, f.severity, f.line]), [["attribute-missing", "warning", 1]]);
    assert.equal(result.valid, true);
  });

  test("a missing column is reported once, on the header row", () => {
    const { id: _, ...noId } = GOOGLE_ITEM;
    const result = lint(tsv([noId, noId]));
    const missing = result.findings.filter((f) => f.rule === "attribute-missing");
    assert.deepEqual(missing.map((f) => [f.line, f.itemId, f.attribute]), [[1, null, "id"]]);
  });

  both("availability_date is required for preorder and backorder", (run) => {
    for (const availability of ["preorder", "backorder"]) {
      const result = run([item({ availability })]);
      assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["attribute-missing", "availability_date"]]);
      assert.deepEqual(run([item({ availability, availability_date: "2027-02-15T09:00-0800" })]).findings, []);
    }
    assert.deepEqual(run([item({ availability: "out_of_stock" })]).findings, []);
  });
});

describe("attribute names", () => {
  both("an unknown attribute is reported once with a likely spelling", (run, format) => {
    const result = run([item({ colour: "Blue" }), item({ id: "MUG-2", colour: "Red" })]);
    const unknown = result.findings.filter((f) => f.rule === "attribute-unknown");
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0].severity, "warning");
    assert.match(unknown[0].message, /Did you mean color\?/);
    assert.equal(unknown[0].line, format === "tsv" ? 1 : 15);
    if (format === "xml") assert.match(unknown[0].message, /Found in 2 items/);
  });

  both("documented attributes are known, including native_commerce and custom labels", (run) => {
    const known = { custom_label_0: "summer", google_product_category: "Home & Garden", product_type: "Kitchen > Mugs", native_commerce: "true", merchant_item_id: "M1", consumer_notice: "prop_65:Contains lead.", pause: "ads" };
    assert.deepEqual(run([item(known)]).findings, []);
  });

  both("tax and tax_category are reported as retired", (run) => {
    const result = run([item({ tax: "US:CA:8.25:y" })]);
    assert.deepEqual(rules(result), ["attribute-retired"]);
    assert.match(result.findings[0].message, /July 2025/);
  });

  test("text headers ignore case and accept spaces for underscores", () => {
    const header = Object.keys(GOOGLE_ITEM).map((k) => k.replace("_", " ").toUpperCase());
    const text = [header, Object.values(GOOGLE_ITEM)].map((r) => r.join("\t")).join("\n");
    assert.deepEqual(lint(text).findings, []);
  });

  test("a header with sub-attributes is read by its base name", () => {
    const result = lint(tsv([item({ "shipping(country:service:price)": "US:Standard:4.95 USD" })]));
    assert.deepEqual(result.findings, []);
  });
});

describe("ids", () => {
  both("id-duplicate", (run, format) => {
    const result = run([item(), item({ gtin: "5012345678900" })]);
    const dup = result.findings.filter((f) => f.rule === "id-duplicate");
    assert.equal(dup.length, 1);
    assert.equal(dup[0].itemId, "MUG-1");
    assert.match(dup[0].message, format === "tsv" ? /first used on row 2\./ : /first used on line 5\./);
  });

  both("id-duplicate-case", (run) => {
    const result = run([item(), item({ id: "mug-1" })]);
    assert.deepEqual(rules(result), ["id-duplicate-case"]);
    assert.equal(result.findings[0].severity, "warning");
  });
});

describe("lengths and counts", () => {
  both("value-too-long is an error for id and a warning for title and description", (run) => {
    const result = run([item({ id: "x".repeat(51), title: "t".repeat(151), description: "d".repeat(5001) })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute, f.severity]), [
      ["value-too-long", "id", "error"],
      ["value-too-long", "title", "warning"],
      ["value-too-long", "description", "warning"],
    ]);
  });

  both("limits count characters, not UTF-16 units", (run) => {
    assert.deepEqual(run([item({ id: "x".repeat(50), title: "\u{1F37A}".repeat(150) })]).findings, []);
  });

  test("values-too-many: more than 10 additional images in one cell", () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://shop.example/${i}.jpg`);
    assert.deepEqual(rules(lint(tsv([item({ additional_image_link: urls.join(",") })]))), ["values-too-many"]);
    assert.deepEqual(rules(lint(tsv([item({ additional_image_link: urls.slice(1).join(",") })]))), []);
  });

  test("values-too-many: repeated XML elements", () => {
    const images = Array.from({ length: 11 }, (_, i) => `<g:additional_image_link>https://shop.example/${i}.jpg</g:additional_image_link>`).join("");
    const text = rss([item()]).replace("</item>", `${images}</item>`);
    assert.deepEqual(rules(lint(text)), ["values-too-many"]);
  });
});

describe("values", () => {
  both("value-enum for availability, condition and identifier_exists", (run) => {
    const result = run([item({ availability: "available", condition: "second-hand", identifier_exists: "maybe" })]);
    assert.deepEqual(rules(result), ["value-enum", "value-enum", "value-enum"]);
    assert.match(result.findings[0].message, /in_stock, out_of_stock, preorder, backorder/);
  });

  both("enums accept any case and spaces for underscores, as Google's own examples do", (run) => {
    assert.deepEqual(run([item({ availability: "In Stock", condition: "NEW", gender: "Unisex", age_group: "adult" })]).findings, []);
  });

  both("url-invalid", (run) => {
    for (const link of ["www.shop.example/mug", "https://shop.example/blue mug", "ftp://shop.example/mug", "https://"]) {
      assert.deepEqual(rules(run([item({ link })])), ["url-invalid"], link);
    }
    assert.deepEqual(rules(run([item({ link: "http://shop.example/mug?a=1&b=2" })])), []);
  });

  test("url-invalid in a comma-separated list", () => {
    const result = lint(tsv([item({ additional_image_link: "https://shop.example/1.jpg,shop.example/2.jpg" })]));
    assert.deepEqual(rules(result), ["url-invalid"]);
    assert.match(result.findings[0].message, /"shop\.example\/2\.jpg"/);
  });

  both("price-invalid", (run) => {
    for (const price of ["$12.00", "12,00 EUR", "1,299.00 USD", "12.00 XYZ", "-5 USD", "USD"]) {
      assert.deepEqual(rules(run([item({ price })])), ["price-invalid"], price);
    }
    for (const price of ["12 USD", "12.5 EUR", "12.00usd", "1299.00 INR"]) assert.deepEqual(rules(run([item({ price })])), [], price);
  });

  both("price-currency-missing, price-precision and price-zero are warnings", (run) => {
    const cases: [string, string][] = [["12.00", "price-currency-missing"], ["12.999 USD", "price-precision"], ["0 USD", "price-zero"]];
    for (const [price, rule] of cases) {
      const result = run([item({ price })]);
      assert.deepEqual(rules(result), [rule], price);
      assert.equal(result.findings[0].severity, "warning");
    }
  });

  both("sale-price-invalid when sale_price isn't lower", (run) => {
    assert.deepEqual(rules(run([item({ sale_price: "12.00 USD" })])), ["sale-price-invalid"]);
    assert.deepEqual(rules(run([item({ sale_price: "15 USD" })])), ["sale-price-invalid"]);
    assert.deepEqual(rules(run([item({ sale_price: "9.99 USD" })])), []);
    assert.deepEqual(rules(run([item({ sale_price: "15 EUR" })])), [], "different currencies aren't compared");
  });

  both("date-invalid", (run) => {
    for (const availability_date of ["15/02/2027", "2027-02-30", "2027-13-01", "2027-02-15T25:00Z", "2027-02-15 09:00"]) {
      assert.deepEqual(rules(run([item({ availability: "preorder", availability_date })])), ["date-invalid"], availability_date);
    }
    for (const availability_date of ["2027-02-15", "2027-02-15T09:00Z", "2027-02-15T09:00-0800", "2027-02-15T09:00:30+01:00"]) {
      assert.deepEqual(rules(run([item({ availability: "preorder", availability_date })])), [], availability_date);
    }
  });

  both("date-invalid for sale_price_effective_date", (run) => {
    const bad = ["2026-12-01", "2026-12-31T23:59-0800/2026-12-01T00:00-0800", "2026-12-01/2026-12-31/2027-01-01"];
    for (const sale_price_effective_date of bad) {
      assert.deepEqual(rules(run([item({ sale_price: "9 USD", sale_price_effective_date })])), ["date-invalid"], sale_price_effective_date);
    }
    assert.deepEqual(rules(run([item({ sale_price: "9 USD", sale_price_effective_date: "2026-12-01T00:00-0800/2026-12-31T23:59-0800" })])), []);
  });

  both("value-placeholder for brand", (run) => {
    for (const brand of ["N/A", "Generic", "no brand", "Does not exist"]) assert.deepEqual(rules(run([item({ brand })])), ["value-placeholder"], brand);
  });
});

describe("GTINs", () => {
  both("gtin-invalid for a wrong check digit, length or characters", (run) => {
    for (const gtin of ["4006381333930", "400638133393", "40063813339311", "ABC4006381333"]) {
      const result = run([item({ gtin })]);
      assert.deepEqual(rules(result), ["gtin-invalid"], gtin);
    }
  });

  both("spaces and dashes in a GTIN are ignored, as Google states", (run) => {
    assert.deepEqual(run([item({ gtin: "400-6381-33393 1" })]).findings, []);
  });

  test("an XML element is one URL even with commas in it; a text cell is split", () => {
    const url = "https://img.example/upload/w_500,h_500/b.jpg";
    assert.deepEqual(lint(rss([item({ additional_image_link: url })])).findings, []);
    assert.deepEqual(rules(lint(tsv([item({ additional_image_link: url })]))), ["url-invalid"]);
  });

  test("several GTINs in one cell are checked one by one", () => {
    assert.deepEqual(rules(lint(tsv([item({ gtin: "4006381333931,9780306406158" })]))), ["gtin-invalid"]);
    assert.deepEqual(rules(lint(tsv([item({ gtin: "4006381333931,9780306406157" })]))), []);
  });

  both("gtin-restricted for in-store, coupon and bulk ranges", (run) => {
    for (const gtin of [withGtin("200000000001"), withGtin("41234567890"), withGtin("990000000001"), withGtin("9123456789012")]) {
      assert.deepEqual(rules(run([item({ gtin })])), ["gtin-restricted"], gtin);
    }
  });
});

describe("identifiers", () => {
  both("identifier-missing without gtin or mpn", (run) => {
    assert.deepEqual(rules(run([item({ gtin: "" })])), ["identifier-missing"]);
    assert.deepEqual(rules(run([item({ gtin: "", identifier_exists: "no" })])), []);
    assert.deepEqual(rules(run([item({ gtin: "", mpn: "AC-1" })])), []);
  });

  both("identifier-missing for an mpn without brand", (run) => {
    const result = run([item({ gtin: "", brand: "", mpn: "AC-1" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.attribute]), [["identifier-missing", "brand"]]);
  });

  both("identifier-exists-conflict when identifier_exists is no but a gtin or mpn is present", (run) => {
    assert.deepEqual(rules(run([item({ identifier_exists: "no" })])), ["identifier-exists-conflict"]);
    assert.deepEqual(rules(run([item({ gtin: "", mpn: "AC-1", identifier_exists: "false" })])), ["identifier-exists-conflict"]);
    assert.deepEqual(rules(run([item({ identifier_exists: "yes" })])), []);
  });

  both("identifier_exists no with an mpn but no brand isn't a conflict: Google says to still submit it", (run) => {
    assert.deepEqual(run([item({ gtin: "", brand: "", mpn: "AC-1", identifier_exists: "no" })]).findings, []);
  });
});

describe("variants", () => {
  both("variant-inconsistent when item_group_title differs in a group", (run) => {
    const rows = [item({ item_group_id: "MUG", item_group_title: "Mug" }), item({ id: "MUG-2", item_group_id: "MUG", item_group_title: "Cup" })];
    const result = run(rows);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.itemId]), [["variant-inconsistent", "MUG-2"]]);
    rows[1].item_group_title = "Mug";
    assert.deepEqual(run(rows).findings, []);
  });

  both("variant-inconsistent when group ids differ only in case", (run) => {
    const result = run([item({ item_group_id: "MUG" }), item({ id: "MUG-2", item_group_id: "mug" })]);
    assert.deepEqual(rules(result), ["variant-inconsistent"]);
  });

  both("variant-parent-listed when the parent SKU is also an item", (run) => {
    const result = run([item({ id: "TEE" }), item({ id: "TEE-M", item_group_id: "TEE" }), item({ id: "TEE-L", item_group_id: "TEE" })]);
    assert.deepEqual(result.findings.map((f) => [f.rule, f.itemId]), [["variant-parent-listed", "TEE"]]);
  });
});

describe("native_commerce (checkout on Google)", () => {
  test("a text header with sub-attributes and TRUE/FALSE values", () => {
    const ok = lint(tsv([item({ "native_commerce(checkout_eligibility:cart_eligibility)": "TRUE:FALSE" })]));
    assert.deepEqual(ok.findings, []);
    const bad = lint(tsv([item({ "native_commerce(checkout_eligibility:cart_eligibility)": "TRUE:maybe" })]));
    assert.deepEqual(rules(bad), ["value-enum"]);
  });

  test("XML sub-elements", () => {
    const element = (value: string) => `<g:native_commerce><g:checkout_eligibility>TRUE</g:checkout_eligibility><g:cart_eligibility>${value}</g:cart_eligibility></g:native_commerce>`;
    assert.deepEqual(lint(rss([item()]).replace("</item>", `${element("FALSE")}</item>`)).findings, []);
    assert.deepEqual(rules(lint(rss([item()]).replace("</item>", `${element("yes")}</item>`))), ["value-enum"]);
  });
});

describe("findings carry the item and the line", () => {
  test("XML findings point at the element's line", () => {
    const result = lint(rss([item(), item({ id: "MUG-2", price: "$5" })]));
    const f = result.findings[0];
    assert.deepEqual([f.rule, f.itemId, f.attribute], ["price-invalid", "MUG-2", "price"]);
    assert.equal(rss([item(), item({ id: "MUG-2", price: "$5" })]).split("\n")[f.line! - 1].trim(), "<g:price>$5</g:price>");
  });

  test("TSV findings use spreadsheet rows", () => {
    const result = lint(tsv([item(), item({ id: "MUG-2", price: "$5" })]));
    assert.equal(result.findings[0].line, 3);
  });
});
