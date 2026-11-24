# product-feed-lint

Check a product feed before you upload it: a Google Merchant Center feed (tab-separated text, or
RSS 2.0 and Atom 1.0 XML), or an OpenAI product feed for ChatGPT shopping (JSONL, CSV or TSV).
Every finding comes with the row or line, the item id, the attribute and a plain-English fix.

```text
$ npx product-feed-lint examples/google-feed-with-problems.tsv
examples/google-feed-with-problems.tsv: google, tsv, 4 items
WARN   attribute-unknown (row 1, colour)
       "colour" isn't an attribute in the Google Merchant Center spec, so it is probably ignored. Did you mean color?
ERROR  price-invalid (row 2, item MUG-350-BLUE, price)
       price: "$18.00" isn't a price. Write a number and an ISO 4217 currency code, like 15.00 USD, without currency symbols or thousands separators.
ERROR  gtin-invalid (row 2, item MUG-350-BLUE, gtin)
       gtin: "4006381333930" isn't a valid GTIN: The last digit is 0, but the GS1 check digit for the rest is 1. A digit is wrong or two are swapped.
ERROR  url-invalid (row 3, item TEE-ORG-M, link)
       link: "www.example.com/products/tee" isn't an absolute http or https URL.
WARN   sale-price-invalid (row 3, item TEE-ORG-M, sale_price)
       sale_price 29.00 USD isn't lower than price 25.00 USD. Keep the regular price in price and the lower price in sale_price.
WARN   identifier-exists-conflict (row 3, item TEE-ORG-M, identifier_exists)
       identifier_exists is "no", but the item has a gtin. Google warns when identifier_exists is set to no for a product with identifiers. Remove identifier_exists, or the identifier if it isn't the manufacturer's.
ERROR  attribute-missing (row 4, item LAMP-2027, availability_date)
       availability_date is missing. It is required when availability is preorder or backorder.
ERROR  attribute-missing (row 5, item MUG-350-BLUE, image_link)
       image_link is missing or empty. It is required for every product.
WARN   value-placeholder (row 5, item MUG-350-BLUE, brand)
       "N/A" is a placeholder, not a value. Submit the real brand, or leave it out if there is none.
ERROR  id-duplicate (row 5, item MUG-350-BLUE, id)
       Duplicate id "MUG-350-BLUE", first used on row 2. Each product needs its own id.
WARN   identifier-missing (row 5, item MUG-350-BLUE, gtin)
       No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.

6 errors, 5 warnings
```

Merchant Center reports problems hours after an upload, one product at a time. This catches the
mechanical ones first: missing required attributes, prices with currency symbols, GTINs with a
wrong check digit, preorders without a date, duplicate ids, broken URLs and variant groups that
don't line up.

- **Two targets, one engine.** Google Merchant Center and OpenAI's product feed (ChatGPT
  shopping) each have a requirements table: one entry per attribute, each naming the page it
  came from and the date it was checked. Reading, value checks, duplicates and lengths are shared.
- **Grounded in the specs.** Every rule cites Google's Merchant Center Help or OpenAI's
  product feed schema. Requirements that depend on the target country or product category are
  not guessed at (see [Limitations](#limitations)).
- **Honest severities.** An error is something the source says is required or invalid. Where the
  source says a value is truncated, ignored or dropped, the finding is a warning.
- **Offline and safe on any input.** The library never touches the network. XML is read
  without DTD processing, so external entities can't be loaded. Linear time on large feeds.

## Install

```sh
npm install product-feed-lint
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later. Its dependencies are
[`product-csv-lint`](https://www.npmjs.com/package/product-csv-lint) (the CSV reader),
[`sitemap-lint`](https://www.npmjs.com/package/sitemap-lint) (the XML reader) and
[`websync-validators`](https://www.npmjs.com/package/websync-validators) (GTIN check digits):
same maintainer, no dependencies of their own.

## CLI

```text
product-feed-lint <file | url | -> [options]

  --target <name>      google or openai (default: google)
  --format <name>      google: tsv or xml; openai: jsonl, csv or tsv
                       (default: detected from the content)
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version
```

```sh
npx product-feed-lint products.txt
npx product-feed-lint https://shop.example/feeds/google.xml --max-warnings 0
npx product-feed-lint chatgpt-feed.jsonl --target openai --json > report.json
curl -s https://shop.example/feeds/google.xml | npx product-feed-lint -
```

The format is detected from the content: XML starts with `<`, JSONL with `{`, and text files by
the delimiter in the header row. A comma-separated file given to the Google target is reported
as `delimiter-wrong`, since Merchant Center reads tab-separated text. Files are read as UTF-8, or
UTF-16 with a byte order mark. Compressed feeds (gzip, zip) must be decompressed first. URLs are
fetched with redirects followed.

Input over 100 MB is refused without being linted. Google accepts files up to 4 GB, but the whole
feed is held in memory (the text plus parsed rows or an XML tree), so the cap is what one process
lints comfortably, several hundred thousand products. Split bigger feeds.

The same for an OpenAI feed:

```text
$ npx product-feed-lint examples/openai-feed-with-problems.csv --target openai
examples/openai-feed-with-problems.csv: openai, csv, 3 items
ERROR  value-enum (row 2, item MUG-350-BLUE, availability)
       availability: "In Stock" isn't a supported value. Use one of: in_stock, out_of_stock, pre_order, backorder, unknown.
ERROR  price-invalid (row 2, item MUG-350-BLUE, price)
       price: "18.00" isn't a price. Write amount CURRENCY, like 79.99 USD: a decimal point, no thousands separators, one space and an uppercase ISO 4217 code.
ERROR  gtin-invalid (row 2, item MUG-350-BLUE, gtin)
       gtin: "4006 3813 3393 1" contains spaces or dashes. Submit the digits only.
ERROR  attribute-missing (row 3, item TRAIL-BLK-10, seller_name)
       seller_name is missing or empty. It is required for every product.
ERROR  value-invalid (row 3, item TRAIL-BLK-10, target_countries)
       target_countries: "us" must be an uppercase ISO 3166-1 alpha-2 country code, like US.
WARN   sale-price-invalid (row 3, item TRAIL-BLK-10, sale_price)
       sale_price 89.99 USD isn't lower than price 79.99 USD, so the sale isn't used. A sale price must be above zero, below price and in the same currency.
WARN   value-placeholder (row 4, item TRAIL-BLK-10B, brand)
       "n/a" is a placeholder, not a value. Submit the real brand.
WARN   variant-inconsistent (row 4, item TRAIL-BLK-10B, variant_dict)
       Item "TRAIL-BLK-10B" has the same variant options as "TRAIL-BLK-10" in group "TRAIL". Each variant needs a unique option combination.

5 errors, 3 warnings
```

The clean examples ([google-feed.tsv](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-lint/examples/google-feed.tsv),
[google-feed.xml](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-lint/examples/google-feed.xml),
[openai-feed.jsonl](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-lint/examples/openai-feed.jsonl))
pass with no findings:

```text
$ npx product-feed-lint examples/google-feed.xml
examples/google-feed.xml: google, xml, 3 items

No problems found.
```

### In CI

```yaml
- name: Lint the product feed
  run: npx --yes product-feed-lint@1 public/feeds/google.xml --max-warnings 0
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors, and no more warnings than `--max-warnings` |
| `1` | Errors, or more warnings than `--max-warnings` |
| `2` | Usage error, unreadable input (missing file, invalid UTF-8, compressed, over 100 MB), HTTP error status, timeout or network error |

Errors are printed to stderr as one line, prefixed `product-feed-lint:`.

## Library

```ts
import { lintProductFeed } from "product-feed-lint";

const result = lintProductFeed(text); // Google Merchant Center, format detected
const chatgpt = lintProductFeed(jsonl, { target: "openai" });
const forced = lintProductFeed(text, { target: "google", format: "tsv" });
```

```ts
function lintProductFeed(text: string, options?: LintOptions): ProductFeedResult;

interface LintOptions {
  target?: "google" | "openai";           // default "google"
  format?: "tsv" | "csv" | "xml" | "jsonl"; // google: tsv, xml; openai: jsonl, csv, tsv
}

interface ProductFeedResult {
  valid: boolean;                          // true when there are no errors
  target: "google" | "openai";
  format: "tsv" | "csv" | "xml" | "jsonl" | null; // null for an empty feed
  itemCount: number;
  errorCount: number;
  warningCount: number;
  findings: FeedFinding[];                 // sorted by line
}

interface FeedFinding {
  rule: RuleId;                            // see the rule table
  severity: "error" | "warning";
  message: string;
  line: number | null;                     // spreadsheet row for TSV and CSV (the header is
                                           // row 1), source line for XML and JSONL
  itemId: string | null;                   // the item's id (google) or item_id (openai)
  attribute: string | null;
}
```

`lintProductFeed()` never throws on bad feed text: malformed XML, broken quoting and invalid
JSON lines become findings. It throws a `TypeError` only for invalid options (an unknown target,
or a format the target doesn't accept), or when `text` isn't a string.

Also exported: `detectFormat(text)`, and the requirement tables `GOOGLE_ATTRIBUTES` and
`OPENAI_ATTRIBUTES` (each entry has `name`, the checks, `source` and `checked`), for tools that
want to show what is checked and why.

### Reading items

`readFeedItems()` reads a feed the way `lintProductFeed()` does (same readers, format detection
and attribute aliases) and returns the values instead of the checks, for tools that work with
the products themselves, such as
[feed-page-check](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/feed-page-check):

```ts
import { readFeedItems } from "product-feed-lint";

const { format, items, findings } = readFeedItems(text, { target: "google" });
items[0]; // { id: "MUG-1", line: 2, attributes: { id: ["MUG-1"], price: ["12.00 USD"], ... } }
```

```ts
function readFeedItems(text: string, options?: LintOptions): FeedItemsResult;

interface FeedItemsResult {
  target: "google" | "openai";
  format: "tsv" | "csv" | "xml" | "jsonl" | null; // null for an empty feed
  items: FeedItem[];
  findings: FeedFinding[];                 // reading problems only: empty or unreadable feed,
                                           // wrong format or delimiter, quoting, row widths, aliases
}

interface FeedItem {
  id: string | null;                       // id (google) or item_id (openai)
  line: number;                            // row for TSV and CSV, line for XML and JSONL
  attributes: Record<string, string[]>;    // trimmed values by documented name (aliases resolved;
                                           // Google names lower-cased, spaces as underscores);
                                           // empty values left out; null prototype
}
```

Values are as written: `readFeedItems()` doesn't check them, so run `lintProductFeed()` for that.
It throws a `TypeError` for the same invalid options as `lintProductFeed()`.

### JSON output

The CLI's `--json` output is the result with a `source` field added:

```text
$ npx product-feed-lint - --target openai --json < mug.jsonl
{
  "source": "stdin",
  "valid": false,
  "target": "openai",
  "format": "jsonl",
  "itemCount": 1,
  "errorCount": 1,
  "warningCount": 0,
  "findings": [
    {
      "rule": "price-invalid",
      "severity": "error",
      "message": "price: \"18.00\" isn't a price. Write amount CURRENCY, like 79.99 USD: a decimal point, no thousands separators, one space and an uppercase ISO 4217 code.",
      "line": 1,
      "itemId": "MUG-1",
      "attribute": "price"
    }
  ]
}
```

## Rules

Severity is fixed per rule except where the table says "per attribute": then it comes from the
attribute tables below (a value the source says is truncated or dropped is a warning).

| Rule | Severity | Targets | Meaning |
|---|---|---|---|
| `feed-unreadable` | error | both | Malformed XML (with the line), a root that isn't RSS 2.0 or Atom 1.0, RSS without `<channel>`, a JSONL line that isn't a JSON object, or a JSON array instead of JSONL |
| `feed-empty` | error | both | No content, or a header or channel with no products |
| `format-unsupported` | error | both | A format the target doesn't accept: JSONL for Google, XML for OpenAI |
| `delimiter-wrong` | error | both | Comma-separated text given to Google, or a delimiter other than the one `format` names |
| `quote-unterminated` | error | both | A quoted value that never closes, so the rest of the file reads as one value |
| `quote-unexpected` | warning | openai | A quote inside an unquoted CSV value. Not checked in tab-separated text: Google lets quotes wrap single values inside a cell, as in `General:Range:"10:20 inches"` ([quoted attributes](https://support.google.com/merchants/answer/14998273)), and OpenAI describes quoting for CSV only |
| `row-width` | error | both | A row with more or fewer values than the header, so values may sit under the wrong attribute |
| `row-trailing-tab` | warning | google | A line ending in a tab, which Google's [text format](https://support.google.com/merchants/answer/160569) says not to include |
| `header-duplicate` | warning | openai | Two columns for one attribute. Only the first is read. For Google a repeated column adds values, as its [quoted attributes](https://support.google.com/merchants/answer/14998273) page allows |
| `namespace-wrong` | warning | google | An XML attribute without the `g:` prefix, or with `g:` bound to another namespace. Google ignores it, so a required attribute written this way is also reported missing ([RSS](https://support.google.com/merchants/answer/160589), [Atom](https://support.google.com/merchants/answer/14990811)) |
| `attribute-unknown` | warning | both | A name that isn't in the spec, with the closest attribute when one is near (`colour`: did you mean `color`?). Reported once per name |
| `attribute-retired` | warning | google | `tax` or `tax_category`, which Google [no longer requires](https://support.google.com/merchants/answer/16098264) and no longer lists |
| `attribute-alias` | warning | openai | An item sends a value under two names, such as `item_id` and its older name `id`. Send only one. The value OpenAI uses is checked: the newer name, except that `enable_search`, `enable_checkout` and `return_window` win over `is_eligible_search`, `is_eligible_checkout` and `return_deadline_in_days` |
| `attribute-missing` | error | both | A required attribute is absent or empty, or a conditional one (`availability_date` for preorder, `seller_tos` for checkout ...). A missing column is reported once, on the header row. A missing Google `description` is a warning: Google [warns](https://support.google.com/merchants/answer/6324468) rather than disapproves |
| `id-duplicate` | error | both | Two items with the same `id`, `item_id` or `offer_id` |
| `id-duplicate-case` | warning | google | Ids that differ only in letter case, which Google [may treat as one product](https://support.google.com/merchants/answer/6324405) |
| `value-too-long` | per attribute | both | Over the documented length |
| `values-too-many` | warning | google | More values than allowed, such as 11 `additional_image_link` URLs |
| `value-enum` | per attribute | both | Not one of the documented values |
| `value-invalid` | per attribute | both | A number, country code, JSON object or dimensions value in the wrong form, and OpenAI pairings (a return window without `accepts_returns=true`, a rating without reviews, `shipping_price` in another currency, checkout on while search is off) |
| `value-placeholder` | warning | both | `N/A`, `Generic`, `No brand`, `Does not exist` as a Google brand; `null`, `unknown`, `n/a` in any OpenAI field where they aren't listed values |
| `url-invalid` | per attribute | both | Not an absolute http or https URL, contains a space, or can't be parsed |
| `date-invalid` | error | google | Not ISO 8601, not a real date, or a sale date range that isn't two dates joined by `/` with the start first |
| `price-invalid` | per attribute | both | Not a number plus a currency code (Google), not exactly `amount CURRENCY` with an uppercase code and the currency's decimals (OpenAI), an unknown ISO 4217 code, or a non-positive OpenAI price |
| `price-currency-missing` | warning | google | A price without a currency code |
| `price-precision` | warning | google | More than 2 decimals, which Google rounds |
| `price-zero` | warning | google | A price of 0, allowed only for contract phones and subscriptions |
| `sale-price-invalid` | warning | both | A sale price that isn't lower than the price (OpenAI: also not positive, or another currency, so it isn't used) |
| `gtin-invalid` | error | both | Wrong GS1 check digit, a length other than 8, 12, 13 or 14, non-digits, or (OpenAI) spaces and dashes |
| `gtin-restricted` | error | google | A GTIN in a restricted or coupon range (prefix 2, 02, 04, 05, 98, 99) or a GTIN-14 with the bulk indicator 9 |
| `identifier-missing` | warning | google | No `gtin` and no `mpn` while `identifier_exists` isn't `no`, or an `mpn` without `brand` ([unique product identifiers](https://support.google.com/merchants/answer/160161)) |
| `identifier-exists-conflict` | warning | google | `identifier_exists` is `no` or `false` but the item has a `gtin`, or an `mpn` and a `brand`, which [Google warns about](https://support.google.com/merchants/answer/6324478) |
| `variant-inconsistent` | warning | both | Google: different `item_group_title` in one group, or group ids that differ only in case. OpenAI: `group_id` equal to `item_id`, a variant without `listing_has_variations=true`, different option names or the same options twice in a group |
| `variant-parent-listed` | warning | google | An item whose id is the `item_group_id` of other items but which isn't in a group itself: the parent SKU, which [shouldn't be submitted](https://support.google.com/merchants/answer/6324507) |

### Google Merchant Center attributes

From the [product data specification](https://support.google.com/merchants/answer/7052112) and
the attribute pages it links to, checked on 2026-11-24. Text headers are read case-insensitively
with spaces for underscores (`Image Link` is `image_link`), and enum values the same way
(`in stock` is `in_stock`), as Google's own examples write them. Header sub-attributes such as
`shipping(country:service:price)` are read by their base name, and a repeated column adds values
to the attribute.

| Attribute | Required | Checked | Source |
|---|---|---|---|
| `id` | yes | 1 to 50 characters, unique, case-only duplicates warned | [6324405](https://support.google.com/merchants/answer/6324405) |
| `title` | yes, or `structured_title` | 150 characters (warning: Google truncates) | [6324415](https://support.google.com/merchants/answer/6324415), [7052112](https://support.google.com/merchants/answer/7052112) |
| `description` | yes, or `structured_description` (missing: warning) | 5,000 characters (warning: Google truncates) | [6324468](https://support.google.com/merchants/answer/6324468), [7052112](https://support.google.com/merchants/answer/7052112) |
| `link` | yes | absolute http(s) URL, 2,000 characters | [6324416](https://support.google.com/merchants/answer/6324416) |
| `image_link` | yes | URL, 2,000 characters | [6324350](https://support.google.com/merchants/answer/6324350) |
| `additional_image_link` | no | URLs, up to 10 (comma-separated in text, repeated in XML) | [6324370](https://support.google.com/merchants/answer/6324370) |
| `availability` | yes | `in_stock`, `out_of_stock`, `preorder`, `backorder`, `build_to_order` (vehicles) | [6324448](https://support.google.com/merchants/answer/6324448) |
| `availability_date` | for `preorder` and `backorder` | ISO 8601, 25 characters | [6324470](https://support.google.com/merchants/answer/6324470) |
| `price` | yes | number plus ISO 4217 code; 0 and more than 2 decimals warned | [6324371](https://support.google.com/merchants/answer/6324371), [7052112](https://support.google.com/merchants/answer/7052112) |
| `sale_price` | no | price format, lower than `price` | [6324471](https://support.google.com/merchants/answer/6324471) |
| `sale_price_effective_date` | no | two ISO 8601 dates joined by `/`, start first, 51 characters | [6324460](https://support.google.com/merchants/answer/6324460), [7052112](https://support.google.com/merchants/answer/7052112) |
| `condition` | no | `new`, `refurbished`, `used` | [6324469](https://support.google.com/merchants/answer/6324469) |
| `brand` | no | 70 characters, no placeholder values; needed with `mpn` | [6324351](https://support.google.com/merchants/answer/6324351), [7052112](https://support.google.com/merchants/answer/7052112) |
| `gtin` | no | GS1 check digit and length, restricted ranges, up to 10 values; spaces and dashes ignored | [6324461](https://support.google.com/merchants/answer/6324461), [160161](https://support.google.com/merchants/answer/160161) |
| `mpn` | no | 70 characters | [6324482](https://support.google.com/merchants/answer/6324482) |
| `identifier_exists` | no | `yes`, `true`, `no`, `false` | [6324478](https://support.google.com/merchants/answer/6324478) |
| `item_group_id` | no | 50 characters; group consistency | [6324507](https://support.google.com/merchants/answer/6324507) |
| `gender`, `age_group` | no | `male`, `female`, `unisex`; `newborn`, `infant`, `toddler`, `kids`, `adult` | [7052112](https://support.google.com/merchants/answer/7052112) |
| `mobile_link`, `ads_redirect`, `lifestyle_image_link`, `video_link`, `virtual_model_link`, `document_link` (up to 5) | no | URL, 2,000 characters | [7052112](https://support.google.com/merchants/answer/7052112) |
| `expiration_date` | no | ISO 8601, 25 characters | [7052112](https://support.google.com/merchants/answer/7052112) |
| `cost_of_goods_sold` | no | price format | [7052112](https://support.google.com/merchants/answer/7052112) |
| `item_group_title` 150, `short_title` 150 (warning), `product_type` 750, `color` 100, `size` 100, `material` 200, `pattern` 100, `custom_label_0` to `custom_label_4` 100, `promotion_id` 50, `shipping_label` 100, `return_policy_label` 100, `external_seller_id` 50 | no | length | [7052112](https://support.google.com/merchants/answer/7052112) |
| `native_commerce` | no | `TRUE` or `FALSE` for each sub-attribute (`checkout_eligibility`, `cart_eligibility`) | [UCP Merchant Center guide](https://developers.google.com/merchant/ucp/guides/overview/merchant-center) |
| `merchant_item_id`, `consumer_notice` | no | known (UCP checkout id override, checkout warnings) | [UCP Merchant Center guide](https://developers.google.com/merchant/ucp/guides/overview/merchant-center) |
| `tax`, `tax_category` | retired | reported as `attribute-retired` | [16098264](https://support.google.com/merchants/answer/16098264) |

The other attributes in the specification (shipping, returns, installments, energy labels,
product details and more) are recognised, so they aren't reported as unknown, but their values
aren't checked.

### OpenAI product feed attributes

From OpenAI's [product feed schema](https://developers.openai.com/commerce/specs/file-upload/products)
(the stable version), checked on 2026-11-24. OpenAI distinguishes fields required for discovery
(every row) from fields required only for Ads or checkout; both are checked, and the message says
which. Names and values are exact, as the schema writes them: booleans are the lowercase strings
`true` and `false` in CSV and TSV, or JSON booleans in JSONL.

| Attribute | Required | Checked |
|---|---|---|
| `item_id` (aliases `id`, `sku`) | yes | unique |
| `title`, `description` | yes | 150 and 5,000 characters (warnings: the schema says "aim for at most") |
| `url`, `image_url` | yes | absolute http(s) URL |
| `brand`, `seller_name` | yes | present, not a placeholder |
| `availability` | yes | `in_stock`, `out_of_stock`, `pre_order`, `backorder`, `unknown` (anything else rejects the row) |
| `price` | yes | `amount CURRENCY`: decimal point, no thousands separators, uppercase ISO 4217, no more decimals than the currency has, positive |
| `target_countries` | yes | uppercase ISO 3166-1 alpha-2 codes, as a JSON array or a comma-separated cell |
| `store_country` | yes | uppercase ISO 3166-1 alpha-2 code |
| `seller_privacy_policy`, `seller_tos` | for checkout (`is_eligible_checkout=true`) | URL |
| `dimensions_unit` | with `length`, `width` or `height` | `in`, `cm`, `ft`, `m`, `mm` |
| `item_weight_unit` | with `weight` | `g`, `kg`, `oz`, `lb` |
| `group_id` (alias `item_group_id`), `listing_has_variations`, `variant_dict` | for variants | group rules; `variant_dict` a JSON object of nonempty strings |
| `offer_id` | no | unique |
| `gtin` | no | 8, 12, 13 or 14 digits with a valid check digit, no spaces or dashes |
| `sale_price` | no | lower than `price`, above zero, same currency (warning: otherwise it isn't used) |
| `shipping_price` | no | money, same currency as `price` |
| `condition`, `gender`, `age_group`, `size_system` | no | documented values (gender and age group: warning, unrecognized values are dropped) |
| `dimensions` | no | JSON object with at least two of `length`, `width`, `height` as positive decimal strings, and `unit` |
| `length`, `width`, `height`, `weight` | no | positive decimal |
| `additional_image_urls`, `seller_url`, `return_policy` | no | URLs (warning: invalid ones are dropped) |
| `return_deadline_in_days` (alias `return_window`) | no | positive whole number, with `accepts_returns=true` |
| `review_count`, `store_review_count`; `star_rating`, `store_star_rating` | no | whole number of 0 or more; 0 to 5 |
| `is_eligible_search` (alias `enable_search`), `is_eligible_checkout` (alias `enable_checkout`), `is_ads_eligible` (alias `is_eligible_ads`), `accepts_returns`, `accepts_exchanges`, `is_digital` | no | `true` or `false` |
| `ads_metadata` | no | JSON object of strings |
| `product_category`, `material`, `color`, `size`, `mpn`, `shipping`, `marketplace_seller`, `Custom_variant1_category` ... | no | known |

## Security

The library never touches the network or the filesystem: it takes the feed text you already
have. XML is read by `sitemap-lint`'s reader, which skips any DOCTYPE and expands only the five
predefined entities and numeric references, so external entities (XXE) and entity expansion
can't happen. All patterns are anchored and free of nested quantifiers, and linting is linear in
the size of the feed.

The CLI reads only the file or URL you give it, including `localhost`, so you can lint a feed on
a dev server. It stops reading at 100 MB, while streaming, for files, stdin and responses alike.
It sends a fixed User-Agent, `product-feed-lint/<version> (+https://github.com/idrisiRehan/websync-plugins)`,
and has a request timeout. Don't expose the CLI as a service that fetches URLs for other people
without your own SSRF controls. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a
vulnerability.

## Limitations

- **Passing doesn't guarantee approval.** Google also crawls the landing page and requires the
  price, currency and availability there to [match the feed](https://support.google.com/merchants/answer/4752265),
  checks images (size, watermarks, placeholders) and enforces its Shopping policies. None of that
  is visible in the feed file. OpenAI likewise checks the live site when a customer acts.
- **Country and category requirements are not checked.** Google requires `color`, `size`,
  `gender` and `age_group` for apparel in some countries, `item_group_id` for variants in
  Brazil, France, Germany, Japan, the UK and the US, `shipping` in many countries, `certification`
  for EU energy labels, `condition` for used and refurbished products, and `brand` for products
  with a clearly associated brand. The feed doesn't say which country it targets or what the
  product is, so these are left to Merchant Center. Likewise `marketplace_seller` for OpenAI
  marketplace offers.
- **Dates are checked for form, not against today.** Google allows `availability_date` up to a
  year ahead and `expiration_date` under 30 days ahead; a pure linter has no clock to compare with.
- **Not every value is validated.** Sub-attributes of `shipping`, `return`, `installment` and
  similar groups, `google_product_category` ids, color names, URL encoding beyond spaces, and
  image formats are not checked. Values of recognised but unchecked attributes pass as is.
- **Quoted values in Google text files.** A cell is read with CSV quoting: quotes around the whole
  cell may hold tabs, line breaks and commas. Google also lets quotes wrap one value of several,
  as in `"https://a.example/1,2.jpg","https://a.example/3.jpg"`. When the first value of a cell is
  quoted like that, the cell is read as one value, so its URLs can be reported as invalid.
- **Supplemental data sources** carry only some attributes. The linter checks a primary feed, so
  a supplemental file is reported as missing required attributes.
- **Google's Atom entries** must have `updated`, as Google's Atom page requires. `title`, `id`,
  `link` and `summary` are accepted from either the Atom element or its `g:` version.
- **OpenAI formats:** JSONL, CSV and TSV, as the schema describes. XML, JSON arrays and
  compressed files are not accepted. Fields marked "requires setup" in the schema (such as
  `shipping` tuples and store ratings) are checked only for form; whether your integration
  carries them is not known to the linter. Ads feeds follow a separate guide and aren't
  checked beyond `is_ads_eligible` and `ads_metadata`.
- **Read cap.** The CLI refuses feeds over 100 MB. The library has no cap: pass it what fits in
  memory.

## Upkeep

Google and OpenAI change these specs. Each table entry in
[google.ts](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-lint/src/google.ts) and
[openai.ts](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-lint/src/openai.ts)
names its source and the date it was last compared with it (2026-11-24 for all entries in 1.0).
The tables are rechecked against both sources quarterly. If a valid feed is flagged, please
[open an issue](https://github.com/idrisiRehan/websync-plugins/issues).

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
