// Offline GS1 GTIN validation (GTIN-8, GTIN-12 / UPC-A, GTIN-13 / EAN-13, GTIN-14) and
// conversion between lengths.
//
// The check digit follows the GS1 General Specifications (section 7.9, "Check digit
// calculation"): weight the payload digits 3, 1, 3, 1 ... starting from the rightmost, and the
// check digit is what brings the total to a multiple of 10. Because the weights start from the
// right, leading zeros never change the check digit. So every GTIN pads to a GTIN-14 with
// zeros, and a GTIN-14 shortens only when the digits removed are all zeros. Putting a non-zero
// GS1 indicator digit (1-9) in front makes a different GTIN-14 and needs a new check digit.
//
// A pass means the number is well formed. Whether it was ever issued, and to whom, is only in
// GS1's registry (GEPIR / Verified by GS1).

import type { CheckStatus } from "./types.ts";

export type GtinType = "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14";

export interface GtinCheck {
  id: "format" | "length" | "checksum";
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface GtinResult {
  /** Input with spaces and hyphens removed. */
  normalized: string;
  valid: boolean;
  /** Detected from the length; null when the length is not 8, 12, 13 or 14. */
  type: GtinType | null;
  /** The same number as a 14-digit GTIN, when valid. Useful as a database key. */
  gtin14: string | null;
  checks: GtinCheck[];
}

export type Conversion = { ok: true; value: string } | { ok: false; error: string };

export const GTIN_LENGTHS: Record<GtinType, number> = {
  "GTIN-8": 8,
  "GTIN-12": 12,
  "GTIN-13": 13,
  "GTIN-14": 14,
};

const TYPE_BY_LENGTH = new Map(Object.entries(GTIN_LENGTHS).map(([type, length]) => [length, type as GtinType]));

export function normalizeGtin(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/** The check digit for a payload of digits (the GTIN without its last digit), or null if it isn't all digits. */
export function gtinCheckDigit(payload: string): string | null {
  if (!/^\d+$/.test(payload)) return null;
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(payload[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidGtin(raw: string): boolean {
  return validateGtin(raw).valid;
}

export function validateGtin(raw: string): GtinResult {
  const normalized = normalizeGtin(raw);
  const result: GtinResult = { normalized, valid: false, type: null, gtin14: null, checks: [] };
  const digitsOnly = /^\d+$/.test(normalized);

  result.checks.push({
    id: "format",
    label: "Digits only",
    status: digitsOnly ? "pass" : "fail",
    detail: digitsOnly
      ? "Digits only once spaces and hyphens are removed."
      : normalized === ""
        ? "Nothing to check."
        : "A GTIN contains digits only.",
  });
  if (!digitsOnly) {
    result.checks.push(
      { id: "length", label: "Length", status: "skipped", detail: "Not checked until the input is digits only." },
      { id: "checksum", label: "Check digit", status: "skipped", detail: "Not checked until the input is digits only." },
    );
    return result;
  }

  result.type = TYPE_BY_LENGTH.get(normalized.length) ?? null;
  result.checks.push({
    id: "length",
    label: "Length",
    status: result.type ? "pass" : "fail",
    detail: result.type
      ? `${normalized.length} digits: a ${result.type}.`
      : `${normalized.length} digits. A GTIN has 8, 12, 13 or 14.`,
  });
  if (!result.type) {
    result.checks.push({ id: "checksum", label: "Check digit", status: "skipped", detail: "Not checked until the length is valid." });
    return result;
  }

  const expected = gtinCheckDigit(normalized.slice(0, -1)) as string;
  const found = normalized.slice(-1);
  result.checks.push({
    id: "checksum",
    label: "Check digit",
    status: found === expected ? "pass" : "fail",
    detail:
      found === expected
        ? `The last digit, ${found}, is the correct GS1 check digit.`
        : `The last digit is ${found}, but the GS1 check digit for the rest is ${expected}. A digit is wrong or two are swapped.`,
  });

  result.valid = found === expected;
  if (result.valid) result.gtin14 = normalized.padStart(14, "0");
  return result;
}

/**
 * Converts a valid GTIN to another length. Pads or removes leading zeros, and refuses rather
 * than drop a significant digit. With `indicatorDigit` 1-9 and target GTIN-14, puts that GS1
 * packaging indicator in front and recomputes the check digit; 0 or undefined just pads.
 */
export function convertGtin(raw: string, target: GtinType, indicatorDigit?: number): Conversion {
  const source = validateGtin(raw);
  if (!source.valid) {
    const failed = source.checks.find((c) => c.status === "fail");
    return { ok: false, error: failed ? failed.detail : "Not a valid GTIN." };
  }
  const gtin14 = source.gtin14 as string;

  if (target === "GTIN-14" && indicatorDigit !== undefined && indicatorDigit !== 0) {
    if (!Number.isInteger(indicatorDigit) || indicatorDigit < 1 || indicatorDigit > 9) {
      return { ok: false, error: "The indicator digit must be a whole number from 1 to 9." };
    }
    // A GTIN-14 is [indicator][12-digit item reference][check digit]. Positions 1-12 of the
    // padded form hold the item reference whatever the source length was.
    const body = String(indicatorDigit) + gtin14.slice(1, 13);
    return { ok: true, value: body + gtinCheckDigit(body) };
  }

  const removed = 14 - GTIN_LENGTHS[target];
  if (/[^0]/.test(gtin14.slice(0, removed))) {
    return { ok: false, error: `This GTIN can't be written as a ${target} without losing significant digits.` };
  }
  return { ok: true, value: gtin14.slice(removed) };
}
