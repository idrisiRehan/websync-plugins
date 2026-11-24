// WooCommerce product CSV rules, for the file shape the built-in Product CSV Importer and
// Exporter read and write. Column names and value sets were last checked against a
// WooCommerce export in 2026-09. Header spelling varies by store locale ("Visibility in
// catalog" / "catalogue") and unit settings ("Weight (kg)" / "Weight (lbs)"), so both
// forms are accepted.
//
// Where a rule depends on store settings or on products that already exist outside the
// file, the finding is a warning that says so, never an error.

import { reportDuplicates, type ColumnRule, type PlatformRules, type Report, type Sheet } from "./core.ts";
import type { CsvRecord } from "./csv.ts";

const PRODUCT_TYPES = ["simple", "variable", "variation", "grouped", "external"];
const ATTRIBUTE = /^Attribute (\d+) (name|value\(s\)|visible|global|default)$/i;

const VISIBILITY = ["visible", "catalog", "catalogue", "search", "hidden"];

/** The WooCommerce columns products.ts reads, as the exporter names them. */
export const COL = {
  id: ["ID"],
  type: ["Type"],
  sku: ["SKU"],
  name: ["Name"],
  parent: ["Parent"],
  published: ["Published"],
  visibility: ["Visibility in catalog", "Visibility in catalogue"],
  shortDescription: ["Short description"],
  description: ["Description"],
  saleStarts: ["Date sale price starts"],
  saleEnds: ["Date sale price ends"],
  stockStatus: ["In stock?"],
  stock: ["Stock"],
  backorders: ["Backorders allowed?"],
  regularPrice: ["Regular price"],
  salePrice: ["Sale price"],
  categories: ["Categories"],
  tags: ["Tags"],
  brands: ["Brands"],
  images: ["Images"],
  gtin: ["GTIN, UPC, EAN, or ISBN"],
  mpn: ["MPN"],
} as const;

const COLUMNS: ColumnRule[] = [
  { names: COL.id, type: "integer" },
  { names: COL.stock, type: "integer" },
  { names: ["Low stock amount"], type: "integer" },
  { names: ["Position"], type: "integer" },
  { names: ["Download limit"], type: "integer" },
  { names: ["Download expiry days"], type: "integer" },
  { names: COL.regularPrice, type: "decimal" },
  { names: COL.salePrice, type: "decimal" },
  { names: ["External URL"], type: "url" },
  { names: COL.images, type: "images" },
  { names: COL.gtin, type: "barcode", severity: "warning" },
  // The exporter writes "backorder" for a product on backorder, 1 or 0 otherwise
  // (get_column_value_stock_status in class-wc-product-csv-exporter.php).
  { names: COL.stockStatus, type: "flag", severity: "warning", values: ["backorder"] },
  ...["Is featured?", "Sold individually?", "Allow customer reviews?", "Downloadable", "Virtual"].map(
    (name): ColumnRule => ({ names: [name], type: "flag", severity: "warning" }),
  ),
  // The exporter writes 2 for a product pending review (get_column_value_published).
  { names: COL.published, type: "enum", severity: "warning", values: ["1", "0", "-1", "2"], hint: "1 publishes the product, 0 makes it private, -1 leaves it as a draft and 2 pending review." },
  { names: COL.backorders, type: "enum", severity: "warning", values: ["0", "1", "notify", "yes", "no"], hint: "notify allows a backorder and warns the customer." },
  { names: COL.visibility, type: "enum", severity: "warning", values: VISIBILITY },
  { names: ["Tax status"], type: "enum", severity: "warning", values: ["taxable", "shipping", "none"] },
];

const KNOWN = [
  ...COLUMNS.flatMap((c) => c.names),
  "Type",
  "SKU",
  "Name",
  "Short description",
  "Description",
  "Date sale price starts",
  "Date sale price ends",
  "Tax class",
  "Purchase note",
  "Categories",
  "Tags",
  "Brands",
  "Shipping class",
  "Parent",
  "Grouped products",
  "Upsells",
  "Cross-sells",
  "Button text",
  // Default export columns of current WooCommerce (get_default_column_names in
  // class-wc-product-csv-exporter.php); Cost of goods only with that feature on.
  ...COL.mpn,
  "Commodity code (HS code)",
  "Country of origin",
  "Customs description",
  "Cost of goods",
];

const KNOWN_PATTERNS = [ATTRIBUTE, /^(Weight|Length|Width|Height) \(.+\)$/i, /^Meta: .+$/, /^Download \d+ (name|URL)$/i];

export function attributeSlots(headers: string[]): number[] {
  const slots = new Set<number>();
  for (const h of headers) {
    const m = ATTRIBUTE.exec(h);
    if (m) slots.add(Number(m[1]));
  }
  return [...slots].sort((a, b) => a - b);
}

/**
 * The product type in a Type cell, lower-cased, or "". The exporter adds "downloadable" and
 * "virtual" to the type as flags, like "simple, downloadable, virtual" (get_column_value_type in
 * class-wc-product-csv-exporter.php).
 */
export function baseType(cell: string): string {
  return cell.toLowerCase().split(",").map((t) => t.trim()).find((t) => t !== "" && t !== "downloadable" && t !== "virtual") ?? "";
}

/** The row a variation's Parent points at: "id:123" by ID, otherwise by SKU, then by ID. */
export function findParent(ref: string, bySku: ReadonlyMap<string, CsvRecord>, byId: ReadonlyMap<string, CsvRecord>): CsvRecord | undefined {
  const idRef = /^id:\s*(\d+)$/i.exec(ref);
  return idRef ? byId.get(idRef[1]) : (bySku.get(ref) ?? byId.get(ref));
}

function check(sheet: Sheet, report: Report): { productCount: number; variantCount: number } {
  const col = {
    id: sheet.find(COL.id),
    type: sheet.find(COL.type),
    sku: sheet.find(COL.sku),
    name: sheet.find(COL.name),
    parent: sheet.find(COL.parent),
    regular: sheet.find(COL.regularPrice),
    sale: sheet.find(COL.salePrice),
  };
  const typeOf = (record: CsvRecord) => baseType(sheet.cell(record, col.type));
  const slots = attributeSlots(sheet.headers);
  const attrName = (slot: number) => sheet.find([`Attribute ${slot} name`]);
  const attrValues = (slot: number) => sheet.find([`Attribute ${slot} value(s)`]);

  for (const slot of slots) {
    const [name, values] = [attrName(slot), attrValues(slot)];
    if (Boolean(name) !== Boolean(values)) {
      const missing = name ? `Attribute ${slot} value(s)` : `Attribute ${slot} name`;
      report("attribute-pair-missing", "error", `"${missing}" is missing. An attribute needs both its name and value(s) columns.`, { row: 1, column: missing });
    }
  }

  if (col.type) {
    for (const record of sheet.records) {
      const type = sheet.cell(record, col.type);
      if (typeOf(record) === "") {
        report("type-missing", "warning", "No product type. WooCommerce falls back to \"simple\", which is wrong for anything with variations.", { row: record.row, column: col.type });
      } else if (!PRODUCT_TYPES.includes(typeOf(record))) {
        report("type-unknown", "warning", `"${type}" isn't one of WooCommerce's built-in types (${PRODUCT_TYPES.join(", ")}). Plugins add their own types, so check it isn't a typo.`, { row: record.row, column: col.type, value: type });
      }
    }
  }

  if (col.regular && col.sale) {
    for (const record of sheet.records) {
      const regular = sheet.cell(record, col.regular);
      const sale = sheet.cell(record, col.sale);
      if (/^\d+(\.\d+)?$/.test(regular) && /^\d+(\.\d+)?$/.test(sale) && Number(sale) >= Number(regular)) {
        report("sale-not-below-regular", "error", `Sale price ${sale} isn't below the regular price ${regular}, so no sale price will show.`, { row: record.row, column: col.sale, value: sale });
      }
    }
  }

  if (col.name) {
    for (const record of sheet.records) {
      if (typeOf(record) !== "variation" && sheet.cell(record, col.name) === "") {
        report("name-missing", "warning", "No product name. A row that updates an existing product keeps its current name, but a new product gets an empty title.", { row: record.row, column: col.name });
      }
    }
  }

  reportDuplicates(sheet, col.sku, report, "sku-duplicate", "SKU", "WooCommerce rejects a second product with the same SKU.");
  reportDuplicates(sheet, col.id, report, "id-duplicate", "ID", "WooCommerce rejects a second product with the same ID.");

  const bySku = new Map<string, CsvRecord>();
  const byId = new Map<string, CsvRecord>();
  for (const record of sheet.records) {
    const sku = sheet.cell(record, col.sku);
    const id = sheet.cell(record, col.id);
    if (sku !== "" && !bySku.has(sku)) bySku.set(sku, record);
    if (id !== "" && !byId.has(id)) byId.set(id, record);
  }

  const parentsWithVariations = new Set<CsvRecord>();
  if (col.type && col.parent) {
    for (const record of sheet.records) {
      if (typeOf(record) !== "variation") continue;
      const at = { row: record.row, column: col.parent };
      const parentRef = sheet.cell(record, col.parent);
      if (parentRef === "") {
        report("parent-missing", "error", "A variation needs a Parent: the parent's SKU, or id:123 for its product ID.", at);
        continue;
      }
      const parent = findParent(parentRef, bySku, byId);
      if (!parent) {
        report("parent-not-found", "warning", `Parent "${parentRef}" matches no SKU or ID in this file. Fine if that product already exists in the store; otherwise the variation has nowhere to go.`, { ...at, value: parentRef });
        continue;
      }
      parentsWithVariations.add(parent);
      const parentType = typeOf(parent);
      if (parentType !== "" && parentType !== "variable") {
        report("parent-not-variable", "error", `Parent "${parentRef}" is row ${parent.row}, a "${parentType}" product. Only a variable product can have variations.`, { ...at, value: parentRef });
      }

      const parentAttributes = new Set(slots.map((slot) => sheet.cell(parent, attrName(slot)).toLowerCase()).filter((n) => n !== ""));
      for (const slot of slots) {
        const valuesCol = attrValues(slot);
        const value = sheet.cell(record, valuesCol);
        if (value.includes(",")) {
          report("variation-attribute-list", "warning", `"${value}" is a list, but a variation takes one value per attribute. The full list belongs on the parent row.`, { row: record.row, column: valuesCol, value });
        }
        const name = sheet.cell(record, attrName(slot));
        if (name !== "" && parentAttributes.size > 0 && !parentAttributes.has(name.toLowerCase())) {
          report("variation-attribute-unknown", "warning", `Attribute "${name}" isn't declared on the parent (row ${parent.row}). Check the spelling matches exactly.`, { row: record.row, column: attrName(slot), value: name });
        }
      }
    }

    for (const record of sheet.records) {
      if (typeOf(record) === "variable" && !parentsWithVariations.has(record)) {
        report("variable-without-variations", "warning", "Typed as variable, but no variation in this file points at it. It imports with nothing to buy unless its variations come in another file.", { row: record.row, column: col.type, value: "variable" });
      }
    }
  }

  const variantCount = col.type ? sheet.records.filter((record) => typeOf(record) === "variation").length : 0;
  return { productCount: sheet.records.length - variantCount, variantCount };
}

export const woocommerce: PlatformRules = {
  platform: "woocommerce",
  label: "WooCommerce",
  semicolonSeverity: "warning",
  semicolonNote: "WooCommerce expects commas unless you set the delimiter under the importer's advanced options.",
  required: [["Type"], ["Name"]],
  recommended: [["SKU"], ["Regular price"]],
  known: KNOWN,
  knownPatterns: KNOWN_PATTERNS,
  columns: COLUMNS,
  check,
};

/** Header names that only a WooCommerce product CSV uses, for platform detection. */
export const WOOCOMMERCE_MARKERS = ["Regular price", "Sale price", "In stock?", "Visibility in catalog", "Visibility in catalogue", "Parent", "Short description"];
