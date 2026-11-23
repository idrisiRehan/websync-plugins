// Offline ABA routing transit number (RTN) validation.
//
// A US routing number is 9 digits. The checksum: 3 x (d1 + d4 + d7) + 7 x (d2 + d5 + d8) +
// (d3 + d6 + d9) must be a multiple of 10. The first two digits must fall in one of the ranges
// the ABA assigns: 00 (US Government), 01-12 (the twelve Federal Reserve districts), 21-32
// (originally thrift institutions; the same districts plus 20), 61-72 (electronic transactions;
// the districts plus 60) or 80 (traveler's checks).
//
// None of this says which bank owns the number, or whether it is still in use. Only the bank,
// or the Federal Reserve's E-Payments Routing Directory, can tell you that.


import type { CheckStatus } from "./types.ts";

export interface RoutingCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface RoutingResult {
  normalized: string;
  valid: boolean;
  checks: RoutingCheck[];
  /** Plain-language reading of the first two digits, when they fall in an assigned range. */
  prefixMeaning: string | null;
  /** Federal Reserve district for prefixes 01-12, 21-32 and 61-72. */
  district: string | null;
}

export const FED_DISTRICTS: Record<number, string> = {
  1: "Boston",
  2: "New York",
  3: "Philadelphia",
  4: "Cleveland",
  5: "Richmond",
  6: "Atlanta",
  7: "Chicago",
  8: "St. Louis",
  9: "Minneapolis",
  10: "Kansas City",
  11: "Dallas",
  12: "San Francisco",
};

export function normalizeRouting(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function routingChecksum(rtn: string): number | null {
  if (!/^\d{9}$/.test(rtn)) return null;
  const d = rtn.split("").map(Number);
  return 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
}

export function readPrefix(prefix: number): { meaning: string; district: string | null } | null {
  if (prefix === 0) return { meaning: "US Government", district: null };
  if (prefix >= 1 && prefix <= 12) return { meaning: "Bank or credit union", district: FED_DISTRICTS[prefix] };
  if (prefix >= 21 && prefix <= 32) return { meaning: "Thrift institution range", district: FED_DISTRICTS[prefix - 20] };
  if (prefix >= 61 && prefix <= 72) return { meaning: "Electronic transactions range", district: FED_DISTRICTS[prefix - 60] };
  if (prefix === 80) return { meaning: "Traveler's checks", district: null };
  return null;
}

export function validateRoutingNumber(raw: string): RoutingResult {
  const normalized = normalizeRouting(raw);
  const result: RoutingResult = { normalized, valid: false, checks: [], prefixMeaning: null, district: null };

  const wellFormed = /^\d{9}$/.test(normalized);
  result.checks.push({
    id: "format",
    label: "Nine digits",
    status: wellFormed ? "pass" : "fail",
    detail: wellFormed
      ? "Nine digits once spaces and hyphens are removed."
      : /^\d*$/.test(normalized)
        ? `${normalized.length} digits. A routing number has exactly 9.`
        : "A routing number contains digits only.",
  });

  if (!wellFormed) {
    result.checks.push(
      { id: "prefix", label: "First two digits", status: "skipped", detail: "Not checked until the number is 9 digits." },
      { id: "checksum", label: "Checksum", status: "skipped", detail: "Not checked until the number is 9 digits." },
    );
    return result;
  }

  const prefix = Number(normalized.slice(0, 2));
  const reading = readPrefix(prefix);
  result.prefixMeaning = reading?.meaning ?? null;
  result.district = reading?.district ?? null;
  result.checks.push({
    id: "prefix",
    label: "First two digits",
    status: reading ? "pass" : "fail",
    detail: reading
      ? `${normalized.slice(0, 2)} is an assigned range (${reading.meaning.toLowerCase()}${reading.district ? `, ${reading.district} Federal Reserve district` : ""}).`
      : `${normalized.slice(0, 2)} is not an assigned range. Routing numbers start with 00-12, 21-32, 61-72 or 80.`,
  });

  const sum = routingChecksum(normalized) as number;
  result.checks.push({
    id: "checksum",
    label: "Checksum",
    status: sum % 10 === 0 ? "pass" : "fail",
    detail:
      sum % 10 === 0
        ? `The weighted total (3-7-1 weights) is ${sum}, a multiple of 10.`
        : `The weighted total (3-7-1 weights) is ${sum}, which is not a multiple of 10. A digit is wrong or two are swapped.`,
  });

  result.valid = result.checks.every((c) => c.status === "pass");
  return result;
}

/** The ninth digit that makes the first eight a valid routing number. */
export function routingCheckDigit(first8: string): string | null {
  if (!/^\d{8}$/.test(first8)) return null;
  const d = first8.split("").map(Number);
  const partial = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5]);
  return String((10 - (partial % 10)) % 10);
}
