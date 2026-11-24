// The shapes shared by the rule engine (lint.ts) and the per-target requirement tables
// (google.ts, openai.ts). A table entry is data: each names the page it was taken from and the
// date it was last compared with it, so a spec change is a one-entry edit.

export type Severity = "error" | "warning";
export type TargetName = "google" | "openai";
export type FeedFormat = "tsv" | "csv" | "xml" | "jsonl";

export type RuleId =
  // reading the file
  | "feed-unreadable"
  | "feed-empty"
  | "format-unsupported"
  | "delimiter-wrong"
  | "quote-unterminated"
  | "quote-unexpected"
  | "row-width"
  | "row-trailing-tab"
  | "header-duplicate"
  | "namespace-wrong"
  // attributes
  | "attribute-unknown"
  | "attribute-retired"
  | "attribute-alias"
  | "attribute-missing"
  | "id-duplicate"
  | "id-duplicate-case"
  // values
  | "value-too-long"
  | "values-too-many"
  | "value-enum"
  | "value-invalid"
  | "value-placeholder"
  | "url-invalid"
  | "date-invalid"
  | "price-invalid"
  | "price-currency-missing"
  | "price-precision"
  | "price-zero"
  | "sale-price-invalid"
  | "gtin-invalid"
  | "gtin-restricted"
  // identifiers and variants
  | "identifier-missing"
  | "identifier-exists-conflict"
  | "variant-inconsistent"
  | "variant-parent-listed";

export type ValueType =
  | "text"
  | "url"
  /** Several URLs: repeated XML elements, a JSON array, or one comma-separated cell. */
  | "url-list"
  | "money"
  | "enum"
  | "date"
  /** Two ISO 8601 dates separated by "/". */
  | "date-range"
  /** One or more GTINs: repeated elements or a comma-separated cell. */
  | "gtin"
  | "number"
  | "country"
  /** A JSON array of country codes, or a comma-separated cell. */
  | "country-list"
  /** A JSON object with string values (inline in JSONL, serialized JSON in a cell). */
  | "string-map"
  | "dimensions";

export interface AttributeSpec {
  name: string;
  /** Other accepted names. When both appear, the item is flagged and `name` is used, unless `aliasWins`. */
  aliases?: readonly string[];
  /** The source gives an alias precedence over `name` when both appear. */
  aliasWins?: boolean;
  required?: boolean;
  /** Attributes that meet `required` instead, such as structured_title for title. */
  satisfiedBy?: readonly string[];
  /** Severity when a required attribute is missing. Default "error". */
  missingSeverity?: Severity;
  /** Required when any of these holds: the attribute is present (no `values`), or has one of `values`. */
  requiredWhen?: readonly { attribute: string; values?: readonly string[] }[];
  /** Why this is required, appended to the message when it is missing. */
  requiredNote?: string;
  type?: ValueType;
  /** Allowed values for "enum", checked per value and per sub-attribute. */
  values?: readonly string[];
  /** Characters per value. */
  maxLength?: number;
  /** Values per item, counting repeated elements and list entries. */
  maxValues?: number;
  /** For "number". */
  number?: { integer?: boolean; min: number; minExclusive?: boolean; max?: number };
  /** No two items may share a value. */
  unique?: boolean;
  /** Also warn when two values differ only in letter case. */
  uniqueIgnoringCase?: boolean;
  /** GTIN prefixes the source says not to use, matched against the 13-digit form. */
  restrictedGtinPrefixes?: readonly string[];
  /** Severity of value problems (invalid, too long). Default "error". */
  severity?: Severity;
  /** The attribute is no longer in the spec; the reason is reported when it appears. */
  retired?: string;
  source: string;
  /** Date the entry was last compared with `source`. */
  checked: string;
}

/** One attribute occurrence: a cell, an XML element or a JSON property. */
export interface Field {
  /** The trimmed text. For an XML element with children, their texts joined with ":". */
  value: string;
  line: number;
  /** Sub-attribute values: an XML element's children, or a cell under a "name(a:b)" header. */
  parts: string[] | null;
  /** The JSON value in a JSONL record, when it isn't a string. */
  json?: unknown;
  /** An XML element: one value, even when it contains commas. */
  element?: boolean;
}

export interface Item {
  line: number;
  /** Values by attribute name, after alias resolution. */
  fields: Map<string, Field[]>;
  /** The item's id (or item_id) value, or null. */
  id: string | null;
}

export type Report = (rule: RuleId, severity: Severity, message: string, at: { line: number | null; itemId?: string | null; attribute?: string | null }) => void;

export interface Target {
  name: TargetName;
  label: string;
  formats: readonly FeedFormat[];
  idAttribute: string;
  /**
   * Strict targets take names and values exactly as documented. Lenient ones also accept the
   * variants their own documentation uses: any letter case, spaces for underscores ("in stock",
   * "image link"), and spaces or dashes inside a GTIN.
   */
  strict: boolean;
  /** Whether a repeated header column adds values to the attribute. If not, only the first column is read. */
  repeatedColumns: boolean;
  attributes: readonly AttributeSpec[];
  /** Values the source says not to use as stand-ins. */
  placeholders: { values: readonly string[]; attributes?: readonly string[]; source: string };
  /** Cross-attribute rules for one item. */
  checkItem(item: Item, report: Report): void;
  /** Rules across items, such as variant groups. */
  checkFeed(items: readonly Item[], report: Report): void;
}

/** First trimmed value of an attribute, or "" when absent. */
export function valueOf(item: Item, name: string): string {
  return item.fields.get(name)?.[0]?.value ?? "";
}
