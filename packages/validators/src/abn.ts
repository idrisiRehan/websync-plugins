// Offline ABN / ACN validation.
//
// An Australian Business Number (ABN) is 11 digits. The ATO's published check: subtract 1 from
// the first digit, multiply each of the 11 digits by the weights 10, 1, 3, 5, 7, 9, 11, 13, 15,
// 17, 19, add the products, and the total must divide exactly by 89.
//
// An Australian Company Number (ACN) is 9 digits. ASIC's published check: multiply the first 8
// digits by the weights 8 down to 1, take the sum's remainder on division by 10, and the 9th
// digit must equal (10 - remainder), with 10 written as 0.
//
// A company's ABN is normally its ACN with two leading digits that make the ABN checksum work,
// so the last nine digits of a company ABN are themselves a valid ACN.
//
// None of this says whether the number was ever issued or is still active. Only the Australian
// Business Register (ABN Lookup) and ASIC's register know that.


import type { CheckStatus } from "./types.ts";

export interface AbnCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export type AbnKind = "abn" | "acn" | "unknown";

export interface AbnResult {
  /** Input with spaces and hyphens removed. */
  normalized: string;
  kind: AbnKind;
  valid: boolean;
  checks: AbnCheck[];
  /** Grouped the usual way: "51 824 753 556" for an ABN, "004 085 616" for an ACN. */
  formatted: string | null;
  /** For an ABN whose last nine digits pass the ACN check, those nine digits. */
  embeddedAcn: string | null;
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const ACN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 1];

export function normalizeAbn(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/** The weighted ABN total, or null when the input is not 11 digits. Valid ABNs give a multiple of 89. */
export function abnChecksum(abn: string): number | null {
  if (!/^\d{11}$/.test(abn)) return null;
  const digits = abn.split("").map(Number);
  digits[0] -= 1;
  return digits.reduce((sum, d, i) => sum + d * ABN_WEIGHTS[i], 0);
}

export function isValidAbn(abn: string): boolean {
  const sum = abnChecksum(abn);
  // A leading 0 would become -1 after the subtraction; ABNs never start with 0.
  return sum !== null && abn[0] !== "0" && sum % 89 === 0;
}

/** The ACN check digit for the first 8 digits, or null when the input is not 8 digits. */
export function acnCheckDigit(first8: string): string | null {
  if (!/^\d{8}$/.test(first8)) return null;
  const sum = first8.split("").reduce((s, d, i) => s + Number(d) * ACN_WEIGHTS[i], 0);
  return String((10 - (sum % 10)) % 10);
}

export function isValidAcn(acn: string): boolean {
  return /^\d{9}$/.test(acn) && acnCheckDigit(acn.slice(0, 8)) === acn[8];
}

export function formatAbn(abn: string): string {
  return `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}`;
}

export function formatAcn(acn: string): string {
  return `${acn.slice(0, 3)} ${acn.slice(3, 6)} ${acn.slice(6)}`;
}

export function validateAbnOrAcn(raw: string): AbnResult {
  const normalized = normalizeAbn(raw);
  const result: AbnResult = {
    normalized,
    kind: "unknown",
    valid: false,
    checks: [],
    formatted: null,
    embeddedAcn: null,
  };

  const digitsOnly = /^\d+$/.test(normalized);
  result.checks.push({
    id: "characters",
    label: "Digits only",
    status: digitsOnly ? "pass" : "fail",
    detail: digitsOnly
      ? "Only digits remain once spaces and hyphens are removed."
      : "ABNs and ACNs contain digits only. Remove any letters or other symbols.",
  });

  const kind: AbnKind = normalized.length === 11 ? "abn" : normalized.length === 9 ? "acn" : "unknown";
  result.kind = digitsOnly ? kind : "unknown";
  result.checks.push({
    id: "length",
    label: "Length",
    status: kind === "unknown" ? "fail" : "pass",
    detail:
      kind === "abn"
        ? "11 digits, the length of an ABN."
        : kind === "acn"
          ? "9 digits, the length of an ACN."
          : `${normalized.length} characters. An ABN has 11 digits and an ACN has 9.`,
  });

  if (!digitsOnly || kind === "unknown") {
    result.checks.push({
      id: "checksum",
      label: "Check digits",
      status: "skipped",
      detail: "Not run, because the number is not 9 or 11 digits.",
    });
    return result;
  }

  if (kind === "abn") {
    const sum = abnChecksum(normalized) as number;
    const leadingZero = normalized[0] === "0";
    const pass = isValidAbn(normalized);
    result.checks.push({
      id: "checksum",
      label: "ABN checksum (modulus 89)",
      status: pass ? "pass" : "fail",
      detail: leadingZero
        ? "An ABN cannot start with 0."
        : pass
          ? `The weighted total is ${sum}, which divides exactly by 89.`
          : `The weighted total is ${sum}, which leaves a remainder of ${sum % 89} on division by 89. A digit is wrong or two are swapped.`,
    });
    result.formatted = formatAbn(normalized);
    const tail = normalized.slice(2);
    if (isValidAcn(tail)) result.embeddedAcn = tail;
  } else {
    const expected = acnCheckDigit(normalized.slice(0, 8)) as string;
    const pass = expected === normalized[8];
    result.checks.push({
      id: "checksum",
      label: "ACN check digit",
      status: pass ? "pass" : "fail",
      detail: pass
        ? `The 9th digit (${expected}) matches the check digit calculated from the first eight.`
        : `The 9th digit is ${normalized[8]}. The first eight digits give a check digit of ${expected}.`,
    });
    result.formatted = formatAcn(normalized);
  }

  result.valid = result.checks.every((c) => c.status === "pass");
  return result;
}
