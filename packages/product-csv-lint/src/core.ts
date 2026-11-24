// The platform-neutral half of the linter: decoding, CSV structure, headers, value types and
// duplicates. Platform modules (shopify.ts, woocommerce.ts) describe their columns as data
// and add only the checks that are truly specific to them.
//
// Header names are matched case-insensitively, and each logical column can have several
// accepted names, because platforms rename columns between export formats.

import { validateGtin, validateIsbn } from "websync-validators";
import { detectDelimiter, parseCsv, type CsvRecord } from "./csv.ts";

export type Severity = "error" | "warning" | "info";

export type RuleId =
  // file and structure
  | "encoding-invalid"
  | "encoding-mojibake"
  | "bom"
  | "file-empty"
  | "rows-none"
  | "delimiter-semicolon"
  | "quote-unexpected"
  | "quote-unterminated"
  | "row-width"
  // headers
  | "header-missing"
  | "header-recommended"
  | "header-unknown"
  | "header-blank"
  | "header-duplicate"
  // values
  | "value-decimal"
  | "value-integer"
  | "value-boolean"
  | "value-flag"
  | "value-enum"
  | "value-url"
  | "value-barcode"
  | "images-pipe"
  | "images-empty-entry"
  | "images-url-invalid"
  | "images-url-space"
  | "images-no-scheme"
  | "sku-duplicate"
  // Shopify
  | "handle-missing"
  | "title-repeated"
  | "option-name-inconsistent"
  | "variant-duplicate"
  | "image-position-duplicate"
  | "compare-at-below-price"
  // WooCommerce
  | "id-duplicate"
  | "attribute-pair-missing"
  | "type-missing"
  | "type-unknown"
  | "sale-not-below-regular"
  | "name-missing"
  | "parent-missing"
  | "parent-not-found"
  | "parent-not-variable"
  | "variation-attribute-list"
  | "variation-attribute-unknown"
  | "variable-without-variations";

export interface CsvFinding {
  rule: RuleId;
  severity: Severity;
  /** Spreadsheet row (the header is row 1), or null for a whole-file finding. */
  row: number | null;
  /** Column header as written in the file, when the finding belongs to one. */
  column: string | null;
  message: string;
  /** The offending cell value, when there is one. */
  value: string | null;
}

export type ColumnType = "decimal" | "integer" | "boolean" | "flag" | "enum" | "url" | "barcode" | "images";

export interface ColumnRule {
  /** Accepted header names, current name first. */
  names: readonly string[];
  type: ColumnType;
  severity?: Severity;
  values?: readonly string[];
  hint?: string;
}

export interface Sheet {
  headers: string[];
  records: CsvRecord[];
  /** The header present in the file for any of these names (case-insensitive), or undefined. */
  find(names: readonly string[]): string | undefined;
  /** Trimmed cell value; "" when the column is absent or the row is short. */
  cell(record: CsvRecord, header: string | undefined): string;
}

export type Report = (rule: RuleId, severity: Severity, message: string, at?: { row?: number; column?: string; value?: string }) => void;

export interface PlatformRules {
  platform: "shopify" | "woocommerce";
  label: string;
  semicolonSeverity: Severity;
  semicolonNote: string;
  required: readonly (readonly string[])[];
  recommended: readonly (readonly string[])[];
  known: readonly string[];
  knownPatterns: readonly RegExp[];
  columns: readonly ColumnRule[];
  check(sheet: Sheet, report: Report): { productCount: number; variantCount: number };
}

export interface ProductCsvResult {
  platform: PlatformRules["platform"];
  /** True when there are no errors. */
  valid: boolean;
  delimiter: "," | ";";
  headers: string[];
  /** Data rows, excluding the header and blank lines. */
  rowCount: number;
  productCount: number;
  variantCount: number;
  findings: CsvFinding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const FLAG_VALUES = ["0", "1", "yes", "no", "true", "false"];
// UTF-8 text decoded as Windows-1252 or Latin-1: é, è, â, and the curly quotes.
const MOJIBAKE = /Ã©|Ã¨|Ã¢|â€™|â€œ|â€\x9d|Â /;

export function rowsOf(list: CsvRecord[]): string {
  return list.map((r) => r.row).join(", ");
}

function makeSheet(headers: string[], records: CsvRecord[]): Sheet {
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.toLowerCase();
    if (h !== "" && !index.has(key)) index.set(key, i);
  });
  return {
    headers,
    records,
    find: (names) => {
      for (const name of names) {
        const i = index.get(name.toLowerCase());
        if (i !== undefined) return headers[i];
      }
      return undefined;
    },
    cell: (record, header) => {
      if (header === undefined) return "";
      const i = index.get(header.toLowerCase());
      return i === undefined ? "" : (record.cells[i] ?? "").trim();
    },
  };
}

/** Reports every row that shares a non-empty value in `header` with another row. */
export function reportDuplicates(sheet: Sheet, header: string | undefined, report: Report, rule: RuleId, label: string, consequence: string): void {
  if (!header) return;
  const seen = new Map<string, CsvRecord[]>();
  for (const record of sheet.records) {
    const value = sheet.cell(record, header);
    if (value !== "") seen.set(value, [...(seen.get(value) ?? []), record]);
  }
  for (const [value, list] of seen) {
    if (list.length < 2) continue;
    for (const record of list) {
      const others = list.filter((r) => r !== record);
      report(rule, "error", `Duplicate ${label} "${value}", also on row ${rowsOf(others)}. ${consequence}`, { row: record.row, column: header, value });
    }
  }
}

function checkImages(value: string, row: number, column: string, report: Report): void {
  if (value.includes("|")) {
    report("images-pipe", "warning", "Contains a pipe character. The list is split on commas, so a pipe-separated list imports as one long filename.", { row, column, value });
  }
  for (const entry of value.split(",").map((part) => part.trim())) {
    if (entry === "") {
      report("images-empty-entry", "warning", "Empty entry in the image list (a stray or trailing comma).", { row, column, value });
    } else if (/^https?:\/\//i.test(entry)) {
      if (/\s/.test(entry)) {
        report("images-url-space", "error", `"${entry}" has a space in it. Encode it as %20 or the download will fail.`, { row, column, value: entry });
      } else if (!URL.canParse(entry)) {
        report("images-url-invalid", "error", `"${entry}" starts like a URL but can't be parsed as one.`, { row, column, value: entry });
      }
    } else if (/^www\./i.test(entry)) {
      report("images-no-scheme", "warning", `"${entry}" has no http:// or https:// prefix, so it is read as a media-library filename, not a URL to download.`, { row, column, value: entry });
    }
  }
}

function isValidBarcode(value: string): { valid: boolean; reason: string } {
  const gtin = validateGtin(value);
  if (gtin.valid || validateIsbn(value).valid) return { valid: true, reason: "" };
  return { valid: false, reason: gtin.checks.find((c) => c.status === "fail")?.detail ?? "Not a valid barcode." };
}

function checkValue(rule: ColumnRule, value: string, row: number, column: string, report: Report): void {
  const severity = rule.severity ?? "error";
  const at = { row, column, value };
  switch (rule.type) {
    case "decimal":
      if (!DECIMAL.test(value)) report("value-decimal", severity, `"${value}" isn't a plain non-negative number. Remove currency symbols, units and thousands separators, and use a dot for decimals.`, at);
      break;
    case "integer":
      if (!INTEGER.test(value)) report("value-integer", severity, `"${value}" must be a whole number.`, at);
      break;
    case "boolean":
      if (!/^(true|false)$/i.test(value)) report("value-boolean", severity, `"${value}" must be TRUE or FALSE.`, at);
      break;
    case "flag":
      if (!FLAG_VALUES.includes(value.toLowerCase())) report("value-flag", severity, `"${value}" isn't one of the yes/no values written here (${FLAG_VALUES.join(", ")}).`, at);
      break;
    case "enum": {
      const allowed = rule.values ?? [];
      if (!allowed.some((v) => v.toLowerCase() === value.toLowerCase())) {
        report("value-enum", severity, `"${value}" isn't one of the allowed values (${allowed.join(", ")}).${rule.hint ? ` ${rule.hint}` : ""}`, at);
      }
      break;
    }
    case "url":
      if (!/^https?:\/\//i.test(value) || !URL.canParse(value) || /\s/.test(value)) {
        report("value-url", severity, `"${value}" isn't a valid http(s) URL.`, at);
      }
      break;
    case "barcode": {
      const result = isValidBarcode(value);
      if (!result.valid) report("value-barcode", severity, `"${value}" isn't a valid GTIN, UPC, EAN or ISBN: ${result.reason}`, at);
      break;
    }
    case "images":
      checkImages(value, row, column, report);
      break;
  }
}

function decode(input: string | Uint8Array): string | null {
  if (typeof input === "string") return input;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    return null;
  }
}

export function runRules(input: string | Uint8Array, rules: PlatformRules): ProductCsvResult {
  const findings: CsvFinding[] = [];
  const report: Report = (rule, severity, message, at = {}) =>
    findings.push({ rule, severity, row: at.row ?? null, column: at.column ?? null, message, value: at.value ?? null });
  const finish = (delimiter: "," | ";", headers: string[], rowCount: number, counts = { productCount: 0, variantCount: 0 }): ProductCsvResult => {
    findings.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
    const errorCount = count("error");
    return { platform: rules.platform, valid: errorCount === 0, delimiter, headers, rowCount, ...counts, findings, errorCount, warningCount: count("warning"), infoCount: count("info") };
  };

  const decoded = decode(input);
  if (decoded === null) {
    report("encoding-invalid", "error", `The file isn't valid UTF-8. ${rules.label} expects UTF-8: in Excel, use "Save as CSV UTF-8".`);
    return finish(",", [], 0);
  }
  let text = decoded;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    report("bom", "info", "The file starts with a UTF-8 byte order mark (Excel adds one). It was ignored.");
  }
  if (text.trim() === "") {
    report("file-empty", "error", "The file is empty.");
    return finish(",", [], 0);
  }
  if (MOJIBAKE.test(text)) {
    report("encoding-mojibake", "info", "Some characters look like UTF-8 text that was opened as another encoding and saved again (for example \"Ã©\" for \"é\"). Check accented characters. This is a heuristic.");
  }

  const delimiter = detectDelimiter(text);
  if (delimiter === ";") report("delimiter-semicolon", rules.semicolonSeverity, `The file is separated by semicolons (Excel does this in some regions). ${rules.semicolonNote}`);

  const { records, issues } = parseCsv(text, delimiter);
  for (const issue of issues) {
    if (issue.kind === "quote-unterminated") {
      report("quote-unterminated", "error", "A quoted field is never closed, so everything after it was read as one cell. Find the opening quote on this row.", { row: issue.row });
    } else {
      report("quote-unexpected", "error", "A quote appears inside a field that doesn't start with one (for example 12\" pizza). Wrap the whole field in quotes and double the inner quote: \"12\"\" pizza\".", { row: issue.row });
    }
  }

  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) {
    report("file-empty", "error", "The file has no rows.");
    return finish(delimiter, [], 0);
  }
  const headers = headerRecord.cells.map((h) => h.trim());
  const sheet = makeSheet(headers, dataRecords);

  const seenHeaders = new Map<string, string>();
  for (const h of headers) {
    if (h === "") {
      report("header-blank", "warning", "A header cell is blank, so that column can't be mapped.", { row: headerRecord.row });
      continue;
    }
    const key = h.toLowerCase();
    if (seenHeaders.has(key)) {
      report("header-duplicate", "error", `Column "${h}" appears more than once. Only one of them can be used.`, { row: headerRecord.row, column: h });
      continue;
    }
    seenHeaders.set(key, h);
    const known = rules.known.some((k) => k.toLowerCase() === key) || rules.knownPatterns.some((p) => p.test(h));
    if (!known) report("header-unknown", "info", `"${h}" isn't a ${rules.label} column. It may be ignored, or need mapping by hand.`, { row: headerRecord.row, column: h });
  }
  for (const names of rules.required) {
    if (!sheet.find(names)) report("header-missing", "error", `Required column "${names[0]}" is missing.`, { row: headerRecord.row, column: names[0] });
  }
  for (const names of rules.recommended) {
    if (!sheet.find(names)) report("header-recommended", "warning", `Column "${names[0]}" is missing. The import can run without it, but nothing in the file sets that value.`, { row: headerRecord.row, column: names[0] });
  }

  if (dataRecords.length === 0) {
    report("rows-none", "warning", "The file has a header row but no products.");
    return finish(delimiter, headers, 0);
  }

  for (const record of dataRecords) {
    if (record.cells.length !== headers.length) {
      report("row-width", "error", `Row has ${record.cells.length} cell${record.cells.length === 1 ? "" : "s"}, the header has ${headers.length}. An unescaped comma or quote usually causes this.`, { row: record.row });
    }
  }

  for (const rule of rules.columns) {
    const header = sheet.find(rule.names);
    if (!header) continue;
    for (const record of dataRecords) {
      const value = sheet.cell(record, header);
      if (value !== "") checkValue(rule, value, record.row, header, report);
    }
  }

  return finish(delimiter, headers, dataRecords.length, rules.check(sheet, report));
}
