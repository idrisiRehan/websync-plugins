# schemaview

Check the JSON-LD structured data in a web page against schema.org basics and the properties
Google's documentation lists for each rich result, offline, with a line number and a
JSONPath for every problem.

```text
$ npx schemaview examples/product-with-problems.html
examples/product-with-problems.html: HTML, 2 JSON-LD blocks, 8 typed nodes
  Product (line 7): Product snippet, Merchant listing
  BreadcrumbList (line 36): Breadcrumb
WARN   property-recommended (line 7, $.review)
       Missing "review", recommended for Product snippet per Google's documentation.
WARN   url-relative (line 11, $.image)
       image "/images/trail-runner-2.jpg" is relative. Google's documentation asks for absolute URLs.
ERROR  rating-invalid (line 19, $.aggregateRating.ratingValue)
       ratingValue 8.7 is outside 1-5 (when omitted, bestRating is 5 and worstRating is 1).
ERROR  price-invalid (line 25, $.offers.price)
       price "$89.99" includes a currency. Put only the number in price (for example 19.99) and the currency in priceCurrency.
ERROR  currency-invalid (line 26, $.offers.priceCurrency)
       priceCurrency "usd" isn't an ISO 4217 currency code (three capital letters, for example USD or EUR).
WARN   date-invalid (line 27, $.offers.priceValidUntil)
       priceValidUntil "31/12/2026" isn't an ISO 8601 date (for example 2026-11-24 or 2026-11-24T09:30:00+05:30).
ERROR  property-required (line 41, $.itemListElement[1].item)
       Missing "item", required for Breadcrumb per Google's documentation.

4 errors, 3 warnings
```

A single stray comma makes search engines ignore a whole script. The line number is counted
from the top of the page, not the top of the script:

```text
$ npx schemaview - < page.html
stdin: HTML, 1 JSON-LD block, 0 typed nodes
ERROR  json-invalid (line 10)
       Invalid JSON: Trailing comma before "}". JSON doesn't allow one. Search engines ignore the whole script.

1 error, 0 warnings
```

- **Rich-result rules as data.** Required and recommended properties for 19 Google rich-result
  types live in one table, each entry with its Search Central source and the date it was
  checked. Deprecated features (FAQ, How-to, Fact check and others) are reported as such.
- **Structure and values.** Invalid JSON, `@context`, `@type`, `@graph`, nested and referenced
  nodes, conflicting `@id`s, ISO 8601 dates and durations, absolute URLs, prices, currency
  codes, availability and rating bounds.
- **HTML or JSON-LD.** Give it a page and it reads every `<script type="application/ld+json">`.
  Give it a `.jsonld` file and it checks that.
- **CLI for builds and CI.** Reads files, stdin and URLs. Exits 1 on errors, and on warnings
  too with `--max-warnings`. One dependency: [metacheck](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/metacheck)'s
  HTML tokenizer.

It is not Google's validator and can't promise a rich result: Google also weighs content,
policy and quality. Use the [Rich Results Test](https://search.google.com/test/rich-results)
for the final word.

## Install

```sh
npm install schemaview
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
schemaview <file | url | -> [options]

  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version
```

```sh
npx schemaview dist/products/trail-runner/index.html
npx schemaview https://example.com/products/trail-runner --max-warnings 0
npx schemaview data/organization.jsonld
curl -s https://example.com/ | npx schemaview -
```

URLs are fetched with GET, following redirects, and relative URLs in the markup are resolved
against the final URL in messages. Empty input, and input over 10 MB, is refused with exit code 2.

### In a build

```json
{
  "scripts": {
    "postbuild": "schemaview dist/index.html"
  }
}
```

```yaml
- name: Check structured data
  run: npx --yes schemaview@1 dist/products/index.html
```

## Library

```ts
import { validateStructuredData } from "schemaview";

const result = validateStructuredData(html, { url: "https://example.com/p/1" });

result.valid;      // true when there are no errors
result.findings;   // [{ rule, severity, message, line, path }]
result.entities;   // [{ types, id, line, path, richResults }]
```

```ts
function validateStructuredData(input: string, options?: ValidateOptions): StructuredDataResult;

interface ValidateOptions {
  /** The page's URL. Relative URLs in the markup are resolved against it in messages. */
  url?: string;
}

interface StructuredDataResult {
  valid: boolean;               // no errors (warnings allowed)
  format: "html" | "json";      // how the input was read
  blockCount: number;           // JSON-LD scripts found, or 1 for raw JSON
  entities: StructuredDataEntity[];
  findings: StructuredDataFinding[];
  errorCount: number;
  warningCount: number;
}

interface StructuredDataFinding {
  rule: RuleId;
  severity: "error" | "warning";
  message: string;
  line: number | null;          // 1-based line in the input
  path: string | null;          // JSONPath inside the block, for example $.offers.price
}

interface StructuredDataEntity {
  types: string[];              // @type values without a schema.org prefix
  id: string | null;            // @id
  line: number;
  path: string;
  richResults: string[];        // features checked against it, for example ["Product snippet", "Merchant listing"]
}
```

Input that starts with `{` or `[` (after whitespace or a BOM) is read as JSON-LD; anything else
as HTML. The function is pure: no network, no filesystem. An invalid `options.url` throws a
`TypeError`. The rule table is exported as `RICH_RESULT_TYPES`.

### Reading Product data

`readProducts()` returns the Product and Offer data in the JSON-LD as values, for tools that
compare it with something else, such as
[feed-page-check](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/feed-page-check),
which compares it with a product feed. It uses the same JSON-LD reading as
`validateStructuredData()` (every script, `@graph`, `@id` references across scripts, nodes
merged by `@id`) and checks nothing.

```ts
import { readProducts } from "schemaview";

const { products } = readProducts(html);
products[0].offers[0]; // { types: ["Offer"], price: "12.00", priceCurrency: "USD", availability: "InStock", ... }
```

```ts
function readProducts(input: string): ProductsResult;

interface ProductsResult {
  format: "html" | "json";
  blockCount: number;
  unreadableBlockCount: number; // empty or invalid JSON scripts, which search engines ignore
  otherSyntax: boolean;         // Microdata or RDFa attributes are present (not read)
  products: ProductData[];      // every Product, ProductGroup or Product subtype, in document order
}

interface ProductData {
  types: string[]; id: string | null; name: string | null;
  sku: string | null; gtins: string[]; mpn: string | null; url: string | null;
  productGroupID: string | null; // a group's productGroupID, or a variant's group ID
  group: { id: string | null; productGroupID: string | null; line: number; path: string } | null;
  offers: OfferData[];          // an AggregateOffer's own offers follow it
  line: number; path: string;
}

interface OfferData {
  types: string[];              // ["Offer"], ["AggregateOffer"]
  price: string | null;         // as written; a JSON number in its shortest form (18.00 is "18")
  priceCurrency: string | null;
  lowPrice: string | null; highPrice: string | null;
  availability: string | null;  // without the schema.org prefix: "InStock"
  priceSpecifications: { types: string[]; price: string | null; priceCurrency: string | null;
    priceType: string | null; memberPrice: boolean; // validForMemberTier is set
    validFrom: string | null; validThrough: string | null; line: number; path: string }[];
  url: string | null; sku: string | null; gtins: string[]; mpn: string | null;
  validFrom: string | null; validThrough: string | null; priceValidUntil: string | null;
  line: number; path: string;
}
```

Variants are products too: a `ProductGroup`'s `hasVariant` entries, and products that point to
their group with `isVariantOf`, carry that group in `group`. Products under `isRelatedTo`,
`isSimilarTo`, `isAccessoryOrSparePartFor`, `isConsumableFor` or an offer's `itemOffered` are
other products, so they aren't listed. Never throws.

## Supported rich results

Data checked against Google Search Central on **2026-11-24** (Product variants on
**2026-11-25**). A dotted name like `author.name` is a nested property; "a or b" means at least
one of them. Nested rows apply to each value of that property.

| Feature | Types | Required | Recommended |
|---|---|---|---|
| [Article](https://developers.google.com/search/docs/appearance/structured-data/article) | `Article`, `NewsArticle`, `BlogPosting` and 12 more subtypes | none | `author`, `author.name`, `author.url` or `author.sameAs`, `datePublished`, `dateModified`, `headline`, `image` |
| [Product snippet](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) | `Product` | `name`, `review` or `aggregateRating` or `offers` | `aggregateRating`, `offers`, `review` |
| | `offers` (Offer) | `price` or `priceSpecification.price` | `availability`, `priceCurrency`, `priceValidUntil` |
| | `offers` (AggregateOffer) | `lowPrice`, `priceCurrency` | `highPrice`, `offerCount` |
| | `aggregateRating` | `ratingValue`, `ratingCount` or `reviewCount` | |
| | `review` | `author`, `author.name`, `reviewRating`, `reviewRating.ratingValue` | `datePublished` |
| [Merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing) | `Product` with `offers` | `name`, `image`, `offers` | `description`, `brand.name`, a GTIN (`gtin`, `gtin8`, `gtin12`, `gtin13`, `gtin14` or `isbn`), `mpn`, `sku` |
| | `offers` (Offer) | `price`, `priceCurrency` (or in `priceSpecification`) | `availability`, `itemCondition`, `shippingDetails`, `hasMerchantReturnPolicy` |
| | `offers` (AggregateOffer) | not eligible: reported as `type-ineligible`, because the merchant must be the seller | |
| [Product variants](https://developers.google.com/search/docs/appearance/structured-data/product-variants) | `ProductGroup` | `name` | `aggregateRating`, `brand`, `brand.name`, `description`, `hasVariant`, `productGroupID`, `review`, `variesBy` |
| | `hasVariant` (Product) | each variant is checked as a Product: the Product snippet and Merchant listing rows above. `aggregateRating`, `brand` and `review` may come from the group | |
| [Review snippet](https://developers.google.com/search/docs/appearance/structured-data/review-snippet) | `Review` | `author`, `author.name`, `reviewRating`, `reviewRating.ratingValue`, `itemReviewed`, `itemReviewed.name` | `datePublished` |
| | `AggregateRating` | `ratingValue`, `ratingCount` or `reviewCount`, `itemReviewed`, `itemReviewed.name` | |
| [Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) | `BreadcrumbList` (at any depth) | `itemListElement` (at least 2) | |
| | `itemListElement` | `position`, `name` or `item.name`, `item` (except on the last item) | |
| [Organization](https://developers.google.com/search/docs/appearance/structured-data/organization) | `Organization`, its common subtypes and every `LocalBusiness` type listed below | none | `name`, `url`, `logo`, `sameAs`, `description` |
| [Local business](https://developers.google.com/search/docs/appearance/structured-data/local-business) | `LocalBusiness`, `Restaurant`, `Store`, `Hotel` and 123 more subtypes | `name`, `address` | `url`, `telephone`, `geo`, `openingHoursSpecification`, `priceRange` |
| | `address` | | `streetAddress`, `addressLocality`, `addressRegion`, `postalCode`, `addressCountry` |
| | `geo` | | `latitude`, `longitude` |
| [Event](https://developers.google.com/search/docs/appearance/structured-data/event) | `Event` and 18 subtypes | `name`, `startDate`, `location`, `location.address` | `location.name`, `endDate`, `eventStatus`, `image`, `description`, `offers`, `organizer`, `organizer.name`, `organizer.url`, `performer`, `performer.name` |
| | `offers` | | `price`, `priceCurrency`, `availability`, `url`, `validFrom` |
| [Recipe](https://developers.google.com/search/docs/appearance/structured-data/recipe) | `Recipe` | `name`, `image` | `aggregateRating`, `author`, `cookTime`, `datePublished`, `description`, `keywords`, `nutrition.calories`, `prepTime`, `recipeCategory`, `recipeCuisine`, `recipeIngredient`, `recipeInstructions`, `recipeYield`, `totalTime`, `video` |
| [Video](https://developers.google.com/search/docs/appearance/structured-data/video) | `VideoObject` (at any depth) | `name`, `thumbnailUrl`, `uploadDate` | `description`, `duration`, `contentUrl` or `embedUrl` |
| [Job posting](https://developers.google.com/search/docs/appearance/structured-data/job-posting) | `JobPosting` | `title`, `description`, `datePosted`, `hiringOrganization`, `hiringOrganization.name`, `jobLocation` or `applicantLocationRequirements`, `jobLocation.address.addressCountry` | `validThrough`, `employmentType`, `baseSalary`, `identifier`, `directApply` |
| [Software app](https://developers.google.com/search/docs/appearance/structured-data/software-app) | `SoftwareApplication`, `MobileApplication`, `WebApplication` | `name`, `offers`, `offers.price`, `aggregateRating` or `review` | `applicationCategory`, `operatingSystem`, `offers.priceCurrency` |
| [Movie carousel](https://developers.google.com/search/docs/appearance/structured-data/movie) | `Movie` | `name`, `image` | `aggregateRating`, `dateCreated`, `director`, `review` |
| [Course list](https://developers.google.com/search/docs/appearance/structured-data/course) | `Course` | `name`, `description` | `provider` |
| [Profile page](https://developers.google.com/search/docs/appearance/structured-data/profile-page) | `ProfilePage` | `mainEntity`, `mainEntity.name` or `mainEntity.alternateName` | `dateCreated`, `dateModified`, `mainEntity.image`, `mainEntity.sameAs`, `mainEntity.description` |
| [Discussion forum](https://developers.google.com/search/docs/appearance/structured-data/discussion-forum) | `DiscussionForumPosting`, `SocialMediaPosting` | `author`, `author.name`, `datePublished`, `text` or `image` or `video` or `url` | `author.url`, `url` |
| [Q&A](https://developers.google.com/search/docs/appearance/structured-data/qapage) | `QAPage` | `mainEntity` with `name`, `answerCount`, `acceptedAnswer` or `suggestedAnswer`; each answer's `text` | question `text`, `author`, `datePublished`; answer `author`, `url`, `datePublished` |
| [Employer aggregate rating](https://developers.google.com/search/docs/appearance/structured-data/employer-rating) | `EmployerAggregateRating` | `itemReviewed`, `ratingValue`, `ratingCount` or `reviewCount` | |

Ratings nested in other types (Product variants, Recipe, Software app, Movie) use the same `aggregateRating` and
`review` rules as Product. `bestRating` and `worstRating` aren't flagged when missing, because
Google assumes 5 and 1; `ratingValue` is checked against those bounds instead.

Recommended lists keep what applies to most pages. Situational properties (`expires`,
`regionsAllowed`, variant attributes like `color` and `size`, identifiers like `duns` or
`naics`, a ProductGroup's single-page `url` and `hasAdultConsideration`) are left out so a
typical page isn't buried in warnings.

Rich results are matched on top-level nodes, `@graph` nodes, `mainEntity` values, `ItemList`
items and a top-level `ProductGroup`'s `hasVariant` products, plus `VideoObject` and
`BreadcrumbList` at any depth. A Product nested in an article's `about` isn't checked as a
product page. `@id` references are followed when they
point at a node defined elsewhere on the page, and nodes that share an `@id` are merged.

**No longer shown by Google** (reported as `type-deprecated`, not checked further):

| Type | Status | Source |
|---|---|---|
| `FAQPage` | Stopped 7 May 2026, documentation removed 15 June 2026 | [Search Central updates](https://developers.google.com/search/updates) |
| `HowTo` | Retired on desktop and mobile in September 2023 | [Search Central updates](https://developers.google.com/search/updates) |
| `ClaimReview` | Being phased out of Search (announced June 2025); Fact Check Explorer still reads it | [Fact check](https://developers.google.com/search/docs/appearance/structured-data/factcheck) |
| `SpecialAnnouncement` | Stopped 31 July 2025 | [Search Central updates](https://developers.google.com/search/updates) |
| `Dataset` | Phased out of Search in November 2025; Dataset Search still reads it | [Search Central updates](https://developers.google.com/search/updates) |

## Rules

| Rule | Severity | Meaning |
|---|---|---|
| `jsonld-missing` | warning | HTML without any JSON-LD script |
| `script-empty` | warning | A JSON-LD script with nothing in it |
| `json-invalid` | error | Not valid JSON (trailing comma, single quotes, comment, raw line break in a string, ...) |
| `json-duplicate-key` | warning | The same key twice in one object. Only the last value counts |
| `root-invalid` | error | The JSON isn't an object or an array of objects |
| `context-missing` | error | A top-level node has no `@context` |
| `context-invalid` | error or warning | `@context` isn't schema.org (http or https, with or without `/`, as a string, `@vocab` or in an array). A warning for `www.schema.org`, which serves the same JSON-LD context but isn't the documented form |
| `type-missing` | error | A top-level or `@graph` node with properties but no `@type` |
| `type-invalid` | error | `@type` isn't a type name or an array of them |
| `id-conflict` | warning | Two nodes share an `@id` but give the same property different values |
| `type-deprecated` | warning | A type whose rich result Google no longer shows |
| `type-ineligible` | warning | A value type the feature doesn't accept, such as an `AggregateOffer` for merchant listings |
| `property-required` | error | A property Google's documentation requires for a matched feature is missing |
| `property-recommended` | warning | A property Google's documentation recommends is missing |
| `list-too-short` | error | Fewer items than the feature needs (a breadcrumb trail of one) |
| `date-invalid` | error or warning | Not an ISO 8601 date or date-time, or an impossible one |
| `duration-invalid` | error or warning | Not an ISO 8601 duration; `P30M` (30 months) is flagged as a likely `PT30M` |
| `url-invalid` | error or warning | `url`, `image`, `logo`, `thumbnailUrl`, `contentUrl`, `embedUrl`, `sameAs`, `item` or `menu` isn't an http(s) URL |
| `url-relative` | warning | One of those is a relative URL |
| `price-invalid` | error or warning | `price`, `lowPrice` or `highPrice` isn't a plain number, or includes a currency |
| `currency-invalid` | error or warning | `priceCurrency` isn't three capital letters (ISO 4217) |
| `integer-invalid` | error or warning | A count or `position` isn't a whole number |
| `rating-invalid` | error or warning | `ratingValue` isn't a number, or is outside `worstRating`-`bestRating` |
| `enum-invalid` | error or warning | `availability`, `itemCondition`, `eventStatus` or `employmentType` isn't an allowed value |

Value rules are errors when the value fills a property that a matched feature requires (an
Offer's `price`, an Event's `startDate`), and warnings otherwise. Dates checked:
`datePublished`, `dateModified`, `dateCreated`, `datePosted`, `uploadDate`, `startDate`,
`endDate`, `previousStartDate`, `validFrom`, `validThrough`, `priceValidUntil`, `expires`,
`foundingDate`. Durations: `duration`, `cookTime`, `prepTime`, `totalTime`.

## JSON output

`--json` prints the library result with a `source` field:

```json
{
  "source": "examples/product-with-problems.html",
  "valid": false,
  "format": "html",
  "blockCount": 2,
  "entities": [
    { "types": ["Product"], "id": null, "line": 7, "path": "$", "richResults": ["Product snippet", "Merchant listing"] }
  ],
  "findings": [
    { "rule": "price-invalid", "severity": "error", "message": "price \"$89.99\" includes a currency. ...", "line": 25, "path": "$.offers.price" }
  ],
  "errorCount": 4,
  "warningCount": 3
}
```

(Shortened: the real output lists every entity, nested ones included, and every finding.)

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors (and no more warnings than `--max-warnings`) |
| `1` | Errors, or more warnings than `--max-warnings` |
| `2` | Usage error, unreadable or empty input, input over 10 MB, HTTP error status, timeout or network error |

## Limitations

- **Google changes its requirements.** The table was checked against Search Central on
  2026-11-24. Features get added, limited and retired; check the linked pages when a result
  matters, and expect updates to this package.
- **JSON-LD only.** Microdata and RDFa aren't read. A page that only uses them gets
  `jsonld-missing`, with a note when their attributes are present.
- **Not Google's validator.** Passing doesn't guarantee a rich result, and the Rich Results
  Test may report things this package doesn't, such as image sizes, content policies, or
  whether the markup matches what the page shows.
- **No schema.org vocabulary check.** Unknown types and properties (typos like `Prodcut`)
  aren't flagged; such a node simply matches no rich result, which `entities` shows.
- **Variant links are read one way for recommendations.** A `ProductGroup` is asked for
  `hasVariant` and `productGroupID` even when its variants point to it with `isVariantOf` and
  `inProductGroupWithID` instead, which Google also accepts. Variants take only `brand`,
  `aggregateRating` and `review` from their group.
- **Subtypes are listed, not inferred.** Common subtypes of Article, Organization,
  LocalBusiness and Event are recognised; a rare subtype outside those lists isn't checked.
- **Pages are read as served.** JSON-LD injected by JavaScript after load isn't seen, and
  the CLI decodes responses as UTF-8.

## Security

The library never touches the network or the filesystem. The CLI fetches only the URL you give
it, including `localhost`, so you can check a dev server. Don't expose the CLI as a service
that fetches URLs for other people without your own SSRF controls. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
