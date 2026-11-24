export { lintProductCsv, detectPlatform } from "./lint.ts";
export type { Platform } from "./lint.ts";
// The CSV reader, a documented building block reused by product-feed-lint (ADR 0006).
export { parseCsv } from "./csv.ts";
export type { CsvIssue, CsvRecord, ParsedCsv } from "./csv.ts";
export type { CsvFinding, ProductCsvResult, RuleId, Severity } from "./core.ts";
// Product records read from an export, a building block for product-feed-build.
export { readProducts } from "./products.ts";
export type { Inventory, Product, ProductOption, ProductVariant, ProductsResult } from "./products.ts";
