// One complete example per supported rich-result type: each must pass cleanly, and dropping a
// required property must be reported as an error for that feature.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RICH_RESULT_TYPES } from "../src/rich-results.ts";
import { validateStructuredData, type StructuredDataResult } from "../src/validate.ts";

const IMG = "https://example.com/photo.jpg";
const PERSON = { "@type": "Person", name: "Asha Rao", url: "https://example.com/asha" };
const ADDRESS = { "@type": "PostalAddress", streetAddress: "1 Main St", addressLocality: "Pune", addressRegion: "MH", postalCode: "411001", addressCountry: "IN" };
const RATING = { "@type": "AggregateRating", ratingValue: 4.4, reviewCount: 89 };
const REVIEW = { "@type": "Review", author: PERSON, reviewRating: { "@type": "Rating", ratingValue: 4 }, datePublished: "2026-10-01" };

const EXAMPLES: Record<string, Record<string, unknown>> = {
  Article: { "@type": "NewsArticle", headline: "h", image: [IMG], datePublished: "2026-11-20T08:00:00+05:30", dateModified: "2026-11-21T08:00:00+05:30", author: [PERSON] },
  "Product snippet": {
    "@type": "Product", name: "Trail Runner", image: IMG, description: "d", brand: { "@type": "Brand", name: "B" }, gtin13: "4006381333931", mpn: "TR-1", sku: "TR-1-42",
    aggregateRating: RATING, review: REVIEW,
    offers: {
      "@type": "Offer", price: "89.99", priceCurrency: "USD", availability: "https://schema.org/InStock", priceValidUntil: "2026-12-31",
      itemCondition: "https://schema.org/NewCondition", shippingDetails: { "@id": "#ship" }, hasMerchantReturnPolicy: { "@id": "#returns" },
    },
  },
  "Review snippet": { "@type": "Review", author: PERSON, itemReviewed: { "@type": "Book", name: "A Book" }, reviewRating: { "@type": "Rating", ratingValue: 5 }, datePublished: "2026-10-01" },
  Breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Books", item: "https://example.com/books" },
      { "@type": "ListItem", position: 2, item: { "@id": "https://example.com/books/sf", name: "Science fiction" } },
      { "@type": "ListItem", position: 3, name: "Award winners" },
    ],
  },
  Organization: { "@type": "Organization", name: "Acme", url: "https://example.com/", logo: "https://example.com/logo.png", sameAs: ["https://www.linkedin.com/company/acme"], description: "d" },
  "Local business": {
    "@type": "Restaurant", name: "Dosa Place", url: "https://example.com/", logo: "https://example.com/logo.png", sameAs: "https://www.instagram.com/dosa", description: "d",
    address: ADDRESS, telephone: "+91-20-5555-0100", geo: { "@type": "GeoCoordinates", latitude: 18.52043, longitude: 73.85674 },
    openingHoursSpecification: { "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "11:00", closes: "22:00" }, priceRange: "$$",
  },
  Event: {
    "@type": "MusicEvent", name: "Concert", startDate: "2027-01-10T19:00+05:30", endDate: "2027-01-10T22:00+05:30", eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: "Hall", address: ADDRESS }, image: [IMG], description: "d",
    offers: { "@type": "Offer", price: 30, priceCurrency: "USD", availability: "https://schema.org/InStock", url: "https://example.com/tickets", validFrom: "2026-11-01T10:00+05:30" },
    organizer: { "@type": "Organization", name: "Acme", url: "https://example.com/" }, performer: { "@type": "PerformingGroup", name: "Band" },
  },
  Recipe: {
    "@type": "Recipe", name: "Dal", image: [IMG], aggregateRating: RATING, author: PERSON, cookTime: "PT30M", prepTime: "PT10M", totalTime: "PT40M",
    datePublished: "2026-01-05", description: "d", keywords: "lentils", nutrition: { "@type": "NutritionInformation", calories: "250 calories" },
    recipeCategory: "Main", recipeCuisine: "Indian", recipeIngredient: ["1 cup lentils"], recipeInstructions: [{ "@type": "HowToStep", text: "Cook." }], recipeYield: "4",
    video: { "@type": "VideoObject", name: "Dal", thumbnailUrl: IMG, uploadDate: "2026-01-05T10:00:00+05:30", description: "d", duration: "PT2M", contentUrl: "https://example.com/dal.mp4" },
  },
  Video: { "@type": "VideoObject", name: "v", thumbnailUrl: [IMG], uploadDate: "2026-01-05T10:00:00Z", description: "d", duration: "PT1M54S", embedUrl: "https://example.com/embed/1" },
  "Job posting": {
    "@type": "JobPosting", title: "Software engineer", description: "<p>Build things.</p>", datePosted: "2026-11-01", validThrough: "2026-12-31T00:00",
    hiringOrganization: { "@type": "Organization", name: "Acme", sameAs: "https://example.com/" }, jobLocation: { "@type": "Place", address: ADDRESS },
    employmentType: "FULL_TIME", identifier: { "@type": "PropertyValue", name: "Acme", value: "1234" }, directApply: true,
    baseSalary: { "@type": "MonetaryAmount", currency: "INR", value: { "@type": "QuantitativeValue", value: 1500000, unitText: "YEAR" } },
  },
  "Software app": { "@type": "MobileApplication", name: "App", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }, aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, ratingCount: 8864 }, applicationCategory: "GameApplication", operatingSystem: "ANDROID" },
  "Movie carousel": { "@type": "Movie", name: "Film", image: IMG, aggregateRating: RATING, dateCreated: "2024-05-01", director: { "@type": "Person", name: "D" }, review: REVIEW },
  "Course list": { "@type": "Course", name: "Intro to CS", description: "d", provider: { "@type": "Organization", name: "Uni", sameAs: "https://example.edu/" } },
  "Profile page": { "@type": "ProfilePage", dateCreated: "2024-12-23T12:34:00-05:00", dateModified: "2024-12-26T14:53:00-05:00", mainEntity: { "@type": "Person", name: "Asha", image: IMG, sameAs: ["https://example.com/asha"], description: "Editor" } },
  "Discussion forum": { "@type": "DiscussionForumPosting", headline: "Q", text: "Body", url: "https://example.com/t/1", author: PERSON, datePublished: "2026-03-01T08:34:34+02:00" },
  "Q&A": {
    "@type": "QAPage",
    mainEntity: {
      "@type": "Question", name: "How?", text: "How do I?", answerCount: 1, author: PERSON, datePublished: "2026-01-01",
      acceptedAnswer: { "@type": "Answer", text: "Like this.", author: PERSON, url: "https://example.com/q/1#a1", datePublished: "2026-01-02", upvoteCount: 3 },
    },
  },
  "Employer aggregate rating": { "@type": "EmployerAggregateRating", itemReviewed: { "@type": "Organization", name: "Acme" }, ratingValue: 91, bestRating: 100, worstRating: 1, ratingCount: 10561 },
};

function ld(node: Record<string, unknown>): StructuredDataResult {
  return validateStructuredData(JSON.stringify({ "@context": "https://schema.org", ...node }, null, 2));
}

function errors(result: StructuredDataResult): string[] {
  return result.findings.filter((f) => f.severity === "error").map((f) => `${f.path}: ${f.message}`);
}

describe("the rule table", () => {
  test("every entry names its Google source and the date it was checked", () => {
    for (const entry of RICH_RESULT_TYPES) {
      assert.match(entry.source, /^https:\/\/developers\.google\.com\/search\//, entry.feature);
      assert.match(entry.checked, /^\d{4}-\d{2}-\d{2}$/, entry.feature);
      assert.ok(entry.types.length > 0, entry.feature);
      assert.ok(entry.deprecated || entry.required?.length || entry.recommended?.length, entry.feature);
    }
  });

  test("no type is listed twice in one entry", () => {
    for (const entry of RICH_RESULT_TYPES) assert.equal(new Set(entry.types).size, entry.types.length, entry.feature);
  });

  test("every supported feature has an example below", () => {
    const features = new Set(RICH_RESULT_TYPES.filter((e) => !e.deprecated).map((e) => e.feature));
    features.delete("Merchant listing"); // covered by the Product snippet example
    assert.deepEqual([...features].sort(), Object.keys(EXAMPLES).sort());
  });
});

describe("complete examples pass", () => {
  for (const [feature, example] of Object.entries(EXAMPLES)) {
    test(feature, () => {
      const r = ld(example);
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings, null, 2));
      assert.ok(r.entities[0].richResults.includes(feature), JSON.stringify(r.entities[0]));
    });
  }
});

describe("dropping a required property is an error", () => {
  for (const entry of RICH_RESULT_TYPES) {
    const example = EXAMPLES[entry.feature];
    // The standalone AggregateRating entry shares the "Review snippet" name; it has its own test below.
    if (!example || !entry.required?.length || !entry.types.includes(example["@type"] as string)) continue;
    const top = entry.required.filter((r) => !r.includes(".") && !r.includes("|"));
    for (const property of top) {
      test(`${entry.feature} without ${property}`, () => {
        const { [property]: _dropped, ...rest } = example;
        const r = ld(rest);
        assert.ok(
          r.findings.some((f) => f.rule === "property-required" && f.path === `$.${property}` && f.message.includes(entry.feature)),
          JSON.stringify(r.findings, null, 2),
        );
        assert.equal(r.valid, false);
      });
    }
  }
});

describe("type-specific rules", () => {
  test("Article subtypes and BlogPosting match Article", () => {
    for (const type of ["Article", "BlogPosting", "ReportageNewsArticle", "TechArticle"]) {
      assert.deepEqual(ld({ ...EXAMPLES.Article, "@type": type }).entities[0].richResults, ["Article"], type);
    }
  });

  test("Article has no required properties, only recommended ones", () => {
    const r = ld({ "@type": "Article" });
    assert.equal(r.valid, true);
    assert.deepEqual(r.findings.map((f) => f.path), ["$.author", "$.datePublished", "$.dateModified", "$.headline", "$.image"]);
    assert.ok(r.findings.every((f) => f.rule === "property-recommended"));
  });

  test("author.sameAs satisfies author.url", () => {
    const r = ld({ ...EXAMPLES.Article, author: { "@type": "Person", name: "A", sameAs: "https://example.com/a" } });
    assert.deepEqual(r.findings, []);
  });

  test("a Product without offers is checked as a product snippet only", () => {
    const { offers: _offers, ...rest } = EXAMPLES["Product snippet"];
    const r = ld({ ...rest });
    assert.deepEqual(r.entities[0].richResults, ["Product snippet"]);
    assert.deepEqual(r.findings.map((f) => f.path), ["$.offers"]);
  });

  test("a Product with offers is also a merchant listing, which requires image and priceCurrency", () => {
    const r = ld({ "@type": "Product", name: "P", offers: { "@type": "Offer", price: 5 } });
    assert.deepEqual(r.entities[0].richResults, ["Product snippet", "Merchant listing"]);
    assert.deepEqual(errors(r), [
      '$.image: Missing "image", required for Merchant listing per Google\'s documentation.',
      '$.offers: Missing one of "priceCurrency" or "priceSpecification.priceCurrency", required for Merchant listing per Google\'s documentation.',
    ]);
  });

  test("priceSpecification can carry the price and currency", () => {
    const r = ld({ ...EXAMPLES["Product snippet"], offers: { ...(EXAMPLES["Product snippet"].offers as object), price: undefined, priceCurrency: undefined, priceSpecification: { "@type": "UnitPriceSpecification", price: 10, priceCurrency: "EUR" } } });
    assert.deepEqual(errors(r), []);
  });

  test("an AggregateOffer needs lowPrice and priceCurrency, not price", () => {
    const product = { "@type": "Product", name: "P", image: IMG, aggregateRating: RATING, offers: { "@type": "AggregateOffer", lowPrice: "10", highPrice: "20", offerCount: 3 } };
    assert.deepEqual(errors(ld(product)), ['$.offers.priceCurrency: Missing "priceCurrency", required for Product snippet and Merchant listing per Google\'s documentation.']);
  });

  test("nested reviews and ratings are checked without itemReviewed", () => {
    const r = ld({ ...EXAMPLES["Product snippet"], aggregateRating: { "@type": "AggregateRating", ratingValue: 4 }, review: { "@type": "Review", author: { "@type": "Person" }, reviewRating: { "@type": "Rating", ratingValue: 4 } } });
    assert.deepEqual(errors(r), [
      '$.aggregateRating: Missing one of "ratingCount" or "reviewCount", required for Product snippet per Google\'s documentation.',
      '$.review.author.name: Missing "author.name", required for Product snippet per Google\'s documentation.',
    ]);
  });

  test("a standalone AggregateRating needs itemReviewed", () => {
    const r = ld({ "@type": "AggregateRating", ratingValue: 4, ratingCount: 3 });
    assert.deepEqual(errors(r), ['$.itemReviewed: Missing "itemReviewed", required for Review snippet per Google\'s documentation.']);
  });

  test("breadcrumbs: item may be left out on the last element only", () => {
    const list = EXAMPLES.Breadcrumb.itemListElement as Record<string, unknown>[];
    const r = ld({ "@type": "BreadcrumbList", itemListElement: [{ ...list[0], item: undefined }, list[1], list[2]] });
    assert.deepEqual(errors(r), ['$.itemListElement[0].item: Missing "item", required for Breadcrumb per Google\'s documentation.']);
  });

  test("breadcrumbs: name may come from the item", () => {
    const r = ld({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, item: "https://example.com/a" }, { "@type": "ListItem", position: 2, name: "b" }] });
    assert.deepEqual(errors(r), ['$.itemListElement[0]: Missing one of "name" or "item.name", required for Breadcrumb per Google\'s documentation.']);
  });

  test("breadcrumbs: at least two items, positions are whole numbers", () => {
    const r = ld({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: "first", name: "a" }] });
    assert.deepEqual(r.findings.map((f) => f.rule).sort(), ["integer-invalid", "list-too-short"]);
    assert.equal(r.findings.find((f) => f.rule === "integer-invalid")?.severity, "error");
  });

  test("breadcrumbs nested in a WebPage are checked", () => {
    const r = ld({ "@type": "WebPage", breadcrumb: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "a" }] } });
    assert.deepEqual(r.entities[1].richResults, ["Breadcrumb"]);
    assert.equal(r.findings[0].rule, "list-too-short");
  });

  test("LocalBusiness subtypes are also Organizations", () => {
    assert.deepEqual(ld(EXAMPLES["Local business"]).entities[0].richResults, ["Organization", "Local business"]);
  });

  test("a LocalBusiness address as plain text lacks the PostalAddress fields", () => {
    const r = ld({ ...EXAMPLES["Local business"], address: "1 Main St, Pune" });
    assert.equal(r.valid, true);
    assert.ok(r.findings.some((f) => f.path === "$.address.streetAddress" && f.rule === "property-recommended"));
  });

  test("geo latitude and longitude are recommended, not required", () => {
    const r = ld({ ...EXAMPLES["Local business"], geo: { "@type": "GeoCoordinates" } });
    assert.equal(r.valid, true);
    assert.deepEqual(r.findings.map((f) => `${f.rule} ${f.path}`), ["property-recommended $.geo.latitude", "property-recommended $.geo.longitude"]);
  });

  test("an Event needs a location with an address", () => {
    const r = ld({ ...EXAMPLES.Event, location: { "@type": "Place", name: "Hall" } });
    assert.deepEqual(errors(r), ['$.location.address: Missing "location.address", required for Event per Google\'s documentation.']);
  });

  test("Recipe times must be ISO 8601 durations, and a bad one on a recommended property is a warning", () => {
    const r = ld({ ...EXAMPLES.Recipe, cookTime: "30 min" });
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].rule, "duration-invalid");
    assert.equal(r.findings[0].severity, "warning");
  });

  test("a VideoObject's uploadDate is required, so a bad date is an error", () => {
    const r = ld({ ...EXAMPLES.Video, uploadDate: "05/01/2026" });
    assert.equal(r.findings[0].rule, "date-invalid");
    assert.equal(r.findings[0].severity, "error");
  });

  test("a remote job can replace jobLocation with applicantLocationRequirements", () => {
    const { jobLocation: _jobLocation, ...rest } = EXAMPLES["Job posting"];
    const remote = { ...rest, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "IN" } };
    assert.deepEqual(ld(remote).findings, []);
    assert.deepEqual(errors(ld(rest)), ['$: Missing one of "jobLocation" or "applicantLocationRequirements", required for Job posting per Google\'s documentation.']);
  });

  test("a job location needs addressCountry", () => {
    const r = ld({ ...EXAMPLES["Job posting"], jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Pune" } } });
    assert.deepEqual(errors(r), ['$.jobLocation.address.addressCountry: Missing "jobLocation.address.addressCountry", required for Job posting per Google\'s documentation.']);
  });

  test("a software app needs a rating or a review, and an offer price", () => {
    const r = ld({ "@type": "SoftwareApplication", name: "App", offers: { "@type": "Offer" }, applicationCategory: "GameApplication", operatingSystem: "iOS" });
    assert.deepEqual(errors(r), [
      '$: Missing one of "aggregateRating" or "review", required for Software app per Google\'s documentation.',
      '$.offers.price: Missing "price", required for Software app per Google\'s documentation.',
    ]);
  });

  test("a profile's main entity needs a name or alternateName", () => {
    const r = ld({ ...EXAMPLES["Profile page"], mainEntity: { "@type": "Person", alternateName: "@asha", image: IMG, sameAs: "https://example.com", description: "d" } });
    assert.deepEqual(r.findings, []);
  });

  test("a Q&A question needs an answer and each answer needs text", () => {
    const r = ld({ "@type": "QAPage", mainEntity: { "@type": "Question", name: "q", answerCount: 1, text: "t", author: PERSON, datePublished: "2026-01-01", suggestedAnswer: [{ "@type": "Answer", author: PERSON, url: "https://example.com/a", datePublished: "2026-01-01" }] } });
    assert.deepEqual(errors(r), ['$.mainEntity.suggestedAnswer[0].text: Missing "text", required for Q&A per Google\'s documentation.']);
  });

  test("a discussion post needs text, an image, a video or a url", () => {
    const { text: _text, url: _url, ...rest } = EXAMPLES["Discussion forum"];
    assert.match(errors(ld(rest))[0], /Missing one of "text", "image", "video" or "url"/);
  });

  for (const type of ["FAQPage", "HowTo", "ClaimReview", "SpecialAnnouncement", "Dataset"]) {
    test(`${type} is reported as deprecated`, () => {
      const r = ld({ "@type": type, name: "x" });
      assert.equal(r.findings.length, 1);
      assert.equal(r.findings[0].rule, "type-deprecated");
    });
  }
});
