# product-feed-build

Your store in ChatGPT shopping and Google Shopping in one command. `product-feed-build` turns a
Shopify or WooCommerce product export (the CSV both platforms give you from the admin) into a
product feed for Google Merchant Center or for OpenAI's product feed spec, then checks the result
with [`product-feed-lint`](https://www.npmjs.com/package/product-feed-lint) before you upload it.

```text
$ npx product-feed-build examples/shopify-products.csv --target google --store-url https://shop.example.com --currency USD -o google.xml
examples/shopify-products.csv: shopify, 7 items written to google.xml (google, xml), 2 skipped
SKIP   row 10
       Draft: not ready to be sold.
SKIP   row 11
       Gift card: store credit, not merchandise. Add it to the feed by hand if you want to advertise it.

Lint: no problems found.
```

- **One item per variant**, grouped the way each spec asks: `item_group_id` for Google,
  `group_id`, `listing_has_variations` and `variant_dict` for OpenAI, with the variant's
  options in its title and in `color`, `size`, `material` and `pattern`.
- **Grounded in the documentation.** Every mapping follows the platform's export format and the
  feed's attribute definitions, linked in the [mapping table](#mapping). Where the export doesn't
  hold a value a feed needs, it is left out and the linter says so. Nothing is made up.
- **Checked before it is written.** The feed is linted with `product-feed-lint`, so you see
  Merchant Center's and OpenAI's mechanical rejections before you upload, with the item id.
- **Reuses tested readers.** The export is read by
  [`product-csv-lint`](https://www.npmjs.com/package/product-csv-lint), which knows current and
  legacy Shopify column names and WooCommerce's parent and variation wiring.
- **Offline and safe on any input.** The library never touches the network or the filesystem,
  never throws on a broken CSV, and runs in linear time (20,000 rows build and lint in seconds).

## Install

```sh
npm install product-feed-build
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later. Its dependencies are
[`product-csv-lint`](https://www.npmjs.com/package/product-csv-lint) (reading the export),
[`product-feed-lint`](https://www.npmjs.com/package/product-feed-lint) (checking the feed) and
[`metacheck`](https://www.npmjs.com/package/metacheck) (its HTML tokenizer turns descriptions into
plain text): same maintainer, no third-party dependencies.

## CLI

```text
product-feed-build <export.csv | -> --target <name> --store-url <url> --currency <code> [options]

Required:
  --target <name>             google or openai
  --store-url <url>           Your storefront, like https://shop.example.com
  --currency <code>           ISO 4217 code of the export's prices, like USD

Options:
  -o, --output <file>         Write the feed to a file (default: stdout)
  --format <name>             google: xml or tsv; openai: jsonl, csv or tsv
                              (default: from the -o extension, else xml or jsonl)
  --platform <name>           shopify or woocommerce (default: detected)
  --brand <name>              Brand for products with an empty Vendor or Brands
  --condition <value>         new, refurbished or used (default: new)
  --availability-date <date>  google: availability_date for backordered items,
                              ISO 8601 like 2026-12-15T09:00-0800
  --link-template <url>       Product links from {handle} (Shopify) or {id} and
                              {sku} (WooCommerce), like https://shop.example.com/product/{sku}/
  --seller-name <name>        openai (required): seller_name
  --store-country <code>      openai (required): store_country, like US
  --target-countries <list>   openai: comma-separated (default: the store country)
  --json                      Print the summary on stderr as JSON
  --max-warnings <n>          Exit with code 1 when there are more than n warnings
  -h, --help                  Show this help
  -v, --version               Show the version
```

The feed goes to `-o` or to stdout; the summary (skipped rows, notes and lint findings) always
goes to stderr, so `> feed.xml` gets a clean feed. With `-o`, the extension picks the format
when `--format` isn't given: `.xml`, `.tsv` or `.txt`, `.jsonl`, `.csv`. An extension the target
can't take (`.csv` for Google) is a usage error. The store URL and
currency are required because the exports have neither: Shopify and WooCommerce write prices
without a currency, and neither export has the shop's address.

For ChatGPT shopping, OpenAI also needs the seller's name and country on every row:

```text
$ npx product-feed-build examples/woocommerce-products.csv --target openai --store-url https://shop.example.com --currency USD --seller-name "Northline Outdoor" --store-country US -o chatgpt.jsonl
examples/woocommerce-products.csv: woocommerce, 5 items written to chatgpt.jsonl (openai, jsonl), 4 skipped
SKIP   row 7
       Disabled variation: not published.
SKIP   row 9
       Grouped product: a set of other products with no price of its own. The products in it are listed on their own rows.
SKIP   row 10
       Draft: not ready to be sold.
SKIP   row 11
       External product: it is sold on another site, not by your store.
NOTE   row 6, item HOODIE-GRY-M
       The sale is scheduled, and OpenAI's feed has no sale dates, so sale_price is left out.

Lint: no problems found.
```

`SKIP` and `NOTE` lines name the row in your export. Lint findings name the row or line in the
feed and the item id. When the feed has problems it is still written, and the exit code is 1:

```text
$ npx product-feed-build products_export.csv --target google --store-url https://shop.example.com --currency USD --format tsv > google.tsv
products_export.csv: shopify, 2 items written to stdout (google, tsv), 0 skipped
NOTE   row 2, item TOTE-1
       Barcode "4006381333930" isn't a valid GTIN (length or check digit), so gtin is left out.
ERROR  attribute-missing (feed row 2, item TOTE-1, availability_date)
       availability_date is missing. It is required when availability is preorder or backorder.
WARN   identifier-missing (feed row 2, item TOTE-1, gtin)
       No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.
WARN   attribute-missing (feed row 3, item APRON-1, description)
       description is missing or empty. Google warns and may limit the product's performance. Submit a description or structured_description.
WARN   identifier-missing (feed row 3, item APRON-1, gtin)
       No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.
HINT   Google needs the date backordered items ship. Pass --availability-date, like 2026-12-15T09:00-0800,
       or stop selling those variants when they are out of stock.

Lint: 1 error, 3 warnings
```

Here the tote is out of stock but set to keep selling, which Google calls a backorder, and a
backorder needs the date it will ship again
([6324470](https://support.google.com/merchants/answer/6324470)). The export doesn't have that
date and the tool doesn't guess one: pass it with `--availability-date` (it goes on every
backordered item; Google accepts a date up to a year ahead), or change the product's inventory
policy. With the date, the error is gone and the exit code is 0:

```text
$ npx product-feed-build products_export.csv --target google --store-url https://shop.example.com --currency USD --format tsv --availability-date 2026-12-15T09:00-0800 > google.tsv
products_export.csv: shopify, 2 items written to stdout (google, tsv), 0 skipped
NOTE   row 2, item TOTE-1
       Barcode "4006381333930" isn't a valid GTIN (length or check digit), so gtin is left out.
WARN   identifier-missing (feed row 2, item TOTE-1, gtin)
       No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.
WARN   attribute-missing (feed row 3, item APRON-1, description)
       description is missing or empty. Google warns and may limit the product's performance. Submit a description or structured_description.
WARN   identifier-missing (feed row 3, item APRON-1, gtin)
       No gtin or mpn. Submit the manufacturer's GTIN if the product has one, otherwise brand and mpn. For custom or one-of-a-kind products with neither, set identifier_exists to no.

Lint: 0 errors, 3 warnings
```

OpenAI's feed has no date field (its availability values "do not schedule a future stock
change"), so `--availability-date` affects Google feeds only.

### Product links

By default a Shopify product links to `{store}/products/{handle}`, and a WooCommerce product to
`{store}/?post_type=product&p={ID}`, because the WooCommerce export has no permalink or slug
column (WordPress redirects that address to the product's permalink). If your permalinks can be
built from the export, give a template:

```sh
npx product-feed-build wc-product-export.csv --target google --store-url https://shop.example.com --currency USD \
  --link-template "https://shop.example.com/product/{sku}/"
```

Placeholders are `{handle}` for Shopify, and `{id}` and `{sku}` for WooCommerce (a variation
uses its parent's, since the variation has no page of its own). Values are percent-encoded. The
template must be an absolute https URL on the store URL's host, since both Google and OpenAI
want links on the seller's own site. A product without the value the template needs (a
WooCommerce product with no SKU for `{sku}`) is skipped with that reason.

The export is read up to 50 MB, a cap enforced while reading; Shopify's own import limit is
15 MB. Files must be UTF-8, as both platforms export them.

### In CI

```yaml
- name: Build the Google feed
  run: npx --yes product-feed-build@1 products_export.csv --target google --store-url https://shop.example.com --currency USD -o public/google.xml --max-warnings 0
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The feed was written and has no lint errors (and no more warnings than `--max-warnings`) |
| `1` | The feed was written, but has lint errors or more warnings than `--max-warnings` |
| `2` | Usage error, or input it can't use: a missing file, invalid UTF-8, over 50 MB, a header row that matches neither platform (pass `--platform`), or an output file that can't be written |

Errors are printed to stderr as one line, prefixed `product-feed-build:`.

## Library

```ts
import { buildProductFeed } from "product-feed-build";

const result = buildProductFeed(csvText, {
  target: "google",
  storeUrl: "https://shop.example.com",
  currency: "USD",
});
result.feed;            // the feed text, RSS 2.0 XML here
result.lint.valid;      // product-feed-lint found no errors
result.skipped;         // [{ row, reason }]

const chatgpt = buildProductFeed(bytes, {
  target: "openai",
  format: "csv",
  storeUrl: "https://shop.example.com",
  currency: "USD",
  sellerName: "Northline Outdoor",
  storeCountry: "US",
});
```

```ts
function buildProductFeed(csv: string | Uint8Array, options: BuildOptions): BuildResult;

interface BuildOptions {
  target: "google" | "openai";
  format?: "xml" | "tsv" | "jsonl" | "csv"; // google: xml (default), tsv; openai: jsonl (default), csv, tsv
  storeUrl: string;                        // absolute https URL, may include a path (https://shop.example/en-ca)
  currency: string;                        // ISO 4217 code of the export's prices
  platform?: "shopify" | "woocommerce";    // default: detected from the header row
  brand?: string;                          // used when Vendor (Shopify) or Brands (WooCommerce) is empty
  condition?: "new" | "refurbished" | "used"; // default "new"
  sellerName?: string;                     // openai: required; google: titles the XML channel
  storeCountry?: string;                   // openai: required, ISO 3166-1 alpha-2
  targetCountries?: string[];              // openai: default [storeCountry]
  availabilityDate?: string;               // google: availability_date for backordered items, ISO 8601
  linkTemplate?: string;                   // "https://shop.example.com/product/{sku}/", see Product links
}

interface BuildResult {
  feed: string;
  target: "google" | "openai";
  format: "xml" | "tsv" | "jsonl" | "csv";
  platform: "shopify" | "woocommerce";
  itemCount: number;
  skipped: { row: number; reason: string }[];                    // rows of the export, sorted
  notes: { row: number; itemId: string | null; message: string }[]; // values left out or shortened
  lint: ProductFeedResult;                                       // from product-feed-lint
}
```

Bytes are decoded as UTF-8 (invalid sequences become U+FFFD; run `product-csv-lint` on the file
to find them). `buildProductFeed()` never throws on a broken export: unusable rows are skipped
with a reason, and values the feed needs but the export lacks are left out for the linter to
report. It throws a `TypeError` only for invalid options, including a header row that matches
neither platform while `platform` isn't set.

`ProductFeedResult` is documented in
[`product-feed-lint`](https://www.npmjs.com/package/product-feed-lint#library). The records the
export is read into come from `readProducts()` in
[`product-csv-lint`](https://www.npmjs.com/package/product-csv-lint#library).

### JSON output

The CLI's `--json` summary, printed on stderr, is the result without `feed`, plus `source` and
`output` (here cut after the first of four findings):

```text
$ npx product-feed-build products_export.csv --target google --store-url https://shop.example.com --currency USD --format tsv --json -o google.tsv
{
  "source": "products_export.csv",
  "output": "google.tsv",
  "target": "google",
  "format": "tsv",
  "platform": "shopify",
  "itemCount": 2,
  "skipped": [],
  "notes": [
    {
      "row": 2,
      "itemId": "TOTE-1",
      "message": "Barcode \"4006381333930\" isn't a valid GTIN (length or check digit), so gtin is left out."
    }
  ],
  "lint": {
    "valid": false,
    "target": "google",
    "format": "tsv",
    "itemCount": 2,
    "errorCount": 1,
    "warningCount": 3,
    "findings": [
      {
        "rule": "attribute-missing",
        "severity": "error",
        "message": "availability_date is missing. It is required when availability is preorder or backorder.",
        "line": 2,
        "itemId": "TOTE-1",
        "attribute": "availability_date"
      },
      ...
    ]
  }
}
```

## Mapping

Shopify column names are the current ones, with the older export's name in brackets; both are
read ([Shopify's product CSV page](https://help.shopify.com/en/manual/products/import-export/using-csv)).
WooCommerce names are those its built-in exporter writes
([schema](https://github.com/woocommerce/woocommerce/wiki/Product-CSV-Import-Schema),
[exporter](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/export/class-wc-product-csv-exporter.php)).
Feed attributes follow Google's [product data specification](https://support.google.com/merchants/answer/7052112)
and OpenAI's [product feed schema](https://developers.openai.com/commerce/specs/file-upload/products).

| Google | OpenAI | Shopify | WooCommerce | How |
|---|---|---|---|---|
| `id` | `item_id` | SKU (Variant SKU), else the handle, plus `-1`, `-2` ... for a product with variants | SKU, else ID | Over 50 characters (Google's [limit](https://support.google.com/merchants/answer/6324405)): the first 41 characters, `-` and an 8-digit fingerprint of the whole id, so it stays stable and distinct. Noted |
| `title` | `title` | Title, plus the variant's option values | parent Name, plus the variation's attribute values | "Blue mug, Large", as [Google](https://support.google.com/merchants/answer/6324415) and OpenAI ask for variants. Google truncates past 150 characters, so it is cut at a word boundary and noted; OpenAI's 150 is a recommendation, so the linter warns instead |
| `description` | `description` | Description (Body (HTML)), else SEO description | the variation's Description, else Description, else Short description | HTML to plain text: tags dropped, entities decoded, scripts and styles left out, paragraphs and list items on their own lines (spaces in TSV, which can't hold line breaks). Google truncates past 5,000 characters ([6324468](https://support.google.com/merchants/answer/6324468)), so it is cut at a word boundary and noted |
| `link` | `url` | `{store}/products/{URL handle}` ([Shopify](https://shopify.dev/docs/api/liquid/objects/product)) | `{store}/?post_type=product&p={ID}`, the parent's ID for a variation | Or `--link-template` ([Product links](#product-links)). See [Limitations](#limitations) for variant URLs |
| `image_link` | `image_url` | Variant image URL (Variant Image), else the first product image by Image position | the variation's image, else the first of Images ("first is featured") | |
| `additional_image_link` | `additional_image_urls` | the other Product image URL (Image Src) rows, in position order | the rest of Images | Other variants' own images are left out. Google takes up to 10 ([6324370](https://support.google.com/merchants/answer/6324370)). Commas inside a URL are encoded as `%2C` |
| `availability` | `availability` | Inventory tracker (Variant Inventory Tracker), Inventory quantity (Variant Inventory Qty), Continue selling when out of stock (Variant Inventory Policy) | In stock? (`1`, `0`, `backorder`) | Shopify: not tracked, `in_stock`; quantity above 0, `in_stock`; 0 or less with `continue`, `backorder`; otherwise `out_of_stock`. No quantity: left out for Google (it has no "unknown"), `unknown` for OpenAI. Google's `backorder` needs `availability_date` ([6324448](https://support.google.com/merchants/answer/6324448)) |
| `availability_date` | (none) | | | `--availability-date`, on backordered items. The export has no such date, so without the option the linter reports it ([6324470](https://support.google.com/merchants/answer/6324470)) |
| `price` | `price` | Compare-at price (Variant Compare At Price) when it is above Price, else Price | Regular price | Written with the currency's decimals and code: `18` becomes `18.00 USD`, `1500` JPY `1500 JPY`. More decimals than the currency has are kept for the linter to report, not rounded |
| `sale_price` | `sale_price` | Price, when Compare-at price is above it | Sale price, when below Regular price | Google keeps the full price in `price` and the lower one in `sale_price` ([6324471](https://support.google.com/merchants/answer/6324471)) |
| `sale_price_effective_date` | (none) | | Date sale price starts / ends | Google only ([6324460](https://support.google.com/merchants/answer/6324460)). OpenAI has no sale dates, so a scheduled sale's price is left out and noted |
| `condition` | `condition` | Google Shopping / Condition | | Else `--condition`, default `new` |
| `brand` | `brand` | Vendor | first of Brands | Else `--brand`. OpenAI requires it |
| `gtin` | `gtin` | Barcodes (Variant Barcodes in Shopify's sample file; Barcode, Variant Barcode in older files): in the list, the first valid entry typed GTIN, UPC, EAN or ISBN, else an untyped (Custom) one; ASIN and NS-PID entries never | GTIN, UPC, EAN, or ISBN | Only with a valid GS1 check digit and length 8, 12, 13 or 14; anything else is left out and noted. Google: restricted and coupon ranges (2, 02, 04, 05, 98, 99) are left out too ([6324461](https://support.google.com/merchants/answer/6324461)) |
| `mpn` | `mpn` | Google Shopping / Manufacturer part number (MPN) (Google Shopping / MPN) | MPN | The variant's own row only: an MPN identifies one variant, so it isn't copied to the others |
| `identifier_exists` | (none) | Google Shopping / Custom product | | `no` only when the merchant marked the product custom and it has no GTIN and no MPN with a brand ([6324478](https://support.google.com/merchants/answer/6324478)). Never set otherwise |
| `item_group_id`, `item_group_title` | `group_id`, `listing_has_variations`, `variant_dict` | URL handle (Handle), Title, option names and values | parent SKU (else parent ID), parent Name, attribute names and values | Only for products with variants ([6324507](https://support.google.com/merchants/answer/6324507)). A group id over 50 characters is shortened like `id` |
| `color`, `size`, `material`, `pattern` | `color`, `size`, `material` | an option named Color or Colour, Size, Material, Pattern | an attribute with that name: the variation's value, or a simple product's single value | |
| `product_type` | `product_category` | Type, else Product category; OpenAI: Product category, else Type | Categories (Google: all; OpenAI: the first) | |
| `google_product_category` | (none) | Google Shopping / Google product category | | |
| `gender`, `age_group` | `gender`, `age_group` | Google Shopping / Gender, Age group | | Lower-cased, and Shopify's labels read as the value: `Adult (13+ years old)` is `adult` |
| `custom_label_0` to `_4` | (none) | Google Shopping / Custom label 0 to 4 | | |
| (none) | `seller_name`, `seller_url`, `store_country`, `target_countries` | | | `--seller-name`, `--store-url`, `--store-country`, `--target-countries` (default: the store country) |

Formats: Google RSS 2.0 XML with the `g:` namespace ([160589](https://support.google.com/merchants/answer/160589))
or tab-separated text ([160569](https://support.google.com/merchants/answer/160569)), where tabs
and line breaks inside values become spaces and a value starting with a quote is quoted with the
inner quotes doubled ([14998273](https://support.google.com/merchants/answer/14998273)). OpenAI
JSONL with JSON booleans, arrays and objects, or CSV (RFC 4180 quoting) or TSV with booleans as
`true`/`false`, lists comma-separated and `variant_dict` as JSON text, as its schema describes.
Attributes come in a fixed order, so successive feeds diff cleanly.

## What is skipped, and why

| Skipped | Platform | Why |
|---|---|---|
| Status `draft` | Shopify | "Isn't yet ready to be sold" (Shopify) |
| Status `archived` | Shopify | "No longer available to sell" (Shopify) |
| Any other non-active Status | Shopify | Not for sale |
| Published on online store (Published) `false` | Shopify | The product isn't visible on the online store, so it has no public page to link to |
| Gift card `true` | Shopify | Store credit, not merchandise: no brand, GTIN or shipping. Add it by hand if you want to advertise it |
| A row without a URL handle | Shopify | It belongs to no product |
| Published `0` (private), `-1` (draft), `2` (pending) | WooCommerce | Not published |
| Visibility in catalog `hidden` | WooCommerce | The store hides it from its own catalog and search |
| Type `grouped` | WooCommerce | A set of other products with no price of its own; the products in it are items on their own |
| Type `external` | WooCommerce | Sold on another site, not by the store |
| Another type (a plugin's, such as a subscription) | WooCommerce | How it is sold isn't known from the export |
| A variable product with no variations in the file | WooCommerce | Its variations are what is sold |
| A disabled variation (Published `0`) | WooCommerce | Not for sale |
| A variation whose Parent is missing, not in the file, or not a variable product | WooCommerce | It belongs to no product in the file |
| An item with neither SKU nor ID | WooCommerce | No stable id |

A variable WooCommerce product, like a Shopify product's first row, is never an item itself:
only its variations are, as Google [asks](https://support.google.com/merchants/answer/6324507).

## Examples

[`examples/`](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/product-feed-build/examples)
holds three exports and the feeds built from them, all of which lint with no findings:

| Export | Feeds |
|---|---|
| [shopify-products.csv](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/shopify-products.csv) (current format: shoes in two colors and sizes on sale, a single mug with untracked stock, a beanie without SKUs, a draft and a gift card) | [shopify-google.xml](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/shopify-google.xml), [shopify-openai.jsonl](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/shopify-openai.jsonl) |
| [shopify-legacy-products.csv](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/shopify-legacy-products.csv) (older format: `Handle`, `Body (HTML)`, `Variant ...` columns) | [shopify-legacy-google.tsv](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/shopify-legacy-google.tsv) |
| [woocommerce-products.csv](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/woocommerce-products.csv) (a variable hoodie with variations, one on a scheduled sale and one disabled, a simple mug, and grouped, draft and external products) | [woocommerce-google.xml](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/woocommerce-google.xml), [woocommerce-openai.jsonl](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/product-feed-build/examples/woocommerce-openai.jsonl) |

They were built with `--store-url https://shop.example.com --currency USD --seller-name "Northline Outdoor" --store-country US`.
The brand, products and barcodes are made up.

## Security

The library never touches the network or the filesystem: it takes the export you already have
and returns text. HTML descriptions are read by `metacheck`'s tokenizer, which never runs scripts
and drops script and style content. Patterns are anchored and free of nested quantifiers, and
building is linear in the size of the export. Bad input is fuzz-tested.

The CLI reads only the file (or stdin) you name, stops reading at 50 MB, and writes only to
stdout or the `-o` file you name. It makes no network requests. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a
vulnerability.

## Limitations

- **Variant links open the product, not the variant.** Shopify selects a variant with
  `?variant={variant ID}` ([Shopify](https://www.shopify.com/partners/blog/product-variants)),
  and the product export has no variant IDs, so every variant links to `/products/{handle}`,
  which opens on the default variant. Google asks for the variant to be preselected
  ([6324416](https://support.google.com/merchants/answer/6324416)) and may flag a price or
  availability that differs on the landing page. WooCommerce variations link to their parent the
  same way.
- **WooCommerce links redirect once by default.** The export has no permalink or slug, so links
  use the product ID: `/?post_type=product&p={ID}`. WordPress answers that with a redirect to the
  product's permalink ([`redirect_canonical`](https://developer.wordpress.org/reference/functions/redirect_canonical/)).
  Google allows redirects but asks for as few as possible, on the same domain. If your
  permalinks follow the SKU or ID, `--link-template` avoids the redirect; permalinks made from
  the product's slug can't be built, because the export doesn't have it.
- **The export lacks some data.** Shipping costs, return policies, tax, the date a backorder
  ships (pass one store-wide date with `--availability-date`), product reviews and ratings
  aren't in either export. Set shipping and
  returns in Merchant Center, or add them to the feed (OpenAI's `shipping_price`,
  `accepts_returns`, `return_policy` ...). OpenAI's checkout fields (`is_eligible_checkout`,
  `seller_privacy_policy`, `seller_tos`) are for its checkout integration and aren't set.
- **Store-wide values are assumed.** All prices are in `--currency`, and condition is
  `--condition` unless Shopify's Google Shopping / Condition says otherwise. Shopify's market
  prices (`Price / International` ...) and multi-location inventory aren't read: an export from a
  store with several locations has no Inventory quantity, so availability comes out unknown.
- **Sale dates have no time zone.** WooCommerce exports sale dates in the store's local time
  without an offset, and Google reads a time without an offset as UTC.
- **Country and category rules aren't applied.** Google requires `color`, `size`, `gender` and
  `age_group` for apparel in some countries, `google_product_category` is passed through only from
  Shopify's Google Shopping column, and Shopify's own product category isn't Google's taxonomy.
  The linter leaves these to Merchant Center too.
- **Weights and dimensions aren't mapped.** Shopify's weight is a shipping weight and
  WooCommerce's is configurable per store, while OpenAI's `weight` is the net product weight.
- **Option names are matched in English** (Color or Colour, Size, Material, Pattern). Other
  options still appear in the title and in OpenAI's `variant_dict`.
- **A clean lint isn't approval.** Google and OpenAI also check the landing page, images and
  their policies. See product-feed-lint's
  [limitations](https://www.npmjs.com/package/product-feed-lint#limitations).

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
