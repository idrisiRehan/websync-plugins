// Offline ISBN-10 and ISBN-13 validation and conversion.
//
// ISBN-13 is a GTIN-13 in the 978 or 979 "Bookland" prefix, so it uses the GS1 check digit
// (see gtin.ts). ISBN-10 (ISO 2108, pre-2007) weights its first nine digits 10 down to 2; the
// check character brings the total to a multiple of 11, with "X" standing for 10. Only
// 978-prefixed ISBN-13s have an ISBN-10 form: the ISBN-10 is the nine middle digits plus a
// recomputed check character.
//
// A pass means the ISBN is well formed. Whether a book was assigned it is only in the ISBN
// agencies' records.

import { gtinCheckDigit, type Conversion } from "./gtin.ts";
import type { CheckStatus } from "./types.ts";

export type IsbnKind = "ISBN-10" | "ISBN-13";

export interface IsbnCheck {
  id: "format" | "prefix" | "checksum";
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface IsbnResult {
  /** Input with spaces and hyphens removed, upper-cased. */
  normalized: string;
  valid: boolean;
  kind: IsbnKind | null;
  /** Both forms when valid; isbn10 is null for 979-prefixed ISBNs, which have none. */
  isbn10: string | null;
  isbn13: string | null;
  checks: IsbnCheck[];
}

export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** The ISBN-10 check character ("0"-"9" or "X") for nine digits, or null if the input isn't nine digits. */
export function isbn10CheckDigit(first9: string): string | null {
  if (!/^\d{9}$/.test(first9)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? "X" : String(check);
}

export function isValidIsbn(raw: string): boolean {
  return validateIsbn(raw).valid;
}

export function validateIsbn(raw: string): IsbnResult {
  const normalized = normalizeIsbn(raw);
  const result: IsbnResult = { normalized, valid: false, kind: null, isbn10: null, isbn13: null, checks: [] };
  const skip = (id: IsbnCheck["id"], label: string) =>
    result.checks.push({ id, label, status: "skipped", detail: "Not checked until the format is valid." });

  if (/^\d{9}[\dX]$/.test(normalized)) result.kind = "ISBN-10";
  else if (/^\d{13}$/.test(normalized)) result.kind = "ISBN-13";

  result.checks.push({
    id: "format",
    label: "Format",
    status: result.kind ? "pass" : "fail",
    detail: result.kind
      ? `${result.kind} format.`
      : normalized === ""
        ? "Nothing to check."
        : "An ISBN-10 is nine digits then a digit or X. An ISBN-13 is 13 digits.",
  });
  if (!result.kind) {
    skip("prefix", "Prefix");
    skip("checksum", "Check digit");
    return result;
  }

  if (result.kind === "ISBN-10") {
    result.checks.push({ id: "prefix", label: "Prefix", status: "skipped", detail: "ISBN-10s have no prefix." });
    const expected = isbn10CheckDigit(normalized.slice(0, 9)) as string;
    const found = normalized[9];
    result.checks.push(checksumCheck(found, expected, "ISBN-10 (mod 11)"));
    result.valid = found === expected;
    if (result.valid) {
      result.isbn10 = normalized;
      result.isbn13 = toIsbn13(normalized.slice(0, 9));
    }
    return result;
  }

  const prefix = normalized.slice(0, 3);
  const bookland = prefix === "978" || prefix === "979";
  result.checks.push({
    id: "prefix",
    label: "Prefix",
    status: bookland ? "pass" : "fail",
    detail: bookland ? `${prefix} is an ISBN prefix.` : `${prefix} is not an ISBN prefix. ISBN-13s start with 978 or 979.`,
  });
  const expected = gtinCheckDigit(normalized.slice(0, 12)) as string;
  const found = normalized[12];
  result.checks.push(checksumCheck(found, expected, "GS1"));
  result.valid = bookland && found === expected;
  if (result.valid) {
    result.isbn13 = normalized;
    result.isbn10 = prefix === "978" ? toIsbn10(normalized) : null;
  }
  return result;
}

function checksumCheck(found: string, expected: string, scheme: string): IsbnCheck {
  return {
    id: "checksum",
    label: "Check digit",
    status: found === expected ? "pass" : "fail",
    detail:
      found === expected
        ? `The last character, ${found}, is the correct ${scheme} check digit.`
        : `The last character is ${found}, but the ${scheme} check digit for the rest is ${expected}. A digit is wrong or two are swapped.`,
  };
}

function toIsbn13(first9: string): string {
  const body = `978${first9}`;
  return body + gtinCheckDigit(body);
}

function toIsbn10(isbn13: string): string {
  const first9 = isbn13.slice(3, 12);
  return first9 + isbn10CheckDigit(first9);
}

export function isbn10To13(raw: string): Conversion {
  const r = validateIsbn(raw);
  if (r.kind !== "ISBN-10") return { ok: false, error: "Not in ISBN-10 format." };
  if (!r.valid) return { ok: false, error: r.checks.find((c) => c.status === "fail")?.detail ?? "Not a valid ISBN-10." };
  return { ok: true, value: r.isbn13 as string };
}

export function isbn13To10(raw: string): Conversion {
  const r = validateIsbn(raw);
  if (r.kind !== "ISBN-13") return { ok: false, error: "Not in ISBN-13 format." };
  if (!r.valid) return { ok: false, error: r.checks.find((c) => c.status === "fail")?.detail ?? "Not a valid ISBN-13." };
  if (!r.isbn10) return { ok: false, error: "979-prefixed ISBNs have no ISBN-10 form." };
  return { ok: true, value: r.isbn10 };
}
