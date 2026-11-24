// Value checks shared by every target: URLs, prices, dates, GTINs, enums, numbers, countries
// and JSON objects. Each returns problems instead of reporting, so lint.ts can attach the line,
// item and attribute. All patterns are anchored and have no nested quantifiers.

import { validateGtin, normalizeGtin } from "websync-validators";
import type { AttributeSpec, Field, RuleId, Severity } from "./spec.ts";

export interface Problem {
  rule: RuleId;
  message: string;
  /** Overrides the attribute's severity. */
  severity?: Severity;
}

export interface Money {
  amount: number;
  /** Upper-cased ISO 4217 code, or null when the value has none. */
  currency: string | null;
  decimals: number;
}

const MONEY_STRICT = /^(\d+(?:\.(\d+))?) ([A-Z]{3})$/;
const MONEY_LENIENT = /^(\d+(?:\.(\d+))?) ?([A-Za-z]{3})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DECIMAL = /^\d+(?:\.\d+)?$/;
const INTEGER = /^\d+$/;
const COUNTRY = /^[A-Z]{2}$/;

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const fractionDigits = new Map<string, number>();

/** Minor-unit digits of an ISO 4217 currency (USD 2, JPY 0, KWD 3). */
export function currencyDigits(code: string): number {
  let digits = fractionDigits.get(code);
  if (digits === undefined) {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    fractionDigits.set(code, digits);
  }
  return digits;
}

export function parseMoney(value: string, strict: boolean): Money | null {
  const m = (strict ? MONEY_STRICT : MONEY_LENIENT).exec(value);
  if (!m) return null;
  return { amount: Number(m[1]), currency: m[3] ? m[3].toUpperCase() : null, decimals: m[2]?.length ?? 0 };
}

/** Milliseconds since the epoch for a valid ISO 8601 date or date-time, else null. */
export function parseIsoDate(value: string): number | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return null;
  const zone = m[7] ? (m[7] === "Z" ? "Z" : `${m[7].slice(0, 3)}:${m[7].slice(-2)}`) : "Z";
  const time = m[4] !== undefined ? `T${m[4]}:${m[5]}:${m[6] ?? "00"}` : "T00:00:00";
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}${time}${zone}`);
}

/** Length in characters (code points), so an emoji counts once. */
export function charLength(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0xd800 || c > 0xdbff) n++;
  }
  return n;
}

/** Matches an enum value; lenient targets ignore case and accept spaces for underscores. */
export function enumMatches(value: string, allowed: readonly string[], strict: boolean): boolean {
  if (strict) return allowed.includes(value);
  const key = value.toLowerCase().replaceAll(" ", "_");
  return allowed.some((v) => v.toLowerCase() === key);
}

/** The entries of a list value: a JSON array, or a comma-separated string. An XML element repeats instead. */
export function listEntries(field: Field): string[] {
  if (field.element) return [field.value];
  if (Array.isArray(field.json)) return field.json.map((v) => (typeof v === "string" ? v.trim() : JSON.stringify(v)));
  if (field.value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(field.value);
      if (Array.isArray(parsed)) return parsed.map((v) => (typeof v === "string" ? v.trim() : JSON.stringify(v)));
    } catch {
      // not JSON: read it as a comma-separated list
    }
  }
  return field.value.split(",").map((v) => v.trim());
}

export function objectOf(field: Field): Record<string, unknown> | null {
  let value = field.json;
  if (value === undefined) {
    try {
      value = JSON.parse(field.value);
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function checkUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return `"${url}" isn't an absolute http or https URL.`;
  if (/\s/.test(url)) return `"${url}" contains a space. Encode spaces as %20.`;
  if (!URL.canParse(url)) return `"${url}" can't be parsed as a URL.`;
  return null;
}

function checkMoney(value: string, strict: boolean): Problem[] {
  const money = parseMoney(value, strict);
  if (!money) {
    return [{
      rule: "price-invalid",
      message: strict
        ? `"${value}" isn't a price. Write amount CURRENCY, like 79.99 USD: a decimal point, no thousands separators, one space and an uppercase ISO 4217 code.`
        : `"${value}" isn't a price. Write a number and an ISO 4217 currency code, like 15.00 USD, without currency symbols or thousands separators.`,
    }];
  }
  if (money.currency === null) {
    return [{ rule: "price-currency-missing", severity: "warning", message: `"${value}" has no currency. The price format is a number plus an ISO 4217 code, like 15.00 USD.` }];
  }
  if (!CURRENCIES.has(money.currency)) return [{ rule: "price-invalid", message: `"${money.currency}" in "${value}" isn't an ISO 4217 currency code.` }];
  if (strict) {
    const digits = currencyDigits(money.currency);
    if (money.decimals > digits) return [{ rule: "price-invalid", message: `"${value}" has ${money.decimals} decimal places; ${money.currency} allows ${digits}.` }];
  } else if (money.decimals > 2) {
    return [{ rule: "price-precision", severity: "warning", message: `"${value}" has more than 2 digits after the decimal point, so it will be rounded. Round it yourself to the amount you charge.` }];
  }
  return [];
}

function checkGtin(gtin: string, spec: AttributeSpec, strict: boolean): Problem[] {
  if (strict && /[\s-]/.test(gtin)) return [{ rule: "gtin-invalid", message: `"${gtin}" contains spaces or dashes. Submit the digits only.` }];
  const result = validateGtin(gtin);
  if (!result.valid) {
    const detail = result.checks.find((c) => c.status === "fail")?.detail ?? "Not a valid GTIN.";
    return [{ rule: "gtin-invalid", message: `"${gtin}" isn't a valid GTIN: ${detail}` }];
  }
  const thirteen = normalizeGtin(gtin).padStart(14, "0").slice(1);
  const restricted = result.type !== "GTIN-8" && spec.restrictedGtinPrefixes?.find((p) => thirteen.startsWith(p));
  // The bulk indicator rule is Google's (answer 160161), so it comes with the restricted ranges.
  const bulk = spec.restrictedGtinPrefixes !== undefined && result.type === "GTIN-14" && result.normalized.startsWith("9");
  if (restricted || bulk) {
    return [{
      rule: "gtin-restricted",
      message: restricted
        ? `"${gtin}" is in a restricted or coupon GTIN range (prefix ${restricted}), which are for in-store or internal use. Submit the manufacturer's GTIN, or leave gtin empty.`
        : `"${gtin}" is a GTIN-14 with the bulk indicator 9, which shouldn't be used.`,
    }];
  }
  return [];
}

function checkNumber(value: string, spec: AttributeSpec): string | null {
  const rule = spec.number ?? { min: 0 };
  const n = Number(value);
  const shape = rule.integer ? INTEGER : DECIMAL;
  const tooSmall = rule.minExclusive ? n <= rule.min : n < rule.min;
  if (!shape.test(value) || tooSmall || (rule.max !== undefined && n > rule.max)) {
    const kind = rule.integer ? "a whole number" : "a number";
    const range = rule.max !== undefined ? ` from ${rule.min} to ${rule.max}` : rule.minExclusive ? ` greater than ${rule.min}` : ` of ${rule.min} or more`;
    return `"${value}" must be ${kind}${range}, with a dot for decimals.`;
  }
  return null;
}

function checkStringMap(field: Field): string | null {
  const object = objectOf(field);
  if (!object) return `"${field.value}" isn't a JSON object. Write it like {"color":"Black","size":"10"}.`;
  for (const [key, value] of Object.entries(object)) {
    if (key.trim() === "" || typeof value !== "string" || value.trim() === "") return `Every key and value in "${field.value}" must be a nonempty string.`;
  }
  return null;
}

const DIMENSION_AXES = ["length", "width", "height"];

function checkDimensions(field: Field, units: readonly string[]): string | null {
  const object = objectOf(field);
  const shape = `Write it like {"length":"30","width":"20","height":"12","unit":"cm"}.`;
  if (!object) return `"${field.value}" isn't a JSON object. ${shape}`;
  const keys = Object.keys(object);
  const extra = keys.find((k) => k !== "unit" && !DIMENSION_AXES.includes(k));
  if (extra) return `"${extra}" isn't allowed in dimensions; only length, width, height and unit are.`;
  if (keys.filter((k) => DIMENSION_AXES.includes(k)).length < 2) return `dimensions needs at least two of length, width and height. ${shape}`;
  if (typeof object.unit !== "string" || !units.includes(object.unit)) return `dimensions needs a unit: ${units.join(", ")}.`;
  for (const axis of DIMENSION_AXES) {
    const v = object[axis];
    if (v !== undefined && (typeof v !== "string" || !DECIMAL.test(v) || Number(v) <= 0)) return `dimensions.${axis} must be a positive decimal string, like "30".`;
  }
  return null;
}

/** Every format problem in one field. Length, count and cross-attribute rules live in lint.ts. */
export function checkField(field: Field, spec: AttributeSpec, strict: boolean): Problem[] {
  const value = field.value;
  const invalid = (message: string): Problem[] => [{ rule: "value-invalid", message }];
  switch (spec.type ?? "text") {
    case "text":
      return [];
    case "url": {
      const message = checkUrl(value);
      return message ? [{ rule: "url-invalid", message }] : [];
    }
    case "url-list":
      return listEntries(field).flatMap((url) => {
        const message = url === "" ? "The list has an empty entry (a stray comma)." : checkUrl(url);
        return message ? [{ rule: "url-invalid", message } as Problem] : [];
      });
    case "money":
      return checkMoney(value, strict);
    case "enum": {
      const allowed = spec.values ?? [];
      const bad = (field.parts ?? [value]).find((v) => !enumMatches(v, allowed, strict));
      return bad === undefined ? [] : [{ rule: "value-enum", message: `"${bad}" isn't a supported value. Use one of: ${allowed.join(", ")}.` }];
    }
    case "date":
      return parseIsoDate(value) === null
        ? [{ rule: "date-invalid", message: `"${value}" isn't an ISO 8601 date. Write it like 2026-12-25 or 2026-12-25T13:00-0800.` }]
        : [];
    case "date-range": {
      const ends = value.split("/").map((v) => (strict ? v : v.trim()));
      const [start, end] = ends.map(parseIsoDate);
      if (ends.length !== 2 || start === null || end === null) {
        return [{ rule: "date-invalid", message: `"${value}" isn't two ISO 8601 dates separated by "/". Write it like 2026-12-01T00:00-0800/2026-12-31T23:59-0800.` }];
      }
      return start < end ? [] : [{ rule: "date-invalid", message: `The start of "${value}" isn't before its end.` }];
    }
    case "gtin":
      return listEntries(field).flatMap((gtin) => (gtin === "" ? [] : checkGtin(gtin, spec, strict)));
    case "number": {
      const message = checkNumber(value, spec);
      return message ? invalid(message) : [];
    }
    case "country":
      return COUNTRY.test(value) ? [] : invalid(`"${value}" must be an uppercase ISO 3166-1 alpha-2 country code, like US.`);
    case "country-list": {
      const bad = listEntries(field).find((c) => !COUNTRY.test(c));
      return bad === undefined ? [] : invalid(`"${bad}" must be an uppercase ISO 3166-1 alpha-2 country code, like US.`);
    }
    case "string-map": {
      const message = checkStringMap(field);
      return message ? invalid(message) : [];
    }
    case "dimensions": {
      const message = checkDimensions(field, spec.values ?? []);
      return message ? invalid(message) : [];
    }
  }
}
