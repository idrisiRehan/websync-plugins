// Value readers for the comparison: exact decimal amounts, feed prices, ISO 8601 dates, and the
// mapping between feed availability values and schema.org ItemAvailability. All patterns are
// anchored and have no nested quantifiers.

/**
 * A decimal amount in canonical form: no leading zeros, no trailing fraction zeros, so two
 * amounts are equal exactly when their strings are ("18.00" and "18" are both "18"). Amounts
 * stay strings, so nothing is rounded the way binary floating point would.
 */
export type Decimal = string;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
// The feed price format: a number and an optional ISO 4217 code ("15.00 USD"), as Google and
// OpenAI document it. product-feed-lint reports any other spelling.
const MONEY = /^(\d+(?:\.\d+)?) ?([A-Za-z]{3})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** The canonical form of a plain decimal number ("018.50" is "18.5"), or null for anything else. */
export function parseDecimal(text: string): Decimal | null {
  const m = DECIMAL.exec(text.trim());
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, "");
  const fraction = (m[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Compares two canonical decimals: negative, zero or positive, like a sort comparator. */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const [aWhole, aFraction = ""] = a.split(".");
  const [bWhole, bFraction = ""] = b.split(".");
  if (aWhole.length !== bWhole.length) return aWhole.length - bWhole.length;
  if (aWhole !== bWhole) return aWhole < bWhole ? -1 : 1;
  const width = Math.max(aFraction.length, bFraction.length);
  const x = aFraction.padEnd(width, "0");
  const y = bFraction.padEnd(width, "0");
  return x === y ? 0 : x < y ? -1 : 1;
}

export interface Money {
  amount: Decimal;
  /** Upper-cased, or null when the value has no currency. */
  currency: string | null;
}

export function parseMoney(text: string): Money | null {
  const m = MONEY.exec(text.trim());
  if (!m) return null;
  return { amount: parseDecimal(m[1])!, currency: m[2] ? m[2].toUpperCase() : null };
}

/** Milliseconds since the epoch for an ISO 8601 date or date-time (UTC when no offset is given), else null. */
export function parseDate(text: string): number | null {
  const m = ISO_DATE.exec(text.trim());
  if (!m) return null;
  // Date.parse() rolls "2026-02-30" over into March, so the day is checked first.
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.getUTCMonth() !== Number(m[2]) - 1 || day.getUTCDate() !== Number(m[3])) return null;
  const zone = m[7] ? (m[7] === "Z" ? "Z" : `${m[7].slice(0, 3)}:${m[7].slice(-2)}`) : "Z";
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}${zone}`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Like parseDate(), for the end of a period: a date without a time includes that whole day.
 * Google's sale_price_effective_date: "If you don't include a time, the sale price starts at
 * 12 AM, midnight, on the start date" and "ends at 11:59 PM on the end date"
 * (https://support.google.com/merchants/answer/6324460).
 */
export function parseEndDate(text: string): number | null {
  const ms = parseDate(text);
  return ms !== null && !text.includes("T") ? ms + 24 * 60 * 60 * 1000 : ms;
}

/** The feed availability values that can be compared, in Google's spelling. */
export type FeedAvailability = "in_stock" | "out_of_stock" | "preorder" | "backorder";

// Google's mapping between the availability attribute and schema.org's ItemAvailability, from the
// "Structured data" table of https://support.google.com/merchants/answer/6324448 (checked
// 2026-11-24). Matched without regard to case.
const SCHEMA_TO_FEED: Record<string, FeedAvailability> = {
  instock: "in_stock",
  limitedavailability: "in_stock",
  onlineonly: "in_stock",
  discontinued: "out_of_stock",
  instoreonly: "out_of_stock",
  outofstock: "out_of_stock",
  soldout: "out_of_stock",
  preorder: "preorder",
  presale: "preorder",
  backorder: "backorder",
};

/** The feed value a schema.org availability ("InStock", without its prefix) maps to, or null. */
export function availabilityOfSchema(value: string): FeedAvailability | null {
  return Object.hasOwn(SCHEMA_TO_FEED, value.toLowerCase()) ? SCHEMA_TO_FEED[value.toLowerCase()] : null;
}

/**
 * A feed availability in Google's spelling, or null when it can't be compared: OpenAI's
 * "unknown" asserts nothing, and Google's build_to_order (vehicle ads) has no schema.org value.
 * OpenAI writes pre_order; Google's own documentation also writes "in stock" with a space.
 */
export function availabilityOfFeed(value: string): FeedAvailability | null {
  const key = value.trim().toLowerCase().replaceAll(" ", "_");
  if (key === "pre_order") return "preorder";
  return key === "in_stock" || key === "out_of_stock" || key === "preorder" || key === "backorder" ? key : null;
}
