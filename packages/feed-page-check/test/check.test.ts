import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkFeedAgainstPages } from "../src/index.ts";
import { BASE, check1, html, item, jsonl, offer, product, rules, tsv } from "./helpers.ts";

const NOW = new Date("2026-11-24T12:00:00Z");

describe("a page that agrees with the feed", () => {
  test("no findings, and the values from both sides", () => {
    const result = check1(item("MUG-1"), html(product({ sku: "MUG-1" })));
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.feed, { price: "18.00 USD", salePrice: null, saleActive: false, availability: "in_stock" });
    assert.deepEqual(result.page, { url: `${BASE}/p/MUG-1`, matchedBy: "single", price: "18.00", lowPrice: null, highPrice: null, originalPrice: null, currency: "USD", availability: "InStock", line: 7 });
    assert.deepEqual([result.id, result.line, result.link], ["MUG-1", 2, `${BASE}/p/MUG-1`]);
  });

  test("prices compare as decimals: 18.00 USD equals 18, 18.0 and 018.00", () => {
    for (const price of [18, "18", "18.0", "018.00", " 18.00 "]) {
      assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ price }) })))), [], String(price));
    }
    assert.deepEqual(rules(check1(item("A", { price: "0.30 USD" }), html(product({ offers: offer({ price: 0.3 }) })))), []);
    // Beyond what a double holds exactly: compared digit by digit.
    const big = "12345678901234567890.10";
    assert.deepEqual(rules(check1(item("A", { price: `${big} USD` }), html(product({ offers: offer({ price: "12345678901234567890.1" }) })))), []);
    assert.deepEqual(rules(check1(item("A", { price: `${big} USD` }), html(product({ offers: offer({ price: "12345678901234567890.11" }) })))), ["price-mismatch"]);
  });
});

describe("price-mismatch", () => {
  test("an error naming both prices, with the page line", () => {
    const result = check1(item("A"), html(product({ offers: offer({ price: "19.00" }) })));
    assert.deepEqual(rules(result), ["price-mismatch"]);
    const [f] = result.findings;
    assert.equal(f.severity, "error");
    assert.equal(f.line, 7);
    assert.match(f.message, /^The page's price is 19\.00 USD; the feed's price is 18\.00 USD\./);
    assert.match(f.message, /https:\/\/support\.google\.com\/merchants\/answer\/12159029/);
  });

  test("one cent apart is a mismatch", () => {
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ price: 18.01 }) })))), ["price-mismatch"]);
  });

  test("hints at a sale the feed doesn't have when the page strikes through the feed price", () => {
    const page = html(product({ offers: offer({ price: undefined, priceSpecification: [{ "@type": "UnitPriceSpecification", price: 15, priceCurrency: "USD" }, { "@type": "UnitPriceSpecification", price: 18, priceCurrency: "USD", priceType: "https://schema.org/StrikethroughPrice" }] }) }));
    const [f] = check1(item("A"), page).findings;
    assert.equal(f.rule, "price-mismatch");
    assert.match(f.message, /The page shows a sale \(18 USD struck through\): submit 15 USD as sale_price\./);
  });
});

describe("currency-mismatch", () => {
  test("an error, and the amounts aren't compared across currencies", () => {
    const result = check1(item("A"), html(product({ offers: offer({ priceCurrency: "EUR", price: 20 }) })));
    assert.deepEqual(rules(result), ["currency-mismatch"]);
    assert.equal(result.findings[0].severity, "error");
    assert.match(result.findings[0].message, /in EUR, the feed's in USD/);
  });

  test("letter case doesn't matter, and a feed price without a currency compares the amount only", () => {
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ priceCurrency: "usd" }) })))), []);
    assert.deepEqual(rules(check1(item("A", { price: "18.00" }), html(product()))), []);
  });

  test("page-currency-missing is a warning; the amount is still compared", () => {
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ priceCurrency: undefined }) })))), ["page-currency-missing"]);
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ priceCurrency: undefined, price: 1 }) })))), ["page-currency-missing", "price-mismatch"]);
  });
});

describe("sale prices", () => {
  const sale = (rest: Record<string, string> = {}) => item("A", { price: "25.00 USD", sale_price: "19.00 USD", ...rest });

  test("a current sale price is the price the page must show", () => {
    const result = check1(sale(), html(product({ offers: offer({ price: "19.00" }) })), { now: NOW });
    assert.deepEqual(rules(result), []);
    assert.equal(result.feed.saleActive, true);
  });

  test("sale-price-not-on-page when the page shows the regular price", () => {
    const [f] = check1(sale(), html(product({ offers: offer({ price: "25" }) })), { now: NOW }).findings;
    assert.deepEqual([f.rule, f.severity], ["sale-price-not-on-page", "error"]);
    assert.match(f.message, /current sale_price of 19.00 USD, but the page's price is the regular price, 25 USD/);
  });

  test("a price that is neither is a price mismatch against the sale price", () => {
    const [f] = check1(sale(), html(product({ offers: offer({ price: "21" }) })), { now: NOW }).findings;
    assert.equal(f.rule, "price-mismatch");
    assert.match(f.message, /the feed's sale_price is 19.00 USD/);
  });

  test("sale_price_effective_date: outside the dates the regular price applies", () => {
    const future = sale({ sale_price_effective_date: "2026-12-01T00:00-0800/2026-12-31T23:59-0800" });
    const regular = check1(future, html(product({ offers: offer({ price: "25.00" }) })), { now: NOW });
    assert.deepEqual([rules(regular), regular.feed.saleActive], [[], false]);
    const early = check1(future, html(product({ offers: offer({ price: "19.00" }) })), { now: NOW });
    assert.deepEqual(rules(early), ["price-mismatch"]);
    assert.match(early.findings[0].message, /That is the feed's sale_price, which isn't current: check sale_price_effective_date/);
    const during = check1(future, html(product({ offers: offer({ price: "19.00" }) })), { now: new Date("2026-12-10T00:00:00Z") });
    assert.deepEqual(rules(during), []);
  });

  test("sale_price_effective_date: an end date without a time includes that whole day (UTC)", () => {
    // Google: "If you don't include a time, ... ends at 11:59 PM on the end date" (answer 6324460).
    const dated = sale({ sale_price_effective_date: "2026-11-01/2026-11-24" });
    const page = html(product({ offers: offer({ price: "19.00" }) }));
    const lastDay = check1(dated, page, { now: new Date("2026-11-24T23:30:00Z") });
    assert.deepEqual([rules(lastDay), lastDay.feed.saleActive], [[], true]);
    const after = check1(dated, page, { now: new Date("2026-11-25T00:00:00Z") });
    assert.deepEqual([rules(after), after.feed.saleActive], [["price-mismatch"], false]);
  });

  test("a date that doesn't exist can't be read", () => {
    const result = check1(sale({ sale_price_effective_date: "2026-02-30T00:00Z/2026-03-31T00:00Z" }), html(product({ offers: offer({ price: "19.00" }) })), { now: NOW });
    assert.deepEqual(rules(result), ["feed-value-invalid"]);
  });

  test("a sale_price that isn't used says why, not that its dates are wrong", () => {
    const result = check1(item("A", { price: "25.00 USD", sale_price: "19.00" }), html(product({ offers: offer({ price: "19.00" }) })));
    assert.deepEqual(rules(result), ["price-mismatch"]);
    assert.match(result.findings[0].message, /That is the feed's sale_price, which isn't used because it isn't above zero, below price and in the same currency\./);
  });

  test("an unreadable effective date is reported, and the sale is taken as current", () => {
    const result = check1(sale({ sale_price_effective_date: "next week" }), html(product({ offers: offer({ price: "19.00" }) })), { now: NOW });
    assert.deepEqual(rules(result), ["feed-value-invalid"]);
    assert.equal(result.feed.saleActive, true);
  });

  test("a sale price that isn't below price isn't used", () => {
    const result = check1(item("A", { price: "25.00 USD", sale_price: "30.00 USD" }), html(product({ offers: offer({ price: "25" }) })));
    assert.deepEqual([rules(result), result.feed.saleActive], [[], false]);
  });

  test("original-price-mismatch when the page's strikethrough price isn't the feed's price", () => {
    const strike = (price: number) => html(product({ offers: offer({ price: "19.00", priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "USD", priceType: "StrikethroughPrice" } }) }));
    const wrong = check1(sale(), strike(29), { now: NOW });
    assert.deepEqual(rules(wrong), ["original-price-mismatch"]);
    assert.equal(wrong.findings[0].severity, "warning");
    assert.equal(wrong.page?.originalPrice, "29");
    assert.deepEqual(rules(check1(sale(), strike(25), { now: NOW })), []);
  });

  test("OpenAI: a valid sale_price is current; sale dates aren't read", () => {
    const feed = jsonl([{ item_id: "A", url: `${BASE}/p/A`, price: "25.00 USD", sale_price: "19.00 USD", sale_price_effective_date: "2030-01-01/2030-02-01", availability: "in_stock" }]);
    const result = checkFeedAgainstPages(feed, [{ url: `${BASE}/p/A`, html: html(product({ offers: offer({ price: 25 }) })) }], { target: "openai" });
    assert.deepEqual(rules(result.items[0]), ["sale-price-not-on-page"]);
  });
});

describe("availability", () => {
  const withAvailability = (feed: string, page: string | undefined) => check1(item("A", { availability: feed }), html(product({ offers: offer({ availability: page }) })));

  test("Google's mapping of schema.org values to feed values, with any prefix and letter case", () => {
    const table: [string, string][] = [
      ["in_stock", "InStock"], ["in_stock", "LimitedAvailability"], ["in_stock", "OnlineOnly"],
      ["out_of_stock", "Discontinued"], ["out_of_stock", "InStoreOnly"], ["out_of_stock", "OutOfStock"], ["out_of_stock", "SoldOut"],
      ["preorder", "PreOrder"], ["preorder", "PreSale"], ["backorder", "BackOrder"],
    ];
    for (const [feed, page] of table) {
      for (const written of [page, `https://schema.org/${page}`, `http://schema.org/${page}`, `schema:${page}`, page.toLowerCase()]) {
        assert.deepEqual(rules(withAvailability(feed, written)), [], `${feed} ${written}`);
      }
    }
    assert.deepEqual(rules(withAvailability("in stock", "InStock")), []);
  });

  test("availability-mismatch is an error", () => {
    const result = withAvailability("in_stock", "https://schema.org/OutOfStock");
    assert.deepEqual(rules(result), ["availability-mismatch"]);
    assert.equal(result.findings[0].severity, "error");
    assert.match(result.findings[0].message, /The page says OutOfStock \(out_of_stock\), the feed in_stock\./);
    assert.deepEqual(rules(withAvailability("preorder", "InStock")), ["availability-mismatch"]);
    assert.deepEqual(rules(withAvailability("out_of_stock", "BackOrder")), ["availability-mismatch"]);
  });

  test("availability-relaxed: in_stock in the feed, preorder or backorder on the page, is a warning", () => {
    for (const page of ["PreOrder", "BackOrder", "PreSale"]) {
      const result = withAvailability("in_stock", page);
      assert.deepEqual(rules(result), ["availability-relaxed"]);
      assert.equal(result.findings[0].severity, "warning");
    }
  });

  test("OpenAI's pre_order is preorder, and unknown isn't compared", () => {
    const run = (availability: string, page: string) => {
      const feed = jsonl([{ item_id: "A", url: `${BASE}/p/A`, price: "18.00 USD", availability }]);
      return rules(checkFeedAgainstPages(feed, [{ url: `${BASE}/p/A`, html: html(product({ offers: offer({ availability: page }) })) }], { target: "openai" }).items[0]);
    };
    assert.deepEqual(run("pre_order", "PreOrder"), []);
    assert.deepEqual(run("pre_order", "InStock"), ["availability-mismatch"]);
    assert.deepEqual(run("unknown", "OutOfStock"), []);
  });

  test("page-availability-missing for no value or one Google doesn't map", () => {
    assert.deepEqual(rules(withAvailability("in_stock", undefined)), ["page-availability-missing"]);
    const unmapped = withAvailability("in_stock", "https://schema.org/MadeToOrder");
    assert.deepEqual(rules(unmapped), ["page-availability-missing"]);
    assert.match(unmapped.findings[0].message, /"MadeToOrder" isn't one of the schema\.org values Google maps/);
  });
});

describe("pages without usable Product data", () => {
  test("page-no-product, saying why", () => {
    const cases: [string, RegExp][] = [
      ["<html><body>No markup</body></html>", /The page has no JSON-LD\./],
      [html({ "@context": "https://schema.org", "@type": "Organization", name: "Shop" }), /The page's JSON-LD has no Product\./],
      ['<script type="application/ld+json">{"@type": "Product",}</script>', /no Product \(1 of its 1 script can't be read as JSON\)/],
      ['<div itemscope itemtype="https://schema.org/Product"><span itemprop="price">18.00</span></div>', /Microdata or RDFa, which this tool doesn't read/],
    ];
    for (const [page, message] of cases) {
      const result = check1(item("A"), page);
      assert.deepEqual(rules(result), ["page-no-product"]);
      assert.equal(result.findings[0].severity, "warning");
      assert.match(result.findings[0].message, message);
      assert.equal(result.page, null);
    }
  });

  test("page-price-missing for a product without an offer, or a price that isn't a number", () => {
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: undefined })))), ["page-price-missing"]);
    for (const price of ["$18.00", "18,00", "1,299.00", "REPLACE_WITH_PRICE"]) {
      const result = check1(item("A"), html(product({ offers: offer({ price }) })));
      assert.deepEqual(rules(result), ["page-price-missing"], price);
      assert.match(result.findings[0].message, /isn't a plain number/);
    }
  });

  test("feed-value-invalid when the feed's own price can't be read", () => {
    assert.deepEqual(rules(check1(item("A", { price: "$18" }), html(product()))), ["feed-value-invalid"]);
    assert.deepEqual(rules(check1(item("A", { price: "" }), html(product()))), ["feed-value-invalid"]);
    assert.deepEqual(rules(check1(item("A", { sale_price: "cheap" }), html(product()))), ["feed-value-invalid"]);
  });
});

describe("offer shapes", () => {
  test("offers as an array: the one in the feed's currency", () => {
    const page = html(product({ offers: [offer({ priceCurrency: "EUR", price: "17.00" }), offer()] }));
    const result = check1(item("A"), page);
    assert.deepEqual([rules(result), result.page?.matchedBy], [[], "currency"]);
  });

  test("AggregateOffer: a price inside the range is a warning, outside an error", () => {
    const aggregate = (low: string, high: string) => html(product({ offers: { "@type": "AggregateOffer", lowPrice: low, highPrice: high, priceCurrency: "USD", offerCount: 3, availability: "InStock" } }));
    const inside = check1(item("A"), aggregate("15", "20"));
    assert.deepEqual(rules(inside), ["page-price-range"]);
    assert.equal(inside.findings[0].severity, "warning");
    assert.deepEqual([inside.page?.lowPrice, inside.page?.highPrice], ["15", "20"]);
    assert.deepEqual(rules(check1(item("A"), aggregate("18.00", "18.00"))), ["page-price-range"]);
    const outside = check1(item("A"), aggregate("20", "30"));
    assert.deepEqual([rules(outside), outside.findings[0].severity], [["price-mismatch"], "error"]);
    assert.match(outside.findings[0].message, /^The page's price range \(AggregateOffer from 20 to 30\) doesn't include the feed's price: the feed's price is 18\.00 USD\.$/);
  });

  test("AggregateOffer with its own offers: the offers are matched instead", () => {
    const page = html(product({ offers: { "@type": "AggregateOffer", lowPrice: "18", highPrice: "22", priceCurrency: "USD", offers: [offer({ sku: "A" }), offer({ sku: "B", price: "22" })] } }));
    const result = check1(item("B", { price: "22.00 USD" }), page);
    assert.deepEqual([rules(result), result.page?.matchedBy, result.page?.price], [[], "sku", "22"]);
  });

  test("priceSpecification: the active price, and the one valid now", () => {
    const spec = (price: number, rest: Record<string, unknown> = {}) => ({ "@type": "UnitPriceSpecification", price, priceCurrency: "USD", ...rest });
    assert.deepEqual(rules(check1(item("A"), html(product({ offers: offer({ price: undefined, priceCurrency: undefined, priceSpecification: spec(18) }) })))), []);
    const windows = offer({ price: undefined, priceSpecification: [spec(15, { validFrom: "2026-11-01", validThrough: "2026-11-20" }), spec(18, { validFrom: "2026-11-21", validThrough: "2026-12-31" })] });
    const result = check1(item("A"), html(product({ offers: windows })), { now: NOW });
    assert.deepEqual([rules(result), result.page?.price], [[], "18"]);
  });

  test("member prices (validForMemberTier) are neither the active nor the original price", () => {
    // Google: "Active prices have neither a priceType nor a validForMemberTier property", and
    // "Price specifications containing both of these properties are ignored."
    const spec = (price: number, rest: Record<string, unknown> = {}) => ({ "@type": "UnitPriceSpecification", price, priceCurrency: "USD", ...rest });
    const gold = { validForMemberTier: { "@id": "https://shop.example/members#gold" } };
    const memberFirst = offer({ price: undefined, priceCurrency: undefined, priceSpecification: [spec(15, gold), spec(18)] });
    const result = check1(item("A"), html(product({ offers: memberFirst })));
    assert.deepEqual([rules(result), result.page?.price], [[], "18"]);
    const both = offer({ priceSpecification: [spec(30, { ...gold, priceType: "https://schema.org/StrikethroughPrice" })] });
    assert.equal(check1(item("A"), html(product({ offers: both }))).page?.originalPrice, null);
  });

  test("a priceSpecification with another priceType isn't the active price: WooCommerce's variable product on sale", () => {
    // WooCommerce core marks the lowest variation sale price with priceType SalePrice on an AggregateOffer.
    const aggregate = { "@type": "AggregateOffer", lowPrice: "15.00", highPrice: "30.00", offerCount: 3, priceCurrency: "USD", availability: "https://schema.org/InStock", priceSpecification: [{ "@type": "UnitPriceSpecification", priceType: "https://schema.org/SalePrice", price: "15.00", priceCurrency: "USD", validThrough: "2027-12-31" }] };
    const result = check1(item("A"), html(product({ offers: [aggregate] })));
    assert.deepEqual([rules(result), result.page?.price, result.findings[0].severity], [["page-price-range"], null, "warning"]);
  });

  test("@graph and @id references", () => {
    const page = html({ "@context": "https://schema.org", "@graph": [{ "@type": "Product", "@id": "#p", sku: "A", offers: { "@id": "#o" } }, { "@type": "Offer", "@id": "#o", price: "18.00", priceCurrency: "USD", availability: "InStock" }] });
    assert.deepEqual(rules(check1(item("A"), page)), []);
  });
});

describe("matching variants", () => {
  const variant = (sku: string, price: string, rest: Record<string, unknown> = {}) => ({ "@type": "Product", sku, offers: offer({ price, ...rest }), ...rest });
  const group = (...variants: unknown[]) => html({ "@context": "https://schema.org", "@type": "ProductGroup", productGroupID: "TEE", hasVariant: variants });
  const page = group(variant("TEE-S", "20"), variant("TEE-M", "22"), variant("TEE-L", "24"));

  test("by sku: the item's id", () => {
    const result = check1(item("TEE-M", { price: "22.00 USD" }), page);
    assert.deepEqual([rules(result), result.page?.matchedBy, result.page?.price], [[], "sku", "22"]);
    assert.deepEqual(rules(check1(item("TEE-L", { price: "22.00 USD" }), page)), ["price-mismatch"]);
  });

  test("by gtin, any length, before sku", () => {
    const withGtin = group({ ...variant("TEE-S", "20"), gtin13: "0012345678905" }, { ...variant("TEE-M", "22"), gtin12: "036000291452" });
    // UPC-A 036000291452 is EAN-13 0036000291452; the item's id names the other variant.
    const result = check1(item("TEE-S", { gtin: "0036000291452", price: "22 USD" }), withGtin);
    assert.deepEqual([rules(result), result.page?.matchedBy], [[], "gtin"]);
  });

  test("by mpn", () => {
    const withMpn = group({ ...variant("X1", "20"), mpn: "M-S" }, { ...variant("X2", "22"), mpn: "M-M" });
    const result = check1(item("TEE-M", { mpn: "M-M", price: "22 USD" }), withMpn);
    assert.deepEqual([rules(result), result.page?.matchedBy], [[], "mpn"]);
  });

  test("by url: a link that preselects the variant, as on Shopify", () => {
    const shopify = html(product({ offers: [offer({ url: `${BASE}/p/tee?variant=1`, price: "20" }), offer({ url: "/p/tee?variant=2", price: "22" })] }));
    const result = check1(item("shopify_US_9_2", { link: `${BASE}/p/tee?variant=2`, price: "22.00 USD" }), shopify);
    assert.deepEqual([rules(result), result.page?.matchedBy, result.page?.price], [[], "url", "22"]);
  });

  test("by @id", () => {
    const withIds = html({ "@context": "https://schema.org", "@graph": [{ ...variant("", "20"), "@id": "TEE-S" }, { ...variant("", "22"), "@id": "TEE-M" }] });
    assert.equal(check1(item("TEE-M", { price: "22 USD" }), withIds).page?.matchedBy, "id");
  });

  test("product-ambiguous when nothing picks one and the candidates differ", () => {
    const result = check1(item("TEE-XL"), page);
    assert.deepEqual(rules(result), ["product-ambiguous"]);
    assert.equal(result.findings[0].severity, "warning");
    assert.match(result.findings[0].message, /The page has 3 products or offers that differ in price or availability \(lines \d+, \d+, \d+\)/);
    assert.equal(result.page, null);
  });

  test("several candidates that all say the same are a match", () => {
    const twice = html(product({ sku: "A" }), product({ sku: "B", name: "Blue mug, again" }));
    assert.equal(check1(item("C"), twice).page?.matchedBy, "identical");
    // The same product described by two plugins, one of them out of date.
    assert.deepEqual(rules(check1(item("C"), html(product(), product({ offers: offer({ price: "17" }) })))), ["product-ambiguous"]);
  });

  test("a ProductGroup without offers and links to other variant pages don't count when a variant has an offer", () => {
    const multiPage = group(variant("TEE-S", "18"), { "@type": "Product", url: `${BASE}/p/tee-m` });
    assert.equal(check1(item("TEE-S"), multiPage).page?.matchedBy, "single");
  });

  test("related products are not candidates", () => {
    const related = html(product({ sku: "A", isRelatedTo: product({ sku: "R", offers: offer({ price: "5" }) }) }));
    assert.equal(check1(item("Z"), related).page?.matchedBy, "single");
  });
});

describe("checkFeedAgainstPages", () => {
  test("reports only items with a page; links match without their fragment", () => {
    const feed = tsv([item("A"), item("B"), item("C", { link: "ftp://shop.example/c" }), item("D", { link: "" })]);
    const result = checkFeedAgainstPages(feed, [{ url: `${BASE}/p/A#top`, html: html(product()) }, { url: `${BASE}/p/A`, html: "<p>ignored, a later duplicate</p>" }]);
    assert.deepEqual([result.target, result.format, result.itemCount, result.checkedCount], ["google", "tsv", 4, 1]);
    assert.deepEqual(result.items.map((i) => [i.id, i.findings.length]), [["A", 0]]);
  });

  test("items sharing a page share one reading of it", () => {
    const feed = tsv([item("TEE-S", { link: `${BASE}/tee`, price: "20 USD" }), item("TEE-M", { link: `${BASE}/tee`, price: "21 USD" })]);
    const page = html(product({ offers: [offer({ sku: "TEE-S", price: "20" }), offer({ sku: "TEE-M", price: "22" })] }));
    const result = checkFeedAgainstPages(feed, [{ url: `${BASE}/tee`, html: page }]);
    assert.deepEqual(result.items.map((i) => rules(i)), [[], ["price-mismatch"]]);
    assert.deepEqual([result.errorCount, result.warningCount], [1, 0]);
  });

  test("feed reading problems are passed through, and an unreadable feed has no items", () => {
    const result = checkFeedAgainstPages("<rss><channel><item>", []);
    assert.deepEqual([result.itemCount, result.feedFindings.map((f) => f.rule)], [0, ["feed-unreadable"]]);
  });

  test("OpenAI feeds use item_id and url", () => {
    const feed = jsonl([{ item_id: "A", url: `${BASE}/p/A`, price: "18.00 USD", availability: "in_stock" }]);
    const result = checkFeedAgainstPages(feed, [{ url: `${BASE}/p/A`, html: html(product()) }], { target: "openai" });
    assert.deepEqual([result.items[0].id, result.items[0].link, rules(result.items[0])], ["A", `${BASE}/p/A`, []]);
  });

  test("throws a TypeError for invalid arguments", () => {
    assert.throws(() => checkFeedAgainstPages("", "x" as never), TypeError);
    assert.throws(() => checkFeedAgainstPages("", [{ url: 1 }] as never), TypeError);
    assert.throws(() => checkFeedAgainstPages("", [], { target: "bing" as never }), TypeError);
    assert.throws(() => checkFeedAgainstPages("", [], { now: new Date("x") }), TypeError);
    assert.throws(() => checkFeedAgainstPages(1 as never, []), TypeError);
  });
});

describe("robustness", () => {
  test("never throws on hostile feeds and pages", () => {
    const pagePieces = ['<script type="application/ld+json">', "</script>", '{"@type":"Product"', '"@type":"ProductGroup"', ',"offers":', '"hasVariant":', "[", "]", "{", "}", '"price":', '"18.00"', "18", '"$"', '"priceCurrency":"USD"', '"availability":', '"InStock"', '{"@id":"#a"}', '"@id":"#a"', '"sku":"A"', '"lowPrice":"1"', '"priceSpecification":', ",", "null", "<div itemscope>", "\n"];
    const feedPieces = ["id", "link", "price", "sale_price", "availability", "\t", "\n", '"', "A", `${BASE}/p/A`, "18.00 USD", "in_stock", "<", "{", "sale_price_effective_date", "/", "gtin", ","];
    let seed = 3;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const random = (pieces: string[], n: number) => Array.from({ length: n }, () => pieces[next() % pieces.length]).join("");
    for (let i = 0; i < 2000; i++) {
      const feed = i % 2 ? random(feedPieces, 30) : tsv([item("A", { sale_price: random(["1", ".", " ", "USD", "2"], 4) })]);
      const result = checkFeedAgainstPages(feed, [{ url: `${BASE}/p/A`, html: random(pagePieces, 40) }]);
      assert.equal(result.errorCount + result.warningCount, result.items.reduce((n, it) => n + it.findings.length, 0));
    }
  });

  test("linear time: many items against one page with many variants", () => {
    const run = (n: number) => {
      const rows = Array.from({ length: n }, (_, i) => item(`SKU-${i}`, { link: `${BASE}/all`, price: `${i}.00 USD` }));
      const variants = Array.from({ length: n }, (_, i) => ({ "@type": "Product", sku: `SKU-${i}`, offers: offer({ price: String(i % 7 ? i : i + 1) }) }));
      const page = html({ "@context": "https://schema.org", "@type": "ProductGroup", hasVariant: variants });
      const start = performance.now();
      const result = checkFeedAgainstPages(tsv(rows), [{ url: `${BASE}/all`, html: page }]);
      assert.equal(result.checkedCount, n);
      return performance.now() - start;
    };
    run(500); // warm up
    const ratio = run(20_000) / Math.max(run(2_000), 1);
    assert.ok(ratio < 30, `10x the items took ${ratio.toFixed(1)}x as long`);
  });

  test("linear time: many items that no identifier matches, on one page with many offers", () => {
    const run = (n: number) => {
      const rows = Array.from({ length: n }, (_, i) => item(`X-${i}`, { link: `${BASE}/all` }));
      const page = html(product({ offers: Array.from({ length: n }, (_, i) => offer({ price: String(i) })) }));
      const start = performance.now();
      const result = checkFeedAgainstPages(tsv(rows), [{ url: `${BASE}/all`, html: page }]);
      assert.deepEqual(rules(result.items[n - 1]), ["product-ambiguous"]);
      return performance.now() - start;
    };
    run(300); // warm up
    // A floor under the small run, so timer noise on a fast machine can't fail the test.
    const ratio = run(6_000) / Math.max(run(600), 20);
    assert.ok(ratio < 30, `10x the items and offers took ${ratio.toFixed(1)}x as long`);
  });
});
