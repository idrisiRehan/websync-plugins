import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateStructuredData, type RuleId, type StructuredDataResult } from "../src/validate.ts";

const CONTEXT = "https://schema.org";

/** Pretty-printed JSON-LD with a schema.org context, so values sit on predictable lines. */
function ld(node: Record<string, unknown>): string {
  return JSON.stringify({ "@context": CONTEXT, ...node }, null, 2);
}

function script(json: string): string {
  return `<script type="application/ld+json">${json}</script>`;
}

function rules(result: StructuredDataResult): RuleId[] {
  return result.findings.map((f) => f.rule);
}

function only(result: StructuredDataResult, rule: RuleId) {
  const found = result.findings.filter((f) => f.rule === rule);
  assert.equal(found.length, 1, `expected one ${rule}, got: ${JSON.stringify(result.findings, null, 2)}`);
  return found[0];
}

function none(result: StructuredDataResult, rule: RuleId): void {
  assert.deepEqual(result.findings.filter((f) => f.rule === rule), [], `unexpected ${rule}`);
}

// A Thing type that matches no rich result, for structural tests.
const THING = { "@type": "Thing", name: "x" };

describe("input detection", () => {
  test("raw JSON-LD", () => {
    const r = validateStructuredData(ld(THING));
    assert.equal(r.format, "json");
    assert.equal(r.blockCount, 1);
    assert.deepEqual(r.findings, []);
    assert.equal(r.valid, true);
  });

  test("HTML with several scripts", () => {
    const r = validateStructuredData(`<html><head>${script(ld(THING))}\n${script(ld(THING))}</head></html>`);
    assert.equal(r.format, "html");
    assert.equal(r.blockCount, 2);
    assert.equal(r.entities.length, 2);
  });

  test("HTML without JSON-LD is a warning, with a note about Microdata", () => {
    const plain = validateStructuredData("<p>hello</p>");
    assert.equal(only(plain, "jsonld-missing").severity, "warning");
    assert.equal(plain.valid, true);
    assert.match(only(validateStructuredData('<div itemscope itemtype="https://schema.org/Product"></div>'), "jsonld-missing").message, /Microdata or RDFa/);
  });

  test("an empty script", () => {
    const r = validateStructuredData(`<p>\n<script type="application/ld+json">  \n </script>`);
    const f = only(r, "script-empty");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 2);
  });
});

describe("JSON syntax", () => {
  test("the error line is the script's line plus the offset inside it", () => {
    const html = `<!doctype html>\n<html>\n<head>\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Thing",\n  "name": "x",\n}\n</script>`;
    const f = only(validateStructuredData(html), "json-invalid");
    assert.equal(f.severity, "error");
    assert.equal(f.line, 9);
    assert.match(f.message, /Trailing comma/);
  });

  test("a script on the same line as its tag", () => {
    const html = `<p>one</p>\n<p>two</p><script type="application/ld+json">{"@context": "https://schema.org" "@type": "Thing"}</script>`;
    assert.equal(only(validateStructuredData(html), "json-invalid").line, 2);
  });

  test("raw JSON errors use the file's line", () => {
    assert.equal(only(validateStructuredData('{\n"@context": "https://schema.org",\n"name": \'x\'\n}'), "json-invalid").line, 3);
  });

  test("one bad script doesn't stop the others being checked", () => {
    const r = validateStructuredData(`${script("{oops}")}\n${script(ld({ "@type": "Thing" }))}`);
    assert.deepEqual(rules(r), ["json-invalid"]);
    assert.equal(r.entities.length, 1);
  });

  test("a repeated key is a warning", () => {
    const f = only(validateStructuredData('{\n"@context": "https://schema.org",\n"@type": "Thing",\n"name": "a",\n"name": "b"\n}'), "json-duplicate-key");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 5);
  });
});

describe("JSON-LD structure", () => {
  test("the root must be an object or an array of objects", () => {
    assert.equal(only(validateStructuredData('["text"]'), "root-invalid").path, "$[0]");
    assert.match(only(validateStructuredData("[[]]"), "root-invalid").message, /nested array/);
  });

  test("@context missing", () => {
    const f = only(validateStructuredData(JSON.stringify(THING)), "context-missing");
    assert.equal(f.severity, "error");
    assert.equal(f.path, "$");
  });

  test("schema.org contexts in every accepted form", () => {
    for (const context of [
      "https://schema.org",
      "https://schema.org/",
      "http://schema.org",
      "http://schema.org/",
      { "@vocab": "https://schema.org/" },
      { "@vocab": "http://schema.org" },
      ["https://schema.org", { ex: "https://example.com/ns#" }],
    ]) {
      assert.deepEqual(validateStructuredData(JSON.stringify({ "@context": context, ...THING })).findings, [], JSON.stringify(context));
    }
  });

  test("a non-schema.org context", () => {
    for (const context of ["https://example.com/vocab", "https://schema.org.evil.com/", "https://www.schema.org.evil.com/", "https://ww.schema.org", { name: "https://schema.org/name" }, 7]) {
      const f = only(validateStructuredData(JSON.stringify({ "@context": context, ...THING })), "context-invalid");
      assert.equal(f.path, '$["@context"]');
      assert.equal(f.severity, "error", JSON.stringify(context));
      assert.match(f.message, /isn't schema\.org\. Use "https:\/\/schema\.org"\.$/);
    }
  });

  // www.schema.org serves the same JSON-LD context, but only schema.org is documented.
  test("a www.schema.org context is a warning, not an error, naming the documented form", () => {
    for (const context of ["http://www.schema.org", "https://www.schema.org", "http://www.schema.org/", "https://www.schema.org/", { "@vocab": "https://www.schema.org/" }, ["https://www.schema.org", { ex: "https://example.com/ns#" }]]) {
      const r = validateStructuredData(JSON.stringify({ "@context": context, ...THING }));
      const f = only(r, "context-invalid");
      assert.equal(f.severity, "warning", JSON.stringify(context));
      assert.equal(r.valid, true);
      assert.equal(f.path, '$["@context"]');
      assert.match(f.message, /uses www\.schema\.org\. That host serves the same JSON-LD context, but Google's documentation and schema\.org only use schema\.org without www/);
      assert.match(f.message, /Use "https:\/\/schema\.org"\.$/);
    }
  });

  test("a documented schema.org form alongside www.schema.org is not flagged", () => {
    const r = validateStructuredData(JSON.stringify({ "@context": ["https://www.schema.org", "https://schema.org"], ...THING }));
    assert.deepEqual(r.findings, []);
  });

  test("every item of a top-level array needs its own @context", () => {
    const r = validateStructuredData(JSON.stringify([{ "@context": CONTEXT, ...THING }, THING]));
    assert.equal(only(r, "context-missing").path, "$[1]");
  });

  test("@graph nodes share the root's @context", () => {
    const r = validateStructuredData(JSON.stringify({ "@context": CONTEXT, "@graph": [THING, THING] }));
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.entities.map((e) => e.path), ['$["@graph"][0]', '$["@graph"][1]']);
  });

  test("@type missing on a top-level, array or @graph node", () => {
    assert.equal(only(validateStructuredData(ld({ name: "x" })), "type-missing").path, "$");
    assert.equal(only(validateStructuredData(JSON.stringify([{ "@context": CONTEXT, name: "x" }])), "type-missing").path, "$[0]");
    assert.equal(only(validateStructuredData(ld({ "@graph": [THING, { name: "y" }] })), "type-missing").path, '$["@graph"][1]');
  });

  test("references, graph containers and untyped nested values don't need @type", () => {
    const r = validateStructuredData(ld({ "@graph": [{ "@id": "#a" }, { "@type": "Thing", "@id": "#b", author: { name: "x" } }] }));
    none(r, "type-missing");
  });

  test("malformed @type", () => {
    for (const type of [7, "", ["Thing", 3], [], { "@id": "Thing" }]) {
      assert.equal(only(validateStructuredData(ld({ "@type": type })), "type-invalid").path, '$["@type"]', JSON.stringify(type));
    }
  });

  test("schema.org prefixes are removed from @type", () => {
    const r = validateStructuredData(ld({ "@type": ["https://schema.org/Thing", "schema:CreativeWork"] }));
    assert.deepEqual(r.entities[0].types, ["Thing", "CreativeWork"]);
  });

  test("entities list every typed node, nested ones included", () => {
    const r = validateStructuredData(ld({ "@type": "Thing", "@id": "https://example.com/#t", subjectOf: { "@type": "CreativeWork", name: "c" } }));
    assert.deepEqual(r.entities, [
      { types: ["Thing"], id: "https://example.com/#t", line: 1, path: "$", richResults: [] },
      { types: ["CreativeWork"], id: null, line: 5, path: "$.subjectOf", richResults: [] },
    ]);
  });
});

describe("duplicate @id", () => {
  test("two definitions with different values conflict", () => {
    const r = validateStructuredData(ld({ "@graph": [{ "@type": "Organization", "@id": "#org", name: "Acme" }, { "@type": "Corporation", "@id": "#org", name: "Acme Inc" }] }));
    const f = only(r, "id-conflict");
    assert.equal(f.severity, "warning");
    assert.match(f.message, /"@type" and "name"/);
    assert.equal(f.path, '$["@graph"][1]');
  });

  test("repeating the same values, or adding new ones, is fine", () => {
    const r = validateStructuredData(ld({ "@graph": [{ "@type": "Thing", "@id": "#a", name: "A" }, { "@type": "Thing", "@id": "#a", name: "A", description: "more" }] }));
    none(r, "id-conflict");
  });

  test("conflicts are found across scripts and in nested nodes", () => {
    const first = ld({ "@type": "Thing", "@id": "#org", name: "A" });
    const second = ld({ "@type": "Thing", publisher: { "@id": "#org", name: "B" } });
    only(validateStructuredData(`${script(first)}\n${script(second)}`), "id-conflict");
  });

  test("bare references never conflict", () => {
    none(validateStructuredData(ld({ "@graph": [{ "@type": "Thing", "@id": "#a", name: "A" }, { "@type": "Thing", about: { "@id": "#a" } }] })), "id-conflict");
  });
});

describe("rich-result requirements", () => {
  test("a missing required property is an error that names the feature", () => {
    const f = only(validateStructuredData(ld({ "@type": "Recipe", image: "https://example.com/a.jpg" })), "property-required");
    assert.equal(f.severity, "error");
    assert.equal(f.path, "$.name");
    assert.equal(f.message, 'Missing "name", required for Recipe per Google\'s documentation.');
  });

  test("one-of requirements list the alternatives", () => {
    const f = only(validateStructuredData(ld({ "@type": "Product", name: "P" })), "property-required");
    assert.match(f.message, /Missing one of "review", "aggregateRating" or "offers"/);
    assert.equal(f.path, "$");
  });

  test("a property missing for two features is reported once, naming both", () => {
    const r = validateStructuredData(ld({ "@type": "Product", name: "P", image: "https://example.com/p.jpg", offers: { "@type": "Offer", priceCurrency: "USD" } }));
    const f = r.findings.find((x) => x.path === "$.offers" && x.rule === "property-required");
    assert.ok(f);
    assert.match(f.message, /"price" or "priceSpecification.price", required for Product snippet and Merchant listing/);
  });

  test("required wins over recommended for the same property", () => {
    const r = validateStructuredData(ld({ "@type": "Product", name: "P", image: "https://example.com/p.jpg", offers: { "@type": "Offer", price: 5 } }));
    const currency = r.findings.filter((f) => f.path === "$.offers" && /priceCurrency/.test(f.message));
    assert.equal(currency.length, 1);
    assert.equal(currency[0].severity, "error");
    assert.match(currency[0].message, /required for Merchant listing/);
  });

  test("an empty string, null or empty array counts as missing", () => {
    for (const name of ["", "  ", null, []]) {
      only(validateStructuredData(ld({ "@type": "Recipe", name, image: "https://example.com/a.jpg" })), "property-required");
    }
  });

  test("a missing parent is reported once, not again for its nested properties", () => {
    const r = validateStructuredData(ld({ "@type": "Article", headline: "h", image: "https://example.com/a.jpg", datePublished: "2026-01-01", dateModified: "2026-01-02" }));
    assert.deepEqual(r.findings.map((f) => f.path), ["$.author"]);
  });

  test("a nested property is reported when its parent is present without it", () => {
    const r = validateStructuredData(ld({ "@type": "Article", headline: "h", image: "https://example.com/a.jpg", datePublished: "2026-01-01", dateModified: "2026-01-02", author: { "@type": "Person" } }));
    assert.deepEqual(r.findings.map((f) => f.path), ["$.author.name", "$.author"]);
  });

  test("a nested property is reported when its parent isn't listed on its own", () => {
    const recipe = { "@type": "Recipe", name: "r", image: "https://example.com/a.jpg" };
    assert.ok(validateStructuredData(ld(recipe)).findings.some((f) => f.path === "$.nutrition.calories"));
  });

  test("@id references are followed, across @graph and scripts", () => {
    const graph = ld({
      "@graph": [
        { "@type": "Person", "@id": "#asha", name: "Asha", url: "https://example.com/asha" },
        { "@type": "BlogPosting", headline: "h", image: "https://example.com/a.jpg", datePublished: "2026-01-01", dateModified: "2026-01-02", author: { "@id": "#asha" } },
      ],
    });
    assert.deepEqual(validateStructuredData(graph).findings, []);
  });

  test("nodes that share an @id are merged, so properties may be split between them", () => {
    const review = ld({
      "@graph": [
        { "@type": "Review", itemReviewed: { "@type": "Book", name: "B" }, reviewRating: { "@type": "Rating", ratingValue: 4 }, datePublished: "2026-01-01", author: { "@type": "Person", "@id": "#asha" } },
        { "@type": "Person", "@id": "#asha", name: "Asha" },
      ],
    });
    assert.deepEqual(validateStructuredData(review).findings, []);
    const product = { "@context": CONTEXT, "@type": "Product", "@id": "#p", name: "P", image: "https://example.com/a.jpg" };
    const offers = { "@context": CONTEXT, "@id": "#p", offers: { "@type": "Offer", price: "5", priceCurrency: "USD" } };
    const r = validateStructuredData(`${script(JSON.stringify(product))}\n${script(JSON.stringify(offers))}`);
    none(r, "property-required");
    none(r, "type-missing");
  });

  test("an unresolved reference lacks its nested properties", () => {
    const r = validateStructuredData(ld({ "@type": "BlogPosting", headline: "h", image: "https://example.com/a.jpg", datePublished: "2026-01-01", dateModified: "2026-01-02", author: { "@id": "#nobody" } }));
    assert.ok(r.findings.some((f) => f.path === "$.author.name"));
  });

  test("rich results are matched on top-level, @graph, mainEntity and list items, not other nested nodes", () => {
    const recipe = { "@type": "Recipe", name: "r" };
    assert.equal(validateStructuredData(ld({ "@type": "WebPage", mainEntity: recipe })).entities[1].richResults[0], "Recipe");
    assert.equal(validateStructuredData(ld({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, item: recipe }] })).entities[2].richResults[0], "Recipe");
    const nested = validateStructuredData(ld({ "@type": "WebPage", about: recipe }));
    assert.deepEqual(nested.entities[1].richResults, []);
    none(nested, "property-required");
  });

  test("VideoObject is matched at any depth", () => {
    const r = validateStructuredData(ld({ "@type": "Thing", subjectOf: { "@type": "VideoObject", name: "v" } }));
    assert.deepEqual(r.entities[1].richResults, ["Video"]);
    assert.equal(r.findings.filter((f) => f.rule === "property-required").length, 2);
  });

  test("a string where an object is expected lacks its nested properties", () => {
    const r = validateStructuredData(ld({ "@type": "SoftwareApplication", name: "App", offers: "free", aggregateRating: { "@type": "AggregateRating", ratingValue: 4, ratingCount: 10 }, applicationCategory: "GameApplication", operatingSystem: "Android" }));
    assert.equal(only(r, "property-required").path, "$.offers.price");
  });

  test("deprecated types are a warning with the reason, and aren't checked further", () => {
    const r = validateStructuredData(ld({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "q" }] }));
    const f = only(r, "type-deprecated");
    assert.equal(f.severity, "warning");
    assert.match(f.message, /^FAQPage no longer produces a rich result\. Google stopped showing FAQ rich results on 7 May 2026/);
    assert.equal(r.findings.length, 1);
    assert.deepEqual(r.entities[0].richResults, []);
  });

  test("HowTo is retired", () => {
    assert.match(only(validateStructuredData(ld({ "@type": "HowTo", name: "h" })), "type-deprecated").message, /September 2023/);
  });
});

describe("value formats", () => {
  function value(key: string, v: unknown, type = "Thing") {
    return validateStructuredData(ld({ "@type": type, [key]: v }));
  }

  test("ISO 8601 dates", () => {
    for (const ok of ["2026-11-24", "2026-11-24T09:30", "2026-11-24T09:30:00Z", "2026-11-24T09:30:00.123+05:30", "2024-02-29T23:59:59-0800"]) {
      assert.deepEqual(value("datePublished", ok).findings, [], ok);
    }
    for (const bad of ["24/11/2026", "Nov 24, 2026", "2026", "2026-13-01", "2025-02-29", "2026-11-24T25:00", "2026-11-24T10:00+15:00", 20261124]) {
      assert.equal(only(value("datePublished", bad), "date-invalid").path, "$.datePublished", String(bad));
    }
    assert.match(only(value("startDate", "2026-11-24 19:00"), "date-invalid").message, /ISO 8601 uses T/);
  });

  test("ISO 8601 durations", () => {
    for (const ok of ["PT1H30M", "PT00H30M5S", "P1D", "PT0.5S", "P1DT2H"]) assert.deepEqual(value("cookTime", ok).findings, [], ok);
    for (const bad of ["30 minutes", "PT", "P", "PT1H30", "1H30M", "P1H"]) only(value("cookTime", bad), "duration-invalid");
  });

  test("a months-only duration is flagged as a likely minutes mistake", () => {
    const f = only(value("duration", "P10M"), "duration-invalid");
    assert.equal(f.severity, "warning");
    assert.match(f.message, /10 months.*PT10M/);
  });

  test("absolute URLs for url, image, logo and friends", () => {
    for (const key of ["url", "image", "logo", "thumbnailUrl", "contentUrl", "embedUrl", "sameAs"]) {
      assert.deepEqual(value(key, "https://example.com/a.png").findings, [], key);
      assert.equal(only(value(key, "/a.png"), "url-relative").severity, "warning", key);
    }
    assert.match(only(value("url", "javascript:alert(1)"), "url-invalid").message, /http or https/);
    assert.match(only(value("logo", "data:image/png;base64,AAAA"), "url-invalid").message, /data:/);
    assert.match(only(value("url", "ftp://example.com/a"), "url-invalid").message, /uses ftp, but Google needs/);
    only(value("url", "http://[bad"), "url-invalid");
    only(value("image", 42), "url-invalid");
  });

  test("each item of an array is checked, and objects (ImageObject) are left to their own properties", () => {
    const r = value("image", ["https://example.com/a.png", "b.png", { "@type": "ImageObject", url: "c.png" }]);
    assert.deepEqual(r.findings.map((f) => f.path), ["$.image[1]", "$.image[2].url"]);
  });

  test("relative URLs show what they resolve to when the page URL is known", () => {
    const r = validateStructuredData(ld({ "@type": "Thing", image: "/a.png" }), { url: "https://shop.example.com/p/1" });
    assert.match(only(r, "url-relative").message, /resolves to https:\/\/shop\.example\.com\/a\.png/);
  });

  test("an invalid options.url throws", () => {
    assert.throws(() => validateStructuredData("{}", { url: "not a url" }), TypeError);
  });

  test("prices are plain numbers", () => {
    for (const ok of [19.99, 0, "19.99", "1299", " 5 "]) assert.deepEqual(value("price", ok).findings, [], String(ok));
    for (const bad of ["$19.99", "19.99 USD", "€5", "INR 500"]) assert.match(only(value("price", bad), "price-invalid").message, /includes a currency/, bad);
    for (const bad of ["1,299.00", "19,99", "free", -1]) assert.match(only(value("lowPrice", bad), "price-invalid").message, /isn't a plain number/, String(bad));
  });

  test("priceCurrency is an ISO 4217 code", () => {
    assert.deepEqual(value("priceCurrency", "EUR").findings, []);
    for (const bad of ["usd", "$", "US$", "EURO", 840]) only(value("priceCurrency", bad), "currency-invalid");
  });

  test("availability is a schema.org ItemAvailability value", () => {
    for (const ok of ["https://schema.org/InStock", "http://schema.org/OutOfStock", "PreOrder", "schema:SoldOut"]) assert.deepEqual(value("availability", ok).findings, [], ok);
    assert.match(only(value("availability", "https://schema.org/inStock"), "enum-invalid").message, /should be written InStock/);
    assert.match(only(value("availability", "available"), "enum-invalid").message, /ItemAvailability value\. Use one of: BackOrder/);
  });

  test("other enumerations", () => {
    only(value("itemCondition", "new"), "enum-invalid");
    only(value("eventStatus", "Scheduled"), "enum-invalid");
    assert.deepEqual(value("employmentType", ["FULL_TIME", "INTERN"]).findings, []);
    assert.match(only(value("employmentType", "full_time"), "enum-invalid").message, /FULL_TIME/);
    // employmentType values aren't schema.org URLs.
    only(value("employmentType", "https://schema.org/FULL_TIME"), "enum-invalid");
  });

  test("ratingValue within its bounds", () => {
    const rating = (r: Record<string, unknown>) => validateStructuredData(ld({ "@type": "Rating", ...r }));
    for (const ok of [{ ratingValue: 4.5 }, { ratingValue: "1" }, { ratingValue: 8, bestRating: 10 }, { ratingValue: 0, worstRating: 0 }, { ratingValue: "60%" }, { ratingValue: "6 / 10" }]) {
      assert.deepEqual(rating(ok).findings, [], JSON.stringify(ok));
    }
    assert.match(only(rating({ ratingValue: 8.7 }), "rating-invalid").message, /8\.7 is outside 1-5 \(when omitted, bestRating is 5 and worstRating is 1\)/);
    assert.match(only(rating({ ratingValue: 11, bestRating: "10", worstRating: 1 }), "rating-invalid").message, /outside 1-10\.$/);
    assert.match(only(rating({ ratingValue: 0 }), "rating-invalid").message, /worstRating is 1/);
    assert.match(only(rating({ ratingValue: "4,5" }), "rating-invalid").message, /use a period/);
    only(rating({ ratingValue: "great" }), "rating-invalid");
    only(rating({ ratingValue: "120%" }), "rating-invalid");
    only(rating({ ratingValue: "11/10" }), "rating-invalid");
  });

  test("counts are whole numbers", () => {
    assert.deepEqual(value("reviewCount", "12").findings, []);
    for (const bad of [1.5, -2, "a dozen"]) only(value("ratingCount", bad), "integer-invalid");
  });

  test("a bad value is an error on a required property and a warning otherwise", () => {
    const offers = (price: string) => ld({ "@type": "Product", name: "P", image: "https://example.com/p.jpg", offers: { "@type": "Offer", price, priceCurrency: "USD" } });
    assert.equal(only(validateStructuredData(offers("$5")), "price-invalid").severity, "error");
    assert.equal(only(value("price", "$5"), "price-invalid").severity, "warning");
  });

  test("values inside @context are not data", () => {
    assert.deepEqual(validateStructuredData(JSON.stringify({ "@context": [CONTEXT, { url: "/relative" }], ...THING })).findings, []);
  });
});

describe("result", () => {
  test("findings are sorted by line and counted", () => {
    const r = validateStructuredData(`${script(ld({ "@type": "Thing", url: "/a" }))}\n${script("{bad")}`);
    assert.deepEqual(rules(r), ["url-relative", "json-invalid"]);
    assert.equal(r.errorCount, 1);
    assert.equal(r.warningCount, 1);
    assert.equal(r.valid, false);
  });
});
