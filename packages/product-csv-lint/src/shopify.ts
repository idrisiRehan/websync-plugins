// Shopify product CSV rules.
//
// Source: https://help.shopify.com/en/manual/products/import-export/using-csv, read
// 2026-11-24. Shopify renamed most columns in its current format ("URL handle", "Price",
// "Product image URL" ...). Files in the older format ("Handle", "Variant Price",
// "Image Src" ...) are still common, so each column accepts both names, current one first.
//
// How Shopify reads rows: the first row of a product carries the product fields; following
// rows with the same handle add variants (with option values) or extra images (with only
// the handle and an image URL). Title is the only required column for new products.

import { append, reportDuplicates, rowsOf, type ColumnRule, type PlatformRules, type Sheet, type Report } from "./core.ts";
import type { CsvRecord } from "./csv.ts";

/** Every Shopify column this package reads, current name first. Exported for products.ts. */
export const COL = {
  handle: ["URL handle", "Handle"],
  title: ["Title"],
  description: ["Description", "Body (HTML)"],
  vendor: ["Vendor"],
  productCategory: ["Product category"],
  type: ["Type"],
  tags: ["Tags"],
  published: ["Published on online store", "Published"],
  status: ["Status"],
  giftCard: ["Gift card", "Gift Card"],
  seoDescription: ["SEO description"],
  sku: ["SKU", "Variant SKU"],
  price: ["Price", "Variant Price"],
  compareAt: ["Compare-at price", "Variant Compare At Price"],
  barcode: ["Barcode", "Variant Barcode"],
  // The current format's list: up to 20 barcodes separated by semicolons, each optionally
  // prefixed with its type ("upc:..."). It replaces the single Barcode column. The help page
  // names it Barcodes; Shopify's own sample file (product_template.csv) has Variant Barcodes.
  barcodes: ["Barcodes", "Variant Barcodes"],
  inventoryTracker: ["Inventory tracker", "Variant Inventory Tracker"],
  inventoryQuantity: ["Inventory quantity", "Variant Inventory Qty"],
  inventoryPolicy: ["Continue selling when out of stock", "Variant Inventory Policy"],
  imageSrc: ["Product image URL", "Image Src"],
  imagePosition: ["Image position", "Image Position"],
  variantImage: ["Variant image URL", "Variant Image"],
  // A variant's own value: the sample file has a different MPN on each variant row.
  mpn: ["Google Shopping / Manufacturer part number (MPN)", "Google Shopping / MPN"],
  optionName: [1, 2, 3].map((n) => [`Option${n} name`, `Option${n} Name`]),
  optionValue: [1, 2, 3].map((n) => [`Option${n} value`, `Option${n} Value`]),
} as const;

const COLUMNS: ColumnRule[] = [
  { names: COL.price, type: "decimal" },
  { names: COL.compareAt, type: "decimal" },
  { names: ["Cost per item"], type: "decimal" },
  { names: ["Weight value (grams)", "Variant Grams"], type: "decimal" },
  { names: COL.inventoryQuantity, type: "integer" },
  { names: COL.imagePosition, type: "integer" },
  { names: COL.published, type: "boolean" },
  { names: ["Charge tax", "Variant Taxable"], type: "boolean" },
  { names: ["Requires shipping", "Variant Requires Shipping"], type: "boolean" },
  { names: COL.giftCard, type: "boolean" },
  { names: COL.status, type: "enum", values: ["active", "draft", "archived"] },
  { names: COL.inventoryPolicy, type: "enum", values: ["deny", "continue"] },
  { names: ["Weight unit for display", "Variant Weight Unit"], type: "enum", values: ["g", "kg", "lb", "oz"] },
  { names: COL.imageSrc, type: "url" },
  { names: COL.variantImage, type: "url" },
  { names: COL.barcode, type: "barcode", severity: "warning" },
  { names: COL.barcodes, type: "barcode", severity: "warning", list: true },
];

const KNOWN = [
  ...COLUMNS.flatMap((c) => c.names),
  ...COL.handle,
  ...COL.title,
  ...COL.sku,
  ...COL.description,
  ...COL.vendor,
  ...COL.productCategory,
  ...COL.type,
  ...COL.tags,
  "Collection",
  ...COL.inventoryTracker,
  "Fulfillment service",
  "Variant Fulfillment Service",
  "Image alt text",
  "SEO title",
  ...COL.seoDescription,
  "Variant Tax Code",
  "Packed product length",
  "Packed product width",
  "Packed product height",
  "Packed product dimension unit",
];

const KNOWN_PATTERNS = [
  /^Option[123] (name|value|LinkedTo|Linked To)$/i,
  /^(Price|Compare-at price|Compare At Price|Included) \/ .+$/i,
  /^Google Shopping \/ .+$/i,
  /\((product|variant)\.metafields\.[^.)]+\.[^)]+\)$/i,
];

// A row that only adds an image to the product above: no option values, SKU or price.
export function isVariantRow(sheet: Sheet, record: CsvRecord, h: Columns): boolean {
  return h.optionValue.some((col) => sheet.cell(record, col) !== "") || sheet.cell(record, h.sku) !== "" || sheet.cell(record, h.price) !== "";
}

export interface Columns {
  handle?: string;
  title?: string;
  sku?: string;
  price?: string;
  compareAt?: string;
  imagePosition?: string;
  optionName: (string | undefined)[];
  optionValue: (string | undefined)[];
}

/** The headers this file uses for the columns the checks need. */
export function findColumns(sheet: Sheet): Columns {
  return {
    handle: sheet.find(COL.handle),
    title: sheet.find(COL.title),
    sku: sheet.find(COL.sku),
    price: sheet.find(COL.price),
    compareAt: sheet.find(COL.compareAt),
    imagePosition: sheet.find(COL.imagePosition),
    optionName: COL.optionName.map((names) => sheet.find(names)),
    optionValue: COL.optionValue.map((names) => sheet.find(names)),
  };
}

function checkGroup(sheet: Sheet, group: CsvRecord[], h: Columns, report: Report): number {
  const variants = group.filter((record) => isVariantRow(sheet, record, h));

  for (const record of group.slice(1)) {
    const title = sheet.cell(record, h.title);
    if (title !== "") {
      report("title-repeated", "warning", "Repeats a Title on a following row of the same product. Shopify reads product fields from the first row only, so leave it blank here.", { row: record.row, column: h.title, value: title });
    }
  }

  h.optionName.forEach((col) => {
    if (!col) return;
    const names = new Set(group.map((r) => sheet.cell(r, col)).filter((v) => v !== ""));
    if (names.size < 2) return;
    for (const record of group) {
      report("option-name-inconsistent", "error", `"${col}" differs within this product (${[...names].join(", ")}). Every row of a product must use the same option names.`, { row: record.row, column: col, value: sheet.cell(record, col) });
    }
  });

  const combos = new Map<string, CsvRecord[]>();
  for (const record of variants) {
    const combo = h.optionValue.map((col) => sheet.cell(record, col)).join("\u0000");
    append(combos, combo, record);
  }
  for (const list of combos.values()) {
    if (list.length < 2) continue;
    for (const record of list) {
      report("variant-duplicate", "error", `Same option values as row ${rowsOf(list, record)} of this product, so Shopify can't tell the variants apart.`, { row: record.row });
    }
  }

  const positions = new Map<string, CsvRecord[]>();
  for (const record of group) {
    const pos = sheet.cell(record, h.imagePosition);
    if (/^\d+$/.test(pos)) append(positions, pos, record);
  }
  for (const [pos, list] of positions) {
    if (list.length < 2) continue;
    for (const record of list) {
      report("image-position-duplicate", "error", `Image position ${pos} is also used on row ${rowsOf(list, record)} of this product.`, { row: record.row, column: h.imagePosition, value: pos });
    }
  }

  return variants.length;
}

function check(sheet: Sheet, report: Report): { productCount: number; variantCount: number } {
  const h = findColumns(sheet);

  if (h.price && h.compareAt) {
    for (const record of sheet.records) {
      const price = sheet.cell(record, h.price);
      const compareAt = sheet.cell(record, h.compareAt);
      if (/^\d+(\.\d+)?$/.test(price) && /^\d+(\.\d+)?$/.test(compareAt) && Number(compareAt) > 0 && Number(compareAt) < Number(price)) {
        report("compare-at-below-price", "warning", `Compare-at price ${compareAt} is lower than the price ${price}. It imports, but the product shows a "sale" that costs more.`, { row: record.row, column: h.compareAt, value: compareAt });
      }
    }
  }

  reportDuplicates(sheet, h.sku, report, "sku-duplicate", "SKU", "Each variant needs its own SKU for inventory and orders to match.");

  if (!h.handle) {
    // Without handles every row is its own product (Shopify derives a handle from the Title).
    const variantCount = sheet.records.filter((record) => isVariantRow(sheet, record, h)).length;
    return { productCount: sheet.records.length, variantCount };
  }

  const groups = new Map<string, CsvRecord[]>();
  for (const record of sheet.records) {
    const handle = sheet.cell(record, h.handle);
    if (handle === "") {
      report("handle-missing", "error", "Row has no URL handle, so Shopify can't tell which product it belongs to.", { row: record.row, column: h.handle });
      continue;
    }
    append(groups, handle, record);
  }

  let variantCount = 0;
  for (const group of groups.values()) variantCount += checkGroup(sheet, group, h, report);
  return { productCount: groups.size, variantCount };
}

export const shopify: PlatformRules = {
  platform: "shopify",
  label: "Shopify",
  semicolonSeverity: "error",
  semicolonNote: "Shopify requires commas: re-save it as \"CSV UTF-8 (Comma delimited)\".",
  required: [COL.title],
  recommended: [COL.handle],
  known: KNOWN,
  knownPatterns: KNOWN_PATTERNS,
  columns: COLUMNS,
  check,
};

/** Header names that only a Shopify product CSV uses, for platform detection. */
export const SHOPIFY_MARKERS = [...COL.handle, ...COL.imageSrc, "Variant Price", "Option1 value", "Option1 Value", "Body (HTML)"];
