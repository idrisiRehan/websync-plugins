# feed-page-check

Find the products whose feed says one price or availability and whose own product page says
another. It reads a Google Merchant Center or OpenAI product feed, fetches each item's page,
reads the page's Product structured data (JSON-LD) and compares price, sale price, currency and
availability, variant by variant.

```sh
npx feed-page-check products.tsv
```

Google crawls your landing pages and compares them with your product data. Its help page for
the price version of this problem is blunt: "Prices reflected in the HTML need to match exactly
the prices uploaded in Merchant Center", and "the product with the mismatch may be disapproved"
([Mismatched product price](https://support.google.com/merchants/answer/12159029)). The same goes
for availability: "Match the availability listed in your product data with the availability
listed on your landing page and checkout pages"
([availability](https://support.google.com/merchants/answer/6324448)). AI shopping agents
read product feeds too, and a feed that disagrees with the page gives them a price the store
doesn't show.

A mismatch usually comes from a sync that ran at the wrong time, a sale that started on the site
but not in the feed (or the other way round), a variant sold out on the page, or a theme that
writes the wrong number into the structured data. feed-page-check finds them before Google does.

- **Grounded in Google's documentation.** Every rule quotes the Merchant Center Help or Search
  Central page it comes from (see [the rules](#rules)). Availability is mapped with Google's own
  table of schema.org values.
- **Exact.** Prices are compared as decimal numbers, digit by digit: `18.00 USD` in the feed equals
  `18` on the page, and nothing is lost to floating-point rounding.
- **Variant aware.** `ProductGroup` with `hasVariant`, offers arrays (Shopify's markup),
  `AggregateOffer`, `priceSpecification` with strikethrough prices, `@graph` and `@id`
  references. Each item is matched to its variant by GTIN, SKU, MPN or URL ([how](#how-items-are-matched-to-products)).
- **Honest severities.** A mismatch Google disapproves items for is an error. When the tool can't
  tell (no structured data, a price range, a page that couldn't be fetched), it's a warning that
  says so, never a mismatch.
- **Bounded.** A request budget, a timeout and a byte cap on every request, a few pages at a time,
  and no URL requested twice ([what is fetched](#what-is-fetched)).
- **Zero third-party dependencies.** It reads feeds with
  [product-feed-lint](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/product-feed-lint),
  pages with [schemaview](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/schemaview)
  and fetches them with
  [redirect-inspector](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/redirect-inspector)'s
  client on Node's built-in `fetch`, all from the same repository.

## Install

```sh
npm install feed-page-check
```

Or run it without installing: `npx feed-page-check products.tsv`. ESM only. Needs Node 22 or
later. TypeScript types are included.

## CLI

```text
feed-page-check <feed | url | -> [options]

  --target <name>       google or openai (default: google)
  --format <name>       google: tsv or xml; openai: jsonl, csv or tsv
                        (default: detected from the content)
  --limit <n>           Check the first n items (default 50, at most 10000)
  --concurrency <n>     Pages fetched at the same time (default 4, at most 16)
  --timeout <ms>        Timeout for each request in milliseconds (default 10000)
  --json                Print the report as JSON
  --max-warnings <n>    Exit with code 1 when there are more than n warnings
  -h, --help            Show this help
  -v, --version         Show the version
```

```sh
npx feed-page-check products.tsv                          # Google: tab-separated or XML
npx feed-page-check https://shop.example/feeds/google.xml --limit 200
npx feed-page-check chatgpt-feed.jsonl --target openai --json > report.json
```

The feed is read exactly as `product-feed-lint` reads it (format detection, attribute names and
aliases, UTF-8 or UTF-16), so run that first if the feed itself may be broken. The page of a
Google item is its `link`; of an OpenAI item, its `url`.

The repository's [examples](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/feed-page-check/examples)
hold a five-item feed and three product pages: a clean one, a `ProductGroup` with two sizes, and
one with the wrong price. `node examples/serve.mjs` serves them at the feed's links. This is the
output, unedited (2026-11-24):

```text
$ npx feed-page-check examples/google-feed.tsv
examples/google-feed.tsv: google, tsv, 5 items

TEE-ORG-M (row 4)
  link  http://127.0.0.1:8080/products/organic-tee?size=m (HTTP 200)
  feed  price 25.00 USD, sale_price 19.00 USD (current), availability in_stock
  page  price 25 USD, availability OutOfStock; line 33, matched: sku
  ERROR  sale-price-not-on-page (page line 33)
         The feed has a current sale_price of 19.00 USD, but the page's price is the regular price, 25 USD. Google asks for a sale_price "that matches the sale price you display on your landing page" (https://support.google.com/merchants/answer/6324471).
  ERROR  availability-mismatch (page line 33)
         The page says OutOfStock (out_of_stock), the feed in_stock. Google: "Match the availability listed in your product data with the availability listed on your landing page" (https://support.google.com/merchants/answer/6324448).

LAMP-2027 (row 5)
  link  http://127.0.0.1:8080/products/desk-lamp (HTTP 200)
  feed  price 120.00 USD, availability preorder
  page  price 129.00 USD, availability PreOrder; line 13, matched: single
  ERROR  price-mismatch (page line 13)
         The page's price is 129.00 USD; the feed's price is 120.00 USD. Google: "Prices reflected in the HTML need to match exactly the prices uploaded in Merchant Center" (https://support.google.com/merchants/answer/12159029).

KETTLE-1 (row 6)
  link  http://127.0.0.1:8080/products/kettle (HTTP 404)
  feed  price 42.00 USD, availability in_stock
  WARN   page-unavailable
         The page couldn't be fetched (HTTP 404), so it wasn't compared. Check that the link is the product's current URL.

2 items match their pages.

3 errors, 1 warning. 4 of 5 items compared with their pages. 5 requests.
```

Items that match their page are counted, not listed; `--json` lists every item. A page's line
numbers point into the HTML as served, so you can find the markup with "view source".

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors. Warnings alone don't fail, unless `--max-warnings` says so |
| `1` | At least one error, or more warnings than `--max-warnings` |
| `2` | A usage error (nothing is fetched), a feed that can't be read or has no items, a feed URL that fails, or not a single page that could be fetched |

Pages that fail individually (a 404, a timeout, bot protection) are warnings in the report, not
exit code 2: the run still tells you about the others. Errors from code 2 are one line on stderr.

### In CI

```yaml
- name: Compare the feed with the product pages
  run: npx --yes feed-page-check@1 public/feeds/google.xml --limit 100
```

## Real stores

Captured on 2026-11-24 from two public Shopify stores, unedited. The feeds are not the stores'
Merchant Center feeds, which aren't public: each is a small Google feed built that day from the
store's own public `/products.json` (each variant's SKU, link, price, compare-at price and
availability, with the compare-at price as `price` and the lower price as `sale_price`). So the
feed side is what the store's own catalog said, and the comparison shows whether the product
page's structured data says the same. Stores change, so a run today will differ.

Allbirds marks up its variants as `Product` nodes with `isVariantOf`, and each item was matched to
its variant by SKU. The page shows the sale price as $73.50, and the catalog has `73.50`, but the
page's JSON-LD says `"price": 73` for that variant:

```text
$ npx feed-page-check allbirds-feed.tsv
allbirds-feed.tsv: google, tsv, 4 items

A12336W050 (row 2)
  link  https://www.allbirds.com/products/womens-tree-breezer-warm-camel-dark?variant=41271011967056 (HTTP 200)
  feed  price 105.00 USD, sale_price 73.50 USD (current), availability in_stock
  page  price 73 USD, availability InStock; line 14815, matched: sku
  ERROR  price-mismatch (page line 14815)
         The page's price is 73 USD; the feed's sale_price is 73.50 USD. Google: "Prices reflected in the HTML need to match exactly the prices uploaded in Merchant Center" (https://support.google.com/merchants/answer/12159029).

A12336W055 (row 3)
  link  https://www.allbirds.com/products/womens-tree-breezer-warm-camel-dark?variant=41271011999824 (HTTP 200)
  feed  price 105.00 USD, sale_price 73.50 USD (current), availability in_stock
  page  price 73 USD, availability InStock; line 14834, matched: sku
  ERROR  price-mismatch (page line 14834)
         The page's price is 73 USD; the feed's sale_price is 73.50 USD. Google: "Prices reflected in the HTML need to match exactly the prices uploaded in Merchant Center" (https://support.google.com/merchants/answer/12159029).

2 items match their pages.

2 errors, 0 warnings. 4 of 4 items compared with their pages. 4 requests.
```

The two items that match are a sold-out men's shoe on sale at 105.00 USD, which the page marks
up as `105` and `OutOfStock`. Death Wish Coffee: three single-variant products, all matching:

```text
$ npx feed-page-check deathwish-feed.tsv
deathwish-feed.tsv: google, tsv, 3 items

3 items match their pages.

0 errors, 0 warnings. 3 of 3 items compared with their pages. 3 requests.
```

## What is fetched

For each of the first `--limit` items (50 by default), the item's link, if it is an absolute
`http:` or `https:` URL. Nothing else: no images, scripts, robots.txt or sitemaps.

- **Each URL at most once per run.** Items that share a link share one fetch, a fragment
  (`#reviews`) doesn't make a link different, and two links that redirect to the same page share
  the redirect target.
- **Redirects** are followed one hop at a time, at most 5 per link, and each hop is a request.
  A loop, a sixth redirect or a redirect to a non-http(s) URL is a fetch failure.
- **Request budget:** at most 3 requests per checked item (the page and two redirects on
  average), so 150 with the default limit. A link that would go over it isn't requested, and its
  item says so.
- **Concurrency:** at most `--concurrency` requests in flight (default 4).
- **Each request** has a timeout (default 10 seconds, body included) and reads at most 10 MiB of
  body while it streams, after HTTP decompression. Bodies of redirects and error pages are
  cancelled unread.
- **The feed**, when given as a URL, is fetched once with redirects followed, a timeout, and a
  100 MB cap, outside the budget.

Requests send `User-Agent: feed-page-check/<version> (+https://github.com/idrisiRehan/websync-plugins)`
and `Accept: text/html`, and no cookies.

## How items are matched to products

A page can describe several products: the variants of a `ProductGroup`, one `Offer` per variant
(Shopify's markup), a product described twice by two plugins. feed-page-check first lists the
page's candidates, then narrows them down for each item.

**Candidates.** Every `Product` node (and `ProductGroup` or Product subtype) in the page's JSON-LD,
in every script, `@graph` included, with `@id` references followed. Each of its offers is one
candidate; an `AggregateOffer` counts only when the product has no offer with a price of its own.
Products without offers (a `ProductGroup` above its variants, links to variants on other pages)
count only when no product on the page has an offer. Products under `isRelatedTo`,
`isSimilarTo`, `isAccessoryOrSparePartFor`, `isConsumableFor` or an offer's `itemOffered` are
other products and never count.

**Narrowing.** With one candidate, that is the match (`single`). Otherwise each identifier the
item has narrows the set, in this order, whenever it matches at least one candidate:

| Step | The feed's | Compared with the candidate's |
|---|---|---|
| `gtin` | `gtin` (each, if several) | `gtin`, `gtin8`, `gtin12`, `gtin13`, `gtin14` of the offer, else the product, all as 14 digits |
| `sku` | `id` (google) or `item_id` (openai) | `sku` of the offer, else the product |
| `mpn` | `mpn` | `mpn` of the offer, else the product |
| `url` | `link` or `url`, and the page's own URL | `url` of the offer, else the product, resolved against the page and without a fragment |
| `id` | `id` and `link` | the product's `@id` |
| `currency` | the price's currency | the offer's `priceCurrency` |

The first step that leaves one candidate is reported as `matchedBy`. If several are left and they
all give the same price, currency and availability, they count as one match (`identical`).
Otherwise the item gets `product-ambiguous`, a warning, and isn't compared.

**Values.** The page's current price is `Offer.price`, or else the `priceSpecification` entry
with neither a `priceType` nor a `validForMemberTier` (preferring one whose `validFrom` and
`validThrough` include today; a date without a time includes that day). The original price is
the entry marked `StrikethroughPrice` (or `ListPrice`). Member prices are neither. Google: "The
active price is required but may be nested inside a priceSpecification", "Active prices have
neither a priceType nor a validForMemberTier property", and "Price specifications containing
both of these properties are ignored"
([merchant listing structured data](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)).
So WooCommerce's `SalePrice` entry on the `AggregateOffer` of a variable product on sale is not
taken for the price of every variant.

The feed's current price is `sale_price` when there is a usable one (above zero, below `price`, in
the same currency) and, for Google, now is inside `sale_price_effective_date` if it is set. Its
dates are read as Google documents them: UTC when they have no time zone, and an end date without
a time lasts until the end of that day ("If you don't include a time, the sale price starts at
12 AM, midnight, on the start date" and "ends at 11:59 PM on the end date",
[sale_price_effective_date](https://support.google.com/merchants/answer/6324460)). OpenAI's spec
says sale dates "do not schedule price or availability changes", so they aren't read for OpenAI
feeds.

## Rules

All sources were read on 2026-11-24. The severities follow Google's documentation. OpenAI's
product feed spec has no rule about the page: it asks you to "Update current prices and
availability in your feed when they change", and says "Your live website or plugin still checks
the current offer when a customer acts" ([OpenAI commerce docs](https://developers.openai.com/commerce/llms-full.txt)).
OpenAI feeds get the same comparison, with OpenAI's availability values and sale price rules.

| Rule | Severity | When | Source |
|---|---|---|---|
| `price-mismatch` | error | The page's current price isn't the feed's current price (or is outside an `AggregateOffer` range). Messages point out a sale the feed is missing, or a sale price that isn't current yet | "Prices reflected in the HTML need to match exactly the prices uploaded in Merchant Center" ([12159029](https://support.google.com/merchants/answer/12159029)); "The price should be easy to view, and should match your product data" ([4752265](https://support.google.com/merchants/answer/4752265)) |
| `sale-price-not-on-page` | error | The feed has a current sale price, and the page shows the regular price | "Submit a value that matches the sale price you display on your landing page and at checkout"; "If you don't follow these requirements, we disapprove your product" ([6324471](https://support.google.com/merchants/answer/6324471)) |
| `currency-mismatch` | error | The page's `priceCurrency` isn't the feed price's currency. Amounts aren't compared across currencies | "Show the price in the currency of the product data" ([4752265](https://support.google.com/merchants/answer/4752265)) |
| `availability-mismatch` | error | The page's availability maps to another feed value | "Match the availability listed in your product data with the availability listed on your landing page and checkout pages" ([6324448](https://support.google.com/merchants/answer/6324448)); "A mismatch in one of these will trigger a product disapproval" ([9773127](https://support.google.com/merchants/answer/9773127)) |
| `availability-relaxed` | warning | The feed says `in_stock`, the page says preorder or backorder | Automatic item updates: "`in_stock`, `preorder`, and `backorder` are all considered compatible with `in_stock`" ([12157888](https://support.google.com/merchants/answer/12157888)); the availability attribute still asks for the same value ([6324448](https://support.google.com/merchants/answer/6324448)) |
| `original-price-mismatch` | warning | During a sale, the page's strikethrough price isn't the feed's `price` | "Clearly display both non-sale and sale prices on your landing pages" ([6324471](https://support.google.com/merchants/answer/6324471)); the strikethrough `priceType` "marks the full, original listing price" ([merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)) |
| `page-price-range` | warning | The page gives only an `AggregateOffer` range, and the feed's price is inside it | "merchant listings require an Offer" ([merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)) |
| `page-no-product` | warning | No Product in the page's JSON-LD (none, unreadable, or only Microdata or RDFa) | "Make sure the product structured data is included in the initial HTML" ([4752265](https://support.google.com/merchants/answer/4752265)) |
| `product-ambiguous` | warning | Several products or offers, none picked out by the item, and they differ | "Ideally, the landing page pre-populates to the exact variant in the feed" ([9773127](https://support.google.com/merchants/answer/9773127)) |
| `page-price-missing` | warning | The product has no offer, no price, or a price that isn't a plain number | "The active price is required" ([merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)) |
| `page-currency-missing` | warning | A price without `priceCurrency`. The amount is still compared | "`priceCurrency` is required if `price` is specified" ([merchant listing](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing)) |
| `page-availability-missing` | warning | No availability, or a value outside Google's mapping (such as `MadeToOrder`) | "Use schema.org structured data to indicate price, availability" ([4752265](https://support.google.com/merchants/answer/4752265)) |
| `feed-value-invalid` | warning | The feed's price or sale price can't be read, or `sale_price_effective_date` can't (the sale is then taken as current) | Run `product-feed-lint` for the full checks |
| `page-unavailable` | warning | CLI: the page didn't answer 2xx, timed out, was too large, redirected too often, or was over the budget | |
| `link-unusable` | warning | CLI: the item has no link, or one that isn't an absolute http(s) URL | |

**Availability mapping**, from the structured data table of the availability attribute
([6324448](https://support.google.com/merchants/answer/6324448)), with or without the
`https://schema.org/` prefix, in any letter case:

| Feed | Page (`Offer.availability`) |
|---|---|
| `in_stock` | `InStock`, `LimitedAvailability`, `OnlineOnly` |
| `out_of_stock` | `Discontinued`, `InStoreOnly`, `OutOfStock`, `SoldOut` |
| `preorder` (OpenAI: `pre_order`) | `PreOrder`, `PreSale` |
| `backorder` | `BackOrder` |

OpenAI's `unknown` "does not assert that the item is in stock", and Google's `build_to_order` is
for vehicle ads, so neither is compared.

## Library

```ts
import { checkFeedAgainstPages } from "feed-page-check";

const result = checkFeedAgainstPages(feedText, [
  { url: "https://shop.example/products/mug", html: mugPageHtml },
]);

for (const item of result.items) {
  for (const f of item.findings) console.log(item.id, f.severity, f.rule, f.message);
}
```

The library is pure and offline: you fetch the pages, it compares. Each item whose link (Google)
or url (OpenAI) matches a page's `url` (ignoring a fragment) is compared; items without a page are
left out of `items`. Each page is parsed once however many items share it, and the work is linear
in the size of the feed and the pages.

```ts
function checkFeedAgainstPages(feed: string, pages: Page[], options?: CheckOptions): FeedPageResult;

interface Page {
  url: string;               // the URL the page was requested with: an item's link
  html: string;
}

interface CheckOptions {
  target?: "google" | "openai";           // default "google"
  format?: "tsv" | "csv" | "xml" | "jsonl"; // default: detected
  now?: Date;                // when sale dates and price validity are evaluated; default now
}

interface FeedPageResult {
  target: "google" | "openai";
  format: "tsv" | "csv" | "xml" | "jsonl" | null;
  itemCount: number;         // items in the feed
  checkedCount: number;      // items that had a page: the length of items
  errorCount: number;
  warningCount: number;
  items: ItemResult[];       // in feed order
  feedFindings: FeedFinding[]; // product-feed-lint's reading problems (unreadable feed, quoting)
}

interface ItemResult {
  id: string | null;
  line: number;              // row (TSV, CSV) or line (XML, JSONL) in the feed
  link: string | null;
  feed: FeedValues;
  page: PageValues | null;   // null when no product could be matched
  findings: Finding[];
}

interface FeedValues {
  price: string | null;      // as written: "25.00 USD"
  salePrice: string | null;
  saleActive: boolean;       // whether sale_price is the current price
  availability: string | null;
}

interface PageValues {
  url: string;
  matchedBy: "single" | "gtin" | "sku" | "mpn" | "url" | "id" | "currency" | "identical";
  price: string | null;      // as written; a JSON number in its shortest form ("25")
  lowPrice: string | null;   // an AggregateOffer's range
  highPrice: string | null;
  originalPrice: string | null; // the StrikethroughPrice
  currency: string | null;
  availability: string | null;  // without the schema.org prefix: "InStock"
  line: number;              // line of the offer in the page
}

interface Finding {
  rule: RuleId;              // see the rule table
  severity: "error" | "warning";
  message: string;
  line: number | null;       // line in the page's HTML
}
```

`checkFeedAgainstPages()` never throws on bad feeds or pages. It throws a `TypeError` for
invalid arguments: `pages` that isn't an array of `{ url, html }` strings, an unknown target, a
format the target doesn't accept, or an invalid `now`.

## JSON output

`--json` prints the report: the library's fields plus the run's, and a `fetch` record on every
item.

```ts
interface Report {
  source: string;            // the file, "stdin", or the feed URL and its status
  target: "google" | "openai";
  format: "tsv" | "csv" | "xml" | "jsonl" | null;
  checkedAt: string;         // ISO 8601
  itemCount: number;
  selectedCount: number;     // the first --limit items
  checkedCount: number;      // compared with a page
  errorCount: number;
  warningCount: number;
  requestCount: number;      // page requests, redirects included
  items: (ItemResult & { fetch: FetchRecord | null })[]; // fetch is null for link-unusable
  feedFindings: FeedFinding[];
}

interface FetchRecord {
  url: string;               // the item's link
  finalUrl: string;          // after redirects
  status: number | null;     // of the last response; null when none arrived
  redirects: number;
  durationMs: number;
  bytes: number | null;      // body bytes read; null when not read
  error: string | null;      // "HTTP 404", "timed out after 10000 ms", "still redirecting after 5 redirects", ...
}
```

One item from the example run above:

```json
{
  "id": "TEE-ORG-M",
  "line": 4,
  "link": "http://127.0.0.1:8080/products/organic-tee?size=m",
  "feed": { "price": "25.00 USD", "salePrice": "19.00 USD", "saleActive": true, "availability": "in_stock" },
  "page": {
    "url": "http://127.0.0.1:8080/products/organic-tee?size=m",
    "matchedBy": "sku",
    "price": "25",
    "lowPrice": null,
    "highPrice": null,
    "originalPrice": null,
    "currency": "USD",
    "availability": "OutOfStock",
    "line": 33
  },
  "findings": [
    {
      "rule": "sale-price-not-on-page",
      "severity": "error",
      "message": "The feed has a current sale_price of 19.00 USD, but the page's price is the regular price, 25 USD. Google asks for a sale_price \"that matches the sale price you display on your landing page\" (https://support.google.com/merchants/answer/6324471).",
      "line": 33
    },
    {
      "rule": "availability-mismatch",
      "severity": "error",
      "message": "The page says OutOfStock (out_of_stock), the feed in_stock. Google: \"Match the availability listed in your product data with the availability listed on your landing page\" (https://support.google.com/merchants/answer/6324448).",
      "line": 33
    }
  ],
  "fetch": {
    "url": "http://127.0.0.1:8080/products/organic-tee?size=m",
    "finalUrl": "http://127.0.0.1:8080/products/organic-tee?size=m",
    "status": 200,
    "redirects": 0,
    "durationMs": 26,
    "bytes": 1300,
    "error": null
  }
}
```

## Security

The library never touches the network or the filesystem: it compares text you give it. The CLI
is a network tool. It fetches the links in the feed you give it, wherever they point, including
`localhost` and addresses on private networks, and follows their redirects. That is what you
want for checking your own feed against your own store or a staging server, and exactly what you
don't want behind a public endpoint: anyone could hand it a feed of internal URLs and read parts
of the answers back from the report.

- Only `http:` and `https:` URLs are requested.
- A request budget (3 per item, `--limit` items), at most 16 requests in flight, a timeout on
  every request, and each URL requested at most once per run.
- Every page body is read only up to 10 MiB while it streams, after HTTP decompression, so a
  compressed or endless response stops at the cap. The feed is capped at 100 MB.
- No cookies or credentials are sent. The `User-Agent` names the package.

**Don't expose the CLI as a service** as it is. A hosted version needs SSRF protection on every
request and every redirect (vet and pin the resolved address), a rate limit, and a time budget
for the whole run, as the repository's
[security model](https://github.com/idrisiRehan/websync-plugins/blob/main/docs/ecosystem/SECURITY-MODEL.md)
describes. To report a vulnerability, see
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md).

## Limitations

- **Structured data, not the rendered page.** feed-page-check compares the feed with the page's
  JSON-LD, which is what Google says it uses: "Google uses structured data markup to understand
  prices on your product landing pages" ([12159029](https://support.google.com/merchants/answer/12159029)).
  It doesn't read the visible price, so a page whose markup agrees with the feed but whose
  visible price doesn't will pass. Microdata and RDFa aren't read (`page-no-product` says when
  they are present).
- **JavaScript isn't run.** The page is read as the server sends it. Google: "If data on your
  website is passed dynamically with JavaScript after the page is loaded, this will trigger an
  error" ([12159029](https://support.google.com/merchants/answer/12159029)). A store that renders
  its prices or markup only with JavaScript gets `page-no-product`, which is worth fixing for
  that reason alone.
- **Bot protection, geo and currency.** A CDN or platform may answer this tool with a 403, a 429
  or a challenge page that Googlebot never sees; those are `page-unavailable` warnings, not
  mismatches. Stores that switch currency or price by the visitor's location show the price for
  where the tool runs. Google asks for pages that stay "consistent for all locations"
  ([4752265](https://support.google.com/merchants/answer/4752265)), but a mismatch found from one
  country may not be one from another.
- **A sample, not Google's verdict.** The default checks the first 50 items. Google compares
  pages it crawled at its own time, and timing alone causes many mismatches; with automatic item
  updates on, Merchant Center may also be "automatically using your landing page data to update
  your product data" ([12157888](https://support.google.com/merchants/answer/12157888)). A clean
  run doesn't guarantee approval, and a finding doesn't mean the item is disapproved yet.
- **Not checked:** shipping, tax, unit pricing, minimum order quantities, condition, regional
  prices and checkout. Prices are compared exactly; a page price with thousands separators or a
  currency symbol in `price` is reported as unreadable, not guessed at.
- **One page, one view.** A link that preselects a variant only through JavaScript, or a page
  whose markup lists only the default variant, can't be matched to the other variants' items.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
