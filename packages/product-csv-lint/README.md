# product-csv-lint

Check a Shopify or WooCommerce product CSV before you import it. Each finding comes with the
spreadsheet row, the column and a plain-English fix.

```text
$ npx product-csv-lint examples/shopify-products.csv
examples/shopify-products.csv: shopify, 4 rows, 2 products, 4 variants
ERROR  sku-duplicate (row 2, SKU)
       Duplicate SKU "TEE-S", also on row 5. Each variant needs its own SKU for inventory and orders to match.
WARN   value-barcode (row 3, Barcode)
       "4006381333930" isn't a valid GTIN, UPC, EAN or ISBN: The last digit is 0, but the GS1 check digit for the rest is 1. A digit is wrong or two are swapped.
ERROR  variant-duplicate (row 3)
       Same option values as row 4 of this product, so Shopify can't tell the variants apart.
ERROR  variant-duplicate (row 4)
       Same option values as row 3 of this product, so Shopify can't tell the variants apart.
ERROR  quote-unexpected (row 5)
       A quote appears inside a field that doesn't start with one (for example 12" pizza). Wrap the whole field in quotes and double the inner quote: "12"" pizza".
ERROR  value-decimal (row 5, Price)
       "$34.99" isn't a plain non-negative number. Remove currency symbols, units and thousands separators, and use a dot for decimals.
ERROR  value-enum (row 5, Status)
       "live" isn't one of the allowed values (active, draft, archived).
ERROR  sku-duplicate (row 5, SKU)
       Duplicate SKU "TEE-S", also on row 2. Each variant needs its own SKU for inventory and orders to match.

7 errors, 1 warning, 0 info
```

- **Both Shopify formats.** Shopify renamed most columns in its current export (`URL handle`,
  `Price`, `Product image URL` ...). Files in the older format (`Handle`, `Variant Price`,
  `Image Src` ...) are still everywhere. Both are understood, header case is ignored, and
  metafield, market and Google Shopping columns are recognised.
- **Understands product structure.** It knows Shopify's rows (variant rows, and extra-image
  rows that carry only a handle and an image) and WooCommerce's parent and variation wiring
  (by SKU or `id:123`).
- **Catches what breaks imports:** quoting mistakes such as an unescaped inch mark, unclosed
  quotes, semicolon-separated files saved by Excel, files that aren't UTF-8, ragged rows,
  currency symbols in prices, invalid barcodes, duplicate SKUs and variants.
- **Offline.** Nothing is uploaded and nothing is fetched. The only dependency is
  [`websync-validators`](https://www.npmjs.com/package/websync-validators) (same maintainer, no dependencies of its own) for
  barcode check digits.

The browser versions are the free
[Product CSV Validator](https://websync.in/tools/product-csv-validator/) and
[WooCommerce CSV Validator](https://websync.in/tools/woocommerce-csv-validator/) on websync.in.

## Install

```sh
npm install product-csv-lint
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
product-csv-lint <file | -> [options]

  --platform <name>    shopify or woocommerce (default: detected from the header row)
  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
```

Exit codes: `0` no errors, `1` errors (or more warnings than `--max-warnings`), `2` usage or
input error, including a file over 50 MB and a header row that matches neither platform when
`--platform` isn't given.

```sh
npx product-csv-lint products_export.csv
npx product-csv-lint catalog.csv --platform woocommerce --json > report.json
```

## Library

```ts
import { lintProductCsv, detectPlatform } from "product-csv-lint";

const platform = detectPlatform(text) ?? "shopify"; // "shopify" | "woocommerce" | null
const result = lintProductCsv(text, platform);      // a string, or a Uint8Array to also check UTF-8

result.valid;         // true when there are no errors
result.productCount;  // products (Shopify: distinct handles)
result.variantCount;  // variant rows (Shopify) or variation rows (WooCommerce)
result.findings;      // [{ rule, severity, row, column, message, value }]
```

`row` is the spreadsheet row number: the header is row 1, and a cell that spans several lines
still counts as one row.

## Rules

Severities: **error** means the import will fail or produce wrong data. **warning** means it
will import, but probably not as intended. **info** is worth a look.

### Both platforms

| Rule | Severity | Meaning |
|---|---|---|
| `encoding-invalid` | error | Not valid UTF-8 (only when you pass bytes) |
| `encoding-mojibake` | info | Looks like UTF-8 text that was saved again as another encoding (`Ã©` for `é`) |
| `bom` | info | Starts with a byte order mark. It is ignored |
| `file-empty`, `rows-none` | error, warning | No content, or a header row with no products |
| `delimiter-semicolon` | error (Shopify), warning (WooCommerce) | Semicolon-separated, as Excel saves in some regions |
| `quote-unexpected` | error | A quote inside an unquoted field, or text after a closing quote |
| `quote-unterminated` | error | A quoted field that never closes |
| `row-width` | error | A row with a different number of cells from the header |
| `header-missing`, `header-recommended` | error, warning | A required or useful column is absent |
| `header-unknown`, `header-blank`, `header-duplicate` | info, warning, error | Header problems |
| `value-decimal`, `value-integer`, `value-boolean`, `value-flag`, `value-enum`, `value-url` | per column | A cell doesn't fit its column's type |
| `value-barcode` | warning | Not a valid GTIN, UPC, EAN or ISBN check digit |
| `sku-duplicate` | error | The same SKU on more than one row |

### Shopify

| Rule | Severity | Meaning |
|---|---|---|
| `handle-missing` | error | A row without a URL handle |
| `title-repeated` | warning | Title repeated on a following row of the same product |
| `option-name-inconsistent` | error | A product's rows disagree on an option name |
| `variant-duplicate` | error | Two variants of a product with the same option values |
| `image-position-duplicate` | error | Two images of a product with the same position |
| `compare-at-below-price` | warning | Compare-at price lower than the price |

Title is the only required column, as Shopify's documentation states. URL handle is
recommended, because without it every row becomes its own product.

### WooCommerce

| Rule | Severity | Meaning |
|---|---|---|
| `id-duplicate` | error | The same ID on more than one row |
| `attribute-pair-missing` | error | `Attribute N name` without `Attribute N value(s)`, or the reverse |
| `type-missing`, `type-unknown` | warning | No product type, or one that isn't built in |
| `sale-not-below-regular` | error | Sale price not below the regular price |
| `name-missing` | warning | A product (not a variation) without a name |
| `parent-missing`, `parent-not-found`, `parent-not-variable` | error, warning, error | Variation wiring problems |
| `variation-attribute-list`, `variation-attribute-unknown` | warning | A variation with a list of values, or an attribute its parent doesn't have |
| `variable-without-variations` | warning | A variable product with no variations in the file |
| `images-*` | per rule | Pipes instead of commas, empty entries, spaces in URLs, `www.` without a scheme |

## Sources and limitations

- **Shopify** rules follow [Shopify's product CSV documentation](https://help.shopify.com/en/manual/products/import-export/using-csv),
  read on 24 November 2026: the column names, Status values (`active`, `draft`, `archived`),
  inventory policy (`deny`, `continue`), weight units, UTF-8 and commas. Shopify changes this
  format. If a current export is flagged, please open an issue.
- **WooCommerce** rules follow the built-in Product CSV Importer and Exporter, checked against
  an export in September 2026. Plugins add their own columns and product types, so those are
  reported as info or warnings, never errors.
- **Only the file is checked.** Products already in your store aren't known, so a variation
  whose parent exists only in the store is a warning, not an error.
- **Not checked:** category and collection names, tax codes, metafield values, and whether
  image URLs actually load.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)
