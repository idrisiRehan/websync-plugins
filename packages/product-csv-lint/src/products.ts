// Reads a Shopify or WooCommerce product export into product records: product fields,
// variants, images, options, inventory and status, each with its spreadsheet row. It reports
// nothing: lintProductCsv() says what is wrong with a file, this says what is in it, using the
// same column names (current and legacy Shopify headers) and the same parent wiring. Values are
// kept as written, trimmed; only the platform conventions noted below are applied.

import { validateGtin } from "websync-validators";
import { barcodeEntries, GS1_BARCODE_TYPES, makeSheet, type Sheet } from "./core.ts";
import { detectDelimiter, parseCsv, type CsvRecord } from "./csv.ts";
import type { Platform } from "./lint.ts";
import { COL as SHOPIFY, findColumns, isVariantRow } from "./shopify.ts";
import { COL as WOO, attributeSlots, baseType, findParent } from "./woocommerce.ts";

export interface ProductOption {
  name: string;
  value: string;
}

export interface Inventory {
  /** Whether stock is counted. Null when the export doesn't say. */
  tracked: boolean | null;
  /** Units in stock, or null when the cell isn't a whole number. */
  quantity: number | null;
  /** Sold when out of stock: Shopify's "continue" policy, WooCommerce's backorders allowed. */
  continueSelling: boolean | null;
  /** WooCommerce's exported stock status ("In stock?"). Shopify exports have none: null. */
  status: "in_stock" | "out_of_stock" | "backorder" | null;
}

export interface ProductVariant {
  row: number;
  /** WooCommerce product or variation ID. Shopify exports have no variant IDs: "". */
  id: string;
  sku: string;
  /** Option name and value pairs. Shopify's placeholder "Title: Default Title" is left out. */
  options: ProductOption[];
  /** The regular price, as written. */
  price: string;
  /** The sale price, or "". Shopify: a compare-at price above Price makes Price the sale price. */
  salePrice: string;
  /** WooCommerce sale schedule, as exported ("2026-12-01 0:00:00"), or "". */
  saleStarts: string;
  saleEnds: string;
  /** The barcode cell as written. */
  barcode: string;
  /** The first barcode entry that is a valid GTIN (GS1 check digit), as digits, or null. */
  gtin: string | null;
  /** WooCommerce MPN column, or Shopify Google Shopping / MPN on the variant row, or "". */
  mpn: string;
  /** The variant's own image URL, or "". */
  image: string;
  /** A WooCommerce variation's own description (HTML), or "". */
  description: string;
  /** False for a disabled WooCommerce variation (Published 0 or -1). */
  enabled: boolean;
  inventory: Inventory;
}

export interface Product {
  platform: Platform;
  /** Row of the product's first line. */
  row: number;
  /** Shopify URL handle, or "". */
  handle: string;
  /** WooCommerce ID, or "". */
  id: string;
  /** WooCommerce SKU of the product (for a variable product, the parent SKU), or "". */
  sku: string;
  /** WooCommerce type (simple, variable, grouped, external or a plugin's type). "" for Shopify. */
  type: string;
  title: string;
  /** HTML as written (WooCommerce's escaped line breaks restored). */
  description: string;
  /** WooCommerce short description, or Shopify SEO description. */
  summary: string;
  /** Shopify Vendor, or the first WooCommerce Brands entry. */
  brand: string;
  /** Shopify Type. */
  productType: string;
  /** Shopify Product category, or the WooCommerce Categories list. */
  categories: string[];
  tags: string[];
  /** Shopify: active, draft or archived. WooCommerce: active, private, draft or pending. */
  status: string;
  /** False when Shopify's online store publishing is off, or WooCommerce visibility is hidden. */
  visible: boolean;
  giftCard: boolean;
  /** Product images in display order, main image first. */
  images: string[];
  options: { name: string; values: string[] }[];
  variants: ProductVariant[];
  /** Shopify "Google Shopping / X" columns, keyed by X in lowercase ("gender", "condition", "custom product"), from the first row. */
  google: Record<string, string>;
}

export interface ProductsResult {
  platform: Platform;
  products: Product[];
  /** Rows that belong to no product: no Shopify handle, or a variation whose parent isn't usable. */
  unread: { row: number; reason: string }[];
  /** Data rows, excluding the header and blank lines. */
  rowCount: number;
}

type Read = Pick<ProductsResult, "products" | "unread">;

const DECIMAL = /^\d+(\.\d+)?$/;
const WHOLE = /^-?\d+$/;
const GOOGLE_SHOPPING = /^Google Shopping \/ (.+)$/i;

/**
 * Reads a product export. Bytes are decoded as UTF-8, with invalid sequences replaced (lint the
 * file to find them). Never throws on bad input: unreadable rows end up in `unread` or as
 * products with empty fields.
 */
export function readProducts(input: string | Uint8Array, platform: Platform): ProductsResult {
  let text = typeof input === "string" ? input : new TextDecoder().decode(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const [header, ...rows] = parseCsv(text, detectDelimiter(text)).records;
  const sheet = makeSheet((header?.cells ?? []).map((h) => h.trim()), rows);
  return { platform, rowCount: rows.length, ...(platform === "shopify" ? readShopify(sheet) : readWooCommerce(sheet)) };
}

/**
 * The first valid GTIN in a barcode cell. A list (Shopify's Barcodes) is searched by type: GTIN,
 * UPC, EAN and ISBN entries first, then untyped (Custom) ones; ASIN, NS-PID and other types
 * are never GTINs. A single barcode column holds one value.
 */
function firstGtin(cell: string, list: boolean): string | null {
  const entries = list ? barcodeEntries(cell) : [{ type: "", value: cell }];
  const ordered = [...entries.filter((e) => GS1_BARCODE_TYPES.includes(e.type)), ...entries.filter((e) => e.type === "")];
  for (const entry of ordered) {
    const result = validateGtin(entry.value);
    if (result.valid) return result.normalized;
  }
  return null;
}

const splitComma = (value: string) => value.split(",").map((v) => v.trim()).filter((v) => v !== "");

// Shopify: the first row of a handle carries the product fields; following rows add variants
// or images (https://help.shopify.com/en/manual/products/import-export/using-csv).
function readShopify(sheet: Sheet): Read {
  const h = findColumns(sheet);
  const col = {
    description: sheet.find(SHOPIFY.description),
    vendor: sheet.find(SHOPIFY.vendor),
    productCategory: sheet.find(SHOPIFY.productCategory),
    type: sheet.find(SHOPIFY.type),
    tags: sheet.find(SHOPIFY.tags),
    published: sheet.find(SHOPIFY.published),
    status: sheet.find(SHOPIFY.status),
    giftCard: sheet.find(SHOPIFY.giftCard),
    seoDescription: sheet.find(SHOPIFY.seoDescription),
    barcodes: sheet.find(SHOPIFY.barcodes),
    barcode: sheet.find([...SHOPIFY.barcodes, ...SHOPIFY.barcode]),
    inventoryTracker: sheet.find(SHOPIFY.inventoryTracker),
    inventoryQuantity: sheet.find(SHOPIFY.inventoryQuantity),
    inventoryPolicy: sheet.find(SHOPIFY.inventoryPolicy),
    imageSrc: sheet.find(SHOPIFY.imageSrc),
    variantImage: sheet.find(SHOPIFY.variantImage),
    mpn: sheet.find(SHOPIFY.mpn),
  };
  const google = sheet.headers.flatMap((header) => {
    const m = GOOGLE_SHOPPING.exec(header);
    return m ? [[m[1].trim().toLowerCase(), header] as const] : [];
  });

  const unread: Read["unread"] = [];
  const groups = new Map<string, CsvRecord[]>();
  for (const record of sheet.records) {
    const handle = sheet.cell(record, h.handle);
    if (h.handle && handle === "") {
      unread.push({ row: record.row, reason: "No URL handle, so the row belongs to no product." });
      continue;
    }
    // Without a handle column every row is its own product, as Shopify imports it.
    const key = h.handle ? handle : `row ${record.row}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const products: Product[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const get = (header: string | undefined) => sheet.cell(first, header);
    const names = h.optionName.map((header) => group.map((r) => sheet.cell(r, header)).find((name) => name !== "") ?? "");

    const variants = group
      .filter((record, i) => i === 0 || isVariantRow(sheet, record, h))
      .map((record): ProductVariant => {
        const cell = (header: string | undefined) => sheet.cell(record, header);
        const price = cell(h.price);
        const compareAt = cell(h.compareAt);
        const onSale = DECIMAL.test(price) && DECIMAL.test(compareAt) && Number(compareAt) > Number(price);
        const barcode = cell(col.barcode);
        const quantity = cell(col.inventoryQuantity);
        const policy = cell(col.inventoryPolicy).toLowerCase();
        return {
          row: record.row,
          id: "",
          sku: cell(h.sku),
          options: names.flatMap((name, i) => {
            const value = cell(h.optionValue[i]);
            if (value === "" || (name === "Title" && value === "Default Title")) return [];
            return [{ name: name || `Option${i + 1}`, value }];
          }),
          price: onSale ? compareAt : price,
          salePrice: onSale ? price : "",
          saleStarts: "",
          saleEnds: "",
          barcode,
          gtin: firstGtin(barcode, col.barcodes !== undefined),
          mpn: cell(col.mpn),
          image: cell(col.variantImage),
          description: "",
          enabled: true,
          inventory: {
            // A blank tracker means Shopify doesn't track stock, so the variant is always sold.
            tracked: col.inventoryTracker ? cell(col.inventoryTracker) !== "" : null,
            quantity: WHOLE.test(quantity) ? Number(quantity) : null,
            continueSelling: policy === "continue" ? true : policy === "deny" ? false : null,
            status: null,
          },
        };
      });

    const images = group
      .map((record, order) => ({ url: sheet.cell(record, col.imageSrc), position: Number(sheet.cell(record, h.imagePosition)) || Infinity, order }))
      .filter((image) => image.url !== "")
      .sort((a, b) => a.position - b.position || a.order - b.order)
      .map((image) => image.url);

    products.push({
      platform: "shopify",
      row: first.row,
      handle: get(h.handle),
      id: "",
      sku: "",
      type: "",
      title: get(h.title),
      description: get(col.description),
      summary: get(col.seoDescription),
      brand: get(col.vendor),
      productType: get(col.type),
      categories: get(col.productCategory) ? [get(col.productCategory)] : [],
      tags: splitComma(get(col.tags)),
      // Shopify's defaults: Status active, Published on online store true.
      status: get(col.status).toLowerCase() || "active",
      visible: !/^false$/i.test(get(col.published)),
      giftCard: /^true$/i.test(get(col.giftCard)),
      images: [...new Set(images)],
      options: optionsOf(variants),
      variants,
      google: Object.fromEntries(google.map(([key, header]) => [key, get(header)]).filter(([, value]) => value !== "")),
    });
  }
  return { products, unread };
}

function optionsOf(variants: ProductVariant[]): Product["options"] {
  const byName = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const { name, value } of variant.options) {
      const values = byName.get(name) ?? new Set<string>();
      values.add(value);
      byName.set(name, values);
    }
  }
  return [...byName].map(([name, values]) => ({ name, values: [...values] }));
}

// WooCommerce's exporter (class-wc-csv-exporter.php) joins list values with ", " and escapes
// commas inside a value as "\,".
function splitList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === ",") {
      current += ",";
      i++;
    } else if (value[i] === ",") {
      out.push(current.trim());
      current = "";
    } else current += value[i];
  }
  out.push(current.trim());
  return out.filter((v) => v !== "");
}

// The exporter writes a real line break in a description as the two characters \n, and a
// literal \n as \\n (filter_description_field in class-wc-product-csv-exporter.php).
const restoreLineBreaks = (value: string) => value.replace(/\\\\n|\\n/g, (m) => (m.length === 3 ? "\\n" : "\n"));

// The exporter puts a ' before a value starting with =, +, -, @, tab or carriage return, so a
// spreadsheet doesn't run it as a formula (escape_data in class-wc-csv-exporter.php).
const unescapeFormula = (value: string) => (/^'[=+\-@\x09\x0d]/.test(value) ? value.slice(1) : value);

const WOO_STATUS = new Map([["", "active"], ["1", "active"], ["0", "private"], ["-1", "draft"], ["2", "pending"]]);
const YES = ["1", "yes", "true"];
const NO = ["0", "no", "false"];

function readWooCommerce(sheet: Sheet): Read {
  const col = Object.fromEntries(Object.entries(WOO).map(([key, names]) => [key, sheet.find(names)])) as Record<keyof typeof WOO, string | undefined>;
  const get = (record: CsvRecord, key: keyof typeof WOO) => unescapeFormula(sheet.cell(record, col[key]));
  const slots = attributeSlots(sheet.headers).map((slot) => ({ name: sheet.find([`Attribute ${slot} name`]), values: sheet.find([`Attribute ${slot} value(s)`]) }));
  // The type as the linter reads it ("simple, downloadable, virtual" is simple); WooCommerce
  // imports a blank type as simple.
  const typeOf = (record: CsvRecord) => baseType(get(record, "type")) || "simple";

  const variant = (record: CsvRecord, options: ProductOption[], variation: boolean): ProductVariant => {
    const barcode = get(record, "gtin");
    const stock = get(record, "stock");
    const backorders = get(record, "backorders").toLowerCase();
    const inStock = get(record, "stockStatus").toLowerCase();
    return {
      row: record.row,
      id: get(record, "id"),
      sku: get(record, "sku"),
      options,
      price: get(record, "regularPrice"),
      salePrice: get(record, "salePrice"),
      saleStarts: get(record, "saleStarts"),
      saleEnds: get(record, "saleEnds"),
      barcode,
      gtin: firstGtin(barcode, false),
      mpn: get(record, "mpn"),
      image: variation ? (splitList(get(record, "images"))[0] ?? "") : "",
      description: variation ? restoreLineBreaks(get(record, "description")) : "",
      enabled: !variation || WOO_STATUS.get(get(record, "published")) === "active",
      inventory: {
        // A number manages stock, "parent" defers to the parent's, blank doesn't manage it.
        tracked: col.stock ? stock !== "" : null,
        quantity: WHOLE.test(stock) ? Number(stock) : null,
        continueSelling: backorders === "notify" || YES.includes(backorders) ? true : NO.includes(backorders) ? false : null,
        status: YES.includes(inStock) ? "in_stock" : NO.includes(inStock) ? "out_of_stock" : inStock === "backorder" ? "backorder" : null,
      },
    };
  };

  const bySku = new Map<string, CsvRecord>();
  const byId = new Map<string, CsvRecord>();
  for (const record of sheet.records) {
    const sku = get(record, "sku");
    const id = get(record, "id");
    if (sku !== "" && !bySku.has(sku)) bySku.set(sku, record);
    if (id !== "" && !byId.has(id)) byId.set(id, record);
  }

  const products: Product[] = [];
  const byRecord = new Map<CsvRecord, Product>();
  for (const record of sheet.records) {
    const type = typeOf(record);
    if (type === "variation") continue;
    const product: Product = {
      platform: "woocommerce",
      row: record.row,
      handle: "",
      id: get(record, "id"),
      sku: get(record, "sku"),
      type,
      title: get(record, "name"),
      description: restoreLineBreaks(get(record, "description")),
      summary: restoreLineBreaks(get(record, "shortDescription")),
      brand: splitList(get(record, "brands"))[0] ?? "",
      productType: "",
      categories: splitList(get(record, "categories")),
      tags: splitList(get(record, "tags")),
      status: WOO_STATUS.get(get(record, "published")) ?? get(record, "published"),
      visible: get(record, "visibility").toLowerCase() !== "hidden",
      giftCard: false,
      images: [...new Set(splitList(get(record, "images")))],
      options: slots
        .map((slot) => ({ name: unescapeFormula(sheet.cell(record, slot.name)), values: splitList(unescapeFormula(sheet.cell(record, slot.values))) }))
        .filter((option) => option.name !== "" && option.values.length > 0),
      variants: [],
      google: {},
    };
    if (type !== "variable") product.variants.push(variant(record, [], false));
    products.push(product);
    byRecord.set(record, product);
  }

  const unread: Read["unread"] = [];
  for (const record of sheet.records) {
    if (typeOf(record) !== "variation") continue;
    const ref = get(record, "parent");
    const parentRecord = ref === "" ? undefined : findParent(ref, bySku, byId);
    const parent = parentRecord && byRecord.get(parentRecord);
    if (!parentRecord || !parent || parent.type !== "variable") {
      const why = ref === "" ? "has no Parent" : !parent ? `has Parent "${ref}", which isn't a product in this file` : `has Parent "${ref}", a ${parent.type} product, not a variable one`;
      unread.push({ row: record.row, reason: `This variation ${why}.` });
      continue;
    }
    // A variation takes one value per attribute; a blank one means "any" value.
    const options = slots.flatMap((slot) => {
      const value = splitList(unescapeFormula(sheet.cell(record, slot.values)))[0] ?? "";
      const name = unescapeFormula(sheet.cell(record, slot.name) || sheet.cell(parentRecord, slot.name));
      return value !== "" && name !== "" ? [{ name, value }] : [];
    });
    parent.variants.push(variant(record, options, true));
  }
  return { products, unread };
}
